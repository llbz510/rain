use crate::thumbnail_storage;
use crate::video_deletion;
use sqlx::SqliteConnection;
use std::collections::BTreeSet;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

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

// ---------------------------------------------------------------------------
// AC-VL-06: app-owned orphan thumbnail collection
// ---------------------------------------------------------------------------

/// The single controlled directory that owns derived thumbnails. Both the
/// AC-VL-05 deletion path and this collection path derive it from
/// `thumbnail_storage`, so no second naming rule exists.
const CONTROLLED_THUMBNAIL_DIRECTORY: &str = "thumbnails";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OrphanCollectionPolicy {
    /// Maximum directory entries inspected in one round. The scan itself is
    /// bounded by this limit, so a large directory cannot stall the caller.
    pub max_candidates: usize,
    /// Maximum failed deletions before the round ends early.
    pub max_failures: usize,
    /// A thumbnail whose file timestamp is newer than this window is never
    /// deleted: the importer writes the file before it inserts the `video` row.
    pub recent_protection: Duration,
}

/// Production policy: bounded scan, bounded failures, and a protection window
/// far larger than the real gap between writing a thumbnail and inserting its
/// `video` row.
pub const ORPHAN_COLLECTION_POLICY: OrphanCollectionPolicy = OrphanCollectionPolicy {
    max_candidates: 200,
    max_failures: 5,
    recent_protection: Duration::from_secs(300),
};

#[derive(Debug)]
pub struct OrphanCollectionFailure {
    pub name: String,
    pub diagnostic: String,
}

#[derive(Debug, Default)]
pub struct OrphanCollectionReport {
    /// Directory entries inspected in this round, including entries the round
    /// deliberately left alone.
    pub candidates_examined: usize,
    pub deleted: Vec<String>,
    pub retained_in_keep_set: usize,
    pub retained_recent: Vec<String>,
    pub skipped_not_app_owned: usize,
    pub failures: Vec<OrphanCollectionFailure>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum OrphanCollectionSkip {
    AlreadyRunning,
    KeepSetUnavailable(String),
    ControlledDirectoryUnavailable(String),
}

impl OrphanCollectionSkip {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AlreadyRunning => "already_running",
            Self::KeepSetUnavailable(_) => "keep_set_unavailable",
            Self::ControlledDirectoryUnavailable(_) => "controlled_directory_unavailable",
        }
    }

    fn detail(&self) -> &str {
        match self {
            Self::AlreadyRunning => "a round is already running for this app data root",
            Self::KeepSetUnavailable(detail) => detail,
            Self::ControlledDirectoryUnavailable(detail) => detail,
        }
    }
}

impl fmt::Display for OrphanCollectionSkip {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} ({})", self.as_str(), self.detail())
    }
}

/// Running-level outcome. The three endings an operator must be able to tell
/// apart are `Completed`, the two capped endings, and the partial-failure case.
#[derive(Debug)]
pub enum OrphanCollectionResult {
    Completed(OrphanCollectionReport),
    CompletedWithFailures(OrphanCollectionReport),
    CappedByCandidateLimit(OrphanCollectionReport),
    CappedByFailureLimit(OrphanCollectionReport),
    Skipped(OrphanCollectionSkip),
}

impl OrphanCollectionResult {
    pub fn report(&self) -> Option<&OrphanCollectionReport> {
        match self {
            Self::Completed(report)
            | Self::CompletedWithFailures(report)
            | Self::CappedByCandidateLimit(report)
            | Self::CappedByFailureLimit(report) => Some(report),
            Self::Skipped(_) => None,
        }
    }

    pub fn skip(&self) -> Option<&OrphanCollectionSkip> {
        match self {
            Self::Skipped(reason) => Some(reason),
            _ => None,
        }
    }

    pub fn is_skipped(&self) -> bool {
        self.skip().is_some()
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Completed(_) => "completed",
            Self::CompletedWithFailures(_) => "completed_with_failures",
            Self::CappedByCandidateLimit(_) => "capped_by_candidate_limit",
            Self::CappedByFailureLimit(_) => "capped_by_failure_limit",
            Self::Skipped(_) => "skipped",
        }
    }
}

/// Process-wide re-entrancy guard: at most one round per app data root.
static ACTIVE_ORPHAN_COLLECTIONS: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());

pub(crate) struct OrphanCollectionGuard {
    root: PathBuf,
}

impl OrphanCollectionGuard {
    pub(crate) fn try_acquire(app_data_root: &Path) -> Option<Self> {
        let root = app_data_root.to_path_buf();
        let mut active = lock_active_collections();
        if !active.insert(root.clone()) {
            return None;
        }
        Some(Self { root })
    }
}

