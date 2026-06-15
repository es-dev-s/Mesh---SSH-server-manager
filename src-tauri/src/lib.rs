mod ssh;
mod env_loader;
mod ota;
mod store;
mod window_ops;
use std::sync::Arc;

use ssh::SshService;
use store::AppStore;
use tauri::Manager;

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
async fn get_remote_home(
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<String, String> {
    service
        .resolve_remote_home()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn create_remote_directory(
    path: String,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<(), String> {
    service
        .create_remote_directory(&path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn create_remote_file(
    path: String,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<(), String> {
    service
        .create_remote_file(&path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn restart_pm2_process(
    name: String,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<String, String> {
    let path_export = r#"export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH";"#;
    let quoted_name = shell_single_quote(&name);
    let cmd = format!("sh -lc '{path_export} pm2 restart {quoted_name}'");

    service
        .session
        .with_connection(|connection| async move {
            connection.exec(&cmd).await.map_err(ssh::session::SessionError::Command)
        })
        .await
        .map_err(|err| err.to_string())
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[tauri::command]
async fn list_nginx_proxies(
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<ssh::proxy::NginxProxyOverview, String> {
    service
        .list_nginx_proxies()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn stage_nginx_proxy(
    domain: String,
    port: u16,
    websocket_enabled: bool,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<ssh::proxy::StageProxyResult, String> {
    service
        .stage_nginx_proxy(&domain, port, websocket_enabled)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn create_nginx_proxy(
    domain: String,
    port: u16,
    websocket_enabled: bool,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<ssh::proxy::CreateProxyResult, String> {
    service
        .create_nginx_proxy(&domain, port, websocket_enabled)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn check_dns_resolution(
    domain: String,
    expected_ip: String,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<ssh::proxy::DnsCheckResult, String> {
    service
        .check_dns_resolution(&domain, &expected_ip)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn reload_nginx(
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<ssh::proxy::NginxReloadResult, String> {
    service
        .reload_nginx()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_deployments(
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<ssh::deploy::DeployOverview, String> {
    service
        .list_deployments()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_deploy(
    repo_url: String,
    build_command: Option<String>,
    start_command: String,
    app_name: Option<String>,
    env_content: Option<String>,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<ssh::deploy::DeployResult, String> {
    service
        .run_deploy(
            &repo_url,
            build_command.as_deref(),
            &start_command,
            app_name.as_deref(),
            env_content.as_deref(),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn read_deploy_env(
    app_name: String,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<String, String> {
    service
        .read_deploy_env(&app_name)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn pull_deploy(
    app_name: String,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<ssh::deploy::DeployResult, String> {
    service
        .pull_deploy(&app_name)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn remove_deployment(
    app_name: String,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<ssh::deploy::RemoveDeployResult, String> {
    service
        .remove_deployment(&app_name)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn remove_nginx_proxy(
    domain: String,
    service: tauri::State<'_, Arc<SshService>>,
) -> Result<ssh::proxy::RemoveProxyResult, String> {
    service
        .remove_nginx_proxy(&domain)
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ssh_service.clone())
        .manage(std::sync::Arc::new(ssh::terminal::TerminalRegistry::default()))
        .setup(move |app| {
            let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
                .format_timestamp_millis()
                .try_init();

            let store = AppStore::new(&app.handle()).map_err(std::io::Error::other)?;
            app.manage(store);

            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }

            let handle = app.handle().clone();
            let monitor = ssh_service.clone();
            let ota_handle = handle.clone();

            tauri::async_runtime::spawn(async move {
                monitor.run_monitor(handle).await;
            });

            ota::spawn_ota_loop(ota_handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_ssh_status,
            list_remote_directory,
            get_remote_home,
            create_remote_directory,
            create_remote_file,
            restart_pm2_process,
            list_nginx_proxies,
            stage_nginx_proxy,
            create_nginx_proxy,
            check_dns_resolution,
            reload_nginx,
            list_deployments,
            run_deploy,
            read_deploy_env,
            pull_deploy,
            remove_deployment,
            remove_nginx_proxy,
            window_ops::quit_mesh,
            store::mesh_store_get,
            store::mesh_store_set,
            store::mesh_store_delete,
            ssh::terminal::create_terminal_session,
            ssh::terminal::write_terminal_input,
            ssh::terminal::resize_terminal_session,
            ssh::terminal::close_terminal_session,
            ssh::terminal::list_terminal_sessions,
            ssh::terminal::sync_terminal_sessions,
            ssh::editor::read_remote_file,
            ssh::editor::write_remote_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {});
}
