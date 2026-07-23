# Rain 项目剩余落地实现计划

> **历史计划/施工图（非当前项目状态）**
>
> 本文是早期落地实施计划，不是当前“剩余工作”清单。不要根据本文里的未勾选 checkbox、测试数量、占位说明或文件创建清单来判断 Rain 当前状态。当前真相以 `docs/PROJECT_STATE.md`、当前代码、验证脚本和已提交 evidence 为准。

> 目标：把 Rain 从"通过全部 harness 的可测试代码库"变成"可启动的 Vite + Tauri 桌面应用"。
> 约束：所有现有测试 (npm test 281 + cargo test 29 + tsc 0) 必须保持全绿；harness/ 与 src-tauri/tests/ 禁止修改。

## Global Constraints

- **测试不回归**：每次 task 完成后 `npm test` 必须 281/281，`npx tsc --noEmit` 必须 0 错误，`cargo test --manifest-path src-tauri/Cargo.toml` 必须 29/29。
- **harness 锁定**：`harness/` 与 `src-tauri/tests/` 目录禁止任何修改（PR diff 出现即拒绝）。
- **路径别名**：`@/*` → `./src/*`，已在 `tsconfig.json` 和 `vitest.config.ts` 配好，新文件沿用。
- **Tauri 编译环境**：cargo 命令需要 `LIBCLANG_PATH=C:\Program Files\LLVM\bin`、`CMAKE_CXX_FLAGS=/utf-8`、`CMAKE_C_FLAGS=/utf-8`、PATH 含 `C:\Program Files\LLVM\bin;C:\Program Files\CMake\bin`。
- **设计令牌**：M13 视觉令牌已在 `src/ui/design-tokens.ts`（PARAGRAPH_COLORS/SPACING_SCALE/FONT_SIZES/BORDER_RADIUS_SCALE/ANIMATION_DURATIONS），CSS 必须引用这些值或与其一致。
- **Zustand store**：`src/store/rain-store.ts` 的 `useRainStore` 是唯一真相源，新页面/组件必须订阅它而非自建状态。
- **Tauri command 列表**：`src/architecture/commands.ts` 的 `TAURI_COMMANDS` 是契约，Rust 侧 `src-tauri/src/lib.rs` 的 `generate_handler!` 必须与之对齐（已对齐 8 个）。
- **LLM 前端直连**（决策92）：Stage2/合并/AI 助手的 LLM 调用全部在 React 侧用 fetch/OpenAI 兼容 SDK，不经 Rust IPC。
- **SQLite 前端直连**（决策93）：用 `tauri-plugin-sql`，Zustand action 里直接 exec SQL；测试环境（jsdom）走内存 fallback。

## Task 1: Vite 入口骨架

创建可启动的 Vite 应用入口，让 `npm run dev` 能跑起来（即使页面是空壳）。

**要创建的文件：**
- `vite.config.ts` — Vite 配置：React 插件、`@` 别名、Tauri 集成（base='./'、clearScreen:false、server.strictPort:true、HMR 端口 1420）。引用 `@vitejs/plugin-react`。
- `index.html` — Vite 入口 HTML，`<div id="root">`，引用 `/src/main.tsx`，`<title>Rain</title>`，lang="zh-CN"。
- `src/main.tsx` — React 入口：`createRoot(document.getElementById('root')!).render(<App />)`，导入 `./index.css`。
- `src/App.tsx` — App 骨架组件：根据 `useRainStore` 的 `currentVideoId` 切换两个页面 — `null` 时渲染 `<VideoListPage />`，否则渲染 `<StudyInterface />`。这两个组件先做最小占位实现（各自 export 一个返回 `<div data-testid>` 的函数组件），真实实现在 Task 5。
- `src/index.css` — 最小全局样式（Task 2 会扩展）：CSS 变量从 design-tokens 派生 + body reset + `#root` 全高。

**验收：**
- `npm run dev` 能启动（不报错退出）。
- `npm run build` 能构建（`tsc && vite build`，注意 package.json 已有 build script）。
- `npm test` 仍 281/281。
- `npx tsc --noEmit` 0 错误。
- App.tsx 用 `useRainStore` 读 `currentVideoId` 做条件渲染。

