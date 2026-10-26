//! Mirrors the connection status dot on the Dock icon.

use crate::core::handle;
use crate::{Type, logging};
use objc2::{AnyThread as _, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::NSData;
use parking_lot::Mutex;

/// Last applied state: `Some(healthy)` while connected, `None` for the plain icon. The outer `None`
/// means nothing has been applied yet.
static APPLIED: Mutex<Option<Option<bool>>> = Mutex::new(None);

/// Always sets an explicit image: clearing it would leave a dev build, which has no bundle icon, with
/// a blank tile.
pub fn set(state: Option<bool>) {
    if APPLIED.lock().replace(state) == Some(state) {
        return;
    }
    logging!(info, Type::Tray, "dock icon state: {state:?}");
    let _ = handle::Handle::app_handle().run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let bytes: &[u8] = match state {
            None => include_bytes!("../../../icons/dock/plain.png"),
            Some(true) => include_bytes!("../../../icons/dock/green.png"),
            Some(false) => include_bytes!("../../../icons/dock/red.png"),
        };
        let image = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes));
        unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(image.as_deref()) };
    });
}
