use super::*;
use crate::scheduler::{CancellationToken, TaskState};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("rain-ytdlp-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Default)]
struct RecordingReporter {
    percentages: Mutex<Vec<u32>>,
}

impl DownloadProgressReporter for RecordingReporter {
    fn report(&self, percent: u32) -> Result<(), String> {
        self.percentages.lock().unwrap().push(percent);
        Ok(())
    }
}

struct SignallingReporter {
    progressed: Arc<tokio::sync::Semaphore>,
}

impl DownloadProgressReporter for SignallingReporter {
    fn report(&self, _percent: u32) -> Result<(), String> {
        self.progressed.add_permits(1);
        Ok(())
    }
}

#[cfg(windows)]
fn powershell_fixture(root: &Path, body: &str) -> (PathBuf, Vec<OsString>) {
    let script = root.join("fake-ytdlp.ps1");
    std::fs::write(&script, body).unwrap();
    (
        PathBuf::from("powershell.exe"),
        vec![
            OsString::from("-NoProfile"),
            OsString::from("-ExecutionPolicy"),
            OsString::from("Bypass"),
            OsString::from("-File"),
            script.into_os_string(),
        ],
    )
}

#[cfg(windows)]
#[tokio::test]
async fn metadata_probe_is_cancellable_and_parses_only_a_successful_process() {
    let directory = TestDir::new();
    let (program, prefix_args) = powershell_fixture(
        &directory.0,
        r#"
Write-Output '{"title":"Signals Lesson","duration":120,"thumbnail":"https://img.example.test/lesson.jpg"}'
"#,
    );
    let info = probe_with_program(
        &program,
        &prefix_args,
        "https://videos.example.test/watch/lesson-1",
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(info.title, "Signals Lesson");
    assert_eq!(info.duration, 120.0);

    let (program, prefix_args) = powershell_fixture(
        &directory.0,
        r#"
Start-Sleep -Seconds 30
"#,
    );
    let cancellation = CancellationToken::new();
    let task_cancellation = cancellation.clone();
    let task = tokio::spawn(async move {
        probe_with_program(
            &program,
            &prefix_args,
            "https://videos.example.test/watch/lesson-1",
            &task_cancellation,
        )
        .await
    });
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    cancellation.cancel();
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), task)
        .await
        .expect("cancellation must wake the metadata process")
        .unwrap();
    assert!(matches!(result, Err(YtdlpError::Cancelled)));
}

#[cfg(windows)]
#[tokio::test]
async fn controlled_import_seam_finishes_the_scheduler_and_returns_only_committed_media() {
    let directory = TestDir::new();
    let (program, prefix_args) = powershell_fixture(
        &directory.0,
        r#"
if ($args -contains '--dump-single-json') {
  Write-Output '{"title":"Signals Lesson","duration":120,"thumbnail":""}'
  exit 0
}
$outputIndex = [Array]::IndexOf($args, '-o')
$outputPath = $args[$outputIndex + 1].Replace('%(ext)s', 'mp4')
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
[IO.File]::WriteAllText($outputPath, 'video-bytes')
Write-Output 'RAIN_PROGRESS:100.0%'
"#,
    );
    let scheduler = ImportScheduler::new();

    let result = import_online_video_with_programs(
        &scheduler,
        &directory.0.join("downloads"),
        "video-1",
        "https://videos.example.test/watch/lesson-1",
        &program,
        &prefix_args,
        &program,
        &prefix_args,
        &RecordingReporter::default(),
    )
    .await
    .unwrap();

    assert_eq!(result.title, "Signals Lesson");
    assert_eq!(
        PathBuf::from(&result.file_path),
        directory
            .0
            .join("downloads")
            .join("video-1")
            .join("video.mp4")
    );
    assert_eq!(scheduler.get_state().await, TaskState::Completed);
    assert_eq!(
        std::fs::read_to_string(result.file_path).unwrap(),
        "video-bytes"
    );
}

