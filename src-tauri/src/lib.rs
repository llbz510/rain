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
pub mod video_deletion;
pub mod whisper;
pub mod ytdlp;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(Arc::new(scheduler::ImportScheduler::new()))
        .invoke_handler(tauri::generate_handler![
            commands::cancel_import,
            commands::check_ytdlp_command,
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
            commands::list_whisper_models,
            e2e_config::get_real_e2e_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
