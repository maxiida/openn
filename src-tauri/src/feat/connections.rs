use crate::core::handle;
use crate::process::AsyncHandler;
use clash_verge_logging::{Type, logging};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tauri_plugin_mihomo::models::Connection;

/// How long a connection must move no data before it counts as finished. Long enough to ride out
/// the gaps between chunks of a streamed AI answer.
const IDLE_WINDOW: Duration = Duration::from_secs(5);
/// Connections still busy after this are left alone, unless the caller asks for them to be cut.
const GIVE_UP_AFTER: Duration = Duration::from_secs(120);

/// Closes the matching connections once each stops moving data, so they reconnect under the
/// current rules without cutting off an answer or download still in progress. Only connections
/// open now are considered; new ones already follow the new rules. With `force_after`, any still
/// busy by then are closed anyway; without it they are left alone after `GIVE_UP_AFTER`.
pub fn close_when_idle<F>(matches: F, reason: &'static str, force_after: Option<Duration>)
where
    F: Fn(&Connection) -> bool + Send + 'static,
{
    AsyncHandler::spawn(move || async move {
        let started = Instant::now();
        let mut pending: Option<HashMap<String, u64>> = None;
        let mut closed = 0usize;
        loop {
            let connections = match handle::Handle::mihomo().get_connections().await {
                Ok(connections) => connections.connections.unwrap_or_default(),
                Err(err) => {
                    logging!(info, Type::Config, "{reason}: connections unavailable: {err}");
                    return;
                }
            };
            let traffic = |connection: &Connection| connection.upload + connection.download;
            let Some(last) = pending.as_mut() else {
                pending = Some(
                    connections
                        .iter()
                        .filter(|connection| matches(connection))
                        .map(|connection| (connection.id.clone(), traffic(connection)))
                        .collect(),
                );
                tokio::time::sleep(IDLE_WINDOW).await;
                continue;
            };

            let mut still_busy = HashMap::new();
            for connection in &connections {
                let Some(before) = last.get(&connection.id) else {
                    continue;
                };
                let now = traffic(connection);
                if now == *before {
                    if handle::Handle::mihomo().close_connection(&connection.id).await.is_ok() {
                        closed += 1;
                    }
                } else {
                    still_busy.insert(connection.id.clone(), now);
                }
            }
            let elapsed = started.elapsed();
            if let Some(force_after) = force_after
                && elapsed >= force_after
            {
                let mut forced = 0usize;
                for id in still_busy.keys() {
                    if handle::Handle::mihomo().close_connection(id).await.is_ok() {
                        forced += 1;
                    }
                }
                logging!(
                    info,
                    Type::Config,
                    "{reason}: closed {closed} idle connection(s), cut {forced} still busy after {}s",
                    elapsed.as_secs()
                );
                return;
            }
            let busy = still_busy.len();
            *last = still_busy;
            if busy == 0 || (force_after.is_none() && elapsed >= GIVE_UP_AFTER) {
                logging!(
                    info,
                    Type::Config,
                    "{reason}: closed {closed} idle connection(s), left {busy} busy"
                );
                return;
            }
            tokio::time::sleep(IDLE_WINDOW).await;
        }
    });
}
