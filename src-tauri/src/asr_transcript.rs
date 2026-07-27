use crate::whisper;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AsrSentence {
    pub id: String,
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
}

const MAX_FALLBACK_SENTENCE_CHARS: usize = 500;

pub fn build_asr_transcript(result: &whisper::WhisperResult) -> Result<Vec<AsrSentence>, String> {
    let sentences = whisper_result_to_sentences(result);
    validate_whisper_sentences(&sentences)?;
    Ok(sentences)
}

fn validate_whisper_sentences(sentences: &[AsrSentence]) -> Result<(), String> {
    if sentences.is_empty() {
        return Err("Whisper ASR returned no sentences".to_string());
    }

    let mut previous = None;
    for (index, sentence) in sentences.iter().enumerate() {
        if sentence.text.trim().is_empty() {
            return Err(format!("Whisper sentence {index} has empty text"));
        }
        if has_mojibake_markers(&sentence.text) {
            return Err(format!("Whisper sentence {index} contains mojibake text"));
        }
        if !sentence.start_time.is_finite()
            || !sentence.end_time.is_finite()
            || sentence.start_time < 0.0
            || sentence.end_time <= sentence.start_time
        {
            return Err(format!("Whisper sentence {index} has invalid timestamps"));
        }
        if let Some((previous_start, previous_end)) = previous {
            if sentence.start_time < previous_start || sentence.end_time < previous_end {
                return Err(format!(
                    "Whisper sentence timestamps are not monotonic at index {index}"
                ));
            }
            if sentence.start_time < previous_end {
                return Err(format!(
                    "Whisper sentence timestamps overlap at index {index}"
                ));
            }
        }
        previous = Some((sentence.start_time, sentence.end_time));
    }

    Ok(())
}

fn whisper_result_to_sentences(result: &whisper::WhisperResult) -> Vec<AsrSentence> {
    let mut sentences = Vec::new();
    let mut current_text = String::new();
    let mut current_start = 0.0f64;
    let mut current_end = 0.0f64;
    let mut current_chars = 0usize;

    for segment in &result.segments {
        if segment.word_level.is_empty()
            || result.detected_language == "zh"
            || segment_word_text_is_suspicious(segment)
        {
            if !current_text.trim().is_empty() {
                push_current_word_sentence(
                    &mut sentences,
                    &mut current_text,
                    current_start,
                    current_end,
                );
                current_chars = 0;
            }
            push_segment_text_sentences(&mut sentences, segment);
            continue;
        }

        for word in &segment.word_level {
            if current_text.is_empty() {
                current_start = word.start;
            }
            current_text.push_str(&word.word);
            current_chars += word.word.chars().count();
            current_end = word.end;

            if is_sentence_ending(&current_text) || current_chars >= MAX_FALLBACK_SENTENCE_CHARS {
                push_current_word_sentence(
                    &mut sentences,
                    &mut current_text,
                    current_start,
                    current_end,
                );
                current_chars = 0;
            }
        }
    }

    if !current_text.trim().is_empty() {
        push_current_word_sentence(
            &mut sentences,
            &mut current_text,
            current_start,
            current_end,
        );
    }

    sentences
}

fn push_current_word_sentence(
    sentences: &mut Vec<AsrSentence>,
    current_text: &mut String,
    current_start: f64,
    current_end: f64,
) {
    let trimmed = current_text.trim().to_string();
    if !trimmed.is_empty() {
        sentences.push(AsrSentence {
            id: format!("whisper-{}", uuid::Uuid::new_v4()),
            text: trimmed,
            start_time: current_start,
            end_time: current_end,
        });
    }
    current_text.clear();
}

fn has_mojibake_markers(text: &str) -> bool {
    text.contains('\u{fffd}') || text.contains("\u{951f}\u{65a4}\u{62f7}")
}

fn segment_word_text_is_suspicious(segment: &whisper::WhisperSegment) -> bool {
    let joined = segment
        .word_level
        .iter()
        .map(|word| word.word.as_str())
        .collect::<Vec<_>>()
        .join("");
    joined.contains("[_TT_")
        || joined.contains("[_BEG_]")
        || joined.contains("[_EOT_]")
        || has_mojibake_markers(&joined)
}

