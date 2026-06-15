use std::sync::Mutex;

use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager};

pub struct AppStore {
    conn: Mutex<Connection>,
}

impl AppStore {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let db_path = dir.join("mesh.db");
        let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS kv (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );",
        )
        .map_err(|error| error.to_string())?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        f(&conn)
    }

    pub fn get(&self, key: &str) -> Result<Option<String>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT value FROM kv WHERE key = ?1")
                .map_err(|error| error.to_string())?;
            let mut rows = stmt
                .query(params![key])
                .map_err(|error| error.to_string())?;
            if let Some(row) = rows.next().map_err(|error| error.to_string())? {
                Ok(Some(row.get(0).map_err(|error| error.to_string())?))
            } else {
                Ok(None)
            }
        })
    }

    pub fn set(&self, key: &str, value: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, strftime('%s','now'))
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![key, value],
            )
            .map_err(|error| error.to_string())?;
            Ok(())
        })
    }

    pub fn delete(&self, key: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM kv WHERE key = ?1", params![key])
                .map_err(|error| error.to_string())?;
            Ok(())
        })
    }
}

#[tauri::command]
pub fn mesh_store_get(store: tauri::State<'_, AppStore>, key: String) -> Result<Option<String>, String> {
    store.get(&key)
}

#[tauri::command]
pub fn mesh_store_set(
    store: tauri::State<'_, AppStore>,
    key: String,
    value: String,
) -> Result<(), String> {
    store.set(&key, &value)
}

#[tauri::command]
pub fn mesh_store_delete(store: tauri::State<'_, AppStore>, key: String) -> Result<(), String> {
    store.delete(&key)
}
