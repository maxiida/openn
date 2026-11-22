use super::{CmdResult, StringifyErr as _};
use crate::{
    AsyncHandler,
    config::Config,
    core::handle,
    utils::{dirs, yaml_emitter},
};
use anyhow::{Context as _, Result, bail};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_yaml_ng::{Mapping, Value};
use std::{
    collections::{HashMap, HashSet},
    net::{TcpListener, TcpStream},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tauri_plugin_shell::{ShellExt as _, process::CommandChild};

// A separate core gives every node its own local port, so a check never touches the running
// core's selection or connections.
static PROBE: Lazy<Mutex<Option<(u64, CommandChild)>>> = Lazy::new(|| Mutex::new(None));
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// A probe core the page never stopped dies on its own after this long.
const PROBE_LIFETIME: Duration = Duration::from_secs(180);
const READY_TIMEOUT: Duration = Duration::from_secs(5);

pub fn stop_probe() {
    let probe = PROBE.lock().take();
    if let Some((_, child)) = probe {
        let _ = child.kill();
    }
}

/// Starts a probe core and returns the local port that leaves through each requested node.
#[tauri::command]
pub async fn start_ai_probe(nodes: Vec<String>) -> CmdResult<HashMap<String, u16>> {
    start(nodes).await.stringify_err()
}

#[tauri::command]
pub async fn stop_ai_probe() -> CmdResult {
    stop_probe();
    Ok(())
}

async fn start(nodes: Vec<String>) -> Result<HashMap<String, u16>> {
    stop_probe();

    let proxies = Config::runtime()
        .await
        .latest_arc()
        .config
        .as_ref()
        .and_then(|config| config.get("proxies"))
        .and_then(Value::as_sequence)
        .cloned()
        .unwrap_or_default();
    let known: HashSet<&str> = proxies
        .iter()
        .filter_map(|proxy| proxy.get("name").and_then(Value::as_str))
        .collect();
    let nodes: Vec<String> = nodes.into_iter().filter(|node| known.contains(node.as_str())).collect();
    if nodes.is_empty() {
        bail!("none of the requested nodes is a plain proxy in the running config");
    }

    // Each socket stays bound until the config is written, so no two nodes draw the same port.
    let sockets = nodes
        .iter()
        .map(|_| TcpListener::bind("127.0.0.1:0"))
        .collect::<std::io::Result<Vec<_>>>()
        .context("failed to reserve probe ports")?;
    let mut ports = HashMap::new();
    let mut listeners = Vec::new();
    for (index, (node, socket)) in nodes.iter().zip(&sockets).enumerate() {
        let port = socket.local_addr()?.port();
        let mut listener = Mapping::new();
        listener.insert("name".into(), format!("ai-probe-{index}").into());
        listener.insert("type".into(), "mixed".into());
        listener.insert("listen".into(), "127.0.0.1".into());
        listener.insert("port".into(), port.into());
        listener.insert("proxy".into(), node.as_str().into());
        listeners.push(Value::Mapping(listener));
        ports.insert(node.clone(), port);
    }

    let mut config = Mapping::new();
    config.insert("log-level".into(), "warning".into());
    config.insert("mode".into(), "rule".into());
    config.insert("allow-lan".into(), false.into());
    config.insert("ipv6".into(), false.into());
    config.insert("proxies".into(), Value::Sequence(proxies));
    config.insert("listeners".into(), Value::Sequence(listeners));
    config.insert("rules".into(), Value::Sequence(vec!["MATCH,DIRECT".into()]));

    let dir = dirs::app_home_dir()?.join("ai-probe");
    std::fs::create_dir_all(&dir)?;
    let file = dir.join("config.yaml");
    write_private(&file, yaml_emitter::to_mihomo_config_string(&config)?.as_bytes())?;
    drop(sockets);

    let clash_core = Config::verge().await.latest_arc().get_valid_clash_core();
    let (mut events, child) = handle::Handle::app_handle()
        .shell()
        .sidecar(clash_core.as_str())?
        .args(["-d", dirs::path_to_str(&dir)?, "-f", dirs::path_to_str(&file)?])
        .spawn()
        .with_context(|| format!("failed to start probe core {clash_core:?}"))?;
    // An unread event channel stalls the core on a full stdout pipe.
    AsyncHandler::spawn(move || async move { while events.recv().await.is_some() {} });

    let generation = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    *PROBE.lock() = Some((generation, child));
    AsyncHandler::spawn(move || async move {
        tokio::time::sleep(PROBE_LIFETIME).await;
        let mut probe = PROBE.lock();
        if probe.as_ref().is_some_and(|(current, _)| *current == generation)
            && let Some((_, child)) = probe.take()
        {
            let _ = child.kill();
        }
    });

    let first = *ports.values().next().unwrap_or(&0);
    let deadline = Instant::now() + READY_TIMEOUT;
    while TcpStream::connect(("127.0.0.1", first)).is_err() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // The core has read the credentials by now, or never will.
    let _ = std::fs::remove_file(&file);
    if TcpStream::connect(("127.0.0.1", first)).is_err() {
        stop_probe();
        bail!("probe core did not open its ports within {READY_TIMEOUT:?}");
    }
    Ok(ports)
}

/// The config carries every node's credentials, so only the user may read it.
fn write_private(path: &std::path::Path, contents: &[u8]) -> Result<()> {
    use std::io::Write as _;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)?.write_all(contents)?;
    Ok(())
}
