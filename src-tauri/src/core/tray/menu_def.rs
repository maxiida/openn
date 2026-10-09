macro_rules! define_menu {
    ($($field:ident => $const_name:ident, $id:expr, $text:expr),+ $(,)?) => {
        #[derive(Debug)]
        pub struct MenuTexts {
            $(pub $field: &'static str,)+
        }

        pub struct MenuIds;

        impl MenuTexts {
            pub const fn new() -> Self {
                Self {
                    $($field: $text,)+
                }
            }
        }

        impl MenuIds {
            $(pub const $const_name: &'static str = $id;)+
        }
    };
}

define_menu! {
    dashboard => DASHBOARD, "tray_dashboard", "主页",
    proxies => PROXIES, "tray_proxies", "节点",
    exit => EXIT, "tray_exit", "退出",
}
