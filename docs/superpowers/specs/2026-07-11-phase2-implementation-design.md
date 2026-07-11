# Rain 阶段二：实现补齐 + 端到端测试 设计规格

> 日期：2026-07-11
> 范围：阶段二（填充空壳实现 + Tauri E2E 集成测试）
> 前置：阶段一已完成 304/304 harness 全绿

## 决策记录

| 维度 | 决策 |
|------|------|
| start_import Rust 侧 | 保持空壳（设计意图：前端编排） |
| E2E 方式 | 完整 Tauri 集成测试（mock_builder + mock_context） |
| 固件 | ffmpeg 生成 2 秒静音小视频，whisper 缺模型时 skip |

## 约束

- `harness/` 已有文件不修改，`src-tauri/tests/` 已有文件不修改
- `npm test` 保持 304/304
- `cargo test` 现有 40 测试保持全绿，新增 E2E 测试额外通过
- `npx tsc --noEmit` 0 错误

---

## 改动清单

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/pipeline/progress-listener.ts` | 空函数 → 真正调用 Tauri `listen()` / `unlisten()` |
| `src/pages/VideoListPage.tsx` | `handleLocalImport` 中 probe 成功后调 `generate_thumbnail` |
| `src-tauri/Cargo.toml` | `[dev-dependencies]` 加 `tauri = { version = "2", features = ["test"] }` |

### 新增文件

| 文件 | 作用 |
|------|------|
| `test-fixtures/sample.mp4` | ffmpeg 生成的 2 秒静音视频（~20KB） |
| `src-tauri/tests/e2e_pipeline_harness.rs` | Tauri 集成 E2E 测试 |

---

## 实现明细

### 1. progress-listener.ts 真实实现

当前：空函数。

改为：
- `listenProgress`：检测 `isTauri()`，是则调 `@tauri-apps/api/event` 的 `listen(PROGRESS_EVENT_NAME, callback)`，保存返回的 unlisten 函数
- `unlistenProgress`：调用保存的 unlisten 函数
- 非 Tauri 环境（浏览器/jsdom）：静默忽略，不报错

### 2. VideoListPage 补 thumbnail 调用

在 `handleLocalImport` 中，`probe_video_info` 成功后、`insertVideo` 之前：
- 调 `tauriInvoke('generate_thumbnail', { filePath, outputPath, timestamp: 1.0 })`
- `outputPath` = filePath 同目录下的 `<videoId>_thumb.jpg`
- 成功则 `video.thumbnail = outputPath`
- 失败不阻塞（thumbnail 是可选的），只 console.warn

### 3. 测试固件 sample.mp4

用 ffmpeg 生成：
```
ffmpeg -f lavfi -i color=c=black:s=320x240:d=2 -f lavfi -i anullsrc=r=16000 -shortest -c:v libx264 -c:a aac test-fixtures/sample.mp4
```
约 20KB，2 秒静音黑屏。足够让 ffprobe 探测时长、ffmpeg 抽帧。

### 4. E2E Tauri 集成测试

`src-tauri/tests/e2e_pipeline_harness.rs`：

用 `tauri::test::mock_builder()` 构建 mock 应用，注册 `probe_video_info` 和 `generate_thumbnail` command。

测试用例：

| 编号 | 测试名 | 断言 |
|------|--------|------|
| E01 | probe 探测 sample.mp4 时长 | duration 在 1.5~2.5 秒之间 |
| E02 | probe 返回标题为文件名 | title == "sample" |
| E03 | thumbnail 生成成功 | 输出文件存在且 > 0 字节 |
| E04 | probe 不存在的文件返回错误 | 返回 Err |
| E05 | thumbnail 不存在的文件返回错误 | 返回 Err |
| E06 | whisper transcribe（有模型时） | 返回 segments 不为空；无模型时 #[ignore] skip |

E01-E05 用 ffmpeg/ffprobe 跑真实小视频（不需要 whisper）。
E06 标 `#[ignore]`，只在本地有 whisper tiny 模型时手动跑。

---

## 不做的事

- 不改 Rust `start_import`（设计意图就是空壳）
- 不改已有 harness/tests 文件
- 不改 design-tokens.ts
- 不做 URL 导入的 thumbnail（依赖 yt-dlp 下载后才有本地文件）

---

## 预期结果

| 指标 | 当前 | 完成后 |
|------|------|--------|
| npm test | 304 | 304（不变） |
| tsc --noEmit | 0 | 0（不变） |
| cargo test | 40 | 40 + 5 新增 = 45（E06 ignore 不计） |
| progress-listener | 空壳 | 真实实现 |
| thumbnail 调用 | 从未调用 | 本地导入时自动调用 |