impl Drop for OrphanCollectionGuard {
    fn drop(&mut self) {
        lock_active_collections().remove(&self.root);
    }
}

fn lock_active_collections() -> std::sync::MutexGuard<'static, BTreeSet<PathBuf>> {
    ACTIVE_ORPHAN_COLLECTIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Pure protection-window predicate. A timestamp ahead of the local clock is
/// retained conservatively, and `Duration::ZERO` means "no protection".
pub(crate) fn within_protection_window(
    modified: SystemTime,
    now: SystemTime,
    window: Duration,
) -> bool {
    match now.duration_since(modified) {
        Ok(elapsed) => elapsed < window,
        Err(_) => true,
    }
}

/// Runs exactly one bounded collection round against a real database connection
/// and the controlled app-data directory. It never returns an error: every
/// failure or refusal is reported structurally so the caller can decide.
pub async fn collect_orphan_thumbnails_on_connection(
    connection: &mut SqliteConnection,
    app_data_root: &Path,
    policy: &OrphanCollectionPolicy,
) -> OrphanCollectionResult {
    let _guard = match OrphanCollectionGuard::try_acquire(app_data_root) {
        Some(guard) => guard,
        None => return OrphanCollectionResult::Skipped(OrphanCollectionSkip::AlreadyRunning),
    };

    let keep_set = match load_video_keep_set(connection).await {
        Ok(keep_set) => keep_set,
        Err(detail) => {
            return OrphanCollectionResult::Skipped(OrphanCollectionSkip::KeepSetUnavailable(
                detail,
            ))
        }
    };

    let app_data_root = app_data_root.to_path_buf();
    let policy = *policy;
    let scan = tokio::task::spawn_blocking(move || {
        collect_orphans_in_controlled_directory(&app_data_root, &keep_set, &policy)
    })
    .await;

    match scan {
        Ok(result) => result,
        Err(error) => {
            OrphanCollectionResult::Skipped(OrphanCollectionSkip::ControlledDirectoryUnavailable(
                format!("orphan collection task failed: {error}"),
            ))
        }
    }
}

/// The keep-set comes from the same fact source the AC-VL-05 deletion path
/// relies on: the current `video` rows of the real database.
async fn load_video_keep_set(
    connection: &mut SqliteConnection,
) -> Result<BTreeSet<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT id FROM video")
        .fetch_all(connection)
        .await
        .map(|ids| ids.into_iter().collect())
        .map_err(|error| format!("read the Video keep-set: {error}"))
}

fn collect_orphans_in_controlled_directory(
    app_data_root: &Path,
    keep_set: &BTreeSet<String>,
    policy: &OrphanCollectionPolicy,
) -> OrphanCollectionResult {
    let controlled_directory = app_data_root.join(CONTROLLED_THUMBNAIL_DIRECTORY);
    let metadata = match std::fs::symlink_metadata(&controlled_directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return OrphanCollectionResult::Completed(OrphanCollectionReport::default())
        }
        Err(error) => {
            return OrphanCollectionResult::Skipped(
                OrphanCollectionSkip::ControlledDirectoryUnavailable(format!(
                    "inspect the controlled thumbnail directory: {error}"
                )),
            )
        }
    };
    // A redirected or non-directory controlled path is left completely alone.
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return OrphanCollectionResult::Skipped(
            OrphanCollectionSkip::ControlledDirectoryUnavailable(
                "the controlled thumbnail path is not a plain directory".to_string(),
            ),
        );
    }

    let entries = match std::fs::read_dir(&controlled_directory) {
        Ok(entries) => entries,
        Err(error) => {
            return OrphanCollectionResult::Skipped(
                OrphanCollectionSkip::ControlledDirectoryUnavailable(format!(
                    "read the controlled thumbnail directory: {error}"
                )),
            )
        }
    };

    let mut report = OrphanCollectionReport::default();
    let mut capped_by_candidates = false;
    let mut capped_by_failures = false;

    for entry in entries {
        if report.candidates_examined >= policy.max_candidates {
            capped_by_candidates = true;
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                report.candidates_examined += 1;
                report.failures.push(OrphanCollectionFailure {
                    name: String::from("<unreadable directory entry>"),
                    diagnostic: format!("read a controlled directory entry: {error}"),
                });
                if report.failures.len() >= policy.max_failures {
                    capped_by_failures = true;
                    break;
                }
                continue;
            }
        };
        report.candidates_examined += 1;

        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(video_id) = app_owned_video_id_for_entry(app_data_root, &entry.path(), &name)
        else {
            report.skipped_not_app_owned += 1;
            continue;
        };

        let metadata = match std::fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(error) => {
                report.failures.push(OrphanCollectionFailure {
                    name,
                    diagnostic: format!("inspect a controlled thumbnail: {error}"),
                });
                if report.failures.len() >= policy.max_failures {
                    capped_by_failures = true;
                    break;
                }
                continue;
            }
        };
        // Directories, reparse points and anything that is not a plain file are
        // always retained.
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            report.skipped_not_app_owned += 1;
            continue;
        }
        if keep_set.contains(&video_id) {
            report.retained_in_keep_set += 1;
            continue;
        }
        // An unreadable timestamp is retained conservatively.
        let protected = metadata.modified().map_or(true, |modified| {
            within_protection_window(modified, SystemTime::now(), policy.recent_protection)
        });
        if protected {
            report.retained_recent.push(name);
            continue;
        }

        match delete_app_owned_thumbnail(app_data_root, &video_id) {
            Ok(()) => report.deleted.push(name),
            Err(error) => {
                report.failures.push(OrphanCollectionFailure {
                    name,
                    diagnostic: error.to_string(),
                });
                if report.failures.len() >= policy.max_failures {
                    capped_by_failures = true;
                    break;
                }
            }
        }
    }

    if capped_by_failures {
        OrphanCollectionResult::CappedByFailureLimit(report)
    } else if capped_by_candidates {
        OrphanCollectionResult::CappedByCandidateLimit(report)
    } else if report.failures.is_empty() {
        OrphanCollectionResult::Completed(report)
    } else {
        OrphanCollectionResult::CompletedWithFailures(report)
    }
}

