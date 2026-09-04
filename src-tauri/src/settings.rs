use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

const SETTINGS_FILE_NAME: &str = "settings.json";
const KEYRING_SERVICE: &str = "cn.jiachen.citroam";
const KEYRING_USER: &str = "deepseek-api-key";
const DEFAULT_PROVIDER: &str = "deepseek-official";
const DEFAULT_MODEL: &str = "deepseek-v4-flash";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAgentSettings {
    pub provider: String,
    pub model: String,
    pub harness_root: Option<String>,
}

impl Default for StoredAgentSettings {
    fn default() -> Self {
        Self {
            provider: DEFAULT_PROVIDER.to_string(),
            model: DEFAULT_MODEL.to_string(),
            harness_root: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettingsView {
    pub provider: String,
    pub model: String,
    pub harness_root: String,
    pub api_key_configured: bool,
    pub api_key_source: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentSettingsInput {
    pub provider: String,
    pub model: String,
    pub harness_root: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub clear_api_key: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum CredentialUpdate {
    Keep,
    Set(String),
    Clear,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AgentRuntimeSettings {
    pub provider: String,
    pub model: String,
    pub harness_root: Option<PathBuf>,
    pub api_key: Option<String>,
}

pub fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(SETTINGS_FILE_NAME))
        .map_err(|error| format!("无法确定 citroam 设置目录：{error}"))
}

pub fn load_stored_settings(path: &Path) -> Result<StoredAgentSettings, String> {
    let document = match fs::read_to_string(path) {
        Ok(document) => document,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(StoredAgentSettings::default());
        }
        Err(error) => return Err(format!("无法读取模型设置：{error}")),
    };
    serde_json::from_str(&document).map_err(|error| format!("模型设置文件已损坏：{error}"))
}

pub fn save_stored_settings(path: &Path, settings: &StoredAgentSettings) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "模型设置路径没有父目录。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建模型设置目录：{error}"))?;
    let document = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("无法编码模型设置：{error}"))?;
    fs::write(path, document).map_err(|error| format!("无法保存模型设置：{error}"))
}

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|error| format!("无法打开系统凭据：{error}"))
}

fn stored_api_key() -> Result<Option<String>, String> {
    match keyring_entry()?.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) | Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("无法读取系统凭据：{error}")),
    }
}

fn environment_api_key() -> Option<String> {
    env::var("DEEPSEEK_API_KEY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn environment_value(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn credential_update(input: &SaveAgentSettingsInput) -> CredentialUpdate {
    if input.clear_api_key {
        return CredentialUpdate::Clear;
    }
    input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| CredentialUpdate::Set(value.to_string()))
        .unwrap_or(CredentialUpdate::Keep)
}

fn apply_credential_update(update: CredentialUpdate) -> Result<(), String> {
    match update {
        CredentialUpdate::Keep => Ok(()),
        CredentialUpdate::Set(value) => keyring_entry()?
            .set_password(&value)
            .map_err(|error| format!("无法保存系统凭据：{error}")),
        CredentialUpdate::Clear => match keyring_entry()?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(format!("无法删除系统凭据：{error}")),
        },
    }
}

pub fn resolve_settings_view(
    stored: StoredAgentSettings,
    stored_key: Option<&str>,
    environment_key: Option<&str>,
) -> AgentSettingsView {
    let stored_key_present = stored_key.is_some_and(|value| !value.trim().is_empty());
    let environment_key_present = environment_key.is_some_and(|value| !value.trim().is_empty());
    let (api_key_configured, api_key_source) = if stored_key_present {
        (true, "stored")
    } else if environment_key_present {
        (true, "environment")
    } else {
        (false, "missing")
    };
    AgentSettingsView {
        provider: stored.provider,
        model: stored.model,
        harness_root: stored.harness_root.unwrap_or_default(),
        api_key_configured,
        api_key_source: api_key_source.to_string(),
    }
}

fn validate_input(input: &SaveAgentSettingsInput) -> Result<StoredAgentSettings, String> {
    let provider = input.provider.trim();
    let model = input.model.trim();
    if provider.is_empty() {
        return Err("Provider 不能为空。".to_string());
    }
    if model.is_empty() {
        return Err("模型名称不能为空。".to_string());
    }
    Ok(StoredAgentSettings {
        provider: provider.to_string(),
        model: model.to_string(),
        harness_root: (!input.harness_root.trim().is_empty())
            .then(|| input.harness_root.trim().to_string()),
    })
}

