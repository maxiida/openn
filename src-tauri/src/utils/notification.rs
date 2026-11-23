use std::borrow::Cow;

use crate::{core::handle, utils::window_manager::WindowState};
use clash_verge_i18n;
use tauri_plugin_notification::NotificationExt as _;

pub enum NotificationEvent<'a> {
    DashboardToggled,
    ClashModeChanged {
        mode: &'a str,
    },
    SystemProxyToggled(bool),
    /// A proxy change failed while no window could report it.
    SystemProxyFailed,
    /// The system proxy guard stopped.
    SystemProxyGuardStopped,
    TunModeToggled(bool),
    LightweightModeEntered,
    ProfilesReactivated,
    AppQuit,
    #[cfg(target_os = "macos")]
    AppHidden,
    NodeDown {
        node: &'a str,
    },
    /// The node and the direct connection both fail: the local network is down.
    NetworkDown,
    NodeRecovered {
        node: &'a str,
    },
    AiNodeDown {
        node: &'a str,
    },
    AiNodeMissing {
        node: &'a str,
    },
    AiNodeRecovered {
        node: &'a str,
    },
}

/// Whether the user could miss an in-app notice: unless Openn's window is in front, they are
/// looking at something else.
pub const fn needs_system_notification(state: WindowState) -> bool {
    !matches!(state, WindowState::VisibleFocused)
}

fn notify(title: Cow<'_, str>, body: Cow<'_, str>) {
    let app_handle = handle::Handle::app_handle();
    app_handle.notification().builder().title(title).body(body).show().ok();
}

pub async fn notify_event<'a>(event: NotificationEvent<'a>) {
    match event {
        NotificationEvent::DashboardToggled => {
            let title = clash_verge_i18n::t!("notifications.dashboardToggled.title");
            let body = clash_verge_i18n::t!("notifications.dashboardToggled.body");
            notify(title, body);
        }
        NotificationEvent::ClashModeChanged { mode } => {
            let title = clash_verge_i18n::t!("notifications.clashModeChanged.title");
            let body = clash_verge_i18n::t!("notifications.clashModeChanged.body")
                .replace("{mode}", mode)
                .into();
            notify(title, body);
        }
        NotificationEvent::SystemProxyToggled(enabled) => {
            let title = clash_verge_i18n::t!("notifications.systemProxyToggled.title");
            let key = if enabled {
                "notifications.systemProxyToggled.on"
            } else {
                "notifications.systemProxyToggled.off"
            };

            let body = clash_verge_i18n::t!(key);
            notify(title, body);
        }
        NotificationEvent::SystemProxyFailed => {
            let title = clash_verge_i18n::t!("notifications.systemProxyFailed.title");
            let body = clash_verge_i18n::t!("notifications.systemProxyFailed.body");
            notify(title, body);
        }
        NotificationEvent::SystemProxyGuardStopped => {
            let title = clash_verge_i18n::t!("notifications.systemProxyGuardStopped.title");
            let body = clash_verge_i18n::t!("notifications.systemProxyGuardStopped.body");
            notify(title, body);
        }
        NotificationEvent::TunModeToggled(enabled) => {
            let title = clash_verge_i18n::t!("notifications.tunModeToggled.title");
            let key = if enabled {
                "notifications.tunModeToggled.on"
            } else {
                "notifications.tunModeToggled.off"
            };
            let body = clash_verge_i18n::t!(key);
            notify(title, body);
        }
        NotificationEvent::LightweightModeEntered => {
            let title = clash_verge_i18n::t!("notifications.lightweightModeEntered.title");
            let body = clash_verge_i18n::t!("notifications.lightweightModeEntered.body");
            notify(title, body);
        }
        NotificationEvent::ProfilesReactivated => {
            let title = clash_verge_i18n::t!("notifications.profilesReactivated.title");
            let body = clash_verge_i18n::t!("notifications.profilesReactivated.body");
            notify(title, body);
        }
        NotificationEvent::AppQuit => {
            let title = clash_verge_i18n::t!("notifications.appQuit.title");
            let body = clash_verge_i18n::t!("notifications.appQuit.body");
            notify(title, body);
        }
        #[cfg(target_os = "macos")]
        NotificationEvent::AppHidden => {
            let title = clash_verge_i18n::t!("notifications.appHidden.title");
            let body = clash_verge_i18n::t!("notifications.appHidden.body");
            notify(title, body);
        }
        NotificationEvent::NodeDown { node } => {
            let title = clash_verge_i18n::t!("notifications.nodeDown.title");
            let body = clash_verge_i18n::t!("notifications.nodeDown.body")
                .replace("{node}", node)
                .into();
            notify(title, body);
        }
        NotificationEvent::NetworkDown => {
            let title = clash_verge_i18n::t!("notifications.networkDown.title");
            let body = clash_verge_i18n::t!("notifications.networkDown.body");
            notify(title, body);
        }
        NotificationEvent::NodeRecovered { node } => {
            let title = clash_verge_i18n::t!("notifications.nodeRecovered.title");
            let body = clash_verge_i18n::t!("notifications.nodeRecovered.body")
                .replace("{node}", node)
                .into();
            notify(title, body);
        }
        NotificationEvent::AiNodeDown { node } => {
            let title = clash_verge_i18n::t!("notifications.aiNodeDown.title");
            let body = clash_verge_i18n::t!("notifications.aiNodeDown.body")
                .replace("{node}", node)
                .into();
            notify(title, body);
        }
        NotificationEvent::AiNodeMissing { node } => {
            let title = clash_verge_i18n::t!("notifications.aiNodeMissing.title");
            let body = clash_verge_i18n::t!("notifications.aiNodeMissing.body")
                .replace("{node}", node)
                .into();
            notify(title, body);
        }
        NotificationEvent::AiNodeRecovered { node } => {
            let title = clash_verge_i18n::t!("notifications.aiNodeRecovered.title");
            let body = clash_verge_i18n::t!("notifications.aiNodeRecovered.body")
                .replace("{node}", node)
                .into();
            notify(title, body);
        }
    }
}
