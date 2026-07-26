# Rain 模块地图

> 状态：Active
> 更新日期：2026-07-26
> 作用：规定知识和变化应该集中在哪里。这里的“接口”包括调用方式、状态约束、错误模式和副作用。

## 1. 总体依赖方向

```text
React 页面与 UI
        |
        v
应用流程模块（导入、学习、设置）
        |
        v
领域规则（状态机、结构契约、数据类型）
        |
        v
适配器（SQLite、Tauri、OpenAI-compatible LLM）
        |
        v
Rust 系统能力（文件、媒体、Whisper、任务调度）
```

上层可以通过接口使用下层能力，下层不得反过来依赖具体页面。

## 2. 当前模块分工

| 模块 | 负责 | 不负责 | 主要位置 |
| --- | --- | --- | --- |
| UI | 收集用户操作、展示状态和错误 | 编排完整导入、决定数据库事务、调用多个底层命令 | `src/pages/`、`src/ui/` |
| Video Import Controller | 创建本地视频记录，启动/重试/取消 Pipeline，归一化进度并修复失败状态 | 文件选择 UI、列表排序和卡片渲染 | `src/pipeline/video-import-controller.ts` |
| Import Pipeline | 执行 ASR -> Stage2 -> merging，处理取消、失败和恢复 | 页面布局、具体 SQL、Whisper 内部实现 | `src/pipeline/pipeline-orchestrator.ts` |
| ASR Stage | 解析模型、调用 Whisper、校验结果、原子保存 ASR | Stage2、页面提示布局 | `src/pipeline/asr-runner.ts` |
| Stage2 | 分块、调用已通过能力检查的 OpenAI-compatible LLM、校验、检查点和确定性合并 | ASR、UI、任意改写原始句子 | `src/pipeline/stage2-*.ts` |
| Import State | 定义合法状态和转换 | 数据库 I/O、UI | `src/pipeline/import-state.ts` |
| Database | schema、查询、事务和持久化转换 | 页面渲染、模型调用、任务调度 | `src/models/database.ts`、`db-singleton.ts` |
| Runtime Settings | 模型池、角色选择、预检 | 导入流程本身 | `src/settings/` |
| Settings UI | 编排设置页面并分别展示自检、模型池、添加模型和角色选择 | 定义能力裁决、直接实现模型请求、承担设置持久化规则 | `src/ui/components/settings/`；公共入口 `src/ui/components/settings.tsx` |
| Model Capability Contract | 定义配置 + 角色能力状态、记录校验、合并、配置变化失效和角色分配裁决 | 发起具体供应商请求、决定完整 E2E 是否通过 | `src/settings/model-capabilities.ts` |
| ASR Capability Probe | 定位内置短语音并复用生产 Whisper 转写模块，只有有效非空句子才能签发 `Compatible` | 写入业务 Video/Sentence、替代完整导入证据、支持尚未实现的 ASR API | `src/settings/asr-capability.ts`、`src/pipeline/asr-runner.ts` |
| Structuring Capability Probe | 为模型池动作和运行前预检发送最小 Stage2 请求，并用生产契约判断任意 OpenAI-compatible LLM 能否签发 `Compatible` | 跑完整导入、写业务节点、签发 `Verified` | `src/settings/structuring-capability.ts` |
| Assistant Capability Probe | 复用生产流式聊天接口检查文本响应、指令遵循、超时和脱敏，并签发助手角色的 `Compatible` | 证明 vision、替代学习页上下文和引用测试、签发 `Verified` | `src/settings/assistant-capability.ts` |
| LLM Adapter | OpenAI-compatible 请求、流式和错误处理 | 产品状态机、SQLite | `src/llm/` |
| Tauri Adapter | command/event 名称和前端调用封装 | 产品规则 | `src/lib/tauri-env.ts`、`src/architecture/` |
| Rust Commands | 把前端请求翻译为 Rust 模块调用 | 承载全部媒体/Whisper 实现 | `src-tauri/src/commands.rs` |
| Rust Runtime | 文件、ffmpeg、yt-dlp、Whisper、调度、取消 | React 状态和 LLM 调用 | `src-tauri/src/*.rs` |
| Evidence | 运行真实流程并证明结果 | 代替普通回归测试 | `src/e2e/`、`scripts/`、`evidence/` |
| Test Support | 为组件测试注入 Zustand 状态 | 参与生产运行、向生产组件提供 Context | `harness/support/` |

## 3. 关键接口

### 本地视频导入接口

