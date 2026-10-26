use crate::config::IVerge;
use crate::module::lightweight;
use crate::process::AsyncHandler;
use crate::singleton;
use crate::utils::window_manager::WindowManager;
use crate::{
    Type,
    config::Config,
    core::{CoreManager, manager::RunningMode, runstate::RUN_STATE},
    feat, logging,
    utils::dirs::find_target_icons,
};
use clash_verge_limiter::{Limiter, SystemClock, SystemLimiter};
use clash_verge_logging::logging_error;
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tokio::fs;

use super::handle;
use anyhow::Result;
use smartstring::alias::String;
use std::borrow::Cow;
use std::collections::HashMap;
use std::time::Duration;
use tauri::{
    AppHandle, Wry,
    menu::{IsMenuItem, MenuEvent, MenuItem, PredefinedMenuItem},
};

#[cfg(target_os = "macos")]
mod appearance;
#[cfg(target_os = "macos")]
mod dock_icon;
#[cfg(target_os = "macos")]
mod health;
mod menu_def;
#[cfg(target_os = "macos")]
mod speed_task;
#[cfg(target_os = "macos")]
mod status_icon;
use menu_def::{MenuIds, MenuTexts};

// TODO: 是否需要将可变菜单抽离存储起来，后续直接更新对应菜单实例，无需重新创建菜单(待考虑)

const TRAY_CLICK_DEBOUNCE_MS: u64 = 300;
pub const TRAY_ID: &str = "clash-verge-rev-tray";

#[derive(Clone)]
struct TrayState {}

enum IconKind {
    Common,
    SysProxy,
    Tun,
}

pub struct Tray {
    limiter: SystemLimiter,
    #[cfg(target_os = "macos")]
    speed_controller: speed_task::TraySpeedController,
}

impl TrayState {
    async fn get_tray_icon(verge: &IVerge) -> (bool, Cow<'_, [u8]>) {
        let tun_mode = verge.enable_tun_mode.unwrap_or(false) && crate::core::runstate::RUN_STATE.state().tun_capable();
        let system_mode = verge.enable_system_proxy.unwrap_or(false);
        let kind = if tun_mode {
            IconKind::Tun
        } else if system_mode {
            IconKind::SysProxy
        } else {
            IconKind::Common
        };
        Self::load_icon(verge, kind).await
    }

    async fn load_icon(verge: &IVerge, kind: IconKind) -> (bool, Cow<'_, [u8]>) {
        let (custom_enabled, icon_name) = match kind {
            IconKind::Common => (verge.common_tray_icon.unwrap_or(false), "common"),
            IconKind::SysProxy => (verge.sysproxy_tray_icon.unwrap_or(false), "sysproxy"),
            IconKind::Tun => (verge.tun_tray_icon.unwrap_or(false), "tun"),
        };

        if custom_enabled
            && let Ok(Some(path)) = find_target_icons(icon_name)
            && let Ok(data) = fs::read(path).await
        {
            return (true, Cow::Owned(data));
        }

        Self::default_icon(verge, kind)
    }

    #[allow(clippy::missing_const_for_fn)]
    fn default_icon(verge: &IVerge, kind: IconKind) -> (bool, Cow<'_, [u8]>) {
        #[cfg(target_os = "macos")]
        {
            let is_mono = verge.tray_icon.as_deref().unwrap_or("monochrome") == "monochrome";
            if is_mono {
                return (
                    false,
                    match kind {
                        IconKind::Common => Cow::Borrowed(include_bytes!("../../../icons/tray-icon-mono.ico")),
                        IconKind::SysProxy => {
                            Cow::Borrowed(include_bytes!("../../../icons/tray-icon-sys-mono-new.ico"))
                        }
                        IconKind::Tun => Cow::Borrowed(include_bytes!("../../../icons/tray-icon-tun-mono-new.ico")),
                    },
                );
            }
        }

        #[cfg(not(target_os = "macos"))]
        let _ = verge;

        (
            false,
            match kind {
                IconKind::Common => Cow::Borrowed(include_bytes!("../../../icons/tray-icon.ico")),
                IconKind::SysProxy => Cow::Borrowed(include_bytes!("../../../icons/tray-icon-sys.ico")),
                IconKind::Tun => Cow::Borrowed(include_bytes!("../../../icons/tray-icon-tun.ico")),
            },
        )
    }
}

