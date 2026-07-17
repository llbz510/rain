# Rain 本地视频真实可用修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用指定本地 MP4 完成真实 Whisper 转录、Qwen 结构化、学习播放和 AI 助手闭环，并生成完整脱敏证据。

**Architecture:** Rust 处理媒体、Whisper、帧提取、GPU/CPU 后端及取消；前端 Pipeline Controller 负责 Qwen 调用、校验、恢复和 UI。SQLite 是持久化真相，Zustand 只缓存当前会话。

**Tech Stack:** React 19、TypeScript、Vite、Zustand、Tauri 2、Rust、whisper-rs 0.16、ffmpeg、SQLite、DashScope OpenAI-compatible API。

## Global Constraints

- 首轮仅支持本地视频完整闭环；URL 导入隐藏或标为后续阶段。
- ASR 使用本地 Whisper large-v3，GPU 优先、CPU 回退；其余 AI 使用 `qwen3.5-omni-flash`。
- DashScope base URL 为 `https://dashscope.aliyuncs.com/compatible-mode/v1`；Key 不进入仓库、测试和证据。
- Key 按 PRD 存在 SQLite `setting` 表；模型池 JSON 不重复保存 Key。
- 失败、取消或缺少配置时，绝不生成 demo 句子、默认结构或 `ready`。
- 不修改锁定的 `harness/` 和 `src-tauri/tests/`；新增测试属于应用代码。
- 所有可见按钮有真实行为，或在首轮范围外时不显示。
- 真实验收视频 SHA-256 必须是 `3870B5BD62E574685AC99A8E44295F5E44AC44B76343666742C1C4CA48365F8A`。

---

## File Structure

| 文件 | 责任 |
|---|---|
| `src-tauri/Cargo.toml`、`src-tauri/src/runtime.rs` | 可选 CUDA feature 和运行时后端报告。 |
| `src-tauri/src/whisper.rs`、`ffmpeg.rs`、`commands.rs` | 安全媒体转换、真实 ASR、帧提取、进度和取消。 |
| `src/models/database.ts`、`types.ts` | 检查点、原子 ASR 保存、稳定模型设置。 |
| `src/pipeline/import-state.ts`、`asr-runner.ts` | fail-closed 状态机及 ASR 阶段。 |
| `src/pipeline/stage2-contract.ts`、`stage2-runner.ts` | Qwen 块契约、重试、覆盖校验和恢复。 |
| `src/llm/client.ts` | DashScope JSON mode、流式取消、脱敏错误。 |
| `src/pages/VideoListPage.tsx`、`settings.tsx` | 真实导入状态和可测试模型设置。 |
| `src/ui/components/video.tsx`、`src/pages/StudyInterface.tsx` | 播放、字幕、跳转和进度持久化。 |
| `src/ai/context.ts`、`src/ai/assistant.ts` | 分层上下文、来源引用和当前帧请求。 |
| `src/__tests__/`、`scripts/run-real-e2e.ps1` | 应用行为测试和真实 E2E 证据。 |

## Task 1: Add optional CUDA build and runtime capability

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`
- Create: `src-tauri/src/runtime.rs`
- Test: `src-tauri/src/runtime.rs`

**Interfaces:** Produces `WhisperBackend`, `RuntimeCapability`, `selected_backend()` and `runtime_capability()`.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn capability_exposes_one_valid_backend() {
    let backend = runtime_capability().whisper_backend;
    assert!(backend == "cuda" || backend == "cpu");
}
```

- [ ] **Step 2: Run it and record the expected compile failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml runtime::tests::capability_exposes_one_valid_backend`

Expected: FAIL because `runtime` is absent.

- [ ] **Step 3: Add the feature and implementation**

Add to `Cargo.toml`:

```toml
[features]
default = []
cuda-whisper = ["whisper-rs/cuda"]