页面理想上只需要表达：

```ts
startLocalImport(file)
retryImport(videoId)
cancelImport(videoId)
```

导入流程模块负责隐藏以下细节：

- 创建或恢复 Video；
- 加载运行设置；
- ASR、Stage2 和合并顺序；
- AbortSignal 和 Rust 取消；
- 状态持久化；
- 进度归一化；
- 错误分类。

目前 `VideoListPage.tsx` 仍直接知道其中多项细节，这是迁移中的违规点，不是新代码可以继续复制的模式。

### 数据库接口

调用方应通过有业务含义的操作访问数据库，例如：

- `transitionVideoImportState`
- `saveAsrAtomically`
- `mergeImportAtomically`

新代码不得在页面中拼 SQL 或自行管理事务。`database.ts` 当前同时包含内存实现、Tauri SQL 实现、schema、映射和大量业务操作，后续应按接口拆开，但拆分前必须保持现有调用接口和行为测试。

### Rust command 接口

`commands.rs` 只应完成：

- 参数解析和基本验证；
- 调用相应 Rust 模块；
- 把结构化结果或错误返回给前端。

媒体、Whisper、调度和持久化细节应分别留在对应 Rust 模块。新增 command 时必须同步真实 `generate_handler!`、调用适配器和协议测试，不再维护手写影子 command 清单。

## 4. 持久化和状态所有权

- SQLite 是持久业务事实源。
- Zustand 只保存 UI 会话态和当前加载缓存。
- Pipeline 决定导入状态如何前进。
- 页面只展示持久化状态和瞬时进度，不自行发明终态。
- Evidence 记录一次运行，不成为应用运行时状态。

模型能力记录是 SQLite 中的设置事实，Zustand 只缓存当前加载副本。记录不保存 API Key 明文；读取时必须按当前配置重新评估指纹，不能直接相信旧状态字符串。

新的角色分配必须经过 `decideModelRoleAssignment`，UI 禁用只是提示层，Store 是当前不可绕过的写入门禁。迁移期间已有旧分配会保留；本地视频启动时，`VideoImportController` 必须再次用启动快照中的能力记录裁决 ASR 和结构化角色，不能只相信已保存的角色 ID。`VideoListPage` 是当前唯一生产适配器，必须传入能力记录副本；`capabilities` 缺省只用于兼容尚未迁移的锁定 M03/M21 Harness，不是生产回退规则。

学习页每次启动助手请求前必须从 Store 创建模型与能力记录快照，并通过同一个 `decideModelRoleAssignment` 裁决助手角色。通过后的请求使用快照中的 OpenAI-compatible endpoint、Key 和模型名，不得再硬编码供应商；此门禁只授权文本问答，不授权 vision。

结构化探针必须复用生产 `STAGE2_BLOCK_SYSTEM_PROMPT`、`buildStage2Blocks`、输出归一化和 `validateStage2BlockOutput`。不得另建一份更宽松的测试 schema，否则探针通过不能证明生产 Stage2 可用。

真实 E2E Runner 必须经 `VideoImportController` 进入导入流程，不得直接调用 `runPipeline`。完整运行结束后必须通过生产 Store 的 `loadVideo` 打开同一隔离数据库中的视频；证据 schema v2 由 `scripts/validate-evidence.ps1` 负责裁判三角色能力、负向门禁、生产入口、取消/重试、最终落库，以及 WebDriver 采集的学习页、播放器和段落 DOM 状态。截图只能作为可视附件，不能单独证明 UI 就绪。

`ui-proof` 重放只允许复用已有 schema v2 数据库补拍 UI 与短 ASR/CUDA 运行证据，不得重签 LLM 能力或改写长流水线结果。分阶段证据必须在 manifest 中记录生成时间和来源；若事件只能从已提交的重启证据恢复，只保留事件名称并明确 `recoveredFrom`，不得伪造时间戳。

## 5. 当前热点和控制策略

| 热点 | 当前规模 | 混合的职责 | 控制策略 |
| --- | ---: | --- | --- |
| `src/ui/components/settings/` | 页面编排约 349 行；其余组件 129-251 行 | 设置 UI 已按页面、自检、模型池、表单、角色选择和共享展示资源拆分 | 保持 `settings.tsx` 仅作公共 barrel；新行为进入对应组件，领域裁决继续留在 `src/settings/` |
| `src/models/database.ts` | 约 1034 行 | 接口、两种实现、schema、映射、CRUD、事务 | 先补调用级测试，再按数据库接口拆实现 |
| `src-tauri/src/commands.rs` | 约 796 行 | command、参数处理、部分系统行为 | 保持 command 薄，行为下沉到 Rust 模块 |
| `src/pages/VideoListPage.tsx` | 约 555 行 | 列表 UI、搜索排序、文件选择；URL 导入仍在页面 | 本地导入控制已提取；后续只在 URL 功能进入验收范围时迁移 URL 流程 |

