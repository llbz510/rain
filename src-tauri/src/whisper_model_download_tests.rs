use super::*;
use std::sync::Mutex as StdMutex;

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("rain-model-download-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct NoopReporter;

impl ProgressReporter for NoopReporter {
    fn report(&self, _progress: &ModelDownloadProgress) -> Result<(), String> {
        Ok(())
    }
}

#[derive(Default)]
struct RecordingReporter {
    progress: StdMutex<Vec<ModelDownloadProgress>>,
}

impl ProgressReporter for RecordingReporter {
    fn report(&self, progress: &ModelDownloadProgress) -> Result<(), String> {
        self.progress.lock().unwrap().push(progress.clone());
        Ok(())
    }
}

struct SignallingReporter {
    progressed: Arc<tokio::sync::Semaphore>,
}

impl ProgressReporter for SignallingReporter {
    fn report(&self, progress: &ModelDownloadProgress) -> Result<(), String> {
        if progress.downloaded_bytes > 0 {
            self.progressed.add_permits(1);
        }
        Ok(())
    }
}

async fn serve_once(body: &'static [u8]) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0_u8; 1024];
        let _ = socket.read(&mut request).await;
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        socket.write_all(header.as_bytes()).await.unwrap();
        socket.write_all(body).await.unwrap();
    });
    format!("http://{address}/model.bin")
}

async fn serve_truncated(body: &'static [u8], declared_length: usize) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0_u8; 1024];
        let _ = socket.read(&mut request).await;
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {declared_length}\r\nConnection: close\r\n\r\n"
        );
        socket.write_all(header.as_bytes()).await.unwrap();
        socket.write_all(body).await.unwrap();
    });
    format!("http://{address}/model.bin")
}

async fn serve_two_chunks(
    first: &'static [u8],
    second: &'static [u8],
) -> (String, tokio::sync::oneshot::Receiver<()>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (first_sent, first_received) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0_u8; 1024];
        let _ = socket.read(&mut request).await;
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            first.len() + second.len()
        );
        socket.write_all(header.as_bytes()).await.unwrap();
        socket.write_all(first).await.unwrap();
        socket.flush().await.unwrap();
        let _ = first_sent.send(());
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        socket.write_all(second).await.unwrap();
    });
    (format!("http://{address}/model.bin"), first_received)
}

async fn serve_then_stall(
    first: &'static [u8],
    total_bytes: usize,
) -> (String, tokio::sync::oneshot::Receiver<()>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (first_sent, first_received) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0_u8; 1024];
        let _ = socket.read(&mut request).await;
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {total_bytes}\r\nConnection: close\r\n\r\n"
        );
        socket.write_all(header.as_bytes()).await.unwrap();
        socket.write_all(first).await.unwrap();
        socket.flush().await.unwrap();
        let _ = first_sent.send(());
        std::future::pending::<()>().await;
    });
    (format!("http://{address}/model.bin"), first_received)
}

fn hello_manifest(url: String, sha256: &'static str) -> ModelManifest {
    ModelManifest {
        filename: "model.bin",
        url,
        expected_bytes: 5,
        sha256,
    }
}

fn part_files(directory: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(directory)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("part"))
        .collect()
}

