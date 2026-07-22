use serde::Serialize;

const QWEN_BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const QWEN_MODEL: &str = "qwen3.5-omni-flash";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealE2eConfig {
    pub enabled: bool,
    pub video_path: String,
    pub whisper_model_path: String,
    pub qwen_base_url: String,
    pub qwen_model: String,
    pub qwen_api_key: String,
    pub whisper_backend: String,
    pub database_path: String,
}

pub fn read_real_e2e_config_from_env<F>(get_env: F) -> Result<Option<RealE2eConfig>, String>
where
    F: Fn(&str) -> Option<String>,
{
    if get_env("RAIN_E2E_MODE").as_deref() != Some("1") {
        return Ok(None);
    }

    let video_path = required_env(&get_env, "RAIN_E2E_VIDEO_PATH")?;
    let whisper_model_path = required_env(&get_env, "RAIN_E2E_WHISPER_MODEL_PATH")?;
    let qwen_api_key = required_env(&get_env, "RAIN_QWEN_API_KEY")?;
    let database_path = required_env(&get_env, "RAIN_E2E_DB_PATH")?;
    let qwen_base_url = get_env("RAIN_E2E_QWEN_BASE_URL").unwrap_or_else(|| QWEN_BASE_URL.to_string());
    let qwen_model = get_env("RAIN_E2E_QWEN_MODEL").unwrap_or_else(|| QWEN_MODEL.to_string());

    if qwen_base_url.trim_end_matches('/') != QWEN_BASE_URL {
        return Err(format!("RAIN_E2E_QWEN_BASE_URL must be {QWEN_BASE_URL}"));
    }
    if qwen_model != QWEN_MODEL {
        return Err(format!("RAIN_E2E_QWEN_MODEL must be {QWEN_MODEL}"));
    }

    Ok(Some(RealE2eConfig {
        enabled: true,
        video_path,
        whisper_model_path,
        qwen_base_url: QWEN_BASE_URL.to_string(),
        qwen_model: QWEN_MODEL.to_string(),
        qwen_api_key,
        whisper_backend: crate::runtime::runtime_capability().whisper_backend.to_string(),
        database_path,
    }))
}

fn required_env<F>(get_env: &F, key: &str) -> Result<String, String>
where
    F: Fn(&str) -> Option<String>,
{
    let value = get_env(key).unwrap_or_default();
    if value.trim().is_empty() {
        Err(format!("{key} is required for Rain real E2E mode"))
    } else {
        Ok(value)
    }
}

#[tauri::command]
pub async fn get_real_e2e_config() -> Result<Option<RealE2eConfig>, String> {
    read_real_e2e_config_from_env(|key| std::env::var(key).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn read(vars: &[(&str, &str)]) -> Result<Option<RealE2eConfig>, String> {
        let map: HashMap<String, String> = vars
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect();
        read_real_e2e_config_from_env(|key| map.get(key).cloned())
    }

    #[test]
    fn e2e_config_is_disabled_by_default() {
        assert_eq!(read(&[]).unwrap(), None);
    }

    #[test]
    fn e2e_config_requires_exact_qwen_model() {
        let error = read(&[
            ("RAIN_E2E_MODE", "1"),
            ("RAIN_E2E_VIDEO_PATH", "D:\\video.mp4"),
            ("RAIN_E2E_WHISPER_MODEL_PATH", "D:\\ggml-large-v3.bin"),
            ("RAIN_QWEN_API_KEY", "sk-secret"),
            ("RAIN_E2E_DB_PATH", "D:\\rain-e2e.db"),
            ("RAIN_E2E_QWEN_MODEL", "wrong-model"),
        ])
        .unwrap_err();

        assert_eq!(error, "RAIN_E2E_QWEN_MODEL must be qwen3.5-omni-flash");
        assert!(!error.contains("sk-secret"));
    }

    #[test]
    fn e2e_config_returns_required_runtime_without_redacting_values_needed_by_the_app() {
        let config = read(&[
            ("RAIN_E2E_MODE", "1"),
            ("RAIN_E2E_VIDEO_PATH", "D:\\video.mp4"),
            ("RAIN_E2E_WHISPER_MODEL_PATH", "D:\\ggml-large-v3.bin"),
            ("RAIN_QWEN_API_KEY", "sk-secret"),
            ("RAIN_E2E_DB_PATH", "D:\\rain-e2e.db"),
        ])
        .unwrap()
        .unwrap();

        assert_eq!(config.video_path, "D:\\video.mp4");
        assert_eq!(config.whisper_model_path, "D:\\ggml-large-v3.bin");
        assert_eq!(config.qwen_base_url, QWEN_BASE_URL);
        assert_eq!(config.qwen_model, QWEN_MODEL);
        assert_eq!(config.qwen_api_key, "sk-secret");
        assert_eq!(config.database_path, "D:\\rain-e2e.db");
        assert!(config.whisper_backend == "cpu" || config.whisper_backend == "cuda");
    }
}