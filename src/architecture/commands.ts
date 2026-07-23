// src/architecture/commands.ts
// ========================================
// Tauri command 列表（决策92-98，Rust 后端职责）
// ========================================

export const TAURI_COMMANDS = [
  'start_import',
  'cancel_import',
  'check_ytdlp',
  'check_ytdlp_command',
  'get_runtime_capability',
  'probe_video_info',
  'generate_thumbnail',
  'start_asr',
  'assign_asr_sentences_atomically',
  'transition_video_import_state',
  'merge_import_atomically',
  'download_whisper_model',
  'list_whisper_models',
  'convert_file_src',
] as const