**不要做：**
- 不要写 VideoListPage/StudyInterface 的真实内容（Task 5）。
- 不要加路由库（react-router 等）——用 store 的 currentVideoId 做条件渲染即可。
- 不要改 harness/ 或 src-tauri/tests/。

## Task 2: CSS / 设计令牌集成

把 `src/ui/design-tokens.ts` 的令牌映射到 CSS 变量，建立暗色主题基础，让组件能消费真实样式。

**要创建/修改的文件：**
- 修改 `src/index.css`（Task 1 创建的最小版本）— 扩展为完整设计系统：
  - `:root` 里定义 CSS 变量：`--spacing-*`（4/8/12/16/20/24/32/48）、`--font-size-*`（18/16/14/13/12）、`--radius-*`（0/4/8/12/9999）、`--anim-*`（120/200/320ms）、`--color-bg`/`--color-fg`/`--color-surface` 等暗色主题中性色、`--color-concept`/`--color-example`/`--color-analogy`/`--color-transition`（与 PARAGRAPH_COLORS 一致的色值）。
  - body/`#root` 全高、暗色背景、系统无衬线字体族（决策73）、等宽数字特性（`font-variant-numeric: tabular-nums`）。
  - 顶栏/控制栏高度（40px/80px，决策76）。
- 不要改 `src/ui/design-tokens.ts`（它是 JS 侧的真相源，CSS 变量与之对齐即可）。

**验收：**
- `npm test` 281/281。
- `npx tsc --noEmit` 0 错误。
- CSS 变量名与 design-tokens.ts 的值一一对应（在 index.css 注释里标注对应关系）。
- 暗色主题：背景深色、文字浅色、段落四色与 PARAGRAPH_COLORS 一致。

**不要做：**
- 不要引入 Tailwind / CSS-in-JS 库（YAGNI，CSS 变量够用）。
- 不要改 design-tokens.ts。
- 不要改任何组件文件（组件样式在 Task 5 页面组装时处理）。

## Task 3: SQLite 实运行（tauri-plugin-sql + jsdom fallback）

把 `src/models/database.ts` 从纯内存 Map 改为：Tauri 环境用 `tauri-plugin-sql`，测试/开发环境（jsdom）走内存 fallback。现有测试（m15 三个文件 32 测试）必须全绿。

**要修改的文件：**
- `src/models/database.ts` — 重构：
  - 保留现有 `Database` 接口和所有导出函数签名不变（harness 依赖这些签名）。
  - `createDatabase(path)` 内部检测 Tauri 环境（`'__TAURI_INTERNALS__' in window`）：是 → 用 `@tauri-apps/plugin-sql` 的 `Database.load('sqlite:' + path)`；否 → 走现有内存 Map 实现（保留为 fallback）。
  - 内存 fallback 的 schema（6 表 + 字段）保持不变，确保 m15-schema-crud 的 `listTables`/`getTableColumns` 测试通过。
  - 所有 CRUD 函数（insertVideo/getVideoById/insertNodes/...）在两个路径下行为一致。
  - `determineRecoveryAction`/`atomicInsertSentences`/`updateVideoPosition`（单调递增）等业务逻辑保持。
- 不要改 harness 任何文件。

**验收：**
- `npm test` 281/281（重点 m15 三个文件 32 测试全绿）。
- `npx tsc --noEmit` 0 错误。
- `@tauri-apps/plugin-sql` 已在 package.json devDependencies（v2.4.0），直接 import 即可。
- 内存 fallback 仍能在 jsdom 测试环境跑通所有 m15 测试。

**不要做：**
- 不要改 `Database` 接口的公开方法签名。
- 不要在测试环境真正连 SQLite（jsdom 没 Tauri runtime）。
- 不要改 harness/。

## Task 4: LLM 前端直连（Stage2 + AI 助手 SSE 流式）

实现决策92 定的前端直连 LLM：Stage2 调用、合并调用、AI 助手流式对话，全部在 React 侧用 fetch/OpenAI 兼容协议，不经 Rust。

**要创建的文件：**
- `src/llm/client.ts` — OpenAI 兼容 HTTP client：
  - `callStage2(prompt, sentences, settings)` → 非流式 POST `/chat/completions`（model/messages/temperature/json mode），返回解析后的 JSON。
  - `callMerge(metadataContext, settings)` → 非流式，合并 LLM 只看元数据（决策28）。
  - `streamAiChat(messages, settings, { onToken, onDone, signal })` → 流式 SSE，逐 token 回调；`signal: AbortSignal` 支持取消（决策83）。
  - settings 从 `@/settings/model-pool` 的 `listModels()` + `@/models/database` 的 `getSetting('api_key.<alias>')` 读 API Key（决策84 明文存 SQLite）。
  - 不实际发起网络请求的硬编码 URL——从 settings 读 baseUrl。
