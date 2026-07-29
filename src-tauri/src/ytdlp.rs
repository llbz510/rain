// src-tauri/src/ytdlp.rs
// ========================================
// yt-dlp 子进程封装（决策95）
// ========================================

use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader};

use crate::events::{self, ProgressPayload};
use crate::scheduler::{CancellationToken, ImportScheduler, TaskFinish};

const DOWNLOAD_PROGRESS_PREFIX: &str = "RAIN_PROGRESS:";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YtdlpResult {
    pub available: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
pub enum YtdlpError {
    InvalidUrl,
    InvalidVideoId,
    NotInstalled,
    Cancelled,
    Io(String),
    Cleanup(String),
    Progress(String),
    DownloadFailed(String),
    ParseFailed(String),
}

impl std::fmt::Display for YtdlpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            YtdlpError::InvalidUrl => write!(f, "Invalid URL"),
            YtdlpError::InvalidVideoId => write!(f, "Invalid video ID"),
            YtdlpError::NotInstalled => write!(f, "yt-dlp not installed"),
            YtdlpError::Cancelled => write!(f, "Online video download cancelled"),
            YtdlpError::Io(msg) => write!(f, "Download file error: {}", msg),
            YtdlpError::Cleanup(msg) => write!(f, "Download cleanup error: {}", msg),
            YtdlpError::Progress(msg) => write!(f, "Download progress error: {}", msg),
            YtdlpError::DownloadFailed(msg) => write!(f, "Download failed: {}", msg),
            YtdlpError::ParseFailed(msg) => write!(f, "Parse failed: {}", msg),
        }
    }
}

impl std::error::Error for YtdlpError {}

pub fn check_ytdlp() -> YtdlpResult {
    let result = Command::new("yt-dlp").arg("--version").output();

    match result {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout);
            YtdlpResult {
                available: true,
                message: Some(format!("yt-dlp 可用: {}", version.trim())),
            }
        }
        _ => YtdlpResult {
            available: false,
            message: Some(
                "yt-dlp 未安装。请访问 https://github.com/yt-dlp/yt-dlp 下载安装并添加到 PATH。"
                    .to_string(),
            ),
        },
    }
}

fn is_valid_url(url: &str) -> bool {
    reqwest::Url::parse(url)
        .map(|parsed| matches!(parsed.scheme(), "http" | "https") && parsed.host_str().is_some())
        .unwrap_or(false)
}

trait DownloadProgressReporter: Send + Sync {
    fn report(&self, percent: u32) -> Result<(), String>;
}

struct TauriDownloadProgressReporter {
    app: tauri::AppHandle,
    video_id: String,
}

impl DownloadProgressReporter for TauriDownloadProgressReporter {
    fn report(&self, percent: u32) -> Result<(), String> {
        events::emit_progress(
            &self.app,
            ProgressPayload::new(&self.video_id, "download", percent),
        )
    }
}

fn is_valid_video_id(video_id: &str) -> bool {
    !video_id.is_empty()
        && video_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

fn parse_download_percent(line: &str) -> Option<u32> {
    let value = line
        .trim()
        .strip_prefix(DOWNLOAD_PROGRESS_PREFIX)?
        .trim()
        .trim_end_matches('%')
        .trim()
        .parse::<f64>()
        .ok()?;
    Some(value.round().clamp(0.0, 100.0) as u32)
}

fn report_progress_line(
    reporter: &dyn DownloadProgressReporter,
    last_percent: &mut Option<u32>,
    line: &str,
) -> Result<(), YtdlpError> {
    let Some(percent) = parse_download_percent(line) else {
        return Ok(());
    };
    if last_percent.map(|last| percent <= last).unwrap_or(false) {
        return Ok(());
    }
    reporter.report(percent).map_err(YtdlpError::Progress)?;
    *last_percent = Some(percent);
    Ok(())
}

fn video_info_from_json(json: &serde_json::Value) -> VideoInfo {
    VideoInfo {
        title: json
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown")
            .to_string(),
        duration: json
            .get("duration")
            .and_then(|value| value.as_f64())
            .unwrap_or(0.0),
        thumbnail: json
            .get("thumbnail")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
    }
}

async fn read_bounded<R: AsyncRead + Unpin>(
    mut reader: R,
    limit: usize,
) -> std::io::Result<Vec<u8>> {
    let mut captured = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            return Ok(captured);
        }
        let remaining = limit.saturating_sub(captured.len());
        captured.extend_from_slice(&buffer[..count.min(remaining)]);
    }
}