#[cfg(windows)]
#[tokio::test]
async fn download_reports_progress_and_commits_one_final_media_file() {
    let directory = TestDir::new();
    let (program, prefix_args) = powershell_fixture(
        &directory.0,
        r#"
$outputIndex = [Array]::IndexOf($args, '-o')
$outputPath = $args[$outputIndex + 1].Replace('%(ext)s', 'mp4')
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
[IO.File]::WriteAllText($outputPath, 'video-bytes')
Write-Output 'RAIN_PROGRESS:37.0%'
Write-Output 'RAIN_PROGRESS:100.0%'
"#,
    );
    let reporter = RecordingReporter::default();

    let path = download_with_program(
        &program,
        &prefix_args,
        &directory.0.join("downloads"),
        "video-1",
        "https://videos.example.test/watch/lesson-1",
        &CancellationToken::new(),
        &reporter,
    )
    .await
    .unwrap();

    assert_eq!(path, directory.0.join("downloads/video-1/video.mp4"));
    assert_eq!(std::fs::read_to_string(path).unwrap(), "video-bytes");
    assert_eq!(*reporter.percentages.lock().unwrap(), vec![37, 100]);
    assert_eq!(
        std::fs::read_dir(directory.0.join("downloads"))
            .unwrap()
            .count(),
        1
    );
}

#[cfg(windows)]
#[tokio::test]
async fn successful_process_with_only_a_partial_file_is_rejected_and_cleaned() {
    let directory = TestDir::new();
    let (program, prefix_args) = powershell_fixture(
        &directory.0,
        r#"
$outputIndex = [Array]::IndexOf($args, '-o')
$outputPath = $args[$outputIndex + 1].Replace('%(ext)s', 'mp4.part')
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
[IO.File]::WriteAllText($outputPath, 'partial-video-bytes')
"#,
    );

    let result = download_with_program(
        &program,
        &prefix_args,
        &directory.0.join("downloads"),
        "video-1",
        "https://videos.example.test/watch/lesson-1",
        &CancellationToken::new(),
        &RecordingReporter::default(),
    )
    .await;

    assert!(matches!(result, Err(YtdlpError::DownloadFailed(_))));
    assert_eq!(
        std::fs::read_dir(directory.0.join("downloads"))
            .unwrap()
            .count(),
        0
    );
}

#[cfg(windows)]
#[tokio::test]
async fn cancellation_terminates_a_running_process_and_cleans_its_partial_output() {
    let directory = TestDir::new();
    let (program, prefix_args) = powershell_fixture(
        &directory.0,
        r#"
$outputIndex = [Array]::IndexOf($args, '-o')
$outputPath = $args[$outputIndex + 1].Replace('%(ext)s', 'mp4.part')
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
[IO.File]::WriteAllText($outputPath, 'partial-video-bytes')
[Console]::Out.WriteLine('RAIN_PROGRESS:10.0%')
[Console]::Out.Flush()
Start-Sleep -Seconds 30
"#,
    );
    let output_root = directory.0.join("downloads");
    let cancellation = CancellationToken::new();
    let task_cancellation = cancellation.clone();
    let progressed = Arc::new(tokio::sync::Semaphore::new(0));
    let reporter = SignallingReporter {
        progressed: Arc::clone(&progressed),
    };
    let task = tokio::spawn(async move {
        download_with_program(
            &program,
            &prefix_args,
            &output_root,
            "video-1",
            "https://videos.example.test/watch/lesson-1",
            &task_cancellation,
            &reporter,
        )
        .await
    });

    tokio::time::timeout(std::time::Duration::from_secs(5), progressed.acquire())
        .await
        .expect("fixture must report progress")
        .unwrap()
        .forget();
    cancellation.cancel();

    let result = tokio::time::timeout(std::time::Duration::from_secs(5), task)
        .await
        .expect("cancellation must wake the running process")
        .unwrap();
    assert!(matches!(result, Err(YtdlpError::Cancelled)));
    assert_eq!(
        std::fs::read_dir(directory.0.join("downloads"))
            .unwrap()
            .count(),
        0
    );
}

