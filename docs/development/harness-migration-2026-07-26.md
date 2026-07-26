# Rain Harness Migration - 2026-07-26

> 状态：Active
> 授权：用户于 2026-07-26 明确批准修改锁定 Harness。
> 目的：让发布门禁约束当前 AC 和真实公开接口，而不是历史实现草图。

## 1. 迁移规则

Harness 仍然默认锁定。只有用户明确批准迁移后，才允许按以下顺序修改：

1. 找到旧断言对应的 Active AC；没有 AC 的行为标记为 `Future` 或 `Proposed`。
2. 证明旧测试为何不能在实现失效时可靠报警。
3. 先建立调用真实公开接口的替代测试。
4. 替代测试通过后，退役旧断言及其测试专用影子模块。
5. 运行相关测试、完整测试和构建，并更新覆盖矩阵和 `PROJECT_STATE.md`。

功能实现者不得仅因为新代码未通过就降低 AC。迁移改变的是错误或过时的裁判，不是静默改变产品语义。

## 2. 本轮替代关系

| 旧 Harness 问题 | 新裁判 | 对应 AC |
| --- | --- | --- |
| M20 检查手写 `TAURI_COMMANDS`，且“仅包含”只用了 `toContain` | 解析真实 `src-tauri/src/lib.rs` 的 `generate_handler!` 并比较精确集合 | 架构边界 |
| M20 检查 `module-registry` / `store-contract` 常量 | 扫描真实 LLM/SQL 依赖；读取真实 Zustand state 和 actions | 架构边界 |
| M03/M21 修改内存 job 对象并断言自己的赋值 | `VideoImportController` + 内存数据库 + Pipeline/桌面适配器替身 | AC-LV-02/03/06/07/10 |
| M04 检查旧 `stage2-validate` schema | 当前 `stage2-contract` 的精确 schema、树和句子覆盖 | AC-LV-05 |
| M18 检查旧分块 helper 和硬编码 `canSkipMerge()` | 当前 `buildStage2Blocks` / `runStage2Stage` 的分块、重试和确定性合并 | AC-LV-05 |
| M05/M06/M07 点击后只检查元素仍存在 | 检查回调参数、Zustand 状态、媒体 `src/currentTime` 和进度符号 | UI 行为 |
| M08 使用模块级笔记缓存 | 真实数据库 `insertNote/getNotesByVideoId` | 摘注持久化 |
| M10 强制暴露未实现的“解释画面” | 只暴露已实现文本操作；Vision 等待独立 AC 和完整链路 | AC-LV-12 |
| M19 文本助手强制 `supportsVision` | 所有 LLM 可承担文本助手；Vision 能力另行校验 | AC-LV-12 |
| M21 progress 只检查函数存在 | 模拟真实 Tauri event，检查订阅、转发和释放 | AC-LV-10 |
| Rust `let _ = function`、恒真表达式 | 调度串行化、按视频取消、payload 序列化、非法输入和错误上下文 | AC-LV-03/07/10 |
| E2E fixture 缺失时静默返回成功 | 缺少必需 `sample.mp4` 时明确失败 | 媒体集成 |
| M02 树编辑、Note 工厂和文本拼接只被 Harness 调用 | 高级编辑标记为 Proposed；Stage2 契约和数据库测试分别托管结构与笔记持久化 | AC-LV-05 / Proposed |
| M02 类型测试手工造对象再检查字段 | 只保留生产枚举契约；实体行为由数据库、Pipeline 和组件测试负责 | 数据模型边界 |
| M13 检查未被应用导入的 TS 令牌复制品 | 装载真实 `src/index.css` 后通过 CSSOM 检查变量 | 视觉边界 |
| `TextZone` 从测试 Context 读取语言 | `loadVideo` 写入生产 store，组件直接读取 `currentVideoLanguage` | 学习页行为 |
| 字幕/API/旧 Whisper 标准化只被 Rust Harness 调用 | 只保留当前本地 Whisper command 路径及其失败关闭测试 | AC-LV-03 |
| 空 `start_import`、自制 `convert_file_src` 和未使用 `callMerge` | 从公开接口和 Harness 精确清单中退役 | 架构边界 / AC-LV-05 |

## 3. 已退役影子模块

- `src/architecture/commands.ts`
- `src/architecture/module-registry.ts`
- `src/architecture/store-contract.ts`
- `src/architecture/ytdlp-check.ts`
- `src/pipeline/import-manager.ts`
- `src/pipeline/stage2-validate.ts`
- `src/ui/video.ts`
- `src/ui/notes.ts`
- `src/models/factories.ts`
- `src/models/text-utils.ts`
- `src/models/tree-ops.ts`
- `src/models/validators.ts`
- `src/ui/design-tokens.ts`
- `src/store/test-provider.tsx`（替代测试辅助位于 `harness/support/`）
- `src-tauri/src/asr.rs`
- `harness/m06-video.test.ts`
- `harness/m02-tree.test.ts`
- `harness/m02-tree-ops.test.ts`
- `harness/m02-text.test.ts`
- `harness/m02-notes.test.ts`

`src/pipeline/long-video.ts` 只保留当前 `stage2-runner` 使用的 token 估算，不再保留旧分块、摘要和跳过合并接口。
`src/pipeline/language-detection.ts` 只负责从已验证句子判断语言，不再声称提供字幕/API/Whisper 标准化。

## 4. 明确不作为当前门禁

- 在线 URL 下载和完整处理链路：尚未进入已验收范围；只保留 Rust 边界的非法输入和状态信息测试。
- 高级树编辑：没有 Active AC，未完成控件已隐藏；重新实现时必须贯通 UI、数据库和行为测试。
- “解释当前画面”：尚无截图、图像发送和 Vision 能力验证的完整链路。
- 任意模型自动成为 `Verified`：AC-LV-12 的统一能力状态仍待实现。

## 5. 验证

本轮完成的定向验证：

- 新 M03/M20/M21 导入和架构 Harness：通过。
- M04/M18 Stage2 Harness 及现有 `stage2-runner.test.ts`：通过。
- M05/M06/M07、M08、M10、M19、Store 和 progress Harness：通过。
- Rust commands/e2e/ffmpeg/whisper/yt-dlp Harness：通过，真实 Whisper 模型测试保持显式 `ignored`。

完整验证：

```powershell
npm.cmd test
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
npm.cmd run build
npm.cmd audit --json
git diff --check
```

结果：

- Vitest：47 个测试文件通过，328 条测试通过，1 条真实 Qwen 测试按设计跳过。
- Rust：71 条测试通过，1 条真实 Whisper 模型测试按设计忽略；删除的数量来自退役影子能力，不是覆盖倒退。
- TypeScript + Vite build：通过；仅保留原有动态/静态 import chunking 警告。
- npm audit：0 个已知漏洞。迁移加入 `@types/node` 供 M20 源码扫描编译，并把受影响的 PostCSS 锁文件版本升级到 8.5.23。
- `git diff --check`：通过；仅显示 Windows 工作区已有的 LF/CRLF 提示。

本轮没有重跑真实视频 E2E。当前本地 Whisper、Stage2 和导入控制器主链路未改变；学习页语言缓存得到修复，未实现编辑控件被隐藏。现有已提交证据仍是最近一次真实运行证明。