async fn probe_with_program(
    program: &Path,
    prefix_args: &[OsString],
    url: &str,
    cancellation: &CancellationToken,
) -> Result<VideoInfo, YtdlpError> {
    if !is_valid_url(url) {
        return Err(YtdlpError::InvalidUrl);
    }
    if cancellation.is_cancelled() {
        return Err(YtdlpError::Cancelled);
    }

    let mut command = tokio::process::Command::new(program);
    command
        .args(prefix_args)
        .arg("--dump-single-json")
        .arg("--no-playlist")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            YtdlpError::NotInstalled
        } else {
            YtdlpError::ParseFailed(format!("start yt-dlp process: {error}"))
        }
    })?;
    let stdout = child.stdout.take().expect("piped stdout must be available");
    let stderr = child.stderr.take().expect("piped stderr must be available");
    let stdout_task = tokio::spawn(read_bounded(stdout, 1_048_576));
    let stderr_task = tokio::spawn(read_bounded(stderr, 65_536));

    let status = tokio::select! {
        _ = cancellation.cancelled() => {
            terminate_process_tree(&mut child).await;
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            return Err(YtdlpError::Cancelled);
        }
        result = child.wait() => result
            .map_err(|error| YtdlpError::ParseFailed(format!("wait for yt-dlp: {error}")))?,
    };
    let stdout = stdout_task
        .await
        .map_err(|error| YtdlpError::ParseFailed(format!("join stdout reader: {error}")))?
        .map_err(|error| YtdlpError::ParseFailed(format!("read stdout: {error}")))?;
    let stderr = stderr_task
        .await
        .map_err(|error| YtdlpError::ParseFailed(format!("join stderr reader: {error}")))?
        .map_err(|error| YtdlpError::ParseFailed(format!("read stderr: {error}")))?;
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr).replace(url, "[redacted-url]");
        return Err(YtdlpError::ParseFailed(if detail.trim().is_empty() {
            format!("yt-dlp exited with status {status}")
        } else {
            detail.trim().to_string()
        }));
    }
    let json: serde_json::Value = serde_json::from_slice(&stdout)
        .map_err(|error| YtdlpError::ParseFailed(format!("invalid metadata JSON: {error}")))?;
    Ok(video_info_from_json(&json))
}

