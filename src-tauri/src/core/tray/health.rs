use crate::config::Config;
use crate::core::handle;
use crate::process::AsyncHandler;
use crate::{Type, logging};
use parking_lot::Mutex;
use std::sync::OnceLock;
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
    }
}

async fn run(mut just_switched: bool) {
    let mut failures = 0u32;
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
        match probe().await {
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
        let interval = if failures == 0 {
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
