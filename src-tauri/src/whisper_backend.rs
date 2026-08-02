use crate::scheduler::CancellationToken;
use crate::whisper::{self, WhisperError, WhisperResult};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub const WORKER_PROTOCOL_VERSION: u32 = 1;
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const WORKER_POLL_INTERVAL: Duration = Duration::from_millis(50);
const MAX_WORKER_STDOUT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_WORKER_STDERR_BYTES: u64 = 256 * 1024;
const MODEL_MEMORY_HEADROOM_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WhisperBackendPreference {
    #[default]
    Auto,
    Cuda,
    Cpu,
}

impl WhisperBackendPreference {
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("auto").trim().to_ascii_lowercase().as_str() {
            "" | "auto" => Ok(Self::Auto),
            "cuda" | "gpu" => Ok(Self::Cuda),
            "cpu" => Ok(Self::Cpu),
            value => Err(format!(
                "Unknown Whisper backend preference '{value}'; use auto, cuda, or cpu"
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Cuda => "cuda",
            Self::Cpu => "cpu",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CudaDeviceCapability {
    pub available: bool,
    pub device_name: Option<String>,
    pub free_memory_bytes: Option<u64>,
    pub total_memory_bytes: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapability {
    pub whisper_backend: String,
    pub cpu_fallback_available: bool,
    pub preference: String,
    pub cuda_available: bool,
    pub cuda_device: Option<String>,
    pub cuda_free_memory_bytes: Option<u64>,
    pub cuda_total_memory_bytes: Option<u64>,
    pub fallback_reason: Option<String>,
    pub worker_protocol_version: u32,
}

#[derive(Debug, Clone)]
pub struct WhisperExecution {
    pub result: WhisperResult,
    pub backend: &'static str,
    pub fallback_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerErrorKind {
    Cancelled,
    Model,
    Resource,
    Runtime,
    Protocol,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendError {
    pub kind: WorkerErrorKind,
    pub message: String,
}

impl BackendError {
    fn new(kind: WorkerErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn unavailable(message: impl Into<String>) -> Self {
        Self::new(WorkerErrorKind::Runtime, message)
    }

    fn can_auto_fallback(&self) -> bool {
        matches!(
            self.kind,
            WorkerErrorKind::Resource | WorkerErrorKind::Runtime | WorkerErrorKind::Protocol
        )
    }
}

impl std::fmt::Display for BackendError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for BackendError {}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerRequest {
    Probe {
        protocol_version: u32,
    },
    Transcribe {
        protocol_version: u32,
        model_path: String,
        wav_path: String,
        language: Option<String>,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerResponse {
    Probe {
        protocol_version: u32,
        device: CudaDeviceCapability,
    },
    Transcription {
        protocol_version: u32,
        result: WhisperResult,
    },
    Error {
        protocol_version: u32,
        kind: WorkerErrorKind,
        message: String,
    },
}

pub trait CudaWorkerAdapter: Send + Sync + 'static {
    fn probe(&self) -> Result<CudaDeviceCapability, BackendError>;
    fn transcribe(
        &self,
        model_path: &str,
        wav_path: &str,
        language: Option<&str>,
        cancellation: &CancellationToken,
    ) -> Result<WhisperResult, BackendError>;
}

#[derive(Debug, Clone)]
pub struct ProcessCudaWorker {
    executable: PathBuf,
}

impl ProcessCudaWorker {
    pub fn new(executable: PathBuf) -> Self {
        Self { executable }
    }

    pub fn executable(&self) -> &Path {
        &self.executable
    }

    fn invoke(
        &self,
        request: &WorkerRequest,
        cancellation: &CancellationToken,
        timeout: Option<Duration>,
    ) -> Result<WorkerResponse, BackendError> {
        if !self.executable.is_file() {
            return Err(BackendError::unavailable(format!(
                "CUDA worker is not installed at {}",
                self.executable.display()
            )));
        }

        let mut command = Command::new(&self.executable);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(parent) = self.executable.parent() {
            command.current_dir(parent);
        }
        let mut child = command.spawn().map_err(|error| {
            BackendError::unavailable(format!(
                "Cannot start CUDA worker {}: {error}",
                self.executable.display()
            ))
        })?;

        let request_json = serde_json::to_vec(request).map_err(|error| {
            BackendError::new(
                WorkerErrorKind::Protocol,
                format!("Cannot encode CUDA worker request: {error}"),
            )
        })?;
        child
            .stdin
            .take()
            .ok_or_else(|| {
                BackendError::new(
                    WorkerErrorKind::Protocol,
                    "CUDA worker stdin was not available",
                )
            })?
            .write_all(&request_json)
            .map_err(|error| {
                BackendError::unavailable(format!("Cannot send request to CUDA worker: {error}"))
            })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            BackendError::new(
                WorkerErrorKind::Protocol,
                "CUDA worker stdout was not available",
            )
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            BackendError::new(
                WorkerErrorKind::Protocol,
                "CUDA worker stderr was not available",
            )
        })?;
        let stdout_reader = thread::spawn(move || read_bounded(stdout, MAX_WORKER_STDOUT_BYTES));
        let stderr_reader = thread::spawn(move || read_bounded(stderr, MAX_WORKER_STDERR_BYTES));

        let started = Instant::now();
        let status = loop {
            if cancellation.is_cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(BackendError::new(
                    WorkerErrorKind::Cancelled,
                    "ASR cancelled",
                ));
            }
            if timeout.is_some_and(|limit| started.elapsed() >= limit) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(BackendError::unavailable(
                    "CUDA worker probe timed out after 15 seconds",
                ));
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => thread::sleep(WORKER_POLL_INTERVAL),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(BackendError::unavailable(format!(
                        "Cannot read CUDA worker status: {error}"
                    )));
                }
            }
        };

        let stdout = join_reader(stdout_reader, "stdout")?;
        let stderr = join_reader(stderr_reader, "stderr")?;
        if !status.success() {
            let detail = String::from_utf8_lossy(&stderr).trim().to_string();
            return Err(BackendError::unavailable(format!(
                "CUDA worker exited with {status}{}",
                if detail.is_empty() {
                    String::new()
                } else {
                    format!(": {detail}")
                }
            )));
        }
        let response: WorkerResponse = serde_json::from_slice(&stdout).map_err(|error| {
            BackendError::new(
                WorkerErrorKind::Protocol,
                format!("CUDA worker returned invalid JSON: {error}"),
            )
        })?;
        validate_worker_response(response)
    }
}

impl CudaWorkerAdapter for ProcessCudaWorker {
    fn probe(&self) -> Result<CudaDeviceCapability, BackendError> {
        let cancellation = CancellationToken::new();
        match self.invoke(
            &WorkerRequest::Probe {
                protocol_version: WORKER_PROTOCOL_VERSION,
            },
            &cancellation,
            Some(PROBE_TIMEOUT),
        )? {
            WorkerResponse::Probe { device, .. } => Ok(device),
            WorkerResponse::Error { kind, message, .. } => Err(BackendError::new(kind, message)),
            WorkerResponse::Transcription { .. } => Err(BackendError::new(
                WorkerErrorKind::Protocol,
                "CUDA worker returned transcription data for a probe",
            )),
        }
    }

    fn transcribe(
        &self,
        model_path: &str,
        wav_path: &str,
        language: Option<&str>,
        cancellation: &CancellationToken,
    ) -> Result<WhisperResult, BackendError> {
        match self.invoke(
            &WorkerRequest::Transcribe {
                protocol_version: WORKER_PROTOCOL_VERSION,
                model_path: model_path.to_string(),
                wav_path: wav_path.to_string(),
                language: language.map(str::to_string),
            },
            cancellation,
            None,
        )? {
            WorkerResponse::Transcription { result, .. } => Ok(result),
            WorkerResponse::Error { kind, message, .. } => Err(BackendError::new(kind, message)),
            WorkerResponse::Probe { .. } => Err(BackendError::new(
                WorkerErrorKind::Protocol,
                "CUDA worker returned probe data for transcription",
            )),
        }
    }
}

fn development_worker_override() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        std::env::var_os("RAIN_WHISPER_CUDA_WORKER").map(PathBuf::from)
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}

pub fn resolve_cuda_worker_path(resource_dir: Option<&Path>) -> PathBuf {
    if let Some(path) = development_worker_override() {
        return path;
    }

    let filename = if cfg!(windows) {
        "rain-whisper-cuda.exe"
    } else {
        "rain-whisper-cuda"
    };
    let mut candidates = Vec::new();
    if let Some(resource_dir) = resource_dir {
        candidates.push(resource_dir.join("whisper-backends").join(filename));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join("whisper-backends").join(filename));
        }
    }
    if let Some(existing) = candidates.iter().find(|path| path.is_file()) {
        return existing.clone();
    }
    candidates
        .into_iter()
        .next()
        .unwrap_or_else(|| PathBuf::from(filename))
}

pub fn runtime_capability(
    preference: WhisperBackendPreference,
    adapter: &dyn CudaWorkerAdapter,
) -> RuntimeCapability {
    if preference == WhisperBackendPreference::Cpu {
        return RuntimeCapability {
            whisper_backend: "cpu".to_string(),
            cpu_fallback_available: true,
            preference: preference.as_str().to_string(),
            cuda_available: false,
            cuda_device: None,
            cuda_free_memory_bytes: None,
            cuda_total_memory_bytes: None,
            fallback_reason: None,
            worker_protocol_version: WORKER_PROTOCOL_VERSION,
        };
    }

    match adapter.probe() {
        Ok(device) if device.available => RuntimeCapability {
            whisper_backend: "cuda".to_string(),
            cpu_fallback_available: true,
            preference: preference.as_str().to_string(),
            cuda_available: true,
            cuda_device: device.device_name,
            cuda_free_memory_bytes: device.free_memory_bytes,
            cuda_total_memory_bytes: device.total_memory_bytes,
            fallback_reason: None,
            worker_protocol_version: WORKER_PROTOCOL_VERSION,
        },
        Ok(device) => unavailable_capability(preference, device.error),
        Err(error) => unavailable_capability(preference, Some(error.message)),
    }
}

fn unavailable_capability(
    preference: WhisperBackendPreference,
    reason: Option<String>,
) -> RuntimeCapability {
    RuntimeCapability {
        whisper_backend: if preference == WhisperBackendPreference::Auto {
            "cpu"
        } else {
            "unavailable"
        }
        .to_string(),
        cpu_fallback_available: true,
        preference: preference.as_str().to_string(),
        cuda_available: false,
        cuda_device: None,
        cuda_free_memory_bytes: None,
        cuda_total_memory_bytes: None,
        fallback_reason: Some(
            reason.unwrap_or_else(|| "No compatible NVIDIA CUDA device was found".to_string()),
        ),
        worker_protocol_version: WORKER_PROTOCOL_VERSION,
    }
}

pub fn transcribe_with_preference(
    preference: WhisperBackendPreference,
    adapter: &dyn CudaWorkerAdapter,
    model_path: &str,
    wav_path: &str,
    language: Option<&str>,
    cancellation: &CancellationToken,
) -> Result<WhisperExecution, String> {
    transcribe_with_preference_observed(
        preference,
        adapter,
        model_path,
        wav_path,
        language,
        cancellation,
        &|_, _| {},
    )
}

pub fn transcribe_with_preference_observed(
    preference: WhisperBackendPreference,
    adapter: &dyn CudaWorkerAdapter,
    model_path: &str,
    wav_path: &str,
    language: Option<&str>,
    cancellation: &CancellationToken,
    on_selected: &(dyn Fn(&str, Option<&str>) + Send + Sync),
) -> Result<WhisperExecution, String> {
    let cpu_transcriber = |model_path: &str,
                           wav_path: &str,
                           language: Option<&str>,
                           cancellation: &CancellationToken| {
        whisper::transcribe_wav_with_language(
            model_path,
            wav_path,
            language,
            Some(cancellation.clone()),
        )
        .map_err(|error| error.to_string())
    };
    transcribe_with_adapters(
        preference,
        adapter,
        &cpu_transcriber,
        model_path,
        wav_path,
        language,
        cancellation,
        on_selected,
    )
}

type CpuTranscriber<'a> =
    dyn Fn(&str, &str, Option<&str>, &CancellationToken) -> Result<WhisperResult, String> + 'a;

fn transcribe_with_adapters(
    preference: WhisperBackendPreference,
    adapter: &dyn CudaWorkerAdapter,
    cpu_transcriber: &CpuTranscriber<'_>,
    model_path: &str,
    wav_path: &str,
    language: Option<&str>,
    cancellation: &CancellationToken,
    on_selected: &(dyn Fn(&str, Option<&str>) + Send + Sync),
) -> Result<WhisperExecution, String> {
    if preference == WhisperBackendPreference::Cpu {
        on_selected("cpu", None);
        return cpu_transcribe(
            cpu_transcriber,
            model_path,
            wav_path,
            language,
            cancellation,
            None,
        );
    }

    let probe = adapter.probe();
    match probe {
        Ok(device) if device.available => {
            if let Some(reason) = insufficient_memory_reason(&device, model_path) {
                if preference == WhisperBackendPreference::Cuda {
                    return Err(format!("CUDA Whisper is unavailable: {reason}"));
                }
                on_selected("cpu", Some(&reason));
                return cpu_transcribe(
                    cpu_transcriber,
                    model_path,
                    wav_path,
                    language,
                    cancellation,
                    Some(reason),
                );
            }
            on_selected("cuda", None);
            match adapter.transcribe(model_path, wav_path, language, cancellation) {
                Ok(result) => Ok(WhisperExecution {
                    result,
                    backend: "cuda",
                    fallback_reason: None,
                }),
                Err(error)
                    if preference == WhisperBackendPreference::Auto
                        && error.can_auto_fallback()
                        && !cancellation.is_cancelled() =>
                {
                    let reason = format!("CUDA failed; using CPU: {}", error.message);
                    on_selected("cpu", Some(&reason));
                    cpu_transcribe(
                        cpu_transcriber,
                        model_path,
                        wav_path,
                        language,
                        cancellation,
                        Some(reason),
                    )
                }
                Err(error) => Err(error.message),
            }
        }
        Ok(device) => {
            let reason = device
                .error
                .unwrap_or_else(|| "No compatible NVIDIA CUDA device was found".to_string());
            if preference == WhisperBackendPreference::Cuda {
                Err(format!("CUDA Whisper is unavailable: {reason}"))
            } else {
                on_selected("cpu", Some(&reason));
                cpu_transcribe(
                    cpu_transcriber,
                    model_path,
                    wav_path,
                    language,
                    cancellation,
                    Some(reason),
                )
            }
        }
        Err(error) => {
            if preference == WhisperBackendPreference::Cuda {
                Err(format!("CUDA Whisper is unavailable: {}", error.message))
            } else if error.can_auto_fallback() && !cancellation.is_cancelled() {
                on_selected("cpu", Some(&error.message));
                cpu_transcribe(
                    cpu_transcriber,
                    model_path,
                    wav_path,
                    language,
                    cancellation,
                    Some(error.message),
                )
            } else {
                Err(error.message)
            }
        }
    }
}

fn cpu_transcribe(
    cpu_transcriber: &CpuTranscriber<'_>,
    model_path: &str,
    wav_path: &str,
    language: Option<&str>,
    cancellation: &CancellationToken,
    fallback_reason: Option<String>,
) -> Result<WhisperExecution, String> {
    cpu_transcriber(model_path, wav_path, language, cancellation).map(|result| WhisperExecution {
        result,
        backend: "cpu",
        fallback_reason,
    })
}

fn insufficient_memory_reason(device: &CudaDeviceCapability, model_path: &str) -> Option<String> {
    let free = device.free_memory_bytes?;
    let model_bytes = std::fs::metadata(model_path).ok()?.len();
    let required = model_bytes.saturating_add(MODEL_MEMORY_HEADROOM_BYTES);
    (free < required).then(|| {
        format!(
            "CUDA device has {} MiB free, but this model requires at least {} MiB",
            free / (1024 * 1024),
            required / (1024 * 1024)
        )
    })
}

pub fn classify_whisper_error(error: &WhisperError) -> WorkerErrorKind {
    match error {
        WhisperError::Cancelled => WorkerErrorKind::Cancelled,
        WhisperError::ModelNotFound(_) => WorkerErrorKind::Model,
        WhisperError::AudioConversionFailed(_) => WorkerErrorKind::Runtime,
        WhisperError::LoadFailed(message) | WhisperError::TranscribeFailed(message) => {
            let message = message.to_ascii_lowercase();
            if [
                "cuda",
                "cublas",
                "out of memory",
                "allocation",
                "driver",
                "device",
            ]
            .iter()
            .any(|needle| message.contains(needle))
            {
                WorkerErrorKind::Resource
            } else {
                WorkerErrorKind::Model
            }
        }
    }
}

fn validate_worker_response(response: WorkerResponse) -> Result<WorkerResponse, BackendError> {
    let version = match &response {
        WorkerResponse::Probe {
            protocol_version, ..
        }
        | WorkerResponse::Transcription {
            protocol_version, ..
        }
        | WorkerResponse::Error {
            protocol_version, ..
        } => *protocol_version,
    };
    if version != WORKER_PROTOCOL_VERSION {
        return Err(BackendError::new(
            WorkerErrorKind::Protocol,
            format!(
                "CUDA worker protocol mismatch: app expects {}, worker returned {version}",
                WORKER_PROTOCOL_VERSION
            ),
        ));
    }
    Ok(response)
}

fn read_bounded(reader: impl Read, max_bytes: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > max_bytes {
        Err(format!("worker output exceeded {max_bytes} bytes"))
    } else {
        Ok(bytes)
    }
}

fn join_reader(
    reader: thread::JoinHandle<Result<Vec<u8>, String>>,
    stream: &str,
) -> Result<Vec<u8>, BackendError> {
    reader
        .join()
        .map_err(|_| {
            BackendError::new(
                WorkerErrorKind::Protocol,
                format!("CUDA worker {stream} reader panicked"),
            )
        })?
        .map_err(|error| {
            BackendError::new(
                WorkerErrorKind::Protocol,
                format!("Cannot read CUDA worker {stream}: {error}"),
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    struct FakeWorker {
        probe: Result<CudaDeviceCapability, BackendError>,
        transcription: Mutex<Option<Result<WhisperResult, BackendError>>>,
    }

    impl CudaWorkerAdapter for FakeWorker {
        fn probe(&self) -> Result<CudaDeviceCapability, BackendError> {
            self.probe.clone()
        }

        fn transcribe(
            &self,
            _model_path: &str,
            _wav_path: &str,
            _language: Option<&str>,
            _cancellation: &CancellationToken,
        ) -> Result<WhisperResult, BackendError> {
            self.transcription
                .lock()
                .unwrap()
                .take()
                .expect("fake transcription result")
        }
    }

    struct PanicWorker;

    impl CudaWorkerAdapter for PanicWorker {
        fn probe(&self) -> Result<CudaDeviceCapability, BackendError> {
            panic!("CPU preference must not probe CUDA")
        }

        fn transcribe(
            &self,
            _model_path: &str,
            _wav_path: &str,
            _language: Option<&str>,
            _cancellation: &CancellationToken,
        ) -> Result<WhisperResult, BackendError> {
            panic!("CPU preference must not start CUDA")
        }
    }

    fn available_device() -> CudaDeviceCapability {
        CudaDeviceCapability {
            available: true,
            device_name: Some("Test NVIDIA GPU".to_string()),
            free_memory_bytes: Some(8 * 1024 * 1024 * 1024),
            total_memory_bytes: Some(12 * 1024 * 1024 * 1024),
            error: None,
        }
    }

    fn result() -> WhisperResult {
        WhisperResult {
            segments: Vec::new(),
            detected_language: "en".to_string(),
        }
    }

    #[test]
    fn preference_defaults_to_auto_and_rejects_unknown_values() {
        assert_eq!(
            WhisperBackendPreference::parse(None).unwrap(),
            WhisperBackendPreference::Auto
        );
        assert_eq!(
            WhisperBackendPreference::parse(Some("GPU")).unwrap(),
            WhisperBackendPreference::Cuda
        );
        assert!(WhisperBackendPreference::parse(Some("metal")).is_err());
    }

    #[test]
    fn auto_capability_prefers_a_healthy_cuda_worker() {
        let worker = FakeWorker {
            probe: Ok(available_device()),
            transcription: Mutex::new(None),
        };

        let capability = runtime_capability(WhisperBackendPreference::Auto, &worker);

        assert_eq!(capability.whisper_backend, "cuda");
        assert!(capability.cuda_available);
        assert_eq!(capability.cuda_device.as_deref(), Some("Test NVIDIA GPU"));
        assert!(capability.cpu_fallback_available);
    }

    #[test]
    fn auto_capability_falls_back_to_cpu_when_worker_is_missing() {
        let worker = FakeWorker {
            probe: Err(BackendError::unavailable("worker missing")),
            transcription: Mutex::new(None),
        };

        let capability = runtime_capability(WhisperBackendPreference::Auto, &worker);

        assert_eq!(capability.whisper_backend, "cpu");
        assert_eq!(
            capability.fallback_reason.as_deref(),
            Some("worker missing")
        );
    }

    #[test]
    fn forced_cuda_fails_closed_when_worker_is_missing() {
        let worker = FakeWorker {
            probe: Err(BackendError::unavailable("worker missing")),
            transcription: Mutex::new(None),
        };

        let capability = runtime_capability(WhisperBackendPreference::Cuda, &worker);

        assert_eq!(capability.whisper_backend, "unavailable");
        assert_eq!(
            capability.fallback_reason.as_deref(),
            Some("worker missing")
        );
    }

    #[test]
    fn cuda_execution_returns_the_worker_result() {
        let worker = FakeWorker {
            probe: Ok(available_device()),
            transcription: Mutex::new(Some(Ok(result()))),
        };
        let cancellation = CancellationToken::new();

        let execution = transcribe_with_preference(
            WhisperBackendPreference::Cuda,
            &worker,
            "missing-model-for-memory-guard.bin",
            "audio.wav",
            Some("en"),
            &cancellation,
        )
        .unwrap();

        assert_eq!(execution.backend, "cuda");
        assert!(execution.fallback_reason.is_none());
    }

    #[test]
    fn cancellation_is_never_retried_on_cpu() {
        let worker = FakeWorker {
            probe: Ok(available_device()),
            transcription: Mutex::new(Some(Err(BackendError::new(
                WorkerErrorKind::Cancelled,
                "ASR cancelled",
            )))),
        };
        let cancellation = CancellationToken::new();

        let error = transcribe_with_preference(
            WhisperBackendPreference::Auto,
            &worker,
            "missing-model-for-memory-guard.bin",
            "audio.wav",
            None,
            &cancellation,
        )
        .unwrap_err();

        assert_eq!(error, "ASR cancelled");
    }

    #[test]
    fn worker_protocol_version_is_enforced() {
        let error = validate_worker_response(WorkerResponse::Probe {
            protocol_version: WORKER_PROTOCOL_VERSION + 1,
            device: available_device(),
        })
        .unwrap_err();

        assert_eq!(error.kind, WorkerErrorKind::Protocol);
        assert!(error.message.contains("protocol mismatch"));
    }

    #[test]
    fn forced_cpu_never_probes_or_starts_the_cuda_worker() {
        let cpu_count = AtomicUsize::new(0);
        let cpu = |_: &str,
                   _: &str,
                   _: Option<&str>,
                   _: &CancellationToken|
         -> Result<WhisperResult, String> {
            cpu_count.fetch_add(1, Ordering::SeqCst);
            Ok(result())
        };

        let execution = transcribe_with_adapters(
            WhisperBackendPreference::Cpu,
            &PanicWorker,
            &cpu,
            "model.bin",
            "audio.wav",
            None,
            &CancellationToken::new(),
            &|_, _| {},
        )
        .unwrap();

        assert_eq!(execution.backend, "cpu");
        assert_eq!(cpu_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn auto_worker_failure_runs_cpu_once_and_preserves_the_reason() {
        let worker = FakeWorker {
            probe: Err(BackendError::unavailable("worker missing")),
            transcription: Mutex::new(None),
        };
        let cpu_count = AtomicUsize::new(0);
        let cpu = |_: &str,
                   _: &str,
                   _: Option<&str>,
                   _: &CancellationToken|
         -> Result<WhisperResult, String> {
            cpu_count.fetch_add(1, Ordering::SeqCst);
            Ok(result())
        };

        let execution = transcribe_with_adapters(
            WhisperBackendPreference::Auto,
            &worker,
            &cpu,
            "model.bin",
            "audio.wav",
            None,
            &CancellationToken::new(),
            &|_, _| {},
        )
        .unwrap();

        assert_eq!(execution.backend, "cpu");
        assert_eq!(execution.fallback_reason.as_deref(), Some("worker missing"));
        assert_eq!(cpu_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn cuda_resource_failure_falls_back_but_model_failure_does_not() {
        let cpu_count = AtomicUsize::new(0);
        let cpu = |_: &str,
                   _: &str,
                   _: Option<&str>,
                   _: &CancellationToken|
         -> Result<WhisperResult, String> {
            cpu_count.fetch_add(1, Ordering::SeqCst);
            Ok(result())
        };
        let resource_worker = FakeWorker {
            probe: Ok(available_device()),
            transcription: Mutex::new(Some(Err(BackendError::new(
                WorkerErrorKind::Resource,
                "CUDA out of memory",
            )))),
        };
        let resource_execution = transcribe_with_adapters(
            WhisperBackendPreference::Auto,
            &resource_worker,
            &cpu,
            "missing-model-for-memory-guard.bin",
            "audio.wav",
            None,
            &CancellationToken::new(),
            &|_, _| {},
        )
        .unwrap();
        assert_eq!(resource_execution.backend, "cpu");
        assert!(resource_execution
            .fallback_reason
            .as_deref()
            .unwrap()
            .contains("CUDA out of memory"));

        let model_worker = FakeWorker {
            probe: Ok(available_device()),
            transcription: Mutex::new(Some(Err(BackendError::new(
                WorkerErrorKind::Model,
                "model is invalid",
            )))),
        };
        let error = transcribe_with_adapters(
            WhisperBackendPreference::Auto,
            &model_worker,
            &cpu,
            "missing-model-for-memory-guard.bin",
            "audio.wav",
            None,
            &CancellationToken::new(),
            &|_, _| {},
        )
        .unwrap_err();

        assert_eq!(error, "model is invalid");
        assert_eq!(cpu_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn obvious_vram_shortage_is_detected_before_worker_inference() {
        let model_path = std::env::current_exe().unwrap();
        let device = CudaDeviceCapability {
            available: true,
            device_name: Some("Small GPU".to_string()),
            free_memory_bytes: Some(1),
            total_memory_bytes: Some(1024),
            error: None,
        };

        let reason =
            insufficient_memory_reason(&device, model_path.to_str().unwrap()).expect("VRAM guard");

        assert!(reason.contains("requires at least"));
    }
}