[dependencies]
whisper-rs = { version = "0.16", default-features = false }
```

Create `runtime.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhisperBackend { Cuda, Cpu }

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapability { pub whisper_backend: &'static str, pub cpu_fallback_available: bool }

pub fn selected_backend() -> WhisperBackend {
    #[cfg(feature = "cuda-whisper")]
    { WhisperBackend::Cuda }
    #[cfg(not(feature = "cuda-whisper"))]
    { WhisperBackend::Cpu }
}

pub fn runtime_capability() -> RuntimeCapability {
    let whisper_backend = match selected_backend() { WhisperBackend::Cuda => "cuda", WhisperBackend::Cpu => "cpu" };
    RuntimeCapability { whisper_backend, cpu_fallback_available: true }
}
```

Export it through `pub mod runtime;` in `lib.rs`.

- [ ] **Step 4: Verify CPU then CUDA builds**

Run: `cargo test --manifest-path src-tauri/Cargo.toml runtime::tests`

Expected: PASS, backend `cpu`.

After approved CUDA installation, run: `cargo test --manifest-path src-tauri/Cargo.toml --features cuda-whisper runtime::tests`

Expected: PASS, backend `cuda`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/runtime.rs src-tauri/src/lib.rs
git commit -m "feat: add selectable whisper runtime backend"
```

## Task 2: Implement cancellable media, Whisper and frame IPC

**Files:**
- Modify: `src-tauri/src/ffmpeg.rs`, `src-tauri/src/whisper.rs`, `src-tauri/src/commands.rs`
- Test: `src-tauri/src/whisper.rs`

**Interfaces:** Produces `validate_asr_request(video_path, model_path)`, `temporary_wav_path(video_path)`, and `extract_frame(video_path, output_path, timestamp)`.

- [ ] **Step 1: Write failing safety tests**

```rust
#[test]
fn asr_rejects_empty_model_path() {
    assert_eq!(validate_asr_request("video.mp4", "").unwrap_err(), "model_path is required for Whisper ASR");
}

#[test]
fn temporary_wavs_are_unique() {
    assert_ne!(temporary_wav_path("video.mp4"), temporary_wav_path("video.mp4"));
}
```

- [ ] **Step 2: Run before implementation**

Run: `cargo test --manifest-path src-tauri/Cargo.toml whisper::tests`

Expected: FAIL because the helpers are absent.

- [ ] **Step 3: Implement real command behavior**

```rust
pub fn validate_asr_request(video_path: &str, model_path: &str) -> Result<(), String> {
    if video_path.trim().is_empty() { return Err("video_path is required".into()); }
    if model_path.trim().is_empty() { return Err("model_path is required for Whisper ASR".into()); }
    if !std::path::Path::new(video_path).is_file() { return Err("video file does not exist".into()); }
    if !std::path::Path::new(model_path).is_file() { return Err("Whisper model file does not exist".into()); }
    Ok(())
}

pub fn temporary_wav_path(video_path: &str) -> std::path::PathBuf {
    let stem = std::path::Path::new(video_path).file_stem().and_then(|value| value.to_str()).unwrap_or("rain");
    std::env::temp_dir().join(format!("rain-{stem}-{}.wav", uuid::Uuid::new_v4()))
}
```

Wire `start_asr` to require the saved model path, emit extraction/transcription/finalization progress, check cancellation between stages, clean its unique WAV in all outcomes, and return a real error on failure. Implement ffmpeg frame export with `-ss`, `-frames:v 1`, `-q:v 2`, and nonempty output checking.

- [ ] **Step 4: Verify**

Run: `cargo test --manifest-path src-tauri/Cargo.toml whisper::tests ffmpeg::tests`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ffmpeg.rs src-tauri/src/whisper.rs src-tauri/src/commands.rs
git commit -m "feat: run cancellable local whisper ASR"
```

## Task 3: Persist stable settings, checkpoints and atomic ASR

**Files:**
- Modify: `src/models/database.ts`, `src/models/types.ts`, `src/settings/model-pool.ts`, `src/store/rain-store.ts`
- Test: `src/__tests__/database-recovery.test.ts`, `src/__tests__/model-pool.test.ts`

**Interfaces:** Produces `ImportCheckpoint`, `loadRuntimeSettings()`, `saveRuntimeSettings()`, `saveAsrAtomically(videoId, language, sentences)`.

- [ ] **Step 1: Write failing persistence tests**

```ts
it('keeps the saved model ID after restart', async () => {
  await saveRuntimeSettings({ models: [{ id: 'qwen-main', alias: 'Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.5-omni-flash' }], roles: { asr: 'whisper-large-v3', structuring: 'qwen-main', assistant: 'qwen-main' } })
  expect((await loadRuntimeSettings()).roles.structuring).toBe('qwen-main')
})

it('rolls back all ASR rows when persistence fails', async () => {
  await expect(saveAsrAtomically('v1', 'zh', failingSentences)).rejects.toThrow()
  expect(await db.getSentencesByVideoId('v1')).toEqual([])
})
```

- [ ] **Step 2: Run before implementation**

Run: `npm.cmd test -- src/__tests__/database-recovery.test.ts src/__tests__/model-pool.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement schema and startup loading**

Create an `import_checkpoint` table with unique `video_id`, `stage`, `completed_blocks_json`, `error_message`, and `updated_at`. Save model records using their existing IDs; save only `api_key.<model-id>` in the setting table and omit it from model JSON. Make ASR persistence a begin/insert/update/commit transaction with rollback. Load settings in the store before import and expose `settingsReady`.

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- src/__tests__/database-recovery.test.ts src/__tests__/model-pool.test.ts`

Expected: PASS.

```bash
git add src/models/database.ts src/models/types.ts src/settings/model-pool.ts src/store/rain-store.ts src/__tests__/database-recovery.test.ts src/__tests__/model-pool.test.ts
git commit -m "feat: persist import checkpoints and stable model settings"
```

## Task 4: Replace fabricated pipeline success with a strict ASR state machine

**Files:**
- Create: `src/pipeline/import-state.ts`, `src/pipeline/asr-runner.ts`
- Modify: `src/pipeline/pipeline-orchestrator.ts`, `src/pipeline/progress-listener.ts`
- Test: `src/__tests__/pipeline-asr.test.ts`

**Interfaces:** Produces `ImportStage`, `runAsrStage(input)`, and `assertTransition(from, to)`.

- [ ] **Step 1: Write failing no-fabrication tests**

```ts
it('fails an import when Whisper rejects its model path', async () => {
  invokeMock.mockRejectedValue(new Error('model_path is required for Whisper ASR'))
  await expect(runPipeline(input)).rejects.toThrow('model_path is required for Whisper ASR')
  expect(await db.getVideo(input.video.id)).toMatchObject({ status: 'failed', stage: 'asr' })
  expect(await db.getSentencesByVideoId(input.video.id)).toEqual([])
})

it('never saves demo sentence IDs', async () => {
  await expect(runPipeline(input)).rejects.toThrow()
  expect(await db.getSentencesByVideoId(input.video.id)).not.toContainEqual(expect.objectContaining({ id: expect.stringMatching(/^demo_s_/) }))
})
```

- [ ] **Step 2: Run before implementation**

Run: `npm.cmd test -- src/__tests__/pipeline-asr.test.ts`

Expected: FAIL because current broad catches generate demo data.

- [ ] **Step 3: Implement fail-closed transitions**

Allow only `pending → asr → stage2 → merging → ready`, with exits to `failed` and `cancelled`. `runAsrStage` invokes Rust using the selected saved model, validates real nonempty monotonic sentences, calls `saveAsrAtomically`, and rethrows any failure after persisting a truthful error. Delete `generateDemoSentences`, default-structure fallback calls, and success-returning broad catches.

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- src/__tests__/pipeline-asr.test.ts`

Expected: PASS.

```bash
git add src/pipeline/import-state.ts src/pipeline/asr-runner.ts src/pipeline/pipeline-orchestrator.ts src/pipeline/progress-listener.ts src/__tests__/pipeline-asr.test.ts
git commit -m "fix: make import ASR fail closed"
```

## Task 5: Add Qwen block contract, exact coverage, retry and recovery

**Files:**
- Create: `src/pipeline/stage2-contract.ts`, `src/pipeline/stage2-runner.ts`
- Modify: `src/pipeline/long-video.ts`, `src/pipeline/stage2-validate.ts`, `src/llm/client.ts`
- Test: `src/__tests__/stage2-runner.test.ts`

**Interfaces:** Produces `Stage2BlockOutput`, `validateExactSentenceCoverage()`, and `runStage2Stage()`.

- [ ] **Step 1: Write failing contract tests**

```ts
it('reports missing and duplicate sentence IDs', () => {
  const errors = validateExactSentenceCoverage(['s1', 's2'], { blockId: 'b1', nodes: [], coveredSentenceIds: ['s1', 's1'] })
  expect(errors).toEqual(expect.arrayContaining(['missing sentence s2', 'duplicate sentence s1']))
})

it('fails after three malformed model responses', async () => {
  clientMock.mockResolvedValueOnce('bad').mockResolvedValueOnce('bad').mockResolvedValueOnce('bad')
  await expect(runStage2Stage(input)).rejects.toThrow('Qwen returned invalid structured output after 3 attempts')
})
```

- [ ] **Step 2: Run before implementation**

Run: `npm.cmd test -- src/__tests__/stage2-runner.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement contract-first processing**

```ts
export interface Stage2NodeRef {
  id: string
  parentId: string | null
  kind: 'chapter' | 'section' | 'paragraph'
  title: string
  type?: 'concept' | 'example' | 'analogy' | 'transition'
  startSentenceId: string
  endSentenceId: string
}
export interface Stage2BlockOutput { blockId: string; nodes: Stage2NodeRef[]; coveredSentenceIds: string[] }
```

Split only on sentence boundaries. Prompt Qwen with immutable IDs, timestamps and original text, require the word `JSON`, use `response_format: { type: 'json_object' }`, and accept no generated body text. Validate JSON/schema/time/tree/coverage; retry only retryable transport or format errors twice. Persist completed blocks in the checkpoint and resume missing blocks only. Merge compact outlines, then write final nodes transactionally.

- [ ] **Step 4: Add client cancellation and redacted errors**

Require every `fetch` method to accept `AbortSignal`; include sanitized non-2xx body text in errors. Add one `redactSecret(value: string): string` helper and use it before all LLM logging.

- [ ] **Step 5: Verify and commit**

Run: `npm.cmd test -- src/__tests__/stage2-runner.test.ts`

Expected: PASS; malformed data ends in `failed`.

```bash
git add src/pipeline/stage2-contract.ts src/pipeline/stage2-runner.ts src/pipeline/long-video.ts src/pipeline/stage2-validate.ts src/llm/client.ts src/__tests__/stage2-runner.test.ts
git commit -m "feat: validate recoverable Qwen structuring blocks"
```

## Task 6: Expose truthful settings and local import UI

**Files:**
- Modify: `src/pages/VideoListPage.tsx`, `src/ui/components/video-list.tsx`, `src/ui/components/settings.tsx`
- Test: `src/__tests__/video-import-ui.test.tsx`, `src/__tests__/settings-connection.test.tsx`

**Interfaces:** Consumes `ImportStage`, `retryImport(videoId)`, `cancelImport(videoId)`, and `testModelConnection(config)`.

- [ ] **Step 1: Write failing interaction tests**

```tsx
it('shows the ASR error and retries from persisted stage', async () => {
  render(<VideoListPage />)
  await userEvent.click(await screen.findByRole('button', { name: '重试' }))
  expect(retryImportMock).toHaveBeenCalledWith('v1')
  expect(screen.getByText('Whisper 模型文件不存在')).toBeVisible()
})

it('tests Qwen and masks its saved key', async () => {
  clientMock.mockResolvedValue({ content: '{"ok":true}' })
  render(<SettingsPage />)
  await userEvent.click(screen.getByRole('button', { name: '测试' }))
  expect(await screen.findByText(/连接成功.*ms/)).toBeVisible()
  expect(screen.queryByDisplayValue('sk-secret-value')).toBeNull()
})
```

- [ ] **Step 2: Run before implementation**

Run: `npm.cmd test -- src/__tests__/video-import-ui.test.tsx src/__tests__/settings-connection.test.tsx`

Expected: FAIL because progress is console-only and test buttons are inert.

- [ ] **Step 3: Implement actions and health check**

Render precise stage labels, percent, last error, Cancel, Retry and Study actions. Hide the URL import action. Settings health check must send `Return JSON only.` and `Return {"ok":true}.` through the configured Qwen model with JSON mode, measure latency, parse `ok`, and show a sanitized message. A test request never persists the Key.

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- src/__tests__/video-import-ui.test.tsx src/__tests__/settings-connection.test.tsx`

Expected: PASS.

```bash
git add src/pages/VideoListPage.tsx src/ui/components/video-list.tsx src/ui/components/settings.tsx src/__tests__/video-import-ui.test.tsx src/__tests__/settings-connection.test.tsx
git commit -m "feat: expose truthful import and model settings"
```

## Task 7: Repair study playback and cited multimodal assistant

**Files:**
- Create: `src/ai/context.ts`
- Modify: `src/ui/components/video.tsx`, `src/ui/components/text-zone.tsx`, `src/pages/StudyInterface.tsx`, `src/ai/assistant.ts`, `src/ui/components/ai-assistant.tsx`
- Test: `src/__tests__/study-controls.test.tsx`, `src/__tests__/assistant-context.test.ts`

**Interfaces:** Produces `buildAssistantContext(input)`, `AssistantSource`, and `stopAssistant(controller)`.

- [ ] **Step 1: Write failing user-visible behavior tests**

```tsx
it('uses Tauri convertFileSrc and seeks on sentence double click', async () => {
  render(<StudyInterface />)
  await userEvent.dblClick(screen.getByText('信号可以放大'))
  expect(convertFileSrcMock).toHaveBeenCalledWith('D:\\course\\lesson.mp4')
  expect(seekMock).toHaveBeenCalledWith(42.5)
})
```

```ts
it('includes a cross-chapter source and aborts a stopped stream', async () => {
  const context = await buildAssistantContext({ videoId: 'v1', currentNodeId: 'n2', query: '前面如何定义放大器？', scope: 'current' })
  expect(context.sources.map(source => source.sentenceId)).toContain('s-introduction')
  const controller = new AbortController(); stopAssistant(controller)
  expect(controller.signal.aborted).toBe(true)
})
```

- [ ] **Step 2: Run before implementation**

Run: `npm.cmd test -- src/__tests__/study-controls.test.tsx src/__tests__/assistant-context.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement real interaction and layered context**

Use Tauri `convertFileSrc`, bind video time/play/pause/volume events, and persist debounced playback position. Wire subtitle, tree, sentence, excerpt, copy and delete controls; remove any visible operation that has no supported implementation. Build assistant context from global outline, current chapter, neighboring paragraphs and SQLite full-text hits; global questions batch chapter summaries and relevant sentences. Require source IDs/time ranges in replies and label unsupported claims. For visual requests, use Rust `extract_frame` at current time, send it with nearby text to Qwen, then delete the frame in `finally`. Store an `AbortController` for the actual 停止 button.

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- src/__tests__/study-controls.test.tsx src/__tests__/assistant-context.test.ts`

Expected: PASS.

```bash
git add src/ai/context.ts src/ui/components/video.tsx src/ui/components/text-zone.tsx src/pages/StudyInterface.tsx src/ai/assistant.ts src/ui/components/ai-assistant.tsx src/__tests__/study-controls.test.tsx src/__tests__/assistant-context.test.ts
git commit -m "feat: add functional study controls and cited assistant"
```

## Task 8: Build evidence tooling and verify the exact video end to end

**Files:**
- Create: `scripts/run-real-e2e.ps1`, `scripts/validate-evidence.ps1`, `src/__tests__/live-qwen.test.ts`
- Modify: `package.json`
- Create: `evidence/rain-real-e2e-YYYYMMDD-HHmmss/` only as generated untracked output

**Interfaces:** Consumes `RAIN_QWEN_API_KEY`; produces a sanitized `manifest.json` and reviewed artifacts.

- [ ] **Step 1: Write evidence validator failures first**

```powershell
$manifest = Get-Content -LiteralPath $EvidenceManifest -Raw | ConvertFrom-Json
if ($manifest.video.sha256 -ne '3870B5BD62E574685AC99A8E44295F5E44AC44B76343666742C1C4CA48365F8A') { throw 'unexpected input video hash' }
if ($manifest.secretsDetected -ne $false) { throw 'evidence contains a secret' }
if ($manifest.validation.sentenceCoverage -ne 'exactly-once') { throw 'sentence coverage is not exact' }
```

- [ ] **Step 2: Verify the validator fails on an incomplete temporary manifest**

Run: `powershell.exe -ExecutionPolicy Bypass -File scripts/validate-evidence.ps1 -EvidenceManifest C:\tmp\rain-incomplete-manifest.json`

Expected: FAIL with the precise missing-evidence reason.

- [ ] **Step 3: Implement the cold-start runner**

The runner must require `RAIN_QWEN_API_KEY`, create unique app-data and evidence directories, hash/probe the exact MP4, start Rain, perform local import, wait for a persisted `ready`, export sanitized transcript/Qwen/validation/database artifacts, and capture screenshots. Its manifest records backend, timings, ten manual transcription review timestamps, cancellation result, restart result, Qwen block count, and disallows transcript text `This is sentence` or IDs beginning `demo_s_`. Add `test:live:qwen` and `e2e:real` scripts to `package.json`.

- [ ] **Step 4: Run automated verification before live E2E**

Run: `npm.cmd test`

Expected: PASS.

Run: `npm.cmd exec tsc -- --noEmit`

Expected: exit code 0.

Run: `npm.cmd exec vite -- build --outDir .audit-dist-real --emptyOutDir`

Expected: exit code 0.

Run: `$env:CARGO_TARGET_DIR='D:\gongju\shengcan\rain\.audit-cargo-real-cpu'; cargo.exe test --manifest-path src-tauri\Cargo.toml`

Expected: PASS.

After CUDA setup, run: `$env:CARGO_TARGET_DIR='D:\gongju\shengcan\rain\.audit-cargo-real-cuda'; cargo.exe test --manifest-path src-tauri\Cargo.toml --features cuda-whisper`

Expected: PASS and `cuda` capability.

- [ ] **Step 5: Execute and inspect the real E2E**

Set `RAIN_QWEN_API_KEY` only in the current process and run: `npm.cmd run e2e:real`

Expected: the exact local MP4 reaches `ready` after real Whisper and Qwen work.

Run: `$evidenceManifest = Get-ChildItem -LiteralPath evidence -Directory -Filter 'rain-real-e2e-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName 'manifest.json' }; powershell.exe -ExecutionPolicy Bypass -File scripts/validate-evidence.ps1 -EvidenceManifest $evidenceManifest`

Expected: PASS for exact hash, no secrets, no demo content, exactly-once coverage, cancellation and restart proof.

Use the image-analysis skill to inspect captured UI screenshots and representative frames. Check transcript/highlight/tree, assistant citations and visual-answer result. Report the video hash, backend/elapsed time, sentence and Qwen block counts, validation result, restart/cancel result, screenshots reviewed, and all build/test outputs. If any check fails, report the failed stage without a success claim.

- [ ] **Step 6: Commit evidence tooling only**

```bash
git add scripts/run-real-e2e.ps1 scripts/validate-evidence.ps1 src/__tests__/live-qwen.test.ts package.json
git commit -m "test: add sanitized real pipeline evidence runner"
```

## Plan Self-Review

- GPU/CPU runtime, true ASR, model configuration, atomic persistence, strict state transitions, long-video Qwen validation, UI actions, assistant context, cancellation, recovery, evidence and the exact MP4 acceptance each have an owning task.
- The plan retains the approved local-first boundary and explicitly removes fabricated success paths.
- All interfaces are introduced before their consumers, all test steps name commands and expected results, and every commit lists exact files.
