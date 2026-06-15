use std::env;

use crate::env_loader;

#[derive(Debug, Clone)]
pub struct OtaConfig {
    pub enabled: bool,
    pub public_manifest_url: Option<String>,
    pub account_id: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    pub bucket: Option<String>,
    pub manifest_key: String,
    pub pubkey_configured: bool,
}

impl OtaConfig {
    pub fn has_private_r2_credentials(&self) -> bool {
        self.account_id.is_some()
            && self.access_key_id.is_some()
            && self.secret_access_key.is_some()
            && self.bucket.is_some()
    }

    pub fn load() -> Result<Self, String> {
        env_loader::load_dotenv_files();

        let baked_manifest = option_env!("MESH_OTA_MANIFEST_URL")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        let public_manifest_url = env::var("R2_UPDATE_MANIFEST_URL")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or(baked_manifest);

        let account_id = env::var("R2_ACCOUNT_ID").ok().filter(|v| !v.is_empty());
        let access_key_id = env::var("R2_ACCESS_KEY_ID").ok().filter(|v| !v.is_empty());
        let secret_access_key = env::var("R2_SECRET_ACCESS_KEY").ok().filter(|v| !v.is_empty());
        let bucket = env::var("R2_BUCKET").ok().filter(|v| !v.is_empty());

        let manifest_key = env::var("R2_MANIFEST_KEY")
            .unwrap_or_else(|_| "latest.json".into())
            .trim()
            .to_string();

        let pubkey_configured = env::var("TAURI_UPDATER_PUBKEY")
            .ok()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
            || option_env!("MESH_OTA_PUBKEY")
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_some();

        let enabled = public_manifest_url.is_some()
            || (account_id.is_some()
                && access_key_id.is_some()
                && secret_access_key.is_some()
                && bucket.is_some());

        Ok(Self {
            enabled,
            public_manifest_url,
            account_id,
            access_key_id,
            secret_access_key,
            bucket,
            manifest_key,
            pubkey_configured,
        })
    }
}