impl Default for Tray {
    #[allow(clippy::unwrap_used)]
    fn default() -> Self {
        Self {
            limiter: Limiter::new(Duration::from_millis(TRAY_CLICK_DEBOUNCE_MS), SystemClock),
            #[cfg(target_os = "macos")]
            speed_controller: speed_task::TraySpeedController::new(),
        }
    }
}

singleton!(Tray, TRAY);

impl Tray {
    fn new() -> Self {
        Self::default()
    }

    pub async fn init(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘初始化");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        match self.create_tray_from_handle(app_handle).await {
            Ok(_) => {
                logging!(info, Type::Tray, "System tray created successfully");
            }
            Err(e) => {
                logging!(
                    warn,
                    Type::Tray,
                    "System tray creation failed: {e}, Application will continue running without tray icon",
                );
            }
        }
        Ok(())
    }

    pub fn update_click_behavior(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘点击行为更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();
        let tray = app_handle
            .tray_by_id(TRAY_ID)
            .ok_or_else(|| anyhow::anyhow!("Failed to get main tray"))?;
        // Left click is the connect switch, so the menu stays on right click.
        tray.set_show_menu_on_left_click(false)?;
        Ok(())
    }

    pub async fn update_menu(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘菜单更新");
            return Ok(());
        }
        let app_handle = handle::Handle::app_handle();
        let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
            logging!(warn, Type::Tray, "Failed to update tray menu: tray not found");
            return Ok(());
        };

        logging_error!(Type::Tray, tray.set_menu(Some(create_tray_menu(app_handle).await?)));

        logging!(debug, Type::Tray, "托盘菜单更新成功");
        Ok(())
    }

    fn is_connected(verge: &IVerge) -> bool {
        let tun_mode = verge.enable_tun_mode.unwrap_or(false) && crate::core::runstate::RUN_STATE.state().tun_capable();
        tun_mode || verge.enable_system_proxy.unwrap_or(false)
    }

    pub async fn update_icon(&self, verge: &IVerge) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘图标更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
            logging!(warn, Type::Tray, "Failed to update tray icon: tray not found");
            return Ok(());
        };

        let (is_custom_icon, icon_bytes) = TrayState::get_tray_icon(verge).await;

        #[cfg(target_os = "macos")]
        if !is_custom_icon {
            let connected = Self::is_connected(verge);
            health::global().update(connected);
            status_icon::global().sync(connected);
            return Ok(());
        }

        let template = {
            #[cfg(target_os = "macos")]
            {
                verge.tray_icon.as_ref().is_none_or(|v| v == "monochrome")
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        };
        let icon = Some(tauri::image::Image::from_bytes(&icon_bytes)?);

        logging_error!(Type::Tray, tray.set_icon_with_as_template(icon, template));

        Ok(())
    }

    pub async fn update_tooltip(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘提示更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        let verge = Config::verge().await.latest_arc();
        let system_proxy = verge.enable_system_proxy.unwrap_or(false);
        let tun_mode = verge.enable_tun_mode.unwrap_or(false) && crate::core::runstate::RUN_STATE.state().tun_capable();

        let switch_str = |flag: bool| {
            if flag { "on" } else { "off" }
        };

        let mut current_profile_name = "None".into();
        {
            let profiles = Config::profiles().await;
            let profiles = profiles.latest_arc();
            if let Some(current_profile_uid) = profiles.current.as_ref()
                && let Ok(profile) = profiles.get_item(current_profile_uid)
            {
                current_profile_name = match &profile.name {
                    Some(profile_name) => profile_name.to_string(),
                    None => current_profile_name,
                };
            }
        }

        let sys_proxy_text = clash_verge_i18n::t!("tray.tooltip.systemProxy");
        let tun_text = clash_verge_i18n::t!("tray.tooltip.tun");
        let profile_text = clash_verge_i18n::t!("tray.tooltip.profile");

        let v = env!("CARGO_PKG_VERSION");
        let reassembled_version = v.split_once('+').map_or_else(
            || v.into(),
            |(main, rest)| format!("{main}+{}", rest.split('.').next().unwrap_or("")),
        );

        let tooltip = format!(
            "Openn {}\n{}: {}\n{}: {}\n{}: {}",
            reassembled_version,
            sys_proxy_text,
            switch_str(system_proxy),
            tun_text,
            switch_str(tun_mode),
            profile_text,
            current_profile_name
        );

        let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
            logging!(warn, Type::Tray, "Failed to update tray tooltip: tray not found");
            return Ok(());
        };

        logging_error!(Type::Tray, tray.set_tooltip(Some(&tooltip)));

        Ok(())
    }

    pub async fn update_part(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘局部更新");
            return Ok(());
        }
        let verge = Config::verge().await.data_arc();
        self.update_menu().await?;
        self.update_icon(&verge).await?;
        #[cfg(target_os = "macos")]
        self.update_speed_task(verge.enable_tray_speed.unwrap_or(false));
        self.update_tooltip().await?;
        Ok(())
    }

    pub async fn update_menu_and_icon(&self) {
        logging_error!(Type::Tray, self.update_menu().await);
        let verge = Config::verge().await.data_arc();
        logging_error!(Type::Tray, self.update_icon(&verge).await);
    }

    async fn create_tray_from_handle(&self, app_handle: &AppHandle) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘创建");
            return Ok(());
        }

        logging!(info, Type::Tray, "正在从AppHandle创建系统托盘");

        let verge = Config::verge().await.data_arc();

        let (is_custom_icon, icon_bytes) = TrayState::get_tray_icon(&verge).await;
        #[cfg(target_os = "macos")]
        let icon = if is_custom_icon {
            tauri::image::Image::from_bytes(&icon_bytes)?
        } else {
            status_icon::global().initial_image(Self::is_connected(&verge))
        };
        #[cfg(not(target_os = "macos"))]
        let icon = {
            let _ = is_custom_icon;
            tauri::image::Image::from_bytes(&icon_bytes)?
        };

        #[cfg(target_os = "linux")]
        let builder = TrayIconBuilder::with_id(TRAY_ID).icon(icon).icon_as_template(false);

        #[cfg(not(target_os = "linux"))]
        let mut builder = TrayIconBuilder::with_id(TRAY_ID).icon(icon).icon_as_template(false);
        #[cfg(target_os = "macos")]
        {
            let is_monochrome = is_custom_icon && verge.tray_icon.as_ref().is_none_or(|v| v == "monochrome");
            builder = builder.icon_as_template(is_monochrome);
        }

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            builder = builder.show_menu_on_left_click(false);
        }

        let tray = builder.build(app_handle)?;
        #[cfg(target_os = "macos")]
        if !is_custom_icon {
            logging_error!(
                Type::Tray,
                tray.with_inner_tray_icon(|inner| {
                    if let (Some(status_item), Some(mtm)) = (inner.ns_status_item(), objc2::MainThreadMarker::new()) {
                        appearance::observe(&status_item, mtm);
                    }
                })
            );
        }
        tray.on_tray_icon_event(on_tray_icon_event);
        tray.on_menu_event(on_menu_event);
        Ok(())
    }

    /// Shows the "connecting" icon while `toggle` runs, then settles on the resulting state.
    async fn run_connecting<T>(&self, toggle: impl std::future::Future<Output = T>) -> T {
        #[cfg(target_os = "macos")]
        {
            let verge = Config::verge().await.data_arc();
            if !Self::is_connected(&verge) {
                status_icon::global().set_connecting(true);
                status_icon::global().sync(false);
            }
            let result = toggle.await;
            status_icon::global().set_connecting(false);
            let verge = Config::verge().await.data_arc();
            status_icon::global().sync(Self::is_connected(&verge));
            result
        }
        #[cfg(not(target_os = "macos"))]
        {
            toggle.await
        }
    }

    /// One-tap connect switch. Anything that needs the user (no profile, service setup, a failure)
    /// is handed to the main window, whose connect flow can prompt and explain.
    async fn toggle_connection(&self) {
        let verge = Config::verge().await.data_arc();
        if Self::is_connected(&verge) {
            Box::pin(self.run_connecting(disconnect())).await;
            return;
        }
        if !prepare_tunnel().await {
            open_main_window().await;
            return;
        }
        if let Err(err) = Box::pin(self.run_connecting(connect_tunnel())).await {
            logging!(error, Type::Tray, "tray connect failed: {err:#}");
            open_main_window().await;
        }
    }

    fn should_handle_tray_click(&self) -> bool {
        let allow = self.limiter.check();
        if !allow {
            logging!(debug, Type::Tray, "tray click rate limited");
        }
        allow
    }

    #[cfg(target_os = "macos")]
    pub fn update_speed_task(&self, enable_tray_speed: bool) {
        self.speed_controller.update_task(enable_tray_speed);
    }
}

