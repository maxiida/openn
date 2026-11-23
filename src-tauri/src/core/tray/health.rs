use crate::config::Config;
use crate::core::handle;
use crate::process::AsyncHandler;
use crate::utils::notification::{NotificationEvent, needs_system_notification, notify_event};
use crate::utils::window_manager::WindowManager;
use crate::{Type, logging};
use parking_lot::{Mutex, const_mutex};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime};
use tauri::async_runtime::JoinHandle;

use super::{Tray, status_icon};

const DEFAULT_PROBE_URL: &str = "http://cp.cloudflare.com/generate_204";
/// Reached without the node, so a failure here points at the local network instead.
const DIRECT_PROBE_URL: &str = "https://www.baidu.com";
/// A node slower than this is unusable in practice, so it counts as down.
const PROBE_TIMEOUT_MS: u32 = 5000;
/// One dropped probe or a Wi-Fi hop must not turn the dot red.
const FAILURE_THRESHOLD: u32 = 3;
const HEALTHY_INTERVAL: Duration = Duration::from_secs(30);
const RETRY_INTERVAL: Duration = Duration::from_secs(10);
/// A node the user just picked gets the home page's quicker verdict, so the dot and the page agree.
const SWITCH_FAILURE_THRESHOLD: u32 = 2;
const SWITCH_RETRY_INTERVAL: Duration = Duration::from_secs(3);
/// Tokio timers stop while the Mac sleeps, so a wall-clock gap this far past the wait marks a wake-up.
const SLEEP_SLACK: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AiNodeState {
    /// AI routing is off, or the app is disconnected.
    Off,
    Ok,
    Down,
    /// The chosen node is not in the profile, so AI falls back to the main node.
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct AiNodeHealth {
    pub state: AiNodeState,
    pub node: Option<std::string::String>,
}

const AI_OFF: AiNodeHealth = AiNodeHealth {
    state: AiNodeState::Off,
    node: None,
};

/// What the last generated config did with the AI node: the node and whether its rules went in.
/// Read from the config rather than the settings, so a switch flipped a moment ago is not
/// reported as missing before the config catches up.
static AI_ROUTING: Mutex<Option<(std::string::String, bool)>> = const_mutex(None);
static AI_HEALTH: Mutex<AiNodeHealth> = const_mutex(AI_OFF);

/// A recovery is only announced when the user was told about the failure.
static NODE_DOWN_NOTIFIED: AtomicBool = AtomicBool::new(false);
static AI_DOWN_NOTIFIED: AtomicBool = AtomicBool::new(false);
/// A node that keeps dropping and coming back must not fill the screen with notifications.
const NOTIFY_COOLDOWN: Duration = Duration::from_secs(600);
static LAST_NOTIFIED: Mutex<Option<HashMap<&'static str, Instant>>> = const_mutex(None);

pub fn set_ai_routing(routing: Option<(std::string::String, bool)>) {
    *AI_ROUTING.lock() = routing;
}

/// Whether the running config sends AI services to their own node.
pub fn ai_routed() -> bool {
    AI_ROUTING.lock().as_ref().is_some_and(|(_, routed)| *routed)
}

pub fn ai_node_health() -> AiNodeHealth {
    AI_HEALTH.lock().clone()
}

pub fn global() -> &'static HealthMonitor {
    static MONITOR: OnceLock<HealthMonitor> = OnceLock::new();
    MONITOR.get_or_init(|| HealthMonitor { task: Mutex::new(None) })
}

/// Probes the selected node while connected and marks the status icon unhealthy once it stops answering.
pub struct HealthMonitor {
    task: Mutex<Option<JoinHandle<()>>>,
}

impl HealthMonitor {
    pub fn update(&self, connected: bool) {
        if connected {
            let mut task = self.task.lock();
            if task.as_ref().is_none_or(|task| task.inner().is_finished()) {
                *task = Some(AsyncHandler::spawn(|| run(false)));
            }
        } else {
            let task = self.task.lock().take();
            if let Some(task) = task {
                task.abort();
            }
            if status_icon::global().set_unhealthy(false) {
                handle::Handle::connection_health_changed(false);
            }
            AsyncHandler::spawn(|| set_ai_health(AI_OFF));
        }
    }

    /// Starts over after a node switch. `known_dead` is the node list's last result for the new
    /// node, which holds until a probe says otherwise.
    pub async fn recheck(&self, known_dead: bool) {
        let Some(running) = self.task.lock().take() else { return };
        running.abort();
        set_unhealthy(known_dead).await;
        self.task
            .lock()
            .get_or_insert_with(|| AsyncHandler::spawn(|| run(true)));
    }
}

async fn set_unhealthy(unhealthy: bool) {
    if status_icon::global().set_unhealthy(unhealthy) {
        logging!(info, Type::Tray, "connection health changed, unhealthy: {unhealthy}");
        handle::Handle::connection_health_changed(unhealthy);
        let verge = Config::verge().await.data_arc();
        status_icon::global().sync(Tray::is_connected(&verge));
        notify_node_health(unhealthy).await;
    }
}

