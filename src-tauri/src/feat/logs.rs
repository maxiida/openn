use crate::{process::AsyncHandler, utils::dirs};
use anyhow::{Result, anyhow};
use clash_verge_logging::{Type, logging};
use parking_lot::RwLock;
use std::{
    fs::File,
    io::Write as _,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager as _};
use tauri_plugin_clash_verge_sysinfo::Platform;
use zip::{ZipWriter, write::SimpleFileOptions};

/// Bundles the app, core and service logs into one archive in Downloads and reveals it,
/// so a tester can send a single file back.
pub async fn export_logs(app_handle: &AppHandle) -> Result<PathBuf> {
    let now = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let dest_dir = ::dirs::download_dir()
        .or_else(::dirs::desktop_dir)
        .ok_or_else(|| anyhow!("no Downloads or Desktop folder"))?;
    let zip_path = dest_dir.join(format!("Openn-logs-{now}.zip"));
    let system_info = app_handle.state::<RwLock<Platform>>().read().to_string();
    let logs_dir = dirs::app_logs_dir()?;
    let service_logs_dir = dirs::service_logs_root_dir()?;

    let path = zip_path.clone();
    AsyncHandler::spawn_blocking(move || -> Result<()> {
        let mut zip = ZipWriter::new(File::create(&path)?);
        let options = SimpleFileOptions::default();
        zip.start_file("system-info.txt", options)?;
        zip.write_all(system_info.as_bytes())?;
        add_dir(&mut zip, &logs_dir, "logs", options)?;
        // Off macOS the service writes into the app logs folder.
        if service_logs_dir != logs_dir {
            add_dir(&mut zip, &service_logs_dir, "service-logs", options)?;
        }
        zip.finish()?;
        Ok(())
    })
    .await??;

    tauri_plugin_opener::reveal_item_in_dir(&zip_path)?;
    Ok(zip_path)
}

fn add_dir(zip: &mut ZipWriter<File>, dir: &Path, prefix: &str, options: SimpleFileOptions) -> Result<()> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = format!("{prefix}/{}", entry.file_name().to_string_lossy());
        if path.is_dir() {
            add_dir(zip, &path, &name, options)?;
            continue;
        }
        // The privileged service may leave root-only files; one unreadable log should not sink the export.
        match std::fs::read(&path) {
            Ok(content) => {
                zip.start_file(name, options)?;
                zip.write_all(&content)?;
            }
            Err(err) => logging!(warn, Type::File, "Skipping unreadable log {}: {err}", path.display()),
        }
    }
    Ok(())
}
