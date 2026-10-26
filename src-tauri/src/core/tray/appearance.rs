//! Tracks the menu bar's appearance so the tray logo stays legible on it.

use objc2::rc::Retained;
use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_app_kit::{
    NSAppearance, NSAppearanceCustomization as _, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSStatusItem, NSView,
};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize};

use super::status_icon;

define_class!(
    /// Zero-sized subview of the status item button, which inherits the menu bar's appearance.
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "OpennMenuBarAppearanceObserver"]
    struct MenuBarObserver;

    impl MenuBarObserver {
        #[unsafe(method(viewDidChangeEffectiveAppearance))]
        fn view_did_change_effective_appearance(&self) {
            status_icon::global().set_menu_bar_dark(is_dark(&self.effectiveAppearance()));
        }
    }
);

fn is_dark(appearance: &NSAppearance) -> bool {
    let (aqua, dark) = unsafe { (NSAppearanceNameAqua, NSAppearanceNameDarkAqua) };
    appearance
        .bestMatchFromAppearancesWithNames(&NSArray::from_slice(&[aqua, dark]))
        .is_some_and(|name| &*name == dark)
}

pub fn observe(status_item: &NSStatusItem, mtm: MainThreadMarker) {
    if let Some(button) = status_item.button(mtm) {
        let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0));
        let observer: Retained<MenuBarObserver> =
            unsafe { msg_send![MenuBarObserver::alloc(mtm), initWithFrame: frame] };
        button.addSubview(&observer);
        status_icon::global().set_menu_bar_dark(is_dark(&observer.effectiveAppearance()));
    }
}