#[cfg(windows)]
fn windows_process_exists(process_id: u32) -> bool {
    let output = std::process::Command::new("tasklist.exe")
        .args(["/FI", &format!("PID eq {process_id}"), "/NH"])
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout).contains(&process_id.to_string())
}

#[cfg(windows)]
#[tokio::test]
async fn cleanup_failure_is_reported_instead_of_silently_leaving_partial_output() {
    use std::os::windows::fs::OpenOptionsExt;

    let directory = TestDir::new();
    let partial_directory = directory.0.join("locked.partial");
    std::fs::create_dir(&partial_directory).unwrap();
    let partial_file = partial_directory.join("video.mp4.part");
    std::fs::write(&partial_file, b"partial").unwrap();
    let locked_file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0)
        .open(&partial_file)
        .unwrap();

    let result = cleanup_directory(&partial_directory).await;
    assert!(matches!(result, Err(YtdlpError::Cleanup(_))));
    assert!(partial_directory.exists());

    drop(locked_file);
    std::fs::remove_dir_all(partial_directory).unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn process_tree_termination_does_not_leave_a_ffmpeg_like_descendant() {
    let directory = TestDir::new();
    let (program, prefix_args) = powershell_fixture(
        &directory.0,
        r#"
$child = Start-Process ping.exe -ArgumentList @('-t', '127.0.0.1') -PassThru -WindowStyle Hidden
[Console]::Out.WriteLine("CHILD_PID:$($child.Id)")
[Console]::Out.Flush()
Start-Sleep -Seconds 30
"#,
    );
    let mut command = tokio::process::Command::new(program);
    command
        .args(prefix_args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut parent = command.spawn().unwrap();
    let stdout = parent.stdout.take().unwrap();
    let mut lines = tokio::io::BufReader::new(stdout).lines();
    let line = tokio::time::timeout(std::time::Duration::from_secs(5), lines.next_line())
        .await
        .expect("fixture must report its descendant")
        .unwrap()
        .unwrap();
    let child_id = line
        .strip_prefix("CHILD_PID:")
        .unwrap()
        .parse::<u32>()
        .unwrap();

    terminate_process_tree(&mut parent).await;
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    let survived = windows_process_exists(child_id);
    if survived {
        let _ = std::process::Command::new("taskkill.exe")
            .args(["/PID", &child_id.to_string(), "/F"])
            .output();
    }
    assert!(
        !survived,
        "yt-dlp descendants must be terminated with their parent"
    );
}

#[cfg(windows)]
#[tokio::test]
async fn completed_media_is_reused_when_database_attachment_retries() {
    let directory = TestDir::new();
    let (program, prefix_args) = powershell_fixture(
        &directory.0,
        r#"
$outputIndex = [Array]::IndexOf($args, '-o')
$outputPath = $args[$outputIndex + 1].Replace('%(ext)s', 'mp4')
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
[IO.File]::WriteAllText($outputPath, 'video-bytes')
"#,
    );
    let output_root = directory.0.join("downloads");
    let first = download_with_program(
        &program,
        &prefix_args,
        &output_root,
        "video-1",
        "https://videos.example.test/watch/lesson-1",
        &CancellationToken::new(),
        &RecordingReporter::default(),
    )
    .await
    .unwrap();

    let second = download_with_program(
        &program,
        &prefix_args,
        &output_root,
        "video-1",
        "https://videos.example.test/watch/lesson-1",
        &CancellationToken::new(),
        &RecordingReporter::default(),
    )
    .await
    .unwrap();

    assert_eq!(second, first);
    assert_eq!(std::fs::read_to_string(second).unwrap(), "video-bytes");
}