async fn open_main_window() {
    if !lightweight::exit_lightweight_mode().await {
        WindowManager::show_main_window().await;
    }
}

async fn open_nodes_page() {
    const NODES_PAGE: &str = "/nodes";
    // A window created now misses the event, so it has to load straight into the page.
    let window_exists = WindowManager::get_main_window().is_some();
    if !window_exists {
        crate::utils::resolve::window::open_next_window_at(NODES_PAGE);
    }
    open_main_window().await;
    if window_exists {
        handle::Handle::navigate(NODES_PAGE);
    }
}

/// Mirrors the main window's connect preconditions; returns false when the user has to step in.
async fn prepare_tunnel() -> bool {
    if Config::profiles().await.latest_arc().current.is_none() {
        return false;
    }
    let state = RUN_STATE.state();
    if state.op_in_flight || !state.tun_capable() {
        return false;
    }
    let privileged = |mode: RunningMode, is_admin: bool| match mode {
        RunningMode::Service => true,
        RunningMode::Sidecar => is_admin,
        RunningMode::NotRunning => false,
    };
    if privileged(state.mode, state.is_admin) {
        return true;
    }
    // The Service is ready but the Core still runs unprivileged; a restart moves it onto the Service.
    if let Err(err) = CoreManager::global().restart_core().await {
        logging!(warn, Type::Tray, "tray connect: core restart failed: {err:#}");
        return false;
    }
    handle::Handle::refresh_clash();
    let state = RUN_STATE.state();
    state.tun_capable() && privileged(state.mode, state.is_admin)
}