async fn cleanup_directory(path: &Path) -> Result<(), YtdlpError> {
    let mut last_error = None;
    for attempt in 0..5_u64 {
        match tokio::fs::remove_dir_all(path).await {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        tokio::time::sleep(std::time::Duration::from_millis(25 * (attempt + 1))).await;
    }
    Err(YtdlpError::Cleanup(format!(
        "partial directory {} could not be removed: {}",
        path.display(),
        last_error.expect("cleanup retry must retain its last error")
    )))
}

async fn cleanup_before_return(path: &Path, original: YtdlpError) -> YtdlpError {
    match cleanup_directory(path).await {
        Ok(()) => original,
        Err(cleanup_error) => cleanup_error,
    }
}

async fn terminate_process_tree(child: &mut tokio::process::Child) {
    #[cfg(windows)]
    if let Some(process_id) = child.id() {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut taskkill = tokio::process::Command::new("taskkill.exe");
        taskkill
            .args(["/PID", &process_id.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = taskkill.status().await;
    }

    let _ = child.kill().await;
    let _ = child.wait().await;
}

async fn find_downloaded_file(directory: &Path) -> Result<PathBuf, YtdlpError> {
    let mut entries = tokio::fs::read_dir(directory)
        .await
        .map_err(|error| YtdlpError::Io(format!("read temporary directory: {error}")))?;
    let mut files = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| YtdlpError::Io(format!("read temporary entry: {error}")))?
    {
        let file_type = entry
            .file_type()
            .await
            .map_err(|error| YtdlpError::Io(format!("inspect temporary entry: {error}")))?;
        let file_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        let is_temporary = file_name.ends_with(".part")
            || file_name.ends_with(".ytdl")
            || file_name.ends_with(".temp");
        if file_type.is_file() && !is_temporary {
            files.push(entry.path());
        }
    }
    if files.len() != 1 {
        return Err(YtdlpError::DownloadFailed(format!(
            "expected one downloaded media file, found {}",
            files.len()
        )));
    }
    Ok(files.remove(0))
}

async fn download_with_program(
    program: &Path,
    prefix_args: &[OsString],
    output_root: &Path,
    video_id: &str,
    url: &str,
    cancellation: &CancellationToken,
    reporter: &dyn DownloadProgressReporter,
) -> Result<PathBuf, YtdlpError> {
    if !is_valid_url(url) {
        return Err(YtdlpError::InvalidUrl);
    }
    if !is_valid_video_id(video_id) {
        return Err(YtdlpError::InvalidVideoId);
    }
    if cancellation.is_cancelled() {
        return Err(YtdlpError::Cancelled);
    }

    tokio::fs::create_dir_all(output_root)
        .await
        .map_err(|error| YtdlpError::Io(format!("create output directory: {error}")))?;
    let final_directory = output_root.join(video_id);
    if final_directory.exists() {
        return find_downloaded_file(&final_directory).await;
    }
    let temporary_directory =
        output_root.join(format!(".{video_id}.{}.partial", uuid::Uuid::new_v4()));
    tokio::fs::create_dir(&temporary_directory)
        .await
        .map_err(|error| YtdlpError::Io(format!("create temporary directory: {error}")))?;
    let output_template = temporary_directory.join("video.%(ext)s");

    let mut command = tokio::process::Command::new(program);
    command
        .args(prefix_args)
        .arg("--no-playlist")
        .arg("--newline")
        .arg("--progress-template")
        .arg(format!(
            "download:{DOWNLOAD_PROGRESS_PREFIX}%(progress._percent_str)s"
        ))
        .arg("-o")
        .arg(&output_template)
        .arg("-f")
        .arg("bestvideo+bestaudio/best")
        .arg("--merge-output-format")
        .arg("mp4")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let original = if error.kind() == std::io::ErrorKind::NotFound {
                YtdlpError::NotInstalled
            } else {
                YtdlpError::DownloadFailed(format!("start yt-dlp process: {error}"))
            };
            return Err(cleanup_before_return(&temporary_directory, original).await);
        }
    };
    let stdout = child
        .stdout
        .take()
        .expect("piped yt-dlp stdout must be available");
    let stderr = child
        .stderr
        .take()
        .expect("piped yt-dlp stderr must be available");
    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut stderr_lines = BufReader::new(stderr).lines();
    let mut stdout_done = false;
    let mut stderr_done = false;
    let mut stderr_tail = Vec::new();
    let mut last_percent = None;

    let status = loop {
        tokio::select! {
            _ = cancellation.cancelled() => {
                terminate_process_tree(&mut child).await;
                return Err(cleanup_before_return(&temporary_directory, YtdlpError::Cancelled).await);
            }
            line = stdout_lines.next_line(), if !stdout_done => {
                match line {
                    Ok(Some(line)) => {
                        if let Err(error) = report_progress_line(reporter, &mut last_percent, &line) {
                            terminate_process_tree(&mut child).await;
                            return Err(cleanup_before_return(&temporary_directory, error).await);
                        }
                    }
                    Ok(None) => stdout_done = true,
                    Err(error) => {
                        terminate_process_tree(&mut child).await;
                        return Err(cleanup_before_return(
                            &temporary_directory,
                            YtdlpError::DownloadFailed(format!("read yt-dlp stdout: {error}")),
                        ).await);
                    }
                }
            }
            line = stderr_lines.next_line(), if !stderr_done => {
                match line {
                    Ok(Some(line)) => {
                        if stderr_tail.len() == 20 { stderr_tail.remove(0); }
                        stderr_tail.push(line.replace(url, "[redacted-url]"));
                    }
                    Ok(None) => stderr_done = true,
                    Err(error) => {
                        terminate_process_tree(&mut child).await;
                        return Err(cleanup_before_return(
                            &temporary_directory,
                            YtdlpError::DownloadFailed(format!("read yt-dlp stderr: {error}")),
                        ).await);
                    }
                }
            }
            result = child.wait() => {
                match result {
                    Ok(status) => break status,
                    Err(error) => {
                        return Err(cleanup_before_return(
                            &temporary_directory,
                            YtdlpError::DownloadFailed(format!("wait for yt-dlp: {error}")),
                        ).await);
                    }
                }
            }
        }
    };

    loop {
        match stdout_lines.next_line().await {
            Ok(Some(line)) => {
                if let Err(error) = report_progress_line(reporter, &mut last_percent, &line) {
                    return Err(cleanup_before_return(&temporary_directory, error).await);
                }
            }
            Ok(None) => break,
            Err(error) => {
                return Err(cleanup_before_return(
                    &temporary_directory,
                    YtdlpError::DownloadFailed(format!("drain yt-dlp stdout: {error}")),
                )
                .await);
            }
        }
    }
    loop {
        match stderr_lines.next_line().await {
            Ok(Some(line)) => {
                if stderr_tail.len() == 20 {
                    stderr_tail.remove(0);
                }
                stderr_tail.push(line.replace(url, "[redacted-url]"));
            }
            Ok(None) => break,
            Err(error) => {
                return Err(cleanup_before_return(
                    &temporary_directory,
                    YtdlpError::DownloadFailed(format!("drain yt-dlp stderr: {error}")),
                )
                .await);
            }
        }
    }

    if !status.success() {
        let detail = if stderr_tail.is_empty() {
            format!("yt-dlp exited with status {status}")
        } else {
            stderr_tail.join("\n")
        };
        return Err(cleanup_before_return(
            &temporary_directory,
            YtdlpError::DownloadFailed(detail),
        )
        .await);
    }

    let temporary_file = match find_downloaded_file(&temporary_directory).await {
        Ok(path) => path,
        Err(error) => {
            return Err(cleanup_before_return(&temporary_directory, error).await);
        }
    };
    let file_name = match temporary_file.file_name() {
        Some(file_name) => file_name.to_owned(),
        None => {
            return Err(cleanup_before_return(
                &temporary_directory,
                YtdlpError::Io("downloaded file has no name".to_string()),
            )
            .await);
        }
    };
    if let Err(error) = tokio::fs::rename(&temporary_directory, &final_directory).await {
        return Err(cleanup_before_return(
            &temporary_directory,
            YtdlpError::Io(format!("commit downloaded directory: {error}")),
        )
        .await);
    }
    Ok(final_directory.join(file_name))
}

