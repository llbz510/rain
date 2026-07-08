// src-tauri/src/asr.rs
// ========================================
// ASR 三档标准化（决策32/85）
// ========================================

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sentence {
    pub id: String,
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
}

fn gen_id(prefix: &str, index: usize) -> String {
    format!("{}_{}", prefix, index)
}

fn is_sentence_ending(text: &str) -> bool {
    let trimmed = text.trim_end();
    if trimmed.is_empty() {
        return false;
    }
    let last_char = trimmed.chars().last().unwrap();
    matches!(last_char, '.' | '!' | '?' | '。' | '！' | '？' | '…')
}

/// 字幕档：从 yt-dlp 字幕轨解析为 Sentence[]
/// 输入是 SRT 或 VTT 格式的原始字幕文本
pub fn normalize_subtitle_track(subtitle_text: &str, language: &str) -> Vec<Sentence> {
    let fragments = parse_srt_or_vtt(subtitle_text);
    if fragments.is_empty() {
        return Vec::new();
    }

    let mut sentences: Vec<Sentence> = Vec::new();
    let mut current_text = String::new();
    let mut current_start = 0.0f64;
    let mut current_end = 0.0f64;
    let mut sentence_index = 0;

    for frag in &fragments {
        if current_text.is_empty() {
            current_start = frag.start_time;
        }
        // 中文字幕直接拼接，英文加空格
        if language == "zh" {
            current_text.push_str(&frag.text);
        } else {
            if !current_text.is_empty() {
                current_text.push(' ');
            }
            current_text.push_str(&frag.text);
        }
        current_end = frag.end_time;

        if is_sentence_ending(&current_text) {
            let trimmed = current_text.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(Sentence {
                    id: gen_id("sub", sentence_index),
                    text: trimmed,
                    start_time: current_start,
                    end_time: current_end,
                });
                sentence_index += 1;
            }
            current_text.clear();
        }
    }

    if !current_text.trim().is_empty() {
        sentences.push(Sentence {
            id: gen_id("sub", sentence_index),
            text: current_text.trim().to_string(),
            start_time: current_start,
            end_time: current_end,
        });
    }

    sentences
}

struct SubtitleFragment {
    text: String,
    start_time: f64,
    end_time: f64,
}

fn parse_srt_or_vtt(content: &str) -> Vec<SubtitleFragment> {
    let mut fragments = Vec::new();

    // VTT 格式：以 "WEBVTT" 开头
    let is_vtt = content.trim_start().starts_with("WEBVTT");

    let blocks: Vec<&str> = if is_vtt {
        content.split("\n\n").collect()
    } else {
        content.split("\n\n").collect()
    };

    for block in blocks {
        let lines: Vec<&str> = block.lines().collect();
        if lines.is_empty() {
            continue;
        }

        // 找到时间行
        let mut time_line_idx = None;
        for (i, line) in lines.iter().enumerate() {
            if line.contains("-->") {
                time_line_idx = Some(i);
                break;
            }
        }

        let time_line_idx = match time_line_idx {
            Some(idx) => idx,
            None => continue,
        };

        let time_parts: Vec<&str> = lines[time_line_idx].split("-->").collect();
        if time_parts.len() != 2 {
            continue;
        }

        let start = parse_timestamp(time_parts[0].trim(), is_vtt);
        let end = parse_timestamp(time_parts[1].trim().split_whitespace().next().unwrap_or(""), is_vtt);

        let text: String = lines[time_line_idx + 1..].join(" ").trim().to_string();
        if !text.is_empty() {
            fragments.push(SubtitleFragment {
                text,
                start_time: start,
                end_time: end,
            });
        }
    }

    fragments
}

fn parse_timestamp(ts: &str, is_vtt: bool) -> f64 {
    let ts = ts.trim();
    // 格式: HH:MM:SS.mmm 或 HH:MM:SS,mmm
    let ts = ts.replace(',', ".");
    let parts: Vec<&str> = ts.split(':').collect();

    match parts.len() {
        3 => {
            let h: f64 = parts[0].parse().unwrap_or(0.0);
            let m: f64 = parts[1].parse().unwrap_or(0.0);
            let s: f64 = parts[2].parse().unwrap_or(0.0);
            h * 3600.0 + m * 60.0 + s
        }
        2 => {
            let m: f64 = parts[0].parse().unwrap_or(0.0);
            let s: f64 = parts[1].parse().unwrap_or(0.0);
            m * 60.0 + s
        }
        1 => {
            let _ = is_vtt;
            parts[0].parse().unwrap_or(0.0)
        }
        _ => 0.0,
    }
}

