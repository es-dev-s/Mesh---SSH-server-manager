mod ssh;

use std::sync::Arc;

use ssh::SshService;

#[tauri::command]
fn get_ssh_status(service: tauri::State<'_, Arc<SshService>>) -> ssh::types::SshSnapshot {
    service.snapshot()
}

#[tauri::command]
async fn list_remote_directory(
    path: String,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<Vec<ssh::types::RemoteEntry>, String> {
    service
        .list_directory(&path)
        .await
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut ssh_service = SshService::new();
    ssh_service.initialize();
    let ssh_service = Arc::new(ssh_service);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ssh_service.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            let monitor = ssh_service.clone();

            tauri::async_runtime::spawn(async move {
                monitor.run_monitor(handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_ssh_status, list_remote_directory])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