/// Derives a candidate id with the single app-owned naming rule owned by
/// `thumbnail_storage` and confirms the entry really is that derived path, so a
/// second filename convention can never appear here.
fn app_owned_video_id_for_entry(
    app_data_root: &Path,
    entry_path: &Path,
    name: &str,
) -> Option<String> {
    let video_id = name.strip_suffix(".jpg")?;
    let derived = thumbnail_storage::thumbnail_path_for_video_id(app_data_root, video_id).ok()?;
    if derived == entry_path {
        Some(video_id.to_string())
    } else {
        None
    }
}

/// Renders the structured outcome for the existing diagnostic channel. A round
/// that changed nothing and hit no problem produces no line at all.
pub fn orphan_collection_diagnostic(result: &OrphanCollectionResult) -> Option<String> {
    match result {
        OrphanCollectionResult::Skipped(reason) => Some(format!(
            "thumbnail orphan collection: skipped reason={} detail={}",
            reason.as_str(),
            reason.detail()
        )),
        OrphanCollectionResult::Completed(report)
            if report.deleted.is_empty() && report.failures.is_empty() =>
        {
            None
        }
        other => {
            let report = other
                .report()
                .expect("every non-skipped outcome carries a report");
            let mut line = format!(
                "thumbnail orphan collection: outcome={} examined={} deleted={} kept={} protected={} skipped={} failures={}",
                other.label(),
                report.candidates_examined,
                report.deleted.len(),
                report.retained_in_keep_set,
                report.retained_recent.len(),
                report.skipped_not_app_owned,
                report.failures.len(),
            );
            for failure in &report.failures {
                line.push_str(&format!(
                    "; failed={} ({})",
                    failure.name, failure.diagnostic
                ));
            }
            Some(line)
        }
    }
}

/// Writes the round diagnostic to the existing diagnostic channel. No new
/// user-facing surface is introduced.
pub fn report_orphan_collection(result: &OrphanCollectionResult) {
    if let Some(diagnostic) = orphan_collection_diagnostic(result) {
        eprintln!("{diagnostic}");
    }
}

/// `AC-VL-06` / `D2`: delete one Video and then run exactly one bounded round.
/// The round's own outcome can never turn a committed delete into a failure.
pub async fn delete_video_and_collect_orphans_on_connection(
    connection: &mut SqliteConnection,
    app_data_root: &Path,
    video_id: &str,
    policy: &OrphanCollectionPolicy,
) -> Result<OrphanCollectionResult, ThumbnailLifecycleError> {
    delete_video_and_thumbnail_on_connection(&mut *connection, app_data_root, video_id).await?;
    Ok(collect_orphan_thumbnails_on_connection(connection, app_data_root, policy).await)
}
