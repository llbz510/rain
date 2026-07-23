# 阶段二：实现补齐 + E2E 测试 Implementation Plan

> **历史计划/施工图（非当前项目状态）**
>
> 本文是早期实施计划，不是当前进度表。不要根据本文里的未勾选 checkbox、测试数量、代码片段、commit 建议来判断 Rain 当前状态。当前真相以 `docs/PROJECT_STATE.md`、当前代码、验证脚本和已提交 evidence 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 3 个空壳实现补齐（progress-listener、thumbnail 调用），并用 Tauri mock_builder 跑端到端集成测试。

**Architecture:** 前端填充 progress-listener 和 VideoListPage thumbnail 调用；Rust 侧加 `test` feature 和 E2E 测试文件，用 ffmpeg 生成的 2 秒小视频做真实 probe + thumbnail 验证。

**Tech Stack:** TypeScript + Vitest + Tauri v2 + Rust + ffmpeg

## Global Constraints

- **npm test** 保持 304/304
- **npx tsc --noEmit** 0 错误
- **cargo test** 现有 40 测试不回归，新增 E2E 额外通过
- **harness 锁定**：`harness/` 与 `src-tauri/tests/` 已有文件禁止修改，只能新增
- **路径别名**：`@/*` → `./src/*`

---

### Task 1: progress-listener.ts 真实实现

**Files:**
- Modify: `src/pipeline/progress-listener.ts`

**Interfaces:**
- Consumes: `isTauri()` from `@/lib/tauri-env`, `PROGRESS_EVENT_NAME` / `IMPORT_COMPLETE_EVENT` / `IMPORT_FAILED_EVENT` / `IMPORT_CANCELLED_EVENT` from `@/architecture/events`
- Produces: `listenProgress(callback)` 真正订阅 Tauri event；`unlistenProgress()` 取消订阅

- [ ] **Step 1: 替换 progress-listener.ts 内容**

```ts
// src/pipeline/progress-listener.ts
import type { ProgressPayload } from '@/architecture/events'
import { PROGRESS_EVENT_NAME } from '@/architecture/events'

export type ProgressCallback = (payload: ProgressPayload) => void

let unlistenFn: (() => void) | null = null

export async function listenProgress(callback: ProgressCallback): Promise<void> {
  try {
    const { isTauri } = await import('@/lib/tauri-env')
    if (!isTauri()) return

    const { listen } = await import('@tauri-apps/api/event')
    const unlisten = await listen<ProgressPayload>(PROGRESS_EVENT_NAME, (event) => {
      callback(event.payload)
    })
    unlistenFn = unlisten
  } catch {
    // 非 Tauri 环境静默忽略
  }
}

export function unlistenProgress(): void {
  if (unlistenFn) {
    unlistenFn()
    unlistenFn = null
  }
}
```

注意：函数签名从同步变为 `async`。现有 harness（M21-T09）只测 `typeof listenProgress === 'function'`，async function 的 typeof 也是 `'function'`，所以不会破坏。

- [ ] **Step 2: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 运行前端测试验证无回归**

