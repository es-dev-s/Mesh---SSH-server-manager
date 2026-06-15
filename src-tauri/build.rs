use std::env;
use std::path::Path;

fn main() {
    load_build_dotenv();
    inject_ota_build_config();
    tauri_build::build();
}

fn load_build_dotenv() {
    let _ = dotenvy::dotenv();
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let root_env = Path::new(&manifest_dir).join("../.env");
        if root_env.exists() {
            let _ = dotenvy::from_path(root_env);
        }
    }
}

fn inject_ota_build_config() {
    let pubkey = env::var("TAURI_UPDATER_PUBKEY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let manifest_url = env::var("R2_UPDATE_MANIFEST_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let mut updater = serde_json::json!({
        "windows": { "installMode": "passive" }
    });

    if let Some(pubkey) = &pubkey {
        updater["pubkey"] = serde_json::Value::String(pubkey.clone());
        println!("cargo:rustc-env=MESH_OTA_PUBKEY={pubkey}");
    } else {
        println!("cargo:warning=TAURI_UPDATER_PUBKEY is not set — OTA signature verification will fail");
    }

    if let Some(url) = &manifest_url {
        updater["endpoints"] = serde_json::json!([url]);
        println!("cargo:rustc-env=MESH_OTA_MANIFEST_URL={url}");
    }

    if updater.as_object().map(|obj| obj.len() > 1).unwrap_or(false) || pubkey.is_some() {
        let merge = serde_json::json!({ "plugins": { "updater": updater } });
        env::set_var("TAURI_CONFIG", merge.to_string());
    }
}