async fn import_online_video_with_programs(
    scheduler: &ImportScheduler,
    output_root: &Path,
    video_id: &str,
    url: &str,
    probe_program: &Path,
    probe_prefix_args: &[OsString],
    download_program: &Path,
    download_prefix_args: &[OsString],
    reporter: &dyn DownloadProgressReporter,
) -> Result<OnlineVideoImportResult, YtdlpError> {
    if !is_valid_video_id(video_id) {
        return Err(YtdlpError::InvalidVideoId);
    }
    let lease = scheduler.start_video_task(video_id.to_string()).await;
    let cancellation = lease.token();
    let result = async {
        let info = probe_with_program(probe_program, probe_prefix_args, url, &cancellation).await?;
        let file_path = download_with_program(
            download_program,
            download_prefix_args,
            output_root,
            video_id,
            url,
            &cancellation,
            reporter,
        )
        .await?;
        Ok::<_, YtdlpError>((info, file_path))
    }
    .await;

    match result {
        Ok((info, file_path)) => match scheduler.finish_success(&cancellation).await {
            TaskFinish::Completed => Ok(OnlineVideoImportResult {
                title: info.title,
                duration: info.duration,
                thumbnail: info.thumbnail,
                file_path: file_path.to_string_lossy().to_string(),
            }),
            TaskFinish::Cancelled | TaskFinish::Stale => {
                if let Some(directory) = file_path.parent() {
                    cleanup_directory(directory).await?;
                }
                Err(YtdlpError::Cancelled)
            }
            TaskFinish::Failed => Err(YtdlpError::DownloadFailed(
                "download scheduler rejected successful completion".to_string(),
            )),
        },
        Err(error) => {
            let finish = scheduler
                .finish_failure(&cancellation, error.to_string())
                .await;
            if matches!(error, YtdlpError::Cleanup(_)) {
                Err(error)
            } else if matches!(finish, TaskFinish::Cancelled | TaskFinish::Stale)
                || matches!(error, YtdlpError::Cancelled)
            {
                Err(YtdlpError::Cancelled)
            } else {
                Err(error)
            }
        }
    }
}

