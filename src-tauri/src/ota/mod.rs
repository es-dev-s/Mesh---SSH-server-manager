mod config;

use std::time::Duration;

use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::Client as S3Client;
use aws_sdk_s3::config::{Builder as S3ConfigBuilder, Region};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

pub use config::OtaConfig;

const RETRY_INTERVAL: Duration = Duration::from_secs(30 * 60);
const STARTUP_DELAY: Duration = Duration::from_secs(8);

pub async fn check_and_install_silent(app: AppHandle) -> Result<(), String> {
    let config = OtaConfig::load().map_err(|error| error.to_string())?;
    if !config.enabled {
        return Ok(());
    }

    if !config.pubkey_configured {
        return Err(
            "TAURI_UPDATER_PUBKEY is missing — generate keys with `tauri signer generate` and rebuild"
                .into(),
        );
    }

    let manifest_url = resolve_manifest_url(&config).await?;
    log::debug!("OTA: checking manifest at {manifest_url}");

    let update = match check_for_update(&app, &manifest_url).await {
        Ok(result) => result,
        Err(error)
            if config.public_manifest_url.is_some() && config.has_private_r2_credentials() =>
        {
            log::warn!("OTA: public manifest failed ({error}) — retrying via R2 presigned URL");
            let presigned = resolve_presigned_manifest_url(&config).await?;
            check_for_update(&app, &presigned).await?
        }
        Err(error) => return Err(error),
    };

    let Some(update) = update else {
        log::debug!("OTA: already on latest version");
        return Ok(());
    };

    let version = update.version.clone();
    log::info!("OTA: downloading and installing {version}");
    update
        .download_and_install(
            |chunk, total| {
                if let Some(total) = total {
                    let pct = (chunk as f64 / total as f64 * 100.0) as u32;
                    if pct % 25 == 0 {
                        log::info!("OTA: download {pct}%");
                    }
                }
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    log::info!("OTA: installed {version} — restarting");
    app.restart();
}

async fn check_for_update(app: &AppHandle, manifest_url: &str) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let endpoint = Url::parse(manifest_url).map_err(|error| error.to_string())?;
    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())
}

async fn resolve_manifest_url(config: &OtaConfig) -> Result<String, String> {
    if let Some(url) = &config.public_manifest_url {
        return Ok(url.clone());
    }

    resolve_presigned_manifest_url(config).await
}

async fn resolve_presigned_manifest_url(config: &OtaConfig) -> Result<String, String> {
    let account_id = config
        .account_id
        .as_ref()
        .ok_or_else(|| {
            "R2_ACCOUNT_ID is required when R2_UPDATE_MANIFEST_URL is not set".to_string()
        })?;
    let access_key = config
        .access_key_id
        .as_ref()
        .ok_or_else(|| "R2_ACCESS_KEY_ID is required".to_string())?;
    let secret_key = config
        .secret_access_key
        .as_ref()
        .ok_or_else(|| "R2_SECRET_ACCESS_KEY is required".to_string())?;
    let bucket = config
        .bucket
        .as_ref()
        .ok_or_else(|| "R2_BUCKET is required".to_string())?;

    let endpoint = format!("https://{account_id}.r2.cloudflarestorage.com");
    let credentials = Credentials::new(access_key, secret_key, None, None, "mesh-ota");
    let s3_config = S3ConfigBuilder::new()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("auto"))
        .endpoint_url(endpoint)
        .credentials_provider(credentials)
        .build();
    let client = S3Client::from_conf(s3_config);

    let presigned = client
        .get_object()
        .bucket(bucket)
        .key(&config.manifest_key)
        .presigned(
            PresigningConfig::expires_in(Duration::from_secs(900))
                .map_err(|error| error.to_string())?,
        )
        .await
        .map_err(|error| error.to_string())?;

    Ok(presigned.uri().to_string())
}

pub fn spawn_ota_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;

        match OtaConfig::load() {
            Ok(config) if config.enabled => {
                if config.pubkey_configured {
                    log::info!("OTA: enabled (manifest via {})", manifest_source(&config));
                } else {
                    log::warn!(
                        "OTA: R2 configured but TAURI_UPDATER_PUBKEY is missing — updates disabled until you rebuild with a signing key"
                    );
                }
            }
            Ok(_) => {
                log::info!("OTA: disabled (no R2_UPDATE_MANIFEST_URL or R2 credentials in .env)")
            }
            Err(error) => log::warn!("OTA: config error: {error}"),
        }

        loop {
            if let Err(error) = check_and_install_silent(app.clone()).await {
                log::warn!("OTA check failed: {error}");
            }
            tokio::time::sleep(RETRY_INTERVAL).await;
        }
    });
}

fn manifest_source(config: &OtaConfig) -> &'static str {
    if config.public_manifest_url.is_some() {
        "public URL"
    } else {
        "R2 presigned URL"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_ota_config_from_dotenv_when_present() {
        crate::env_loader::load_dotenv_files();
        let config = OtaConfig::load().expect("ota config");
        if std::env::var("R2_ACCOUNT_ID").is_ok() {
            assert!(config.enabled);
        }
    }
}