#[test]
fn production_manifest_is_pinned_and_complete() {
    let cases = [
        (
            WhisperModelSize::Tiny,
            "ggml-tiny.bin",
            77_691_713,
            "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
        ),
        (
            WhisperModelSize::Base,
            "ggml-base.bin",
            147_951_465,
            "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        ),
        (
            WhisperModelSize::Small,
            "ggml-small.bin",
            487_601_967,
            "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        ),
        (
            WhisperModelSize::Medium,
            "ggml-medium.bin",
            1_533_763_059,
            "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
        ),
        (
            WhisperModelSize::LargeV3,
            "ggml-large-v3.bin",
            3_095_033_483,
            "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
        ),
    ];

    for (size, filename, expected_bytes, sha256) in cases {
        let manifest = manifest_for(size);
        assert_eq!(manifest.filename, filename);
        assert_eq!(manifest.expected_bytes, expected_bytes);
        assert_eq!(manifest.sha256, sha256);
        assert!(manifest
            .url
            .contains("/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/"));
        assert!(!manifest.url.contains("/main/"));
    }
}

#[test]
fn progress_payload_serializes_for_the_frontend_contract() {
    let value = serde_json::to_value(ModelDownloadProgress {
        model_size: "medium".to_string(),
        downloaded_bytes: 5,
        total_bytes: Some(10),
        percent: Some(50),
    })
    .unwrap();

    assert_eq!(value["modelSize"], "medium");
    assert_eq!(value["downloadedBytes"], 5);
    assert_eq!(value["totalBytes"], 10);
    assert_eq!(value["percent"], 50);
    assert!(value.get("model_size").is_none());
}

#[tokio::test]
async fn verified_download_commits_only_the_final_file() {
    let directory = TestDir::new();
    let manifest = hello_manifest(
        serve_once(b"hello").await,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    let manager = ModelDownloadManager::new();

    let path = download_from_manifest(&manager, &directory.0, "tiny", &manifest, &NoopReporter)
        .await
        .unwrap();

    assert_eq!(std::fs::read(path).unwrap(), b"hello");
    assert!(part_files(&directory.0).is_empty());
}

#[tokio::test]
async fn hash_failure_preserves_old_file_and_cleans_partial_file() {
    let directory = TestDir::new();
    let destination = directory.0.join("model.bin");
    std::fs::write(&destination, b"old-valid-model").unwrap();
    let bad_hash: &'static str = Box::leak("0".repeat(64).into_boxed_str());
    let manifest = hello_manifest(serve_once(b"hello").await, bad_hash);
    let manager = ModelDownloadManager::new();

    let error = download_from_manifest(&manager, &directory.0, "tiny", &manifest, &NoopReporter)
        .await
        .unwrap_err();

    assert!(matches!(error, ModelDownloadError::Integrity(_)));
    assert_eq!(std::fs::read(destination).unwrap(), b"old-valid-model");
    assert!(part_files(&directory.0).is_empty());
}

#[tokio::test]
async fn truncated_response_preserves_old_file_and_cleans_partial_file() {
    let directory = TestDir::new();
    let destination = directory.0.join("model.bin");
    std::fs::write(&destination, b"old-valid-model").unwrap();
    let manifest = hello_manifest(
        serve_truncated(b"hi", 5).await,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    let manager = ModelDownloadManager::new();

    let error = download_from_manifest(&manager, &directory.0, "tiny", &manifest, &NoopReporter)
        .await
        .unwrap_err();

    assert!(matches!(error, ModelDownloadError::Network(_)));
    assert_eq!(std::fs::read(destination).unwrap(), b"old-valid-model");
    assert!(part_files(&directory.0).is_empty());
}

#[tokio::test]
async fn matching_existing_file_is_reused_without_network() {
    let directory = TestDir::new();
    let destination = directory.0.join("model.bin");
    std::fs::write(&destination, b"hello").unwrap();
    let manifest = hello_manifest(
        "http://127.0.0.1:1/unreachable".to_string(),
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    let manager = ModelDownloadManager::new();

    let path = download_from_manifest(&manager, &directory.0, "tiny", &manifest, &NoopReporter)
        .await
        .unwrap();

    assert_eq!(path, destination);
    assert!(part_files(&directory.0).is_empty());
}

#[test]
fn failed_atomic_replace_preserves_existing_destination() {
    let directory = TestDir::new();
    let destination = directory.0.join("model.bin");
    std::fs::write(&destination, b"old-valid-model").unwrap();

    assert!(atomic_replace(&directory.0.join("missing.part"), &destination).is_err());
    assert_eq!(std::fs::read(destination).unwrap(), b"old-valid-model");
}

#[test]
fn failed_commit_cleans_the_verified_partial_file() {
    let directory = TestDir::new();
    let partial = directory.0.join("model.verified.part");
    let destination = directory.0.join("model.bin");
    std::fs::write(&partial, b"verified-model").unwrap();
    std::fs::create_dir(&destination).unwrap();

    assert!(commit_verified_file(&partial, &destination).is_err());
    assert!(!partial.exists());
    assert!(destination.is_dir());
}

#[tokio::test]
async fn progress_is_monotonic_and_ends_at_verified_size() {
    let directory = TestDir::new();
    let manifest = hello_manifest(
        serve_once(b"hello").await,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    let manager = ModelDownloadManager::new();
    let reporter = RecordingReporter::default();

    download_from_manifest(&manager, &directory.0, "tiny", &manifest, &reporter)
        .await
        .unwrap();

    let progress = reporter.progress.lock().unwrap();
    assert!(progress.windows(2).all(|pair| {
        pair[0].downloaded_bytes <= pair[1].downloaded_bytes && pair[0].percent <= pair[1].percent
    }));
    assert_eq!(progress.first().unwrap().downloaded_bytes, 0);
    assert_eq!(progress.last().unwrap().downloaded_bytes, 5);
    assert_eq!(progress.last().unwrap().percent, Some(100));
}

#[tokio::test]
async fn one_writer_is_enforced_and_cancelled_download_can_retry_cleanly() {
    let directory = TestDir::new();
    let manager = Arc::new(ModelDownloadManager::new());
    let (url, first_chunk_sent) = serve_two_chunks(b"hello", b"world").await;
    let first_manifest = ModelManifest {
        filename: "model.bin",
        url,
        expected_bytes: 10,
        sha256: "936a185caaa266bb9cbe981e9e05cb78a0f3f8f8f1f0b2f8b5d8a8b1d3e6a4f7",
    };
    let first_manager = Arc::clone(&manager);
    let first_directory = directory.0.clone();
    let first = tokio::spawn(async move {
        download_from_manifest(
            first_manager.as_ref(),
            &first_directory,
            "tiny",
            &first_manifest,
            &NoopReporter,
        )
        .await
    });
    first_chunk_sent.await.unwrap();

    let duplicate_manifest = hello_manifest(
        "http://127.0.0.1:1/unused".to_string(),
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    let duplicate = download_from_manifest(
        manager.as_ref(),
        &directory.0,
        "tiny",
        &duplicate_manifest,
        &NoopReporter,
    )
    .await;
    assert_eq!(duplicate.unwrap_err(), ModelDownloadError::AlreadyRunning);

    assert!(manager.cancel("tiny").await);
    assert_eq!(
        first.await.unwrap().unwrap_err(),
        ModelDownloadError::Cancelled
    );
    assert!(part_files(&directory.0).is_empty());

    let retry_manifest = hello_manifest(
        serve_once(b"hello").await,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    let path = download_from_manifest(
        manager.as_ref(),
        &directory.0,
        "tiny",
        &retry_manifest,
        &NoopReporter,
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(path).unwrap(), b"hello");
}

#[tokio::test]
async fn cancellation_interrupts_a_stalled_network_read() {
    let directory = TestDir::new();
    let manager = Arc::new(ModelDownloadManager::new());
    let (url, first_chunk_sent) = serve_then_stall(b"hello", 10).await;
    let manifest = ModelManifest {
        filename: "model.bin",
        url,
        expected_bytes: 10,
        sha256: "unused-because-cancelled",
    };
    let task_manager = Arc::clone(&manager);
    let task_directory = directory.0.clone();
    let progressed = Arc::new(tokio::sync::Semaphore::new(0));
    let task_progressed = Arc::clone(&progressed);
    let task = tokio::spawn(async move {
        download_from_manifest(
            task_manager.as_ref(),
            &task_directory,
            "tiny",
            &manifest,
            &SignallingReporter {
                progressed: task_progressed,
            },
        )
        .await
    });
    first_chunk_sent.await.unwrap();
    progressed.acquire().await.unwrap().forget();

    assert!(manager.cancel("tiny").await);
    // The server never sends the remaining bytes, so successful completion can
    // only come from cancellation. Keep a generous timeout as a deadlock guard;
    // cancellation latency is not an AC-MM-02 performance contract.
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), task)
        .await
        .expect("cancel must wake a stalled response read")
        .unwrap();

    assert_eq!(result.unwrap_err(), ModelDownloadError::Cancelled);
    assert!(part_files(&directory.0).is_empty());
}
