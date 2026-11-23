use rust_i18n::i18n;
use std::borrow::Cow;

const DEFAULT_LANGUAGE: &str = "zh";
i18n!("locales", fallback = "zh");

// Openn ships Chinese and English only, so every non-Chinese locale reads as English.
#[inline]
fn resolve_supported_language(language: &str) -> Option<&'static str> {
    if language.is_empty() {
        return None;
    }
    Some(if language.to_lowercase().starts_with("zh") {
        "zh"
    } else {
        "en"
    })
}

#[inline]
pub fn current_language(language: Option<&str>) -> Cow<'static, str> {
    language
        .filter(|lang| !lang.is_empty())
        .and_then(resolve_supported_language)
        .map_or_else(system_language, Cow::Borrowed)
}

// Choosing a language writes AppleLanguages into the app's own defaults, and the process-wide
// preferred languages read through that override, so they would report the chosen language.
#[cfg(target_os = "macos")]
fn preferred_language() -> Option<String> {
    use objc2_foundation::{NSArray, NSString, NSUserDefaults};
    let global =
        NSUserDefaults::standardUserDefaults().persistentDomainForName(&NSString::from_str("NSGlobalDomain"))?;
    let languages = global
        .objectForKey(&NSString::from_str("AppleLanguages"))?
        .downcast::<NSArray>()
        .ok()?;
    Some(languages.firstObject()?.downcast::<NSString>().ok()?.to_string())
}

#[cfg(not(target_os = "macos"))]
fn preferred_language() -> Option<String> {
    sys_locale::get_locale()
}

#[inline]
pub fn system_language() -> Cow<'static, str> {
    Cow::Borrowed(
        preferred_language()
            .or_else(sys_locale::get_locale)
            .as_deref()
            .and_then(resolve_supported_language)
            .unwrap_or(DEFAULT_LANGUAGE),
    )
}

#[inline]
pub fn sync_locale(language: Option<&str>) {
    rust_i18n::set_locale(&current_language(language));
}

#[inline]
pub fn translate(key: &str) -> Cow<'_, str> {
    rust_i18n::t!(key)
}

#[macro_export]
macro_rules! t {
    ($key:expr) => {
        $crate::translate(&$key)
    };
    ($key:expr, $($arg_name:ident = $arg_value:expr),*) => {
        {
            let mut _text = $crate::translate(&$key).into_owned();
            $(
                _text = _text.replace(&format!("{{{}}}", stringify!($arg_name)), &$arg_value);
            )*
            ::std::borrow::Cow::<'static, str>::Owned(_text)
        }
    };
}
