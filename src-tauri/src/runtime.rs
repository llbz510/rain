#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhisperBackend {
    Cuda,
    Cpu,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapability {
    pub whisper_backend: &'static str,
    pub cpu_fallback_available: bool,
}

pub fn selected_backend() -> WhisperBackend {
    #[cfg(feature = "cuda-whisper")]
    {
        WhisperBackend::Cuda
    }
    #[cfg(not(feature = "cuda-whisper"))]
    {
        WhisperBackend::Cpu
    }
}

pub fn runtime_capability() -> RuntimeCapability {
    let whisper_backend = match selected_backend() {
        WhisperBackend::Cuda => "cuda",
        WhisperBackend::Cpu => "cpu",
    };
    RuntimeCapability {
        whisper_backend,
        cpu_fallback_available: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_exposes_one_valid_backend() {
        let backend = runtime_capability().whisper_backend;
        assert!(backend == "cuda" || backend == "cpu");
    }
}