/// API 档：调用云端 ASR，返回句级时间戳
/// 输入是供应商返回的 JSON 字符串，格式：[{"text":"...","start_time":0.0,"end_time":5.0},...]
pub fn normalize_api_asr(api_response: &str) -> Vec<Sentence> {
    let parsed: Vec<serde_json::Value> = match serde_json::from_str(api_response) {
        Ok(v) => v,
        Err(_) => {
            // 尝试解析为对象 { sentences: [...] }
            if let Ok(obj) = serde_json::from_str::<serde_json::Value>(api_response) {
                if let Some(arr) = obj.get("sentences").and_then(|v| v.as_array()) {
                    arr.clone()
                } else {
                    return Vec::new();
                }
            } else {
                return Vec::new();
            }
        }
    };

    let mut sentences = Vec::new();
    for (i, item) in parsed.iter().enumerate() {
        let text = item
            .get("text")
            .or_else(|| item.get("transcript"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        if text.is_empty() {
            continue;
        }

        let start_time = item
            .get("start_time")
            .or_else(|| item.get("start"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        let end_time = item
            .get("end_time")
            .or_else(|| item.get("end"))
            .and_then(|v| v.as_f64())
            .unwrap_or(start_time);

        sentences.push(Sentence {
            id: gen_id("api", i),
            text,
            start_time,
            end_time,
        });
    }

    sentences
}

/// 本地档：whisper-rs 推理
/// 调用 whisper::transcribe 获取词级时间戳，按标点分组为句级
pub fn run_local_whisper(model_path: &str, audio_path: &str) -> Vec<Sentence> {
    let whisper_result = match crate::whisper::transcribe(model_path, audio_path, true) {
        Ok(result) => result,
        Err(_) => return Vec::new(),
    };

    let mut sentences = Vec::new();
    let mut current_text = String::new();
    let mut current_start = 0.0f64;
    let mut current_end = 0.0f64;
    let mut sentence_index = 0;

    for segment in &whisper_result.segments {
        if !current_text.is_empty() {
            let words = &segment.word_level;
            if !words.is_empty() {
                current_end = words.last().unwrap().end;
            }
        }

        for word in &segment.word_level {
            if current_text.is_empty() {
                current_start = word.start;
            }
            current_text.push_str(&word.word);
            current_end = word.end;

            if is_sentence_ending(&current_text) {
                let trimmed = current_text.trim().to_string();
                if !trimmed.is_empty() {
                    sentences.push(Sentence {
                        id: gen_id("whisper", sentence_index),
                        text: trimmed,
                        start_time: current_start,
                        end_time: current_end,
                    });
                    sentence_index += 1;
                }
                current_text.clear();
            }
        }
    }

    if !current_text.trim().is_empty() {
        sentences.push(Sentence {
            id: gen_id("whisper", sentence_index),
            text: current_text.trim().to_string(),
            start_time: current_start,
            end_time: current_end,
        });
    }

    sentences
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_subtitle_basic() {
        let srt = "1\n00:00:00,000 --> 00:00:02,000\nHello world.\n\n2\n00:00:02,000 --> 00:00:05,000\nHow are you?";
        let sentences = normalize_subtitle_track(srt, "en");
        assert_eq!(sentences.len(), 2);
        assert!(sentences[0].text.contains("Hello world"));
        assert!(sentences[1].text.contains("How are you"));
    }

    #[test]
    fn test_normalize_api_basic() {
        let json = r#"[{"text":"第一句话。","start_time":0.0,"end_time":5.0},{"text":"第二句话。","start_time":5.0,"end_time":10.0}]"#;
        let sentences = normalize_api_asr(json);
        assert_eq!(sentences.len(), 2);
        assert!(sentences[0].text.contains("第一句话"));
    }

    #[test]
    fn test_normalize_api_empty() {
        let sentences = normalize_api_asr("invalid json");
        assert!(sentences.is_empty());
    }
}