pub async fn import_online_video(
    app: &tauri::AppHandle,
    scheduler: &ImportScheduler,
    output_root: &Path,
    video_id: &str,
    url: &str,
) -> Result<OnlineVideoImportResult, YtdlpError> {
    let reporter = TauriDownloadProgressReporter {
        app: app.clone(),
        video_id: video_id.to_string(),
    };
    import_online_video_with_programs(
        scheduler,
        output_root,
        video_id,
        url,
        Path::new("yt-dlp"),
        &[],
        Path::new("yt-dlp"),
        &[],
        &reporter,
    )
    .await
}

pub fn parse_video_info(url: &str) -> Result<VideoInfo, YtdlpError> {
    if !is_valid_url(url) {
        return Err(YtdlpError::InvalidUrl);
    }

    let output = Command::new("yt-dlp")
        .arg("--dump-json")
        .arg("--no-playlist")
        .arg(url)
        .output()
        .map_err(|e| YtdlpError::ParseFailed(format!("Failed to run yt-dlp: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(YtdlpError::ParseFailed(stderr.to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| YtdlpError::ParseFailed(format!("JSON parse error: {}", e)))?;

    Ok(video_info_from_json(&json))
}

pub fn download_video(url: &str, video_dir: &str) -> Result<String, YtdlpError> {
    if !is_valid_url(url) {
        return Err(YtdlpError::InvalidUrl);
    }

    let output_template = format!("{}/video.%(ext)s", video_dir);

    let output = Command::new("yt-dlp")
        .arg("--no-playlist")
        .arg("-o")
        .arg(&output_template)
        .arg("-f")
        .arg("bestvideo+bestaudio/best")
        .arg("--merge-output-format")
        .arg("mp4")
        .arg(url)
        .output()
        .map_err(|e| YtdlpError::DownloadFailed(format!("Failed to run yt-dlp: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(YtdlpError::DownloadFailed(stderr.to_string()));
    }

    Ok(format!("{}/video.mp4", video_dir))
}

pub fn fetch_subtitles(url: &str) -> Result<Vec<SubtitleTrack>, YtdlpError> {
    if !is_valid_url(url) {
        return Err(YtdlpError::InvalidUrl);
    }

    let output = Command::new("yt-dlp")
        .arg("--list-subs")
        .arg("--print-json")
        .arg(url)
        .output()
        .map_err(|e| YtdlpError::ParseFailed(format!("Failed to run yt-dlp: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(YtdlpError::ParseFailed(stderr.to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap_or(serde_json::Value::Null);

    let mut tracks = Vec::new();

    if let Some(subs) = json.get("subtitles").and_then(|v| v.as_object()) {
        for (lang, variants) in subs {
            if let Some(arr) = variants.as_array() {
                if let Some(first) = arr.first() {
                    let url = first
                        .get("url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let ext = first
                        .get("ext")
                        .and_then(|v| v.as_str())
                        .unwrap_or("vtt")
                        .to_string();
                    tracks.push(SubtitleTrack {
                        language: lang.clone(),
                        url,
                        format: ext,
                    });
                }
            }
        }
    }

    // 自动字幕
    if let Some(auto_subs) = json.get("automatic_captions").and_then(|v| v.as_object()) {
        for (lang, variants) in auto_subs {
            if let Some(arr) = variants.as_array() {
                if let Some(first) = arr.first() {
                    let url = first
                        .get("url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let ext = first
                        .get("ext")
                        .and_then(|v| v.as_str())
                        .unwrap_or("vtt")
                        .to_string();
                    tracks.push(SubtitleTrack {
                        language: lang.clone(),
                        url,
                        format: ext,
                    });
                }
            }
        }
    }

    Ok(tracks)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub title: String,
    pub duration: f64,
    pub thumbnail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineVideoImportResult {
    pub title: String,
    pub duration: f64,
    pub thumbnail: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleTrack {
    pub language: String,
    pub url: String,
    pub format: String,
}

#[cfg(test)]
#[path = "ytdlp_tests.rs"]
mod tests;
