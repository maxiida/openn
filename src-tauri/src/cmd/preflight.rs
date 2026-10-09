//! Reports the machine-level conditions that make a tunnel come up but carry no traffic.
//!
//! All three are invisible from inside the app: another VPN owns the default route, the system
//! proxy points at a port nothing is listening on, or a session-wide proxy variable does. Each one
//! produces a connected-looking UI over a dead network, so the minimal UI asks before it connects.
//!
//! The system-proxy read goes through `scutil`, not `networksetup`: a VPN that installs its proxy
//! through NetworkExtension scopes it to its own tunnel, where `networksetup` cannot see it at all.
//! That blind spot is what leaves a dead proxy in place after such a VPN quits.

use super::CmdResult;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleProxyEnv {
    pub variable: std::string::String,
    pub value: std::string::String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    /// Interface name of a tunnel holding the default route that this app did not raise.
    pub foreign_tunnel: Option<std::string::String>,
    /// Port the active system proxy points at, when that is not our own listener.
    pub foreign_system_proxy: Option<u16>,
    /// A login-session proxy variable aimed somewhere other than our own listener.
    pub stale_proxy_env: Option<StaleProxyEnv>,
}

#[tauri::command]
pub async fn get_preflight_report() -> CmdResult<PreflightReport> {
    let tun_enabled = crate::config::Config::verge()
        .await
        .latest_arc()
        .enable_tun_mode
        .unwrap_or(false);
    let mixed_port = crate::config::MixedPort::desired().await;

    Ok(collect(tun_enabled, mixed_port).await)
}

#[cfg(target_os = "macos")]
async fn collect(tun_enabled: bool, mixed_port: u16) -> PreflightReport {
    crate::process::AsyncHandler::spawn_blocking(move || PreflightReport {
        // Our own tunnel legitimately owns the default route once it is up.
        foreign_tunnel: (!tun_enabled).then(macos::default_route_tunnel).flatten(),
        foreign_system_proxy: macos::active_system_proxy_port().filter(|port| *port != mixed_port),
        stale_proxy_env: macos::session_proxy_env().filter(|env| !macos::points_at_port(&env.value, mixed_port)),
    })
    .await
    .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
async fn collect(_tun_enabled: bool, _mixed_port: u16) -> PreflightReport {
    PreflightReport::default()
}

#[cfg(target_os = "macos")]
mod macos {
    use super::StaleProxyEnv;
    use std::process::Command;

    /// Every variable an inherited environment may carry a proxy in; `launchctl` hands each
    /// GUI app its copy at launch, so a stale one outlives whatever tool wrote it.
    const PROXY_VARS: &[&str] = &[
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ];

    pub fn default_route_tunnel() -> Option<std::string::String> {
        let output = Command::new("/sbin/route")
            .args(["-n", "get", "default"])
            .output()
            .ok()?;
        let interface = parse_route_interface(&String::from_utf8_lossy(&output.stdout))?;
        interface.starts_with("utun").then_some(interface)
    }

    /// The port the resolved system proxy points at, or `None` when HTTP proxying is off.
    pub fn active_system_proxy_port() -> Option<u16> {
        let output = Command::new("/usr/sbin/scutil").arg("--proxy").output().ok()?;
        parse_scutil_http_proxy(&String::from_utf8_lossy(&output.stdout))
    }

    fn parse_scutil_http_proxy(output: &str) -> Option<u16> {
        let field = |name: &str| {
            output.lines().find_map(|line| {
                let (key, value) = line.split_once(':')?;
                (key.trim() == name).then(|| value.trim().to_owned())
            })
        };

        (field("HTTPEnable").as_deref() == Some("1")).then(|| field("HTTPPort")?.parse().ok())?
    }

    pub fn session_proxy_env() -> Option<StaleProxyEnv> {
        PROXY_VARS.iter().find_map(|variable| {
            let output = Command::new("/bin/launchctl")
                .args(["getenv", variable])
                .output()
                .ok()?;
            let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            (!value.is_empty()).then(|| StaleProxyEnv {
                variable: (*variable).to_owned(),
                value,
            })
        })
    }

    fn parse_route_interface(output: &str) -> Option<std::string::String> {
        output
            .lines()
            .find_map(|line| line.trim().strip_prefix("interface:"))
            .map(|interface| interface.trim().to_owned())
    }

    pub fn points_at_port(value: &str, port: u16) -> bool {
        value
            .rsplit_once(':')
            .is_some_and(|(_, tail)| tail.trim_end_matches('/').parse() == Ok(port))
    }

    #[cfg(test)]
    #[allow(clippy::panic, reason = "tests assert by panicking")]
    mod tests {
        use super::{parse_route_interface, parse_scutil_http_proxy, points_at_port};

        #[test]
        fn the_route_interface_is_read_off_its_own_line() {
            let output = "   route to: default\ndestination: default\n  interface: utun4\n     flags: <UP>";
            assert_eq!(parse_route_interface(output).as_deref(), Some("utun4"));
            assert_eq!(parse_route_interface("nothing here"), None);
        }

        #[test]
        fn the_system_proxy_port_is_read_only_while_it_is_enabled() {
            let on = "  HTTPEnable : 1\n  HTTPPort : 1082\n  HTTPProxy : 127.0.0.1\n  SOCKSEnable : 0";
            assert_eq!(parse_scutil_http_proxy(on), Some(1082));

            // The dictionary keeps the stale port around, so the flag is what decides.
            let off = "  HTTPEnable : 0\n  HTTPPort : 1082";
            assert_eq!(parse_scutil_http_proxy(off), None);

            assert_eq!(parse_scutil_http_proxy("  HTTPEnable : 0"), None);
            assert_eq!(parse_scutil_http_proxy("<dictionary> {\n}"), None);
        }

        #[test]
        fn only_our_own_listener_clears_a_proxy_variable() {
            assert!(points_at_port("http://127.0.0.1:7688", 7688));
            assert!(points_at_port("http://127.0.0.1:7688/", 7688));
            assert!(!points_at_port("http://127.0.0.1:1082", 7688));
            assert!(!points_at_port("socks5://127.0.0.1:7688", 1082));
            assert!(!points_at_port("no-port-here", 7688));
        }
    }
}