async fn notify_node_health(unhealthy: bool) {
    let view = crate::cmd::get_proxy_view().await.ok();
    let node = view
        .as_ref()
        .and_then(|view| view.main_group())
        .and_then(|group| group.now.as_deref())
        .unwrap_or_default()
        .to_owned();
    if unhealthy {
        // The node is blamed only when the network itself still works.
        let sent = if probe_direct_ok().await {
            notify_if_away(NotificationEvent::NodeDown { node: &node }, "node down").await
        } else {
            notify_if_away(NotificationEvent::NetworkDown, "network down").await
        };
        NODE_DOWN_NOTIFIED.store(sent, Ordering::Relaxed);
    } else if NODE_DOWN_NOTIFIED.swap(false, Ordering::Relaxed) {
        notify_if_away(NotificationEvent::NodeRecovered { node: &node }, "node recovered").await;
    }
}

/// Records a notification of this kind unless one went out within `NOTIFY_COOLDOWN`.
fn claim_notification(what: &'static str) -> bool {
    let mut guard = LAST_NOTIFIED.lock();
    let last = guard.get_or_insert_with(HashMap::new);
    let claimed = last.get(what).is_none_or(|at| at.elapsed() >= NOTIFY_COOLDOWN);
    if claimed {
        last.insert(what, Instant::now());
    }
    drop(guard);
    claimed
}

/// Sends a system notification unless Openn's window is in front, where the page already shows
/// the state, or the same kind went out within `NOTIFY_COOLDOWN`. Returns whether it went out.
async fn notify_if_away(event: NotificationEvent<'_>, what: &'static str) -> bool {
    let window = WindowManager::get_main_window_state();
    if !needs_system_notification(window) {
        logging!(info, Type::Tray, "{what}: notification skipped, window {window:?}");
        return false;
    }
    if !claim_notification(what) {
        logging!(
            info,
            Type::Tray,
            "{what}: notification skipped, sent one less than 10 minutes ago"
        );
        return false;
    }
    logging!(info, Type::Tray, "{what}: notification sent, window {window:?}");
    notify_event(event).await;
    true
}

async fn run(mut just_switched: bool) {
    let mut failures = 0u32;
    let mut ai = AiProbe::default();
    let mut last_probe: Option<(SystemTime, Duration)> = None;
    while !handle::Handle::global().is_exiting() {
        if let Some((at, wait)) = last_probe
            && let Ok(gap) = SystemTime::now().duration_since(at)
            && gap > wait + SLEEP_SLACK
        {
            logging!(
                info,
                Type::Tray,
                "health probe: resumed {}s after the last one (expected {}s), likely after sleep",
                gap.as_secs(),
                wait.as_secs()
            );
        }
        let main = probe().await;
        match main {
            Some(false) => failures += 1,
            Some(true) | None => {
                if failures > 0 {
                    logging!(info, Type::Tray, "health probe: recovered after {failures} failure(s)");
                }
                failures = 0;
                just_switched = false;
            }
        }
        let threshold = if just_switched {
            SWITCH_FAILURE_THRESHOLD
        } else {
            FAILURE_THRESHOLD
        };
        // Between the first failure and the threshold the dot keeps what it showed.
        if failures == 0 || failures >= threshold {
            set_unhealthy(failures > 0).await;
        }
        set_ai_health(ai.check(main).await).await;
        let interval = if failures == 0 && ai.failures == 0 {
            HEALTHY_INTERVAL
        } else if just_switched {
            SWITCH_RETRY_INTERVAL
        } else {
            RETRY_INTERVAL
        };
        last_probe = Some((SystemTime::now(), interval));
        tokio::time::sleep(interval).await;
    }
}

/// `None` when there is no node to test.
async fn probe() -> Option<bool> {
    let view = match crate::cmd::get_proxy_view().await {
        Ok(view) => view,
        Err(err) => {
            logging!(
                info,
                Type::Tray,
                "health probe failed: proxy view unavailable: {}",
                err.detail
            );
            return Some(false);
        }
    };
    let group = view.main_group()?;
    let url = match group.test_url.as_deref().filter(|url| !url.is_empty()) {
        Some(url) => url.to_owned(),
        None => Config::verge()
            .await
            .latest_arc()
            .default_latency_test
            .as_deref()
            .filter(|url| !url.is_empty())
            .unwrap_or(DEFAULT_PROBE_URL)
            .to_owned(),
    };
    let node = group.now.as_deref().unwrap_or("?");
    let started = Instant::now();
    let failure = match handle::Handle::mihomo()
        .delay_proxy_by_name(&group.name, &url, PROBE_TIMEOUT_MS)
        .await
    {
        Ok(result) if result.delay > 0 => return Some(true),
        Ok(_) => format!("no response from {url} within {PROBE_TIMEOUT_MS}ms"),
        Err(err) => format!("core request failed: {err}"),
    };
    logging!(
        info,
        Type::Tray,
        "health probe failed: node {node} in {}: {failure} (after {}ms); direct: {}",
        group.name,
        started.elapsed().as_millis(),
        probe_direct().await
    );
    Some(false)
}

