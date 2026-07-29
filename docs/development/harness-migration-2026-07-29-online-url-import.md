# Rain Harness Migration - 2026-07-29 Online URL Import

> 状态：Active
> 授权：用户于 2026-07-29 明确批准本次锁定 Harness 修改。
> 对应 AC：`AC-LV-17`
> 目的：让桌面在线媒体探测与下载通过一个受控的深 command 进入已批准的 Tauri 边界。

## 1. 旧合同与真实 RED

锁定的 `harness/m20-boundaries.test.ts` 当前要求 `generate_handler!` 只能注册 17 个既有 command，其中 `probe_video_info` 只负责元数据探测，没有任何 command 能拥有在线媒体的长时下载、进度、取消、临时目录清理和最终本地文件提交。

在不修改锁定 Harness 的情况下实现 `AC-LV-17` 后，完整 `npm run harness:check` 按预期失败在 M20-T01：最初实现暴露了两个新 command；其余 452 条前端测试通过，live-key 测试按显式环境门禁跳过。随后把接口收敛为一个 `import_online_video`，定向 M20 复跑仍只因这一个未批准 command 而失败，另外 8 条边界断言通过。这个 RED 证明当前 Harness 正在阻止未经批准的桌面能力扩张，而不是实现错误或测试波动。

把下载偷偷塞进既有 `probe_video_info` 会改变该 command 的既有语义并绕过 allowlist 审查，因此不作为替代方案。最初的两个新 command 已在提交前收敛为一个深接口，避免把元数据探测和下载暴露成可被页面任意重组的浅步骤。

## 2. 提议的新合同

唯一新增的 Tauri command：

```text
import_online_video(videoId, sourceUrl)
  -> { title, duration, thumbnail, filePath }
```

该 command 在同一个 `ImportScheduler` lease 内顺序执行受控元数据探测和下载：

- 只接受绝对 HTTP(S) URL 和安全的 Video ID；
- 通过既有 `progress` event 发布 `download` 进度；
- 既有 `cancel_import(videoId)` 可取消探测或下载并终止对应子进程；
- 下载只写入应用数据目录的唯一临时目录，成功后目录级提交；
- 失败或取消清理临时输出，外部错误不回显完整源 URL；
- 只返回已提交的最终本地媒体路径，不启动 ASR、不调用模型。

前端 `VideoImportController.importUrl` 在调用 command 前先持久化唯一 `processing/download` 记录，成功返回后先附着元数据和最终 `filePath`，再复用现有 Pipeline。页面不直接调用该 command。

## 3. 替代裁判与 Owner

| 层级 | Owner / Judge | 负责发现的问题 |
| --- | --- | --- |
| Tauri 注册边界 | `harness/m20-boundaries.test.ts` | `generate_handler!` 包含且仅包含既有批准集合加 `import_online_video`，不引入第二个在线下载 command 或 LLM command |
| 前端公开入口 | `src/pipeline/video-import-controller.ts` / `src/__tests__/video-import-url.test.ts` | 外部进程前先有唯一记录；进度、取消、失败关闭、URL 脱敏、最终文件附着、Pipeline 前置门禁和同记录重试 |
| Rust 进程与文件边界 | `src-tauri/src/ytdlp.rs` / `src-tauri/src/ytdlp_tests.rs` | 真实受控子进程的元数据解析、进度、运行中取消、部分文件拒绝、临时目录清理、最终提交和幂等复用 |
| 薄 Tauri adapter | `src-tauri/src/commands.rs` | 只解析应用数据目录和 State，所有行为委托给 `ytdlp` module |

## 4. 请求修改的锁定文件

批准后只修改一个锁定文件：

- `harness/m20-boundaries.test.ts`：在 `expectedCommands` 中加入 `import_online_video`。

不修改或降低其他断言，不修改 `src-tauri/tests/`，不删除旧 command，不放宽为模式匹配，也不把任意未来 command 自动加入批准集合。

## 5. 退役路径与边界外

页面中旧的“探测 URL 后直接创建 pending Video 并启动 Pipeline”路径已退役。最初实现过的 `probe_online_video` / `download_online_video` 两个浅 command 已在迁移前合并并删除，不进入最终注册表。

本迁移不签发真实站点兼容性、登录态、播放列表、字幕优先、多小时/GB 级下载或完整外网 Evidence；这些仍是独立 Gap。迁移也不授权修改其他锁定 Harness。

## 6. 批准后的验证顺序

1. 只给 M20 allowlist 增加 `import_online_video`，先运行 `npx vitest run harness/m20-boundaries.test.ts`；
2. 运行 `src/__tests__/video-import-url.test.ts` 和 Rust `ytdlp::tests`；
3. 运行 `npm run harness:control`、`git diff --check`；
4. 运行完整 `npm run harness:check`；
5. 更新 `docs/PROJECT_STATE.md`，独立提交本边界；
6. 经受保护 PR 和 `Clean Windows Harness` 后才合并。

验证结果：用户明确批准后，锁定 M20 只在精确 `expectedCommands` 中增加了 `import_online_video`，没有修改其他断言或锁定文件。定向 M20 与 URL Controller 共 24 条测试通过，Rust `ytdlp` 8 条生产 seam/真实子进程测试通过。完整 `npm run harness:check` 随后通过：79 个前端文件 / 460 条测试通过，1 条 live-key 测试按显式环境门禁跳过；E2E 和普通生产构建的自动化标记隔离均通过；Rust 共 106 条测试通过，1 条真实 Whisper 模型测试按既有合同忽略。全程未访问真实视频站点、读取 API Key、调用模型或生成 Evidence。
