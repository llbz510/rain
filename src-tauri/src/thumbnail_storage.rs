use crate::ffmpeg;
use std::fmt;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct ThumbnailStorageError(String);

impl fmt::Display for ThumbnailStorageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ThumbnailStorageError {}

pub(crate) fn cleanup_after_generation_failure(
    partial_path: &Path,
    generation_error: impl fmt::Display,
    cleanup: impl FnOnce(&Path) -> std::io::Result<()>,
) -> ThumbnailStorageError {
    let generation_message = generation_error.to_string();
    match cleanup(partial_path) {
        Ok(()) => ThumbnailStorageError(generation_message),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            ThumbnailStorageError(generation_message)
        }
        Err(error) => ThumbnailStorageError(format!(
            "{generation_message}; cleanup temporary thumbnail: {error}"
        )),
    }
}

pub fn generate_thumbnail(
    app_data_root: &Path,
    video_id: &str,
    source_path: &Path,
    timestamp: f64,
) -> Result<PathBuf, ThumbnailStorageError> {
    if video_id.is_empty()
        || video_id.len() > 128
        || !video_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(ThumbnailStorageError(
            "video ID must contain only ASCII letters, digits, '-' or '_'".to_string(),
        ));
    }
    let thumbnail_directory = app_data_root.join("thumbnails");
    std::fs::create_dir_all(&thumbnail_directory)
        .map_err(|error| ThumbnailStorageError(format!("create thumbnail directory: {error}")))?;
    let output_path = thumbnail_directory.join(format!("{video_id}.jpg"));
    let partial_path =
        thumbnail_directory.join(format!(".{video_id}.{}.partial.jpg", uuid::Uuid::new_v4()));
    let generation = ffmpeg::extract_frame(
        source_path.to_string_lossy().as_ref(),
        partial_path.to_string_lossy().as_ref(),
        timestamp,
    );
    if let Err(error) = generation {
        return Err(cleanup_after_generation_failure(
            &partial_path,
            error,
            |path| std::fs::remove_file(path),
        ));
    }
    if let Err(commit_error) = atomic_replace(&partial_path, &output_path) {
        let cleanup = std::fs::remove_file(&partial_path);
        if let Err(cleanup_error) = cleanup {
            if cleanup_error.kind() != std::io::ErrorKind::NotFound {
                return Err(ThumbnailStorageError(format!(
                    "commit thumbnail: {commit_error}; cleanup temporary thumbnail: {cleanup_error}"
                )));
            }
        }
        return Err(ThumbnailStorageError(format!(
            "commit thumbnail: {commit_error}"
        )));
    }
    Ok(output_path)
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