async fn probe_direct_ok() -> bool {
    handle::Handle::mihomo()
        .delay_proxy_by_name("DIRECT", DIRECT_PROBE_URL, PROBE_TIMEOUT_MS)
        .await
        .is_ok_and(|result| result.delay > 0)
}

async fn probe_direct() -> String {
    match handle::Handle::mihomo()
        .delay_proxy_by_name("DIRECT", DIRECT_PROBE_URL, PROBE_TIMEOUT_MS)
        .await
    {
        Ok(result) if result.delay > 0 => format!("ok in {}ms", result.delay),
        Ok(_) => format!("no response from {DIRECT_PROBE_URL} within {PROBE_TIMEOUT_MS}ms"),
        Err(err) => format!("core request failed: {err}"),
    }
}

#[derive(Default)]
struct AiProbe {
    node: Option<std::string::String>,
    failures: u32,
}

impl AiProbe {
    async fn check(&mut self, main: Option<bool>) -> AiNodeHealth {
        let routing = AI_ROUTING.lock().clone();
        let Some((node, routed)) = routing else {
            *self = Self::default();
            return AI_OFF;
        };
        if self.node.as_deref() != Some(node.as_str()) {
            *self = Self {
                node: Some(node.clone()),
                failures: 0,
            };
        }
        if !routed {
            self.failures = 0;
            return AiNodeHealth {
                state: AiNodeState::Missing,
                node: Some(node),
            };
        }
        // When the main node fails too the network is the likely cause, which says nothing about
        // the AI node, so only a working main node lets the AI node's result count.
        if main == Some(true) {
            if probe_node(&node).await {
                self.failures = 0;
            } else {
                self.failures += 1;
            }
        }
        let state = if self.failures >= FAILURE_THRESHOLD {
            AiNodeState::Down
        } else if self.failures == 0 {
            AiNodeState::Ok
        } else {
            // Between the first failure and the threshold the verdict keeps what it showed.
            let shown = AI_HEALTH.lock().clone();
            if shown.node.as_deref() == Some(node.as_str()) && shown.state != AiNodeState::Off {
                shown.state
            } else {
                AiNodeState::Ok
            }
        };
        AiNodeHealth {
            state,
            node: Some(node),
        }
    }
}

async fn probe_node(node: &str) -> bool {
    let url = Config::verge()
        .await
        .latest_arc()
        .default_latency_test
        .as_deref()
        .filter(|url| !url.is_empty())
        .unwrap_or(DEFAULT_PROBE_URL)
        .to_owned();
    match handle::Handle::mihomo()
        .delay_proxy_by_name(node, &url, PROBE_TIMEOUT_MS)
        .await
    {
        Ok(result) if result.delay > 0 => true,
        Ok(_) => {
            logging!(
                info,
                Type::Tray,
                "AI node probe failed: {node}: no response from {url} within {PROBE_TIMEOUT_MS}ms"
            );
            false
        }
        Err(err) => {
            logging!(
                info,
                Type::Tray,
                "AI node probe failed: {node}: core request failed: {err}"
            );
            false
        }
    }
}

async fn set_ai_health(next: AiNodeHealth) {
    let previous = {
        let mut shown = AI_HEALTH.lock();
        if *shown == next {
            return;
        }
        std::mem::replace(&mut *shown, next.clone())
    };
    logging!(
        info,
        Type::Tray,
        "AI node health changed: {:?} -> {:?} ({:?})",
        previous.state,
        next.state,
        next.node
    );
    if let Ok(payload) = serde_json::to_value(&next) {
        handle::Handle::ai_node_health_changed(payload);
    }

    let Some(node) = next.node.as_deref() else {
        AI_DOWN_NOTIFIED.store(false, Ordering::Relaxed);
        return;
    };
    match next.state {
        AiNodeState::Down => {
            let sent = notify_if_away(NotificationEvent::AiNodeDown { node }, "AI node down").await;
            AI_DOWN_NOTIFIED.store(sent, Ordering::Relaxed);
        }
        AiNodeState::Missing => {
            AI_DOWN_NOTIFIED.store(false, Ordering::Relaxed);
            notify_if_away(NotificationEvent::AiNodeMissing { node }, "AI node missing").await;
        }
        AiNodeState::Ok => {
            let same_node = previous.node.as_deref() == Some(node);
            if AI_DOWN_NOTIFIED.swap(false, Ordering::Relaxed) && same_node {
                notify_if_away(NotificationEvent::AiNodeRecovered { node }, "AI node recovered").await;
            }
        }
        AiNodeState::Off => AI_DOWN_NOTIFIED.store(false, Ordering::Relaxed),
    }
}