Run: `npm test`
Expected: 304 passed

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/progress-listener.ts
git commit -m "feat: implement progress-listener with real Tauri listen"
```

---

### Task 2: VideoListPage 补 thumbnail 调用

**Files:**
- Modify: `src/pages/VideoListPage.tsx`

**Interfaces:**
- Consumes: `tauriInvoke` from `@/lib/tauri-env`
- Produces: 本地导入时自动调用 `generate_thumbnail`，成功则设置 `video.thumbnail`

- [ ] **Step 1: 在 handleLocalImport 中 probe 成功后加 thumbnail 调用**

在 `src/pages/VideoListPage.tsx` 的 `handleLocalImport` 函数中，找到 `const info = await tauriInvoke<...>('probe_video_info', ...)` 之后、`const video: Video = {` 之前，插入：

```ts
      // 生成缩略图
      let thumbnailPath = ''
      try {
        const videoId = `v_${Date.now()}`
        const thumbOutput = filePath.replace(/\.[^.]+$/, '_thumb.jpg')
        thumbnailPath = await tauriInvoke<string>(
          'generate_thumbnail',
          { filePath, outputPath: thumbOutput, timestamp: 1.0 },
        )
      } catch (err) {
        console.warn('[VideoListPage] 缩略图生成失败，继续导入', err)
      }
```

然后把下面 `const video: Video = { ... }` 里的 `thumbnail: info.thumbnail` 改为 `thumbnail: thumbnailPath || info.thumbnail`。

同时把 `id: \`v_${Date.now()}\`` 改为用上面已生成的 `videoId`（避免两次 `Date.now()` 得到不同值）。

完整修改后的 handleLocalImport probe 到 insertVideo 段：

```ts
      const info = await tauriInvoke<{ title: string; duration: number; thumbnail: string }>(
        'probe_video_info',
        { filePath, sourceUrl: null },
      )

      // 生成缩略图
      const videoId = `v_${Date.now()}`
      let thumbnailPath = ''
      try {
        const thumbOutput = filePath.replace(/\.[^.]+$/, '_thumb.jpg')
        thumbnailPath = await tauriInvoke<string>(
          'generate_thumbnail',
          { filePath, outputPath: thumbOutput, timestamp: 1.0 },
        )
      } catch (err) {
        console.warn('[VideoListPage] 缩略图生成失败，继续导入', err)
      }

      if (!db) return
      const video: Video = {
        id: videoId,
        title: info.title,
        source: 'local',
        filePath,
        thumbnail: thumbnailPath || info.thumbnail,
        duration: info.duration,
        language: '',
        status: 'pending',
        createdAt: Date.now(),
        position: 0,
        lastStudiedAt: Date.now(),
      }
```

- [ ] **Step 2: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 运行前端测试验证无回归**

Run: `npm test`
Expected: 304 passed

- [ ] **Step 4: Commit**

```bash
git add src/pages/VideoListPage.tsx
git commit -m "feat: call generate_thumbnail on local video import"
```

---

### Task 3: 生成测试固件 + Cargo.toml 配置 + E2E 测试

**Files:**
- Create: `test-fixtures/sample.mp4`（ffmpeg 生成）
- Modify: `src-tauri/Cargo.toml`（加 test feature）
- Create: `src-tauri/tests/e2e_pipeline_harness.rs`

**Interfaces:**
- Consumes: `rain_lib::ffmpeg::probe_duration`, `rain_lib::ffmpeg::extract_thumbnail`, `rain_lib::commands::probe_video_info`, `rain_lib::commands::generate_thumbnail`
- Produces: 5 个 E2E 测试用例（E01-E05），1 个 ignored（E06）

- [ ] **Step 1: 用 ffmpeg 生成 2 秒测试视频**

Run:
```bash
mkdir test-fixtures
ffmpeg -y -f lavfi -i "color=c=black:s=320x240:d=2:r=25" -f lavfi -i "anullsrc=r=16000:cl=mono" -t 2 -c:v libx264 -preset ultrafast -c:a aac -b:a 32k test-fixtures/sample.mp4
```
Expected: `test-fixtures/sample.mp4` 存在且可用 ffprobe 探测

验证：
```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 test-fixtures/sample.mp4
```
Expected: 输出约 `2.0`（1.9~2.1）

- [ ] **Step 2: 修改 Cargo.toml 加 test feature**

在 `src-tauri/Cargo.toml` 的 `[dev-dependencies]` 段加一行：

```toml
[dev-dependencies]
tokio-test = "0.4"
tauri = { version = "2", features = ["test"] }
```

- [ ] **Step 3: 验证 cargo check 通过**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: Finished

- [ ] **Step 4: 创建 e2e_pipeline_harness.rs**

```rust
// src-tauri/tests/e2e_pipeline_harness.rs
// ========================================
// E2E Pipeline Harness: 完整 Tauri 集成测试
// probe → thumbnail → (whisper 可选)
// ========================================

use rain_lib::ffmpeg;
use std::path::Path;

fn fixture_path() -> String {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let path = Path::new(manifest_dir)
        .parent()
        .unwrap()
        .join("test-fixtures")
        .join("sample.mp4");
    path.to_string_lossy().to_string()
}

fn temp_thumbnail_path() -> String {
    let dir = std::env::temp_dir().join("rain_e2e_test");
    std::fs::create_dir_all(&dir).ok();
    dir.join("thumb_test.jpg").to_string_lossy().to_string()
}

// ===== E01: probe 探测 sample.mp4 时长 =====

#[test]
fn e01_probe_sample_video_duration() {
    let path = fixture_path();
    if !Path::new(&path).exists() {
        eprintln!("SKIP: test-fixtures/sample.mp4 not found");
        return;
    }
    let duration = ffmpeg::probe_duration(&path).expect("probe_duration failed");
    assert!(
        duration >= 1.5 && duration <= 2.5,
        "Expected duration ~2s, got {}",
        duration
    );
}

// ===== E02: probe 返回后可用文件名作标题 =====

#[test]
fn e02_probe_file_stem_as_title() {
    let path = fixture_path();
    if !Path::new(&path).exists() {
        eprintln!("SKIP: test-fixtures/sample.mp4 not found");
        return;
    }
    let stem = Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown");
    assert_eq!(stem, "sample");
}

// ===== E03: thumbnail 生成成功 =====

#[test]
fn e03_generate_thumbnail_creates_file() {
    let video_path = fixture_path();
    if !Path::new(&video_path).exists() {
        eprintln!("SKIP: test-fixtures/sample.mp4 not found");
        return;
    }
    let thumb_path = temp_thumbnail_path();
    // 清理旧文件
    let _ = std::fs::remove_file(&thumb_path);

    let result = ffmpeg::extract_thumbnail(&video_path, &thumb_path, 1.0);
    assert!(result.is_ok(), "extract_thumbnail failed: {:?}", result.err());

    let meta = std::fs::metadata(&thumb_path);
    assert!(meta.is_ok(), "thumbnail file does not exist");
    assert!(meta.unwrap().len() > 0, "thumbnail file is empty");

    // 清理
    let _ = std::fs::remove_file(&thumb_path);
}

// ===== E04: probe 不存在的文件返回错误 =====

#[test]
fn e04_probe_nonexistent_file_returns_error() {
    let result = ffmpeg::probe_duration("/nonexistent/path/video.mp4");
    assert!(result.is_err());
}

// ===== E05: thumbnail 不存在的文件返回错误 =====

#[test]
fn e05_thumbnail_nonexistent_file_returns_error() {
    let result = ffmpeg::extract_thumbnail(
        "/nonexistent/path/video.mp4",
        "/tmp/out.jpg",
        1.0,
    );
    assert!(result.is_err());
}

// ===== E06: whisper transcribe（有模型时） =====

#[test]
#[ignore]
fn e06_whisper_transcribe_with_model() {
    // 此测试需要本地有 whisper tiny 模型
    // 运行方式：cargo test --manifest-path src-tauri/Cargo.toml e06 -- --ignored
    let video_path = fixture_path();
    if !Path::new(&video_path).exists() {
        eprintln!("SKIP: test-fixtures/sample.mp4 not found");
        return;
    }

    // 查找 whisper tiny 模型
    let model_candidates = [
        "whisper-models/ggml-tiny.bin",
        "../whisper-models/ggml-tiny.bin",
    ];
    let model_path = model_candidates
        .iter()
        .find(|p| Path::new(p).exists());

    let model_path = match model_path {
        Some(p) => p.to_string(),
        None => {
            eprintln!("SKIP: whisper tiny model not found");
            return;
        }
    };

    let result = rain_lib::whisper::transcribe(&model_path, &video_path, true);
    assert!(result.is_ok(), "transcribe failed: {:?}", result.err());
    // 2 秒静音视频，segments 可能为空也可能有空白 segment，不断言内容
}
```

- [ ] **Step 5: 运行 E2E 测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml e2e_pipeline`
Expected: 5 passed, 1 ignored (e06)

- [ ] **Step 6: 运行全量 Rust 测试确认无回归**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 45 passed, 1 ignored

- [ ] **Step 7: Commit**

```bash
git add test-fixtures/sample.mp4 src-tauri/Cargo.toml src-tauri/tests/e2e_pipeline_harness.rs
git commit -m "test: add E2E pipeline harness with sample.mp4 fixture"
```

---

### Task 4: 全量验证

**Files:** 无

- [ ] **Step 1: 前端测试**

Run: `npm test`
Expected: 304 passed

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Rust 测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 45 passed, 1 ignored

- [ ] **Step 4: 确认已有 harness/tests 未被修改**

Run: `git diff HEAD~4 HEAD --name-only -- harness/ src-tauri/tests/`
Expected: 只显示 `src-tauri/tests/e2e_pipeline_harness.rs`（新增），无修改