fn push_segment_text_sentences(
    sentences: &mut Vec<AsrSentence>,
    segment: &whisper::WhisperSegment,
) {
    let text = segment.text.trim();
    if text.is_empty() {
        return;
    }

    let total_chars = text.chars().count();
    if total_chars == 0 {
        return;
    }

    let mut chunk = String::new();
    let mut chunk_start_char = 0usize;
    for (idx, ch) in text.chars().enumerate() {
        chunk.push(ch);
        let chunk_end_char = idx + 1;
        if is_sentence_ending(&chunk) || chunk.chars().count() >= MAX_FALLBACK_SENTENCE_CHARS {
            push_estimated_sentence(
                sentences,
                segment,
                chunk.trim(),
                chunk_start_char,
                chunk_end_char,
                total_chars,
            );
            chunk.clear();
            chunk_start_char = chunk_end_char;
        }
    }

    if !chunk.trim().is_empty() {
        push_estimated_sentence(
            sentences,
            segment,
            chunk.trim(),
            chunk_start_char,
            total_chars,
            total_chars,
        );
    }
}

fn push_estimated_sentence(
    sentences: &mut Vec<AsrSentence>,
    segment: &whisper::WhisperSegment,
    text: &str,
    start_char: usize,
    end_char: usize,
    total_chars: usize,
) {
    if text.is_empty() {
        return;
    }
    let duration = (segment.end_time - segment.start_time).max(0.0);
    let start_time = if start_char == 0 {
        segment.start_time
    } else {
        segment.start_time + duration * (start_char as f64 / total_chars as f64)
    };
    let mut end_time = if end_char >= total_chars {
        segment.end_time
    } else {
        segment.start_time + duration * (end_char as f64 / total_chars as f64)
    };
    if end_time <= start_time {
        end_time = segment.end_time.max(start_time + 0.001);
    }

    sentences.push(AsrSentence {
        id: format!("whisper-{}", uuid::Uuid::new_v4()),
        text: text.to_string(),
        start_time,
        end_time,
    });
}