async fn connect_tunnel() -> Result<()> {
    let mode = Config::clash()
        .await
        .latest_arc()
        .0
        .get("mode")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    if mode.as_deref().is_some_and(|m| !m.eq_ignore_ascii_case("rule")) {
        feat::change_clash_mode("rule".into())
            .await
            .map_err(|err| anyhow::anyhow!("switch to rule mode: {err}"))?;
    }
    feat::patch_verge(
        &IVerge {
            enable_tun_mode: Some(true),
            ..IVerge::default()
        },
        false,
    )
    .await?;
    // Reconciliation may turn TUN straight back off when the Core cannot carry it.
    anyhow::ensure!(
        Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false),
        "TUN was not enabled"
    );
    // The tunnel already carries every app, and a system proxy that outlives its listener takes the
    // machine offline, so clear it; failing to must not tear down a working tunnel.
    logging_error!(
        Type::Tray,
        feat::patch_verge(
            &IVerge {
                enable_system_proxy: Some(false),
                ..IVerge::default()
            },
            false,
        )
        .await
    );
    handle::Handle::refresh_verge();
    Ok(())
}

async fn disconnect() {
    // Each path must be released even if releasing the other one fails.
    for patch in [
        IVerge {
            enable_system_proxy: Some(false),
            ..IVerge::default()
        },
        IVerge {
            enable_tun_mode: Some(false),
            ..IVerge::default()
        },
    ] {
        logging_error!(Type::Tray, feat::patch_verge(&patch, false).await);
    }
    handle::Handle::refresh_verge();
}