- `src/llm/types.ts` — LLM 相关类型：`LlmSettings`（baseUrl/apiKey/model/temperature）、`ChatMessage`（role/content）、`Stage2PromptInput`。
- 不要改 `src/ai/assistant.ts`（它已有 `AiChatSession` 接口和快捷操作，LLM client 是它之下的传输层）。
- 不要改 `src/architecture/module-registry.ts` 的 `LLM_FUNCTIONS`（它已列出 callStage2/callMerge/streamAiChat 作为前端专属）。

**验收：**
- `npm test` 281/281。
- `npx tsc --noEmit` 0 错误。
- `streamAiChat` 用 `AbortController.signal` 支持取消（验证 `signal.aborted` 时停止处理 SSE）。
- 不引入 openai npm 包（YAGNI，fetch + SSE 解析够用；Read the SSE stream with `fetch` + `ReadableStream` reader）。

**不要做：**
- 不要在 Rust 侧加任何 LLM 代码（决策92）。
- 不要改 harness/。
- 不要写真实网络集成测试（没有 mock server）。

## Task 5: 页面组装（VideoListPage + StudyInterface + 三模式布局）

把已有组件拼装成两个真实页面，接入 Zustand store，实现 M17 视频列表页和 M16 三模式学习界面。

**要修改/创建的文件：**
- 修改 `src/App.tsx` — Task 1 的占位换成真实页面组件（按 currentVideoId 条件渲染）。
- 创建 `src/pages/VideoListPage.tsx`：
  - 用 `src/ui/components/video-list` 的 `VideoList` 组件。
  - 顶栏：排序选择器 + 搜索框 + 导入按钮。
  - 空状态引导（决策62）。
  - 点 ready 卡 → `useRainStore.loadVideo(id)` 切到学习界面。
  - 数据来源：调 `listVideos(db, sortBy)`（Task 3 的 database 模块）。
- 创建 `src/pages/StudyInterface.tsx`：
  - 用 `src/ui/components/layout-switch` 的 `LayoutSwitch` 按 `layoutMode` 渲染三模式。
  - 四区：左侧 `SideTree`、中间 `VideoZone`+`TextZone`（随播）/`TextZone`（文本展开）/`DiagramZone`+`TextZone`（目录展开）、右侧 Tab 面板（AI 助手 / 随记）。
  - 顶部目录横条 `CatalogBar`（随播/文本展开模式在，目录展开消失）。
  - 控制栏 `VideoControls`。
  - 返回按钮 → `useRainStore.unloadVideo()` 回列表。
  - 快捷键：用 `ShortcutManager` 组件包整页。
- 不要改已有组件的 data-testid（harness 依赖）。

**验收：**
- `npm test` 281/281。
- `npx tsc --noEmit` 0 错误。
- `npm run dev` 启动后：初始进 VideoListPage；点 ready 卡片切到 StudyInterface；StudyInterface 有返回按钮回列表。
- 三模式切换通过 ShortcutManager 的 1/2/3 键 + VideoControls 的按钮都能触发。

**不要做：**
- 不要加 react-router（用 store 条件渲染）。
- 不要改 harness/。
- 不要改组件的 data-testid。

## Task 6: 最终全分支审查 + commit

所有 task 完成后，跑一次全量验证 + 全分支代码审查，然后 commit。

**要做：**
- `npm test`（281/281）+ `npx tsc --noEmit`（0）+ `cargo test --manifest-path src-tauri/Cargo.toml`（29/29）。
- `git diff --name-only harness/ src-tauri/tests/` 必须为空。
- 全分支代码审查（用 requesting-code-review 技能的 reviewer 模板）。
- 修复审查发现的 Critical/Important 问题。
- commit（信息遵循现有风格：`feat: ...`）。

**验收：**
- 三项测试全绿。
- harness/ 零改动。
- 审查无未修复的 Critical/Important 问题。
- 单个 commit（不要分多个）。