fn is_sentence_ending(text: &str) -> bool {
    let trimmed = text.trim_end();
    if trimmed.is_empty() {
        return false;
    }
    let last = trimmed.chars().last().unwrap();
    matches!(
        last,
        '.' | '!' | '?' | '\u{3002}' | '\u{ff01}' | '\u{ff1f}' | '\u{2026}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_whisper_output_fails_closed() {
        let result = whisper::WhisperResult {
            segments: Vec::new(),
            detected_language: "zh".into(),
        };

        assert_eq!(
            build_asr_transcript(&result).unwrap_err(),
            "Whisper ASR returned no sentences"
        );
    }

    #[test]
    fn whisper_output_rejects_empty_text() {
        let sentences = vec![AsrSentence {
            id: "s1".into(),
            text: "   ".into(),
            start_time: 0.0,
            end_time: 1.0,
        }];

        assert_eq!(
            validate_whisper_sentences(&sentences).unwrap_err(),
            "Whisper sentence 0 has empty text"
        );
    }

    #[test]
    fn whisper_output_rejects_mojibake_text() {
        let sentences = vec![AsrSentence {
            id: "s1".into(),
            text: "\u{951f}\u{65a4}\u{62f7}".into(),
            start_time: 0.0,
            end_time: 1.0,
        }];

        assert_eq!(
            validate_whisper_sentences(&sentences).unwrap_err(),
            "Whisper sentence 0 contains mojibake text"
        );
    }

    #[test]
    fn whisper_output_rejects_non_monotonic_timestamps() {
        let sentences = vec![
            AsrSentence {
                id: "s1".into(),
                text: "first".into(),
                start_time: 1.0,
                end_time: 2.0,
            },
            AsrSentence {
                id: "s2".into(),
                text: "second".into(),
                start_time: 0.5,
                end_time: 3.0,
            },
        ];

        assert_eq!(
            validate_whisper_sentences(&sentences).unwrap_err(),
            "Whisper sentence timestamps are not monotonic at index 1"
        );
    }

    #[test]
    fn whisper_output_rejects_invalid_timestamps() {
        let sentences = vec![AsrSentence {
            id: "s1".into(),
            text: "invalid".into(),
            start_time: f64::NAN,
            end_time: 1.0,
        }];

        assert_eq!(
            validate_whisper_sentences(&sentences).unwrap_err(),
            "Whisper sentence 0 has invalid timestamps"
        );
    }

    #[test]
    fn whisper_segments_without_word_timestamps_still_create_sentences() {
        let result = whisper::WhisperResult {
            segments: vec![whisper::WhisperSegment {
                text: "这里是第一段讲解。".into(),
                start_time: 2.0,
                end_time: 5.0,
                word_level: Vec::new(),
            }],
            detected_language: "zh".into(),
        };

        let sentences = build_asr_transcript(&result).unwrap();

        assert_eq!(sentences.len(), 1);
        assert_eq!(sentences[0].text, "这里是第一段讲解。");
        assert_eq!(sentences[0].start_time, 2.0);
        assert_eq!(sentences[0].end_time, 5.0);
    }

    #[test]
    fn chinese_segments_ignore_suspicious_token_timestamp_text() {
        let result = whisper::WhisperResult {
            segments: vec![whisper::WhisperSegment {
                text: "这里是正常中文。".into(),
                start_time: 2.0,
                end_time: 5.0,
                word_level: vec![whisper::WordTimestamp {
                    word: "[_BEG_]\u{951f}\u{65a4}\u{62f7}[_TT_100]".into(),
                    start: 2.0,
                    end: 5.0,
                }],
            }],
            detected_language: "zh".into(),
        };

        let sentences = build_asr_transcript(&result).unwrap();

        assert_eq!(sentences.len(), 1);
        assert_eq!(sentences[0].text, "这里是正常中文。");
        assert_eq!(sentences[0].start_time, 2.0);
        assert_eq!(sentences[0].end_time, 5.0);
    }

    #[test]
    fn long_segments_without_word_timestamps_are_split_for_stage2_budget() {
        let result = whisper::WhisperResult {
            segments: vec![whisper::WhisperSegment {
                text: "abcde".repeat(260),
                start_time: 10.0,
                end_time: 70.0,
                word_level: Vec::new(),
            }],
            detected_language: "zh".into(),
        };

        let sentences = build_asr_transcript(&result).unwrap();

        assert!(sentences.len() > 1);
        assert!(sentences
            .iter()
            .all(|sentence| sentence.text.chars().count() <= 500));
        for pair in sentences.windows(2) {
            assert!(pair[0].end_time <= pair[1].start_time);
        }
        assert_eq!(sentences.first().unwrap().start_time, 10.0);
        assert_eq!(sentences.last().unwrap().end_time, 70.0);
    }

    #[test]
    fn sentence_ids_are_globally_unique() {
        let result = whisper::WhisperResult {
            segments: vec![whisper::WhisperSegment {
                text: "你好。".into(),
                start_time: 0.0,
                end_time: 1.0,
                word_level: vec![whisper::WordTimestamp {
                    word: "你好。".into(),
                    start: 0.0,
                    end: 1.0,
                }],
            }],
            detected_language: "zh".into(),
        };

        let first = build_asr_transcript(&result).unwrap();
        let second = build_asr_transcript(&result).unwrap();

        assert_ne!(first[0].id, second[0].id);
    }

    #[test]
    fn whisper_output_rejects_overlapping_sentences() {
        let sentences = vec![
            AsrSentence {
                id: "s1".into(),
                text: "first".into(),
                start_time: 1.0,
                end_time: 2.0,
            },
            AsrSentence {
                id: "s2".into(),
                text: "second".into(),
                start_time: 1.5,
                end_time: 3.0,
            },
        ];

        assert_eq!(
            validate_whisper_sentences(&sentences).unwrap_err(),
            "Whisper sentence timestamps overlap at index 1"
        );
    }
}
