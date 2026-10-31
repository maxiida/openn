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

#[tauri::command]
pub async fn get_pending_failures() -> Vec<PendingFailure> {
    notification::pending_failures()
}