fn create_hotkeys(hotkeys: &Option<Vec<String>>) -> HashMap<&str, &str> {
    hotkeys
        .as_ref()
        .map(|h| {
            h.iter()
                .filter_map(|item| {
                    let mut parts = item.split(',');
                    match (parts.next(), parts.next()) {
                        (Some(func), Some(key)) => {
                            // 托盘菜单中的 `accelerator` 属性，在 Linux/Windows 中都不支持小键盘按键的解析
                            if key.to_uppercase().contains("NUMPAD") {
                                None
                            } else {
                                Some((func, key))
                            }
                        }
                        _ => None,
                    }
                })
                .collect::<HashMap<&str, &str>>()
        })
        .unwrap_or_default()
}

async fn create_tray_menu(app_handle: &AppHandle) -> Result<tauri::menu::Menu<Wry>> {
    let verge_settings = Config::verge().await.latest_arc();
    let hotkeys = create_hotkeys(&verge_settings.hotkeys);

    let texts = MenuTexts::new();
    let open_window = &MenuItem::with_id(
        app_handle,
        MenuIds::DASHBOARD,
        clash_verge_i18n::translate(texts.dashboard),
        true,
        hotkeys.get("open_or_close_dashboard").copied(),
    )?;

    let proxies = &MenuItem::with_id(
        app_handle,
        MenuIds::PROXIES,
        clash_verge_i18n::translate(texts.proxies),
        true,
        None::<&str>,
    )?;

    let quit_accelerator = hotkeys.get("quit").copied();

    #[cfg(target_os = "macos")]
    let quit_accelerator = quit_accelerator.or(Some("Cmd+Q"));

    let quit = &MenuItem::with_id(
        app_handle,
        MenuIds::EXIT,
        clash_verge_i18n::translate(texts.exit),
        true,
        quit_accelerator,
    )?;

    let separator = &PredefinedMenuItem::separator(app_handle)?;

    let menu_items: Vec<&dyn IsMenuItem<Wry>> = vec![open_window, proxies, separator, quit];

    let menu = tauri::menu::MenuBuilder::new(app_handle).items(&menu_items).build()?;
    Ok(menu)
}

fn on_tray_icon_event(_tray_icon: &TrayIcon, tray_event: TrayIconEvent) {
    if matches!(
        tray_event,
        TrayIconEvent::Move { .. } | TrayIconEvent::Leave { .. } | TrayIconEvent::Enter { .. }
    ) {
        return;
    }

    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Down,
        ..
    } = tray_event
    {
        #[allow(clippy::use_self)]
        if !Tray::global().should_handle_tray_click() {
            return;
        }

        AsyncHandler::spawn(|| async move {
            Tray::global().toggle_connection().await;
        });
    }
}

fn on_menu_event(_: &AppHandle, event: MenuEvent) {
    if !Tray::global().should_handle_tray_click() {
        return;
    }
    if event.id.as_ref().is_empty() {
        return;
    }
    AsyncHandler::spawn(|| async move {
        match event.id.as_ref() {
            MenuIds::DASHBOARD => {
                logging!(info, Type::Tray, "托盘菜单点击: 打开窗口");
                open_main_window().await;
            }
            MenuIds::PROXIES => {
                open_nodes_page().await;
            }
            MenuIds::EXIT => {
                feat::quit().await;
            }
            _ => {
                logging!(debug, Type::Tray, "Unhandled tray menu event: {:?}", event.id);
            }
        }
    });
}
