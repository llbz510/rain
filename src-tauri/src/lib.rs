pub mod ytdlp;
pub mod whisper;
pub mod ffmpeg;
pub mod asr;
pub mod events;
pub mod scheduler;
pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
