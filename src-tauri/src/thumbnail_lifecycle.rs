use crate::thumbnail_storage;
use crate::video_deletion;
use sqlx::SqliteConnection;
use std::fmt;
use std::path::Path;

#[derive(Debug)]
pub struct ThumbnailLifecycleError(String);

impl fmt::Display for ThumbnailLifecycleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ThumbnailLifecycleError {}

pub async fn delete_video_and_thumbnail_on_connection(
    connection: &mut SqliteConnection,
    app_data_root: &Path,
    video_id: &str,
) -> Result<(), ThumbnailLifecycleError> {
    thumbnail_storage::thumbnail_path_for_video_id(app_data_root, video_id).map_err(|error| {
        ThumbnailLifecycleError(format!("resolve app-owned thumbnail: {error}"))
    })?;

    video_deletion::delete_video_atomically_on_connection(connection, video_id)
        .await
        .map_err(|error| ThumbnailLifecycleError(format!("delete Video rows: {error}")))?;

    let app_data_root = app_data_root.to_path_buf();
    let video_id = video_id.to_owned();
    tokio::task::spawn_blocking(move || delete_app_owned_thumbnail(&app_data_root, &video_id))
        .await
        .map_err(|error| {
            ThumbnailLifecycleError(format!("thumbnail deletion task failed: {error}"))
        })?
}

#[cfg(windows)]
fn delete_app_owned_thumbnail(
    app_data_root: &Path,
    video_id: &str,
) -> Result<(), ThumbnailLifecycleError> {
    windows_delete::delete_app_owned_thumbnail(app_data_root, video_id)
}

