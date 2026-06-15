use std::env;
use std::path::{Path, PathBuf};

/// Load `.env` from every sensible location (dev tree, exe directory, user config).
pub fn load_dotenv_files() {
    let _ = dotenvy::dotenv();

    for path in dotenv_candidates() {
        if path.exists() {
            let _ = dotenvy::from_path(&path);
        }
    }
}

fn dotenv_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let root = Path::new(&manifest_dir);
        candidates.push(root.join("../.env"));
        candidates.push(root.join(".env"));
    }

    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join(".env"));
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(".env"));
            if let Some(parent) = dir.parent() {
                candidates.push(parent.join(".env"));
            }
        }
    }

    if let Some(config_dir) = user_config_dir() {
        candidates.push(config_dir.join(".env"));
    }

    candidates.sort();
    candidates.dedup();
    candidates
}

fn user_config_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        env::var("APPDATA")
            .ok()
            .map(|appdata| PathBuf::from(appdata).join("Mesh"))
    } else if cfg!(target_os = "macos") {
        env::var("HOME")
            .ok()
            .map(|home| PathBuf::from(home).join(".config").join("Mesh"))
    } else {
        env::var("XDG_CONFIG_HOME")
            .ok()
            .or_else(|| env::var("HOME").ok().map(|home| format!("{home}/.config")))
            .map(|config| PathBuf::from(config).join("Mesh"))
    }
}
