use crate::core::{
    notification::{self, PendingFailure},
    runstate::{RUN_STATE, RunStateView},
};

/// Returns one coherent core/service snapshot instead of independently refreshed state.
#[tauri::command]
pub async fn get_runtime_state() -> Result<RunStateView, String> {
    Ok(RUN_STATE.settled().await.to_view())
}

/// The home page shows the same verdict as the tray and Dock dots.
#[tauri::command]
pub fn get_connection_unhealthy() -> bool {
    crate::core::tray::Tray::global().is_unhealthy()
}

/// Whether the AI node is answering, or missing from the profile, while AI routing is on.
#[tauri::command]
pub fn get_ai_node_health() -> crate::core::tray::health::AiNodeHealth {
    crate::core::tray::health::ai_node_health()
}

/// After the main node changes, moves connections off `node` once each goes idle. AI connections
/// stay put while AI routing sends them to their own node, which did not change.
#[tauri::command]
pub fn close_node_connections_when_idle(node: String) {
    let ai_routed = crate::core::tray::health::ai_routed();
    crate::feat::close_when_idle(
        move |connection| {
            connection.chains.contains(&node) && !(ai_routed && crate::enhance::is_ai_host(&connection.metadata.host))
        },
        "main node changed",
        None,
    );
}

/// `known_dead` is the node list's last result for the node just picked.
#[tauri::command]
pub async fn recheck_connection_health(known_dead: bool) {
    crate::core::tray::Tray::global().recheck_health(known_dead).await;
}

#[tauri::command]
pub async fn get_pending_failures() -> Vec<PendingFailure> {
    notification::pending_failures()
}