fn effective_stored_settings(path: &Path) -> Result<StoredAgentSettings, String> {
    let mut stored = load_stored_settings(path)?;
    if !path.exists() {
        if let Some(provider) = environment_value("CITROAM_DEEPSEEK_PROVIDER") {
            stored.provider = provider;
        }
        if let Some(model) = environment_value("CITROAM_DEEPSEEK_MODEL") {
            stored.model = model;
        }
        stored.harness_root = environment_value("CITROAM_HARNESS_ROOT");
    }
    Ok(stored)
}

pub fn get_agent_settings(path: &Path) -> Result<AgentSettingsView, String> {
    let stored = effective_stored_settings(path)?;
    let key = stored_api_key()?;
    let environment_key = environment_api_key();
    Ok(resolve_settings_view(
        stored,
        key.as_deref(),
        environment_key.as_deref(),
    ))
}

pub fn save_agent_settings(
    path: &Path,
    input: &SaveAgentSettingsInput,
) -> Result<AgentSettingsView, String> {
    let stored = validate_input(input)?;
    apply_credential_update(credential_update(input))?;
    save_stored_settings(path, &stored)?;
    get_agent_settings(path)
}

pub fn runtime_settings(path: &Path) -> Result<AgentRuntimeSettings, String> {
    let stored = effective_stored_settings(path)?;
    let api_key = stored_api_key()?.or_else(environment_api_key);
    Ok(AgentRuntimeSettings {
        provider: stored.provider,
        model: stored.model,
        harness_root: stored.harness_root.map(PathBuf::from),
        api_key,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        credential_update, load_stored_settings, resolve_settings_view, save_stored_settings,
        CredentialUpdate, SaveAgentSettingsInput, StoredAgentSettings,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_settings_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("citroam-{name}-{nonce}/settings.json"))
    }

    #[test]
    fn missing_settings_file_uses_citroam_defaults() {
        let path = temp_settings_path("settings-defaults");
        let stored = load_stored_settings(&path).expect("default settings");
        assert_eq!(stored.provider, "deepseek-official");
        assert_eq!(stored.model, "deepseek-v4-flash");
        assert_eq!(stored.harness_root, None);
    }

    #[test]
    fn stored_settings_file_never_contains_the_api_key() {
        let path = temp_settings_path("settings-save");
        let stored = StoredAgentSettings {
            provider: "deepseek-official".to_string(),
            model: "deepseek-chat".to_string(),
            harness_root: Some("/opt/harness".to_string()),
        };
        save_stored_settings(&path, &stored).expect("save settings");

        let json = fs::read_to_string(&path).expect("read settings");
        assert!(json.contains("deepseek-chat"));
        assert!(!json.to_ascii_lowercase().contains("api_key"));
        assert!(!json.contains("sk-secret"));
        assert_eq!(
            load_stored_settings(&path).expect("reload settings"),
            stored
        );
        fs::remove_dir_all(path.parent().expect("temp root")).expect("cleanup");
    }

    #[test]
    fn settings_view_reports_key_source_without_serializing_the_key() {
        let stored = StoredAgentSettings::default();
        let from_store = resolve_settings_view(stored.clone(), Some("sk-stored"), Some("sk-env"));
        assert!(from_store.api_key_configured);
        assert_eq!(from_store.api_key_source, "stored");
        let json = serde_json::to_string(&from_store).expect("serialize view");
        assert!(!json.contains("sk-stored"));
        assert!(!json.contains("sk-env"));

        let from_environment = resolve_settings_view(stored, None, Some("sk-env"));
        assert!(from_environment.api_key_configured);
        assert_eq!(from_environment.api_key_source, "environment");
    }

    #[test]
    fn blank_key_keeps_the_existing_credential_and_clear_is_explicit() {
        let base = SaveAgentSettingsInput {
            provider: "deepseek-official".to_string(),
            model: "deepseek-v4-flash".to_string(),
            harness_root: "".to_string(),
            api_key: None,
            clear_api_key: false,
        };
        assert_eq!(credential_update(&base), CredentialUpdate::Keep);
        assert_eq!(
            credential_update(&SaveAgentSettingsInput {
                api_key: Some("   ".to_string()),
                ..base.clone()
            }),
            CredentialUpdate::Keep
        );
        assert_eq!(
            credential_update(&SaveAgentSettingsInput {
                api_key: Some(" sk-new ".to_string()),
                ..base.clone()
            }),
            CredentialUpdate::Set("sk-new".to_string())
        );
        assert_eq!(
            credential_update(&SaveAgentSettingsInput {
                clear_api_key: true,
                ..base
            }),
            CredentialUpdate::Clear
        );
    }
}
