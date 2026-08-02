use crate::whisper_backend::{
    self, ProcessCudaWorker, RuntimeCapability, WhisperBackendPreference,
};
use std::path::Path;

pub fn runtime_capability() -> RuntimeCapability {
    runtime_capability_for(WhisperBackendPreference::Auto, None)
}

pub fn runtime_capability_for(
    preference: WhisperBackendPreference,
    resource_dir: Option<&Path>,
) -> RuntimeCapability {
    let worker = ProcessCudaWorker::new(whisper_backend::resolve_cuda_worker_path(resource_dir));
    whisper_backend::runtime_capability(preference, &worker)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_cpu_is_always_available_without_a_cuda_probe() {
        let capability = runtime_capability_for(WhisperBackendPreference::Cpu, None);

        assert_eq!(capability.whisper_backend, "cpu");
        assert!(capability.cpu_fallback_available);
        assert_eq!(capability.preference, "cpu");
    }
}
