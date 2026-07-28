use serde::Serialize;

const DEFAULT_LLM_BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_LLM_MODEL: &str = "qwen3.5-omni-flash";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealE2eConfig {
    pub enabled: bool,
    pub run_mode: String,
    pub evidence_id: String,
    pub video_path: String,
    pub whisper_model_path: String,
    pub llm_base_url: String,
    pub llm_model: String,
    pub llm_api_key: String,
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

    let run_mode = get_env("RAIN_E2E_RUN_MODE").unwrap_or_else(|| "full".to_string());
    if run_mode != "full" && run_mode != "ui-proof" && run_mode != "runtime-settings" {
        return Err("RAIN_E2E_RUN_MODE must be full, ui-proof, or runtime-settings".to_string());
    }
    let database_path = required_env(&get_env, "RAIN_E2E_DB_PATH")?;
    if run_mode == "runtime-settings" {
        return Ok(Some(RealE2eConfig {
            enabled: true,
            run_mode,
            evidence_id: String::new(),
            video_path: String::new(),
            whisper_model_path: String::new(),
            llm_base_url: String::new(),
            llm_model: String::new(),
            llm_api_key: String::new(),
            whisper_backend: crate::runtime::runtime_capability()
                .whisper_backend
                .to_string(),
            database_path,
        }));
    }
    let evidence_id = required_env(&get_env, "RAIN_E2E_EVIDENCE_ID")?;
    let video_path = required_env(&get_env, "RAIN_E2E_VIDEO_PATH")?;
    let whisper_model_path = required_env(&get_env, "RAIN_E2E_WHISPER_MODEL_PATH")?;
    let llm_api_key = if run_mode == "full" {
        required_env_with_fallback(&get_env, "RAIN_E2E_LLM_API_KEY", "RAIN_QWEN_API_KEY")?
    } else {
        String::new()
    };
    let llm_base_url = get_env("RAIN_E2E_LLM_BASE_URL")
        .or_else(|| get_env("RAIN_E2E_QWEN_BASE_URL"))
        .unwrap_or_else(|| DEFAULT_LLM_BASE_URL.to_string());
    let llm_model = get_env("RAIN_E2E_LLM_MODEL")
        .or_else(|| get_env("RAIN_E2E_QWEN_MODEL"))
        .unwrap_or_else(|| DEFAULT_LLM_MODEL.to_string());

    let normalized_base_url = llm_base_url.trim().trim_end_matches('/');
    if !(normalized_base_url.starts_with("https://") || normalized_base_url.starts_with("http://"))
    {
        return Err("RAIN_E2E_LLM_BASE_URL must be an absolute HTTP(S) URL".to_string());
    }
    if llm_model.trim().is_empty() {
        return Err("RAIN_E2E_LLM_MODEL is required for Rain real E2E mode".to_string());
    }

    Ok(Some(RealE2eConfig {
        enabled: true,
        run_mode,
        evidence_id,
        video_path,
        whisper_model_path,
        llm_base_url: normalized_base_url.to_string(),
        llm_model: llm_model.trim().to_string(),
        llm_api_key,
        whisper_backend: crate::runtime::runtime_capability()
            .whisper_backend
            .to_string(),
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

fn required_env_with_fallback<F>(
    get_env: &F,
    key: &str,
    fallback_key: &str,
) -> Result<String, String>
where
    F: Fn(&str) -> Option<String>,
{
    let value = get_env(key)
        .filter(|candidate| !candidate.trim().is_empty())
        .or_else(|| get_env(fallback_key))
        .unwrap_or_default();
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
    fn e2e_config_rejects_non_http_llm_endpoint_without_exposing_secret() {
        let error = read(&[
            ("RAIN_E2E_MODE", "1"),
            ("RAIN_E2E_EVIDENCE_ID", "rain-real-e2e-test"),
            ("RAIN_E2E_VIDEO_PATH", "D:\\video.mp4"),
            ("RAIN_E2E_WHISPER_MODEL_PATH", "D:\\ggml-large-v3.bin"),
            ("RAIN_E2E_LLM_API_KEY", "sk-secret"),
            ("RAIN_E2E_DB_PATH", "D:\\rain-e2e.db"),
            ("RAIN_E2E_LLM_BASE_URL", "models.example.test/v1"),
            ("RAIN_E2E_LLM_MODEL", "generic-model"),
        ])
        .unwrap_err();

        assert_eq!(
            error,
            "RAIN_E2E_LLM_BASE_URL must be an absolute HTTP(S) URL"
        );
        assert!(!error.contains("sk-secret"));
    }

    #[test]
    fn e2e_config_accepts_a_generic_openai_compatible_runtime() {
        let config = read(&[
            ("RAIN_E2E_MODE", "1"),
            ("RAIN_E2E_EVIDENCE_ID", "rain-real-e2e-test"),
            ("RAIN_E2E_VIDEO_PATH", "D:\\video.mp4"),
            ("RAIN_E2E_WHISPER_MODEL_PATH", "D:\\ggml-large-v3.bin"),
            ("RAIN_E2E_LLM_API_KEY", "sk-secret"),
            ("RAIN_E2E_LLM_BASE_URL", "https://models.example.test/v1/"),
            ("RAIN_E2E_LLM_MODEL", "generic-model"),
            ("RAIN_E2E_DB_PATH", "D:\\rain-e2e.db"),
        ])
        .unwrap()
        .unwrap();

        assert_eq!(config.evidence_id, "rain-real-e2e-test");
        assert_eq!(config.run_mode, "full");
        assert_eq!(config.video_path, "D:\\video.mp4");
        assert_eq!(config.whisper_model_path, "D:\\ggml-large-v3.bin");
        assert_eq!(config.llm_base_url, "https://models.example.test/v1");
        assert_eq!(config.llm_model, "generic-model");
        assert_eq!(config.llm_api_key, "sk-secret");
        assert_eq!(config.database_path, "D:\\rain-e2e.db");
        assert!(config.whisper_backend == "cpu" || config.whisper_backend == "cuda");
    }

    #[test]
    fn e2e_config_accepts_legacy_llm_environment_aliases() {
        let config = read(&[
            ("RAIN_E2E_MODE", "1"),
            ("RAIN_E2E_EVIDENCE_ID", "rain-real-e2e-test"),
            ("RAIN_E2E_VIDEO_PATH", "D:\\video.mp4"),
            ("RAIN_E2E_WHISPER_MODEL_PATH", "D:\\ggml-large-v3.bin"),
            ("RAIN_QWEN_API_KEY", "sk-secret"),
            ("RAIN_E2E_QWEN_BASE_URL", "https://legacy.example.test/v1"),
            ("RAIN_E2E_QWEN_MODEL", "legacy-model"),
            ("RAIN_E2E_DB_PATH", "D:\\rain-e2e.db"),
        ])
        .unwrap()
        .unwrap();

        assert_eq!(config.llm_base_url, "https://legacy.example.test/v1");
        assert_eq!(config.llm_model, "legacy-model");
        assert_eq!(config.llm_api_key, "sk-secret");
    }

    #[test]
    fn e2e_ui_proof_mode_reuses_evidence_without_an_api_key() {
        let config = read(&[
            ("RAIN_E2E_MODE", "1"),
            ("RAIN_E2E_RUN_MODE", "ui-proof"),
            ("RAIN_E2E_EVIDENCE_ID", "rain-real-e2e-test"),
            ("RAIN_E2E_VIDEO_PATH", "D:\\video.mp4"),
            ("RAIN_E2E_WHISPER_MODEL_PATH", "D:\\ggml-large-v3.bin"),
            ("RAIN_E2E_LLM_BASE_URL", "https://models.example.test/v1"),
            ("RAIN_E2E_LLM_MODEL", "generic-model"),
            ("RAIN_E2E_DB_PATH", "D:\\rain-e2e.db"),
        ])
        .unwrap()
        .unwrap();

        assert_eq!(config.run_mode, "ui-proof");
        assert_eq!(config.llm_api_key, "");
    }

    #[test]
    fn e2e_runtime_settings_mode_needs_only_an_isolated_database() {
        let config = read(&[
            ("RAIN_E2E_MODE", "1"),
            ("RAIN_E2E_RUN_MODE", "runtime-settings"),
            ("RAIN_E2E_DB_PATH", "D:\\tmp\\rain-runtime-settings-e2e.db"),
        ])
        .unwrap()
        .unwrap();

        assert_eq!(config.run_mode, "runtime-settings");
        assert_eq!(
            config.database_path,
            "D:\\tmp\\rain-runtime-settings-e2e.db"
        );
        assert_eq!(config.llm_api_key, "");
        assert_eq!(config.video_path, "");
        assert_eq!(config.whisper_model_path, "");
    }
}
