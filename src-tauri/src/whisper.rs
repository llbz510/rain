// src-tauri/src/whisper.rs
// ========================================
// whisper-rs 封装（决策94）
// ========================================

use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhisperModelSize {
    Tiny,
    Base,
    Small,
    Medium,
    LargeV3,
}

impl WhisperModelSize {
    pub fn as_filename(&self) -> &'static str {
        match self {
            WhisperModelSize::Tiny => "ggml-tiny.bin",
            WhisperModelSize::Base => "ggml-base.bin",
            WhisperModelSize::Small => "ggml-small.bin",
            WhisperModelSize::Medium => "ggml-medium.bin",
            WhisperModelSize::LargeV3 => "ggml-large-v3.bin",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "tiny" => Some(WhisperModelSize::Tiny),
            "base" => Some(WhisperModelSize::Base),
            "small" => Some(WhisperModelSize::Small),
            "medium" => Some(WhisperModelSize::Medium),
            "large-v3" | "large" => Some(WhisperModelSize::LargeV3),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct WhisperSegment {
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
    pub word_level: Vec<WordTimestamp>,
}

#[derive(Debug, Clone)]
pub struct WordTimestamp {
    pub word: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone)]
pub struct WhisperResult {
    pub segments: Vec<WhisperSegment>,
    pub detected_language: String,
}

#[derive(Debug, Clone)]
pub enum WhisperError {
    ModelNotFound(String),
    LoadFailed(String),
    TranscribeFailed(String),
    AudioConversionFailed(String),
}

impl std::fmt::Display for WhisperError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WhisperError::ModelNotFound(msg) => write!(f, "Model not found: {}", msg),
            WhisperError::LoadFailed(msg) => write!(f, "Model load failed: {}", msg),
            WhisperError::TranscribeFailed(msg) => write!(f, "Transcribe failed: {}", msg),
            WhisperError::AudioConversionFailed(msg) => {
                write!(f, "Audio conversion failed: {}", msg)
            }
        }
    }
}

impl std::error::Error for WhisperError {}

/// 加载模型文件（验证可加载）
pub fn load_model(model_path: &str) -> Result<(), WhisperError> {
    if model_path.is_empty() || !Path::new(model_path).exists() {
        return Err(WhisperError::ModelNotFound(format!(
            "Model file not found: {}",
            model_path
        )));
    }

    let params = whisper_rs::WhisperContextParameters::default();
    match whisper_rs::WhisperContext::new_with_params(model_path, params) {
        Ok(_ctx) => Ok(()),
        Err(e) => Err(WhisperError::LoadFailed(e.to_string())),
    }
}