文件行数不是拆分理由；职责因为不同原因变化、需要不同测试，才是拆分理由。

## 6. 新代码规则

- 页面不得新增直接 SQL、模型 HTTP 请求或多个 Tauri command 的流程编排。
- Pipeline 不得创建 demo/default 成功数据。
- 外部依赖通过参数或小接口注入，测试与生产调用同一个公开接口。
- 不为“以后可能替换”提前增加只有一个实现的抽象。
- 新模块必须隐藏复杂性；只转发参数的浅模块不增加。
- 现有违规采用“触碰时迁移”：本次修改涉及哪一块，就把那一块移到正确模块，不做无关大重写。

## 7. 第一项受控重构结果

状态：`Completed`（2026-07-26）

已完成：

- 新建 `video-import-controller.ts`，接口为 `importLocal/start/cancel/acceptProgress`。
- 页面不再直接组合本地媒体探测、Pipeline 参数、失败状态修复和 Rust 取消。
- 数据库未准备好时导入按钮禁用，不再静默丢失用户操作。
- 新增 AC-LV-02 页面到数据库贯通测试。
- AC-LV-02、AC-LV-06、AC-LV-07、AC-LV-08、AC-LV-10 相关测试及完整前端测试保持通过。
- 当时未修改锁定 Harness；随后经用户批准的 2026-07-26 Harness Migration 已把该控制器纳入 M03/M21 的真实行为验收。

剩余工作：

- 在线 URL 导入尚未经过真实验收，相关逻辑暂时仍在页面中。
- 模型能力记录、持久化、配置变化失效、角色分配拦截、三种角色探针以及本地导入/学习页运行入口门禁已实现。`ggml-large-v3.bin` CUDA + DashScope `qwen3-omni-flash`（结构化、文本助手）已有 schema v2 Evidence；下一个模型配置仍须独立探针和完整 E2E，不得继承这个 `Verified` 结论。
- 当前缩略图输出位置仍沿用旧行为，需单独 AC 决定应用数据目录策略后再修改。

## 8. Harness Migration 结果

状态：`Completed`（2026-07-26，用户明确批准）

- M03/M21 现在调用 `VideoImportController`、真实内存数据库和桌面命令适配器。
- M04/M18 现在调用当前 `stage2-contract.ts` / `stage2-runner.ts`，不再保护旧分块和旧 schema。
- M20 解析真实 Rust command 注册并扫描真实 LLM/SQL 依赖，不再相信手写注册表。
- Store、Notes、Video 和 progress Harness 改为检查真实状态、持久化和回调副作用。
- Rust Harness 改为调度、取消、序列化、非法输入和真实 fixture 行为测试。
- M02 只保留生产模型枚举契约；树编辑、工厂、旧校验器和文本拼接影子模块已退役。
- M13 直接装载并检查 `src/index.css`，CSS 是唯一视觉令牌事实源。
- `TextZone` 从生产 store 读取当前视频语言；测试 Provider 已迁到 `harness/support/`。
- 当前 Stage2 只暴露块调用和本地确定性合并，不再暴露未使用的 `callMerge`。
- Rust command 注册只包含真实可调用边界；空 `start_import` 和自制 `convert_file_src` 已退役。
- 已删除只供旧 Harness 使用的浅模块；完整清单见 `harness-migration-2026-07-26.md`。

## 9. 设置 UI 受控拆分结果

状态：`Completed`（2026-07-26）

- `src/ui/components/settings.tsx` 从约 1185 行热点缩为 10 行公共 barrel，原有导入路径保持不变。
- 页面编排、自检、模型池、添加模型、角色选择和共享展示资源分别进入 `src/ui/components/settings/` 下的独立文件。
- 设置 UI 继续调用 `src/settings/` 中的能力契约和探针，没有复制领域规则。
- M19 和现有 `src/__tests__/settings-*.test.tsx` 继续验收相同公共组件；锁定 Harness 未修改。
- 这是行为保持重构，不改变 AC 状态，也不声称完成 `AC-LV-12`。
