use tauri::AppHandle;

#[tauri::command]
pub async fn quit_mesh(app: AppHandle) {
    app.exit(0);
}
