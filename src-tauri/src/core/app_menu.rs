use crate::{core::handle, feat, process::AsyncHandler, utils::window_manager::WindowManager};
use clash_verge_i18n::t;
use clash_verge_logging::{Type, logging};
use objc2_foundation::{NSArray, NSString, NSUserDefaults};
use tauri::{
    AppHandle, Wry,
    image::Image,
    menu::{AboutMetadata, Menu, MenuBuilder, MenuEvent, MenuItem, SubmenuBuilder},
};
use tauri_plugin_dialog::{DialogExt as _, MessageDialogKind};

const SETTINGS: &str = "app_menu_settings";
const EXPORT_LOGS: &str = "app_menu_export_logs";

// Replaces Tauri's default File/View/Window/Help menus. The Edit menu stays because
// WKWebView only receives ⌘C/⌘V/⌘Z through menu key equivalents.
pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let settings = MenuItem::with_id(app, SETTINGS, t!("menu.settings"), true, Some("Cmd+,"))?;
    let app_menu = SubmenuBuilder::new(app, "Openn")
        .about_with_text(t!("menu.about"), Some(about_metadata()?))
        .separator()
        .item(&settings)
        .separator()
        .hide_with_text(t!("menu.hide"))
        .hide_others_with_text(t!("menu.hideOthers"))
        .show_all_with_text(t!("menu.showAll"))
        .separator()
        .quit_with_text(t!("menu.quit"))
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, t!("menu.edit"))
        .undo_with_text(t!("menu.undo"))
        .redo_with_text(t!("menu.redo"))
        .separator()
        .cut_with_text(t!("menu.cut"))
        .copy_with_text(t!("menu.copy"))
        .paste_with_text(t!("menu.paste"))
        .select_all_with_text(t!("menu.selectAll"))
        .build()?;
    let help_menu = SubmenuBuilder::new(app, t!("menu.help"))
        .text(EXPORT_LOGS, t!("menu.exportLogs"))
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &help_menu])
        .build()
}

// Left unset, AppKit shows the live Dock icon, which carries the connection status dot.
fn about_metadata() -> tauri::Result<AboutMetadata<'static>> {
    Ok(AboutMetadata {
        icon: Some(Image::from_bytes(include_bytes!("../../icons/dock/plain.png"))?),
        ..Default::default()
    })
}

/// AppKit localizes the items it adds to the menus (Start Dictation, Emoji & Symbols) from this
/// key, read once at launch, so a changed language reaches them on the next start. It also feeds
/// the system language lookup, so it has to be written before the locale is resolved.
pub fn sync_appkit_language(language: Option<&str>) {
    let key = NSString::from_str("AppleLanguages");
    let defaults = NSUserDefaults::standardUserDefaults();
    match language.filter(|language| !language.is_empty()) {
        Some(language) => {
            let code = if clash_verge_i18n::current_language(Some(language)) == "zh" {
                "zh-Hans"
            } else {
                "en"
            };
            let languages = NSArray::from_retained_slice(&[NSString::from_str(code)]);
            unsafe { defaults.setObject_forKey(Some(&languages), &key) };
        }
        None => defaults.removeObjectForKey(&key),
    }
}

/// Rebuilds the menu after the UI language changes; the first build runs before settings load.
pub fn refresh() {
    let app = handle::Handle::app_handle();
    if let Err(err) = build(app).and_then(|menu| app.set_menu(menu)) {
        logging!(warn, Type::Setup, "Failed to rebuild the app menu: {err}");
    }
}

// Also receives tray menu events, which the tray handles itself.
pub fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id.as_ref() {
        SETTINGS => {
            AsyncHandler::spawn(|| async {
                let _ = WindowManager::show_main_window().await;
                handle::Handle::navigate("/settings");
            });
        }
        EXPORT_LOGS => {
            let app = app.clone();
            AsyncHandler::spawn(move || async move {
                if let Err(err) = feat::export_logs(&app).await {
                    logging!(error, Type::File, "Failed to export logs: {err:#}");
                    app.dialog()
                        .message(t!("menu.exportLogsFailed"))
                        .kind(MessageDialogKind::Error)
                        .show(|_| {});
                }
            });
        }
        _ => {}
    }
}
