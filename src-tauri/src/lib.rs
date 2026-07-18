pub mod ytdlp;
pub mod whisper;
pub mod ffmpeg;
pub mod asr;
pub mod asr_persistence;
pub mod events;
pub mod scheduler;
pub mod commands;
pub mod runtime;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(Arc::new(scheduler::ImportScheduler::new()))
        .invoke_handler(tauri::generate_handler![
            commands::start_import,
            commands::cancel_import,
            commands::check_ytdlp_command,
            commands::probe_video_info,
            commands::generate_thumbnail,
            commands::start_asr,
            commands::save_asr_atomically,
            commands::download_whisper_model,
            commands::list_whisper_models,
            // convert_file_src 用纯函数，前端直接调用
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
