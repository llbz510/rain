pub mod asr_execution;
pub mod asr_persistence;
pub mod asr_transcript;
pub mod commands;
pub mod e2e_config;
pub mod events;
pub mod ffmpeg;
pub mod import_state_persistence;
pub mod note_persistence;
pub mod runtime;
pub mod scheduler;
pub mod settings_persistence;
pub mod structure_persistence;
pub mod thumbnail_storage;
pub mod video_deletion;
pub mod whisper;
pub mod whisper_backend;
pub mod whisper_model_download;
pub mod ytdlp;

#[cfg(test)]
#[path = "thumbnail_storage_tests.rs"]
mod thumbnail_storage_tests;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    if let Some(browser_args) = e2e_config::runtime_settings_webview_args() {
        for window in &mut context.config_mut().app.windows {
            window.additional_browser_args = Some(browser_args.clone());
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(Arc::new(scheduler::ImportScheduler::new()))
        .manage(Arc::new(whisper_model_download::ModelDownloadManager::new()))
        .invoke_handler(tauri::generate_handler![
            commands::cancel_import,
            commands::check_ytdlp_command,
            commands::import_online_video,
            commands::get_runtime_capability,
            commands::probe_video_info,
            commands::generate_thumbnail,
            commands::start_asr,
            commands::save_asr_atomically,
            commands::insert_note_atomically,
            commands::delete_video_atomically,
            commands::apply_settings_atomically,
            commands::assign_asr_sentences_atomically,
            commands::transition_video_import_state,
            commands::merge_import_atomically,
            commands::download_whisper_model,
            commands::cancel_whisper_model_download,
            commands::list_whisper_models,
            e2e_config::get_real_e2e_config,
        ])
        .run(context)
        .expect("error while running tauri application");
}