/// 推理音频 → 词级时间戳输出
/// auto_detect=true 时自动检测语言（前 30 秒，决策85）
/// 支持任意长度音频（长音频：30s VAD 自切，决策32）
pub fn transcribe(
    model_path: &str,
    audio_path: &str,
    auto_detect_language: bool,
) -> Result<WhisperResult, WhisperError> {
    if !Path::new(model_path).exists() {
        return Err(WhisperError::ModelNotFound(model_path.to_string()));
    }
    if !Path::new(audio_path).exists() {
        return Err(WhisperError::TranscribeFailed(format!(
            "Audio file not found: {}",
            audio_path
        )));
    }

    // 1. 将音频转换为 16kHz mono WAV（用 ffmpeg）
    let temp_wav = format!(
        "{}/rain_temp_{}.wav",
        std::env::temp_dir().to_string_lossy(),
        std::process::id()
    );

    convert_to_wav(audio_path, &temp_wav)?;

    // 2. 读取 PCM samples (f32)
    let samples = read_wav_samples(&temp_wav)
        .map_err(|e| WhisperError::TranscribeFailed(format!("Read WAV failed: {}", e)))?;

    // 清理临时文件
    let _ = std::fs::remove_file(&temp_wav);

    // 3. 加载模型
    let ctx_params = whisper_rs::WhisperContextParameters::default();
    let ctx = whisper_rs::WhisperContext::new_with_params(model_path, ctx_params)
        .map_err(|e| WhisperError::LoadFailed(e.to_string()))?;

    // 4. 创建状态
    let mut state = ctx
        .create_state()
        .map_err(|e| WhisperError::TranscribeFailed(format!("Create state failed: {}", e)))?;

    // 5. 设置参数
    let mut params = whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy {
        best_of: 1,
    });

    if auto_detect_language {
        params.set_language(None);
        params.set_detect_language(true);
    } else {
        params.set_language(Some("zh"));
    }

    params.set_n_threads(num_cpus() as i32);
    params.set_token_timestamps(true);

    // 6. 推理
    state
        .full(params, &samples)
        .map_err(|e| WhisperError::TranscribeFailed(format!("Inference failed: {}", e)))?;

    // 7. 读取结果
    let num_segments = state.full_n_segments();
    let mut segments = Vec::new();

    for i in 0..num_segments {
        let seg = match state.get_segment(i) {
            Some(s) => s,
            None => continue,
        };

        let text = seg.to_str_lossy().map(|c| c.to_string()).unwrap_or_default();

        // segment 时间戳是 centiseconds (10ms)
        let start_time = seg.start_timestamp() as f64 * 0.01;
        let end_time = seg.end_timestamp() as f64 * 0.01;

        // 词级时间戳
        let mut word_level = Vec::new();
        let num_tokens = seg.n_tokens();

        for j in 0..num_tokens {
            if let Some(token) = seg.get_token(j) {
                let token_text = token.to_str_lossy().map(|c| c.to_string()).unwrap_or_default();
                let token_data = token.token_data();

                // t0/t1 are in centiseconds
                word_level.push(WordTimestamp {
                    word: token_text,
                    start: token_data.t0 as f64 * 0.01,
                    end: token_data.t1 as f64 * 0.01,
                });
            }
        }

        segments.push(WhisperSegment {
            text,
            start_time,
            end_time,
            word_level,
        });
    }

    // 8. 语言检测
    let detected_language = if auto_detect_language {
        detect_language_from_segments(&segments)
    } else {
        "zh".to_string()
    };

    Ok(WhisperResult {
        segments,
        detected_language,
    })
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

/// 用 ffmpeg 将音频转为 16kHz mono 16-bit WAV
fn convert_to_wav(input: &str, output: &str) -> Result<(), WhisperError> {
    let result = std::process::Command::new("ffmpeg")
        .arg("-y")
        .arg("-i")
        .arg(input)
        .arg("-ar")
        .arg("16000") // 16kHz
        .arg("-ac")
        .arg("1") // mono
        .arg("-sample_fmt")
        .arg("s16") // 16-bit
        .arg(output)
        .output()
        .map_err(|e| WhisperError::AudioConversionFailed(format!("ffmpeg not found: {}", e)))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(WhisperError::AudioConversionFailed(stderr.to_string()));
    }

    Ok(())
}

fn read_wav_samples(wav_path: &str) -> Result<Vec<f32>, String> {
    use std::io::Read;

    let mut file = std::fs::File::open(wav_path).map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    file.read_to_end(&mut data).map_err(|e| e.to_string())?;

    if data.len() < 44 {
        return Err("WAV file too short".to_string());
    }

    // 找到 data chunk
    let mut pos = 12;
    while pos + 8 < data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size = u32::from_le_bytes([
            data[pos + 4],
            data[pos + 5],
            data[pos + 6],
            data[pos + 7],
        ]) as usize;

        if chunk_id == b"data" {
            let audio_start = pos + 8;
            let audio_end = (audio_start + chunk_size).min(data.len());
            let audio_data = &data[audio_start..audio_end];

            // 16-bit PCM → f32 samples
            let samples: Vec<f32> = audio_data
                .chunks_exact(2)
                .map(|chunk| {
                    let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
                    sample as f32 / 32768.0
                })
                .collect();

            return Ok(samples);
        }

        pos += 8 + chunk_size;
        if chunk_size % 2 != 0 {
            pos += 1;
        }
    }

    Err("No data chunk found in WAV".to_string())
}

fn detect_language_from_segments(segments: &[WhisperSegment]) -> String {
    let all_text: String = segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join("");

    let chinese_count = all_text
        .chars()
        .filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c))
        .count();

    if chinese_count > all_text.len() / 4 {
        "zh".to_string()
    } else if all_text.chars().any(|c| c.is_ascii_alphabetic()) {
        "en".to_string()
    } else {
        "other".to_string()
    }
}
