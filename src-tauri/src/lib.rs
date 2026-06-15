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

#[tauri::command]
async fn restart_pm2_process(
    name: String,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<String, String> {
    let path_export = r#"export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH";"#;
    let cmd = format!("sh -lc '{} pm2 restart {}'", path_export, name);

    service
        .session
        .with_connection(|connection| async move {
            connection.exec(&cmd).await.map_err(ssh::session::SessionError::Command)
        })
        .await
        .map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut ssh_service = SshService::new();
    ssh_service.initialize();
    let ssh_service = Arc::new(ssh_service);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ssh_service.clone())
        .manage(ssh::terminal::TerminalRegistry::default())
        .setup(move |app| {
            let handle = app.handle().clone();
            let monitor = ssh_service.clone();

            tauri::async_runtime::spawn(async move {
                monitor.run_monitor(handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_ssh_status,
            list_remote_directory,
            restart_pm2_process,
            ssh::terminal::create_terminal_session,
            ssh::terminal::write_terminal_input,
            ssh::terminal::resize_terminal_session,
            ssh::terminal::close_terminal_session,
            ssh::editor::read_remote_file,
            ssh::editor::write_remote_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
