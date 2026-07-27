use crate::whisper::WhisperModelSize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, Notify};

pub const MODEL_DOWNLOAD_PROGRESS_EVENT: &str = "whisper_model_download_progress";
const WHISPER_CPP_REVISION: &str = "5359861c739e955e79d9a303bcbc70fb988958b1";

#[derive(Debug, Clone)]
struct ModelManifest {
    filename: &'static str,
    url: String,
    expected_bytes: u64,
    sha256: &'static str,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgress {
    pub model_size: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ModelDownloadError {
    AlreadyRunning,
    Cancelled,
    Integrity(String),
    Network(String),
    Io(String),
    Progress(String),
}

impl fmt::Display for ModelDownloadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyRunning => write!(formatter, "download already running"),
            Self::Cancelled => write!(formatter, "cancelled"),
            Self::Integrity(message) => write!(formatter, "integrity check failed: {message}"),
            Self::Network(message) => write!(formatter, "download failed: {message}"),
            Self::Io(message) => write!(formatter, "model file error: {message}"),
            Self::Progress(message) => write!(formatter, "progress event failed: {message}"),
        }
    }
}

pub struct ModelDownloadManager {
    active: Mutex<HashMap<String, Arc<DownloadCancellation>>>,
}

struct DownloadCancellation {
    cancelled: AtomicBool,
    notify: Notify,
}

impl DownloadCancellation {
    fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_one();
    }

    async fn cancelled(&self) {
        if self.cancelled.load(Ordering::Acquire) {
            return;
        }
        self.notify.notified().await;
    }
}

impl Default for ModelDownloadManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ModelDownloadManager {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(HashMap::new()),
        }
    }

    async fn begin(
        &self,
        model_size: &str,
    ) -> Result<Arc<DownloadCancellation>, ModelDownloadError> {
        let mut active = self.active.lock().await;
        if active.contains_key(model_size) {
            return Err(ModelDownloadError::AlreadyRunning);
        }
        let cancellation = Arc::new(DownloadCancellation::new());
        active.insert(model_size.to_string(), Arc::clone(&cancellation));
        Ok(cancellation)
    }

    async fn finish(&self, model_size: &str) {
        self.active.lock().await.remove(model_size);
    }

    pub async fn cancel(&self, model_size: &str) -> bool {
        let cancellation = self.active.lock().await.get(model_size).cloned();
        if let Some(cancellation) = cancellation {
            cancellation.cancel();
            true
        } else {
            false
        }
    }
}

trait ProgressReporter: Send + Sync {
    fn report(&self, progress: &ModelDownloadProgress) -> Result<(), String>;
}

struct TauriProgressReporter<'a> {
    app: &'a AppHandle,
}

impl ProgressReporter for TauriProgressReporter<'_> {
    fn report(&self, progress: &ModelDownloadProgress) -> Result<(), String> {
        self.app
            .emit(MODEL_DOWNLOAD_PROGRESS_EVENT, progress)
            .map_err(|error| error.to_string())
    }
}

fn model_size_name(size: WhisperModelSize) -> &'static str {
    match size {
        WhisperModelSize::Tiny => "tiny",
        WhisperModelSize::Base => "base",
        WhisperModelSize::Small => "small",
        WhisperModelSize::Medium => "medium",
        WhisperModelSize::LargeV3 => "large-v3",
    }
}

fn manifest_for(size: WhisperModelSize) -> ModelManifest {
    let (filename, expected_bytes, sha256) = match size {
        WhisperModelSize::Tiny => (
            "ggml-tiny.bin",
            77_691_713,
            "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
        ),
        WhisperModelSize::Base => (
            "ggml-base.bin",
            147_951_465,
            "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        ),
        WhisperModelSize::Small => (
            "ggml-small.bin",
            487_601_967,
            "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        ),
        WhisperModelSize::Medium => (
            "ggml-medium.bin",
            1_533_763_059,
            "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
        ),
        WhisperModelSize::LargeV3 => (
            "ggml-large-v3.bin",
            3_095_033_483,
            "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
        ),
    };

    ModelManifest {
        filename,
        url: format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/{WHISPER_CPP_REVISION}/{filename}"
        ),
        expected_bytes,
        sha256,
    }
}

pub async fn download_model(
    manager: &ModelDownloadManager,
    app: &AppHandle,
    output_dir: &Path,
    size: WhisperModelSize,
) -> Result<PathBuf, ModelDownloadError> {
    let manifest = manifest_for(size);
    download_from_manifest(
        manager,
        output_dir,
        model_size_name(size),
        &manifest,
        &TauriProgressReporter { app },
    )
    .await
}

pub async fn cancel_model_download(manager: &ModelDownloadManager, size: WhisperModelSize) -> bool {
    manager.cancel(model_size_name(size)).await
}

pub fn list_models(model_dir: &Path) -> Vec<PathBuf> {
    [
        WhisperModelSize::Tiny,
        WhisperModelSize::Base,
        WhisperModelSize::Small,
        WhisperModelSize::Medium,
        WhisperModelSize::LargeV3,
    ]
    .into_iter()
    .map(|size| model_dir.join(size.as_filename()))
    .filter(|path| path.is_file())
    .collect()
}

async fn download_from_manifest(
    manager: &ModelDownloadManager,
    output_dir: &Path,
    model_size: &str,
    manifest: &ModelManifest,
    reporter: &dyn ProgressReporter,
) -> Result<PathBuf, ModelDownloadError> {
    tokio::fs::create_dir_all(output_dir)
        .await
        .map_err(|error| ModelDownloadError::Io(format!("create directory: {error}")))?;
    let destination = output_dir.join(manifest.filename);
    if file_matches(&destination, manifest).await? {
        return Ok(destination);
    }

    let cancellation = manager.begin(model_size).await?;
    let result = download_new_file(
        &destination,
        model_size,
        manifest,
        reporter,
        cancellation.as_ref(),
    )
    .await;
    manager.finish(model_size).await;
    result
}

async fn file_matches(path: &Path, manifest: &ModelManifest) -> Result<bool, ModelDownloadError> {
    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(ModelDownloadError::Io(format!("read metadata: {error}"))),
    };
    if !metadata.is_file() || metadata.len() != manifest.expected_bytes {
        return Ok(false);
    }

    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| ModelDownloadError::Io(format!("open existing model: {error}")))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .await
            .map_err(|error| ModelDownloadError::Io(format!("read existing model: {error}")))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()) == manifest.sha256)
}