#[cfg(not(windows))]
fn delete_app_owned_thumbnail(
    app_data_root: &Path,
    video_id: &str,
) -> Result<(), ThumbnailLifecycleError> {
    let thumbnail_path = thumbnail_storage::thumbnail_path_for_video_id(app_data_root, video_id)
        .map_err(|error| {
            ThumbnailLifecycleError(format!("resolve app-owned thumbnail: {error}"))
        })?;
    match std::fs::symlink_metadata(&thumbnail_path) {
        Ok(_) => Err(ThumbnailLifecycleError(
            "safe app-owned thumbnail deletion is unsupported on this platform".to_string(),
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(ThumbnailLifecycleError(format!(
                "inspect app-owned thumbnail: {error}"
            )))
        }
    }
}

#[cfg(windows)]
mod windows_delete {
    use super::ThumbnailLifecycleError;
    use crate::thumbnail_storage;
    use std::ffi::{c_void, OsString};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};

    type Handle = *mut c_void;

    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
    const DELETE: u32 = 0x0001_0000;
    const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const OPEN_EXISTING: u32 = 3;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_DISPOSITION_INFO: u32 = 4;
    const CSTR_EQUAL: i32 = 2;

    #[repr(C)]
    struct ByHandleFileInformation {
        file_attributes: u32,
        creation_time_low: u32,
        creation_time_high: u32,
        last_access_time_low: u32,
        last_access_time_high: u32,
        last_write_time_low: u32,
        last_write_time_high: u32,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }

    #[repr(C)]
    struct FileDispositionInformation {
        delete_file: u8,
    }

    const _: [(); 1] = [(); std::mem::size_of::<FileDispositionInformation>()];

    #[link(name = "Kernel32")]
    extern "system" {
        fn CreateFileW(
            file_name: *const u16,
            desired_access: u32,
            share_mode: u32,
            security_attributes: *const c_void,
            creation_disposition: u32,
            flags_and_attributes: u32,
            template_file: Handle,
        ) -> Handle;
        fn GetFileInformationByHandle(
            file: Handle,
            information: *mut ByHandleFileInformation,
        ) -> i32;
        fn GetFinalPathNameByHandleW(
            file: Handle,
            path: *mut u16,
            path_length: u32,
            flags: u32,
        ) -> u32;
        fn SetFileInformationByHandle(
            file: Handle,
            information_class: u32,
            information: *mut c_void,
            information_size: u32,
        ) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
        fn CompareStringOrdinal(
            first: *const u16,
            first_length: i32,
            second: *const u16,
            second_length: i32,
            ignore_case: i32,
        ) -> i32;
    }

    struct OpenHandle(Handle);

    impl OpenHandle {
        fn open_for_delete(path: &Path) -> std::io::Result<Self> {
            let wide_path: Vec<u16> = path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let handle = unsafe {
                CreateFileW(
                    wide_path.as_ptr(),
                    DELETE | FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                    std::ptr::null_mut(),
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(Self(handle))
            }
        }

        fn final_path(&self) -> std::io::Result<PathBuf> {
            let mut path = vec![0u16; 260];
            loop {
                let length = unsafe {
                    GetFinalPathNameByHandleW(self.0, path.as_mut_ptr(), path.len() as u32, 0)
                };
                if length == 0 {
                    return Err(std::io::Error::last_os_error());
                }
                if (length as usize) < path.len() {
                    return Ok(PathBuf::from(OsString::from_wide(&path[..length as usize])));
                }
                path.resize(length as usize + 1, 0);
            }
        }

        fn attributes(&self) -> std::io::Result<u32> {
            let mut information = std::mem::MaybeUninit::<ByHandleFileInformation>::uninit();
            let success = unsafe { GetFileInformationByHandle(self.0, information.as_mut_ptr()) };
            if success == 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(unsafe { information.assume_init().file_attributes })
            }
        }

        fn mark_for_deletion(&self) -> std::io::Result<()> {
            let mut disposition = FileDispositionInformation { delete_file: 1 };
            let success = unsafe {
                SetFileInformationByHandle(
                    self.0,
                    FILE_DISPOSITION_INFO,
                    (&mut disposition as *mut FileDispositionInformation).cast(),
                    std::mem::size_of::<FileDispositionInformation>() as u32,
                )
            };
            if success == 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        }
    }

    impl Drop for OpenHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    pub(super) fn delete_app_owned_thumbnail(
        app_data_root: &Path,
        video_id: &str,
    ) -> Result<(), ThumbnailLifecycleError> {
        let thumbnail_path =
            thumbnail_storage::thumbnail_path_for_video_id(app_data_root, video_id).map_err(
                |error| ThumbnailLifecycleError(format!("resolve app-owned thumbnail: {error}")),
            )?;
        let resolved_root = match std::fs::canonicalize(app_data_root) {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(ThumbnailLifecycleError(format!(
                    "resolve app data root: {error}"
                )))
            }
        };
        let expected_thumbnail = resolved_root
            .join("thumbnails")
            .join(format!("{video_id}.jpg"));
        let handle = match OpenHandle::open_for_delete(&thumbnail_path) {
            Ok(handle) => handle,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(ThumbnailLifecycleError(format!(
                    "open app-owned thumbnail: {error}"
                )))
            }
        };
        let final_path = handle.final_path().map_err(|error| {
            ThumbnailLifecycleError(format!("resolve opened app-owned thumbnail: {error}"))
        })?;
        if !paths_equal_case_insensitively(&final_path, &expected_thumbnail) {
            return Err(ThumbnailLifecycleError(
                "refuse thumbnail path outside the resolved app-data root".to_string(),
            ));
        }
        let attributes = handle.attributes().map_err(|error| {
            ThumbnailLifecycleError(format!("inspect opened app-owned thumbnail: {error}"))
        })?;
        if attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
            return Err(ThumbnailLifecycleError(
                "refuse directory or reparse-point thumbnail".to_string(),
            ));
        }
        handle.mark_for_deletion().map_err(|error| {
            ThumbnailLifecycleError(format!("delete app-owned thumbnail: {error}"))
        })
    }

    fn paths_equal_case_insensitively(first: &Path, second: &Path) -> bool {
        let first = normalized_windows_path(first);
        let second = normalized_windows_path(second);
        if first.len() > i32::MAX as usize || second.len() > i32::MAX as usize {
            return false;
        }
        unsafe {
            CompareStringOrdinal(
                first.as_ptr(),
                first.len() as i32,
                second.as_ptr(),
                second.len() as i32,
                1,
            ) == CSTR_EQUAL
        }
    }

    fn normalized_windows_path(path: &Path) -> Vec<u16> {
        let wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        let verbatim_prefix: Vec<u16> = r"\\?\".encode_utf16().collect();
        let unc_prefix: Vec<u16> = "UNC\\".encode_utf16().collect();
        if let Some(without_verbatim) = wide.strip_prefix(verbatim_prefix.as_slice()) {
            if let Some(without_unc) = without_verbatim.strip_prefix(unc_prefix.as_slice()) {
                let mut normalized: Vec<u16> = r"\\".encode_utf16().collect();
                normalized.extend_from_slice(without_unc);
                normalized
            } else {
                without_verbatim.to_vec()
            }
        } else {
            wide
        }
    }
}