async fn download_new_file(
    destination: &Path,
    model_size: &str,
    manifest: &ModelManifest,
    reporter: &dyn ProgressReporter,
    cancellation: &DownloadCancellation,
) -> Result<PathBuf, ModelDownloadError> {
    let response = reqwest::Client::new()
        .get(&manifest.url)
        .send()
        .await
        .map_err(|error| ModelDownloadError::Network(error.to_string()))?;
    if !response.status().is_success() {
        return Err(ModelDownloadError::Network(format!(
            "HTTP {}",
            response.status()
        )));
    }
    if let Some(length) = response.content_length() {
        if length != manifest.expected_bytes {
            return Err(ModelDownloadError::Integrity(format!(
                "expected {} bytes, server announced {length}",
                manifest.expected_bytes
            )));
        }
    }

    let partial = destination.with_extension(format!("{}.part", uuid::Uuid::new_v4()));
    let result = stream_response_to_file(
        response,
        &partial,
        model_size,
        manifest,
        reporter,
        cancellation,
    )
    .await;
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&partial).await;
        return Err(error);
    }

    commit_verified_file(&partial, destination)
        .map_err(|error| ModelDownloadError::Io(format!("commit verified model: {error}")))?;
    Ok(destination.to_path_buf())
}

fn commit_verified_file(partial: &Path, destination: &Path) -> std::io::Result<()> {
    if let Err(commit_error) = atomic_replace(partial, destination) {
        if let Err(cleanup_error) = std::fs::remove_file(partial) {
            if cleanup_error.kind() != std::io::ErrorKind::NotFound {
                return Err(std::io::Error::new(
                    commit_error.kind(),
                    format!("{commit_error}; cleanup temporary file: {cleanup_error}"),
                ));
            }
        }
        return Err(commit_error);
    }
    Ok(())
}

async fn stream_response_to_file(
    mut response: reqwest::Response,
    partial: &Path,
    model_size: &str,
    manifest: &ModelManifest,
    reporter: &dyn ProgressReporter,
    cancellation: &DownloadCancellation,
) -> Result<(), ModelDownloadError> {
    let total_bytes = response.content_length().or(Some(manifest.expected_bytes));
    let mut file = tokio::fs::File::create(partial)
        .await
        .map_err(|error| ModelDownloadError::Io(format!("create temporary file: {error}")))?;
    let mut downloaded_bytes = 0_u64;
    let mut hasher = Sha256::new();

    reporter
        .report(&ModelDownloadProgress {
            model_size: model_size.to_string(),
            downloaded_bytes,
            total_bytes,
            percent: Some(0),
        })
        .map_err(ModelDownloadError::Progress)?;

    loop {
        if cancellation.cancelled.load(Ordering::Acquire) {
            return Err(ModelDownloadError::Cancelled);
        }
        let chunk = tokio::select! {
            _ = cancellation.cancelled() => return Err(ModelDownloadError::Cancelled),
            result = response.chunk() => {
                result.map_err(|error| ModelDownloadError::Network(error.to_string()))?
            }
        };
        let Some(chunk) = chunk else { break };
        if cancellation.cancelled.load(Ordering::Acquire) {
            return Err(ModelDownloadError::Cancelled);
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| ModelDownloadError::Io(format!("write temporary file: {error}")))?;
        downloaded_bytes += chunk.len() as u64;
        hasher.update(&chunk);
        let percent = total_bytes
            .map(|total| ((downloaded_bytes.saturating_mul(100) / total.max(1)).min(100)) as u8);
        reporter
            .report(&ModelDownloadProgress {
                model_size: model_size.to_string(),
                downloaded_bytes,
                total_bytes,
                percent,
            })
            .map_err(ModelDownloadError::Progress)?;
    }

    file.flush()
        .await
        .map_err(|error| ModelDownloadError::Io(format!("flush temporary file: {error}")))?;
    file.sync_all()
        .await
        .map_err(|error| ModelDownloadError::Io(format!("sync temporary file: {error}")))?;
    drop(file);

    if downloaded_bytes != manifest.expected_bytes {
        return Err(ModelDownloadError::Integrity(format!(
            "expected {} bytes, received {downloaded_bytes}",
            manifest.expected_bytes
        )));
    }
    let actual_sha256 = format!("{:x}", hasher.finalize());
    if actual_sha256 != manifest.sha256 {
        return Err(ModelDownloadError::Integrity(format!(
            "expected SHA-256 {}, received {actual_sha256}",
            manifest.sha256
        )));
    }
    Ok(())
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, destination: *const u16, flags: u32) -> i32;
    }

    let source_wide: Vec<u16> = source
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(test)]
#[path = "whisper_model_download_tests.rs"]
mod tests;
