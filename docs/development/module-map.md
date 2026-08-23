# Rain 模块地图

> 状态：Active
> 更新日期：2026-07-30
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
| Import Task Details | `App` 保持跨可见页面的列表/Controller Owner；`VideoListPage` 只选择当前 Video；dialog 合并 SQLite 任务事实与当前会话进度，并适配显式继续/重试/取消 | 卡片点击时启动任务、保存实时进度、重新实现 Pipeline 生命周期、扫描并自动恢复重启遗留任务 | `src/App.tsx`、`src/pages/VideoListPage.tsx`、`src/ui/components/import-task-dialog.tsx` |
| Video Import Controller | 创建本地视频记录，启动/重试/取消 Pipeline，归一化进度并修复失败状态 | 文件选择 UI、列表排序和卡片渲染 | `src/pipeline/video-import-controller.ts` |
| Import Pipeline | 执行 ASR -> Stage2 -> merging，处理取消、失败和恢复 | 页面布局、具体 SQL、Whisper 内部实现 | `src/pipeline/pipeline-orchestrator.ts` |
| ASR Stage | 解析模型、调用 Whisper、校验结果、原子保存 ASR | Stage2、页面提示布局 | `src/pipeline/asr-runner.ts` |
| Stage2 | 分块、调用已通过能力检查的 OpenAI-compatible LLM、校验、检查点和确定性合并 | ASR、UI、任意改写原始句子 | `src/pipeline/stage2-*.ts` |
| Import State | 定义合法状态和转换 | 数据库 I/O、UI | `src/pipeline/import-state.ts` |
| Database | schema、查询、事务和持久化转换 | 页面渲染、模型调用、任务调度 | `src/models/database.ts`、`db-singleton.ts` |
| Database Architecture Policy | 拒绝 SQL plugin 装载点扩散、业务层导入内部数据库 module 和前端事务控制 SQL | 证明业务结果、替代 Rust SQLite 事务测试、决定 schema 迁移 | `scripts/database-architecture-policy.mjs`；裁判 `database-architecture-policy.test.ts` |
| Runtime Settings | 构造和原子保存模型池、角色选择、能力记录快照 | 发布 UI 状态、直接实现模型请求 | `src/settings/model-pool.ts`；Store 是提交门禁 |
| Whisper Download Workflow | 建立一次下载会话、过滤生产进度事件、调用下载/取消并复核安装列表、释放 listener | 下载字节、文件完整性、持有后台任务 | `src/settings/whisper-model-download.ts` |
| Whisper Backend Selection | 根据 Runtime Settings 偏好探针并选择 CPU/CUDA adapter，分类 CUDA worker 错误、控制回退、取消和实际后端报告 | 模型池管理、ASR 结果持久化、Stage2、页面自行探测 CUDA | `src-tauri/src/whisper_backend.rs`；CUDA adapter `src-tauri/src/bin/rain-whisper-cuda.rs`；CPU adapter `src-tauri/src/whisper.rs` |
| Settings UI | 编排设置页面并分别展示自检、模型池、添加模型和角色选择；展示 Store 提交结果 | 定义能力裁决、直接实现模型请求、读取数据库或承担设置持久化规则 | `src/ui/components/settings/`；公共入口 `src/ui/components/settings.tsx` |
| Control Plane Validator | 解析 AC/覆盖结构，检查 Owner/Judge、裁判文件和当前事实冲突 | 判断产品是否真的通过、替代业务测试或修改文档 | `scripts/control-plane-validator.mjs`；命令 `npm run harness:control` |
| Study Session | 原子加载一个 ready 视频、统一播放位置、协调跳转、进度保存和学习页错误 | SQLite 细节、具体面板渲染、模型 HTTP 请求 | `src/store/rain-store.ts` 负责原子加载和成功打开时间；`src/study/session.ts` 负责把媒体进度持久化为单调递增的跨会话事实 |
| Study Navigation | 把句子、节点和可信引用解析为同一时间线跳转，保持播放状态并通知相关区域定位 | 保存笔记、调用 LLM、直接读写 SQL | `src/study/navigation.ts` 负责节点到最早叶子句子的解析；`StudyInterface` 协调 Store/media，文本区负责滚动和真实预览 |
| Notes Workflow | 创建摘注/自由笔记、编辑持久化、解析引用跳转 | 维护 React 局部草稿作为最终事实、修改目录结构 | `src/study/notes.ts` 负责数据库成功后同步 Store；`src/ui/components/notes.tsx` 只收集操作；引用复用 `src/study/navigation.ts` |
| Study Page Composition | 组合布局、媒体、目录、文本、笔记和助手模块；保持跨布局会话事实 | 重新实现各工作流规则、用条件卸载破坏媒体会话、直接读写 SQL | `src/pages/StudyInterface.tsx`；三模式只改变区域可见性，`VideoZone` 在学习页生命周期内保持同一实例 |
| Model Capability Contract | 定义配置 + 角色能力状态、记录校验、合并、配置变化失效和角色分配裁决 | 发起具体供应商请求、决定完整 E2E 是否通过 | `src/settings/model-capabilities.ts` |
| ASR Capability Probe | 定位内置短语音并复用生产 Whisper 转写模块，只有有效非空句子才能签发 `Compatible` | 写入业务 Video/Sentence、替代完整导入证据、支持尚未实现的 ASR API | `src/settings/asr-capability.ts`、`src/pipeline/asr-runner.ts` |
| Structuring Capability Probe | 为模型池动作和运行前预检发送最小 Stage2 请求，并用生产契约判断任意 OpenAI-compatible LLM 能否签发 `Compatible` | 跑完整导入、写业务节点、签发 `Verified` | `src/settings/structuring-capability.ts` |
| Assistant Capability Probe | 复用生产流式聊天接口检查文本响应、指令遵循、超时和脱敏，并签发助手角色的 `Compatible` | 证明 vision、替代学习页上下文和引用测试、签发 `Verified` | `src/settings/assistant-capability.ts` |
| LLM Adapter | OpenAI-compatible 请求、流式和错误处理 | 产品状态机、SQLite | `src/llm/` |
| Tauri Adapter | command/event 名称和前端调用封装 | 产品规则 | `src/lib/tauri-env.ts`、`src/architecture/` |
| Rust Commands | 把前端请求翻译为 Rust 模块调用并解析应用拥有的路径 | 承载 ASR 执行、转录规则或数据库事务实现 | `src-tauri/src/commands.rs` |
| ASR Execution | 校验一次 ASR 请求，持有 scheduler lease，编排临时 WAV、Whisper、进度、成功/失败/取消分类，并调用 Transcript seam | Tauri command 参数协议、转录分句规则、Pipeline 状态持久化 | `src-tauri/src/asr_execution.rs`；唯一生产入口 `execute_asr` |
| ASR Transcript | 把 `WhisperResult` 转换为经过文本、时间戳、长度和唯一 ID 校验的 `AsrSentence` | Tauri 事件、临时 WAV、取消、调度和模型生命周期 | `src-tauri/src/asr_transcript.rs`；唯一生产入口 `build_asr_transcript` |
| Whisper Model Download | 固定 manifest、流式下载、增量校验、临时文件、原子替换、每型号 lease/取消和进度上报 | React 状态、模型能力签发、视频导入调度 | `src-tauri/src/whisper_model_download.rs`；相邻直接裁判 `whisper_model_download_tests.rs`；生产入口 `download_model` / `cancel_model_download` / `list_models` |
| Rust Runtime | 文件、ffmpeg、yt-dlp、Whisper、调度、取消 | React 状态和 LLM 调用 | `src-tauri/src/*.rs` |
| Evidence | 运行真实流程并证明结果；用短桌面 E2E 检查无需外部服务的关键重启边界 | 代替普通回归测试、把短验证冒充完整模型/视频 Evidence | `src/e2e/`、`scripts/`、`evidence/` |
| Controlled GPU Artifact Build | 从后续受审查 tooling checkout 驱动标准 hosted Windows；canonical candidate 只证明精确、clean target，深 `controlled-candidate-source` module 从该 commit 导出仅 tracked 的纯 `candidate-source` child，并让每个 npm/worker/Tauri/artifact consumer 重新打开其 reservation 后使用该 child；native CUDA/LLVM/NSIS 与 CMake 交易由深 `controlled-toolchain-install` module 负责，只有完成标记后才可消费 CMake root；以 source-derived 文件名/kind 和基本 MZ/PE 形状识别 installer，在唯一 runner-TEMP 中真实静默安装，从实际 installed tree 反算布局/manifest，同时保留原 installer archive 解包 hygiene Judge 作为增量扫描；先上传 core，再把 upload digest 固化到独立 build record 和管理员 launcher | 把 tooling commit 当 candidate target、把 untracked/node_modules/target 复制进构建源码、跳过跨 step ownership Open、以解包树替代真实 installed tree 作为布局或 manifest 来源、构建本机 candidate、发布 GitHub Release、运行 GPU/model/LLM Evidence | `scripts/controlled-candidate-source.psm1`；行为裁判 `scripts/controlled-candidate-source.test.ts`；`scripts/release-artifact-generator.psm1`、`scripts/build-whisper-cuda-worker.ps1`、`scripts/controlled-toolchain-install.psm1`、`.github/workflows/controlled-gpu-artifact-build.yml` |
| Controlled TEMP Ownership | 为 hosted build 的每个可中断 runner-TEMP 目录创建精确 target/owner reservation；每目录随机 token 只交给创建调用方，marker 只保存 token SHA-256，公开 reservation 类型为 `Rain.ControlledDirectoryReservation.v2`；workflow 另生成一次 invocation cleanup authority、在日志中 mask 并仅经 `GITHUB_ENV` 传递，marker 以 HMAC 绑定 owner、精确 path 与 token hash。所有 token/authority 参数同时执行非 null/empty 参数验证与 trim 后非空验证，显式 Open/Remove 始终验证 path、owner、marker、token 与 authority；批量 `always()` 清理必须持有 authority 并验证每个 marker 的 HMAC，不能仅凭相同 owner 字符串删除。固定名称的 artifact 根不受信任：core、control 与 assembly 根均为随机 runner-TEMP direct child，先 reservation、后创建，路径及 masked token 跨 step 传递，第二次上传后由最终 `always()` sweep 聚合删除 | 推断或接管预存目录、把 token/authority 明文写入 marker/产物/record、接受空白 token、信任伪造的同-owner marker、删除 foreign/unmarked root、提供无 token 的直接删除入口、在 reservation 前创建 artifact 根、把一个 target 的清理失败当成停止其他清理的理由 | `scripts/controlled-owned-directory.psm1`；行为裁判 `scripts/controlled-owned-directory.test.ts`；toolchain 下载/CMake transaction、worker、NSIS 安装/解包根、core/control/assembly artifact 根和 workflow interruption cleanup 是消费者 |
| Controlled Native Tool Probe | 通过一个可替换 adapter 启动 native version/locator command，紧邻调用捕获完整 output 与 exit code；只有 exit zero 且输出非空时返回 normalized fact，workflow 只从这些成功 facts 构造后续路径或 toolchain record | 仅因命令打印了文本就忽略非零退出、接受 exit-zero 空白输出、让每个 workflow probe 重复实现 `$LASTEXITCODE` 规则、启动真实构建或把 probe 当 Release Evidence | `scripts/controlled-native-tool-probe.psm1`；行为裁判 `scripts/controlled-native-tool-probe.test.ts`；`.github/workflows/controlled-gpu-artifact-build.yml` 负责选择 node/npm/cargo/rustup/rustc/ninja/vswhere/cmake/nvcc/clang/makensis 路径与参数 |
| NVIDIA Release Evidence Runner | 在安装前以受控 merged-target build record 提供的独立 expected manifest hash 将候选 installer 字节和完整 release-artifact manifest 最小字段绑定到目标提交；NSIS adapter 只传 `/S` 加末位、未加引号的 raw `/D=<absolute InstallDir>`。安装后以同一 CUDA/driver DLL 分类核对主程序 PE imports 与全树、并严格双向核对 CUDA payload。取消 fixture 是在 `%TEMP%` 流式生成、固定格式/时长/大小/hash 的 180 秒 PCM WAV；创建、writer/stream 独立释放、Action 和删除错误均聚合并 fail-closed。progress callback 当时写入绝对 epoch 时间和序号，取消窗口不得由轮询读时重置。process adapter 订阅 Windows process-start event，以精确 Rain PID/path/start time、WebDriver ancestry 归属短命 worker，并在每次 window/read/complete 核对唯一 subscriber、provider token、running job 和 Rain root。Forced CPU/取消只接受本次 session 的健康事件；完成过快、时间窗超限、身份歧义、PID 复用、订阅丢失/重复/停止/失败或缺少归属事实均 fail-closed | 构建候选、修改产品行为、调用 LLM、外推未验证 GPU/驱动、替代签名/许可/生命周期 Evidence、用全局进程名、静默空事件集、轮询读时新时间戳、短 fixture 或其他 Rain 实例签发取消/CPU 进程归因 | `scripts/run-nvidia-release-evidence.ps1` 的单一 CLI external interface；深 module `scripts/nvidia-release-evidence-contract.psm1` 的 production/fake fixture/process adapter interface；行为合同 `scripts/nvidia-release-evidence.test.ts`。runner 不再固定阻断于 readiness，但本地 GREEN 仅是 enablement，必须在受审查的 merged target 候选上真实执行后才能写 Release Evidence |
| E2E Build Entry | 向 `App` 提供单一 `E2eAutomation` interface，并在构建期选择禁用或真实 adapter；完整门禁构建并裁判两种产物 | 用运行时条件把 Runner 留在普通 bundle/source map、让 E2E adapter 缺失时假绿、把自动化构建当作发布产物 | `src/e2e/entry.tsx`、`enabled-entry.tsx`、`vite.config.ts`、`build-e2e-frontend.mjs`、`verify-e2e-build-isolation.mjs`、`verify-e2e-build-isolation.test.ts` |
| Independent CI Judge | 在无开发者缓存和本机状态的 Windows checkout 中安装锁定依赖并调用唯一完整 Harness | 复制本地门禁步骤、读取 secrets、运行收费/桌面 Evidence、用 CI 特例降低 AC | `.github/workflows/harness.yml`、`package.json` |
| Hosted Desktop Judge Environment | 在人工请求时提供干净 Windows、精确匹配的 Edge WebView2 Runtime/driver 和固定或机械核对的原生工具，只在 Runtime Settings E2E 启动 context 注入 Hosted WebView2 参数，并调用现有桌面命令 | 复制产品断言、接收 secrets、把 Hosted 参数带入普通运行、自动阻塞每次合并、使用 `-SkipBuild`、生成 Evidence | `.github/workflows/runtime-settings-desktop-e2e.yml`、`src-tauri/src/e2e_config.rs`、`src-tauri/src/lib.rs`；行为 Judge 仍是 `scripts/run-runtime-settings-e2e.ps1` |
| Test Support | 为组件测试注入 Zustand 状态 | 参与生产运行、向生产组件提供 Context | `harness/support/` |

## 3. 关键接口

### 本地视频导入接口

页面理想上只需要表达：

```ts
startLocalImport(file)
retryImport(videoId)
cancelImport(videoId)
cancelAndWait(videoId)
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

新代码不得在页面中拼 SQL 或自行管理事务。`database.ts` 现在只保留稳定公共导出和两种 adapter 的构造；schema、行映射和业务操作均已按职责进入内部 module。调用方仍必须保持现有 `@/models/database` interface，不得绕过入口导入内部实现。

`AC-LV-13` 的生产删除入口由 `VideoListPage` 适配：页面只按需调用公共查询取得段落/笔记数量，通过 `VideoImportController.cancelAndWait` 的 per-Video stopping gate 阻止新任务、请求桌面取消并结算全部活动 Promise，再调用 `deleteVideoWithCascade` 并把已提交结果发布到列表；取消命令失败必须在任何删除前立即返回。Controller 的 URL 下载交接必须在媒体发布后、Pipeline 接管前再次检查取消，以释放旧 Owner；删除失败保留的记录不得因此失去重试入口。`VideoCard` 只负责单飞准备、确认、取消、进行中状态和错误展示。跨表清理与回滚仍唯一归属 `database-video-deletion.ts` 和 Rust `video_deletion`，页面与组件不得复制其规则。

`AC-LV-19` 把非 ready 卡片点击定义为无副作用的详情导航：`App` 在应用生命周期内保持 `VideoListPage` 挂载，页面只保存所选 Video ID，`ImportTaskDialog` 从页面给出的 SQLite `Video` 与可选 `ImportProgress` 渲染状态，且只把详情内显式动作回调给 Controller。`VideoImportController` 继续唯一拥有 start/retry/cancel、活动 AbortController 和实时进度接收；设置/学习页切换不得制造第二个看不见旧 Pipeline 的 Owner。Stage2 runner 是 block/attempt 的唯一生产者，经 Pipeline 可选详细回调进入 Controller；UI 不得自行猜分块或重试。实时进度结束时必须清除，不能覆盖新的持久终态。URL 下载在媒体已发布、Pipeline 尚未接管的取消竞态中，Controller 只能以精确 `pending/null` 比较交换收口自己刚发布的记录，不能覆盖其他 Owner 已推进的状态。进程重启后的静态 `processing` 可由显式取消闭合；`pending` 的自动恢复尚未归入本 AC。

`AC-LV-20` 只补充重启遗留 `pending/null` 的显式恢复：新进程加载列表和打开/关闭详情仍必须完全空闲，dialog 只为这一精确持久状态提供“继续导入”，页面把该意图转给当前应用生命周期内的现有 Controller。Controller 的同 Video ID 活动任务表负责 single-flight，Pipeline 和数据库继续更新原记录；关闭 dialog 只释放 UI 选择，不触碰 AbortController。不得把该入口扩展为启动扫描、跨进程 lease/队列或 Controller 架构迁移。

普通单记录 SQL 可以留在数据库内部 module。凡是一个业务结果需要多个记录或多张表共同提交，SQLite 路径必须经一次专用 Tauri command 进入 Rust persistence module；前端不得再发送事务控制 SQL。该全局边界由 `AC-AR-01` 和可复用的负向 policy fixture 裁判，内存 adapter 或 SQL 调用顺序不能替代 Rust 事务结果。

### Rust command 接口

`commands.rs` 只应完成：

- 参数解析和基本验证；
- 调用相应 Rust 模块；
- 把结构化结果或错误返回给前端。

`start_asr` 只能把 Tauri 参数组装为 `AsrExecutionRequest`，再调用 `execute_asr(&AppHandle, &ImportScheduler, request)`。请求门禁、scheduler lease、临时 WAV、阻塞任务、进度顺序、取消/失败/过期分类和 Whisper adapter 归 `asr_execution.rs`；其生产实现与测试 fake 必须通过同一私有 backend/reporter seam 驱动同一套编排。Whisper 结果随后只能通过 `build_asr_transcript(&WhisperResult)` 进入应用句子模型；分句、无词级时间戳回退、乱码/空文本拒绝、时间戳单调性与重叠检查、500 字符预算和句子 ID 生成归 `asr_transcript.rs`。

`download_whisper_model`、`cancel_whisper_model_download` 和 `list_whisper_models` 只能解析型号/应用模型目录并调用 `whisper_model_download.rs`。固定来源和哈希、响应分块、临时文件、最终替换、任务 lease、取消唤醒与进度事件都归该模块；设置表单不得绕过 `src/settings/whisper-model-download.ts` 自行拼接多条 Tauri 调用。

`generate_thumbnail` 只能解析 `AppHandle` 的 app-data 根目录并把 `filePath/videoId/timestamp` 交给 `thumbnail_storage.rs`。Video ID 校验、`thumbnails/` 目录、唯一临时文件、ffmpeg 提取、失败清理与原子替换都归该深 module；前端不得指定输出路径。`VideoImportController.importLocal` 通过 module 级进程分配表和数据库查重在任何文件副作用前取得唯一 Video ID，跨页面重建或多个 Controller 也不得复用仍在途的 ID；随后只持久化 command 返回的应用所有路径。生产 `VideoCard` 复用播放器的 `localMediaUrl`，不得自行拼 asset URL。

媒体、Whisper、调度和持久化细节应分别留在对应 Rust 模块。新增 command 时必须同步真实 `generate_handler!`、调用适配器和协议测试，不再维护手写影子 command 清单。

## 4. 持久化和状态所有权

- SQLite 是持久业务事实源。
- Zustand 只保存 UI 会话态和当前加载缓存。
- Pipeline 决定导入状态如何前进。
- 页面只展示持久化状态和瞬时进度，不自行发明终态。
- Evidence 记录一次运行，不成为应用运行时状态。

学习页必须先完整读取同一 Video ID 的 Video、Node、Sentence 和 Note，再一次性切换到 `study`。加载失败不得把部分缓存或空数组包装成成功页面。`playPosition` 是视频、句子高亮和目录当前位置的唯一会话事实；`isPlaying` 是视频区、控制栏和随播滚动共享的播放状态，不能再由组件维护第二份。持久化的 `Video.position` 是跨会话最远进度，与这两个瞬时会话状态语义不同。

布局状态只决定区域可见性，不拥有学习事实。生产学习页在三种布局间切换时必须保留同一个 media 实例；隐藏视频不得卸载它，否则控制栏会失去真实播放对象并重置播放状态。M16 占位组件只裁判局部布局契约，生产行为由 `study-layout.test.tsx` 裁判。

数据库的稳定公共入口、职责到 AC/裁判的映射和拆分顺序见 `docs/development/database-control.md`。schema 已由 `src/models/database-schema.ts` 统一定义，内存字段列表和 Tauri 建表 SQL 不得再维护两份。`src/models/database-adapter.ts` 是内部 adapter seam：公共 `Database` 只含两种 adapter 都真实支持的 interface，SQLite 的 `exec/query` 与内存表读写不会互相伪装。检查点编码和读写归 `src/models/database-checkpoints.ts`，Node/Sentence 普通持久化归 `src/models/database-content.ts`，Video 普通记录、列表/搜索和进度归 `src/models/database-videos.ts`，视频跨表删除归 `src/models/database-video-deletion.ts`，Settings 单 key 与批量 interface 归 `src/models/database-settings.ts`，导入状态转换和恢复判断归 `src/models/database-import-state.ts`，原子导入事务归 `src/models/database-import-atomic.ts`，Note 映射、读取与写入归 `src/models/database-notes.ts`；普通读写与原子写入共享 `src/models/database-content-rows.ts` 的 Node/Sentence 行格式。Note/reference 的真实 SQLite 创建必须通过 `insert_note_atomically` 进入 `src-tauri/src/note_persistence.rs`，Video 删除必须通过 `delete_video_atomically` 进入 `src-tauri/src/video_deletion.rs`，Runtime Settings 批量提交必须通过 `apply_settings_atomically` 进入 `src-tauri/src/settings_persistence.rs`；这些跨记录行为都不能退回多次前端 SQL-plugin 调用。业务调用方仍只从 `@/models/database` 使用有业务含义的操作，不得直接导入这些内部模块。

当前加载接口是 `loadVideo(videoId) -> LoadVideoResult`。它在 Store 内完成状态、段落和句子完整性检查，成功后一次写入当前视频缓存；页面只根据失败结果显示错误。新的调用方不得绕开该接口自行拼装学习页状态。

当前进度接口是 `recordPlaybackProgress(videoId, position)`。`VideoZone` 只上报媒体时间，`StudyInterface` 传入当前 Video ID，Study Session 再通过数据库的单调更新保存最远位置。成功的 `loadVideo` 在内容完整性检查之后更新 `lastStudiedAt`；加载失败不得伪造最近学习记录。

当前句子和可信引用都通过 `StudyInterface` 的同一个时间 seek 处理器写入 `playPosition`，`VideoZone` 负责把它同步到 media。目录节点导航通过 `resolveNodeNavigationTarget(nodes, sentences, nodeId)` 这一个 interface 隐藏容器子树遍历、最早句子选择和段落定位规则；`StudyInterface` 只协调选择、时间和一次性文本定位请求，目录区与文本区不再各自猜测容器节点的时间。

当前笔记写接口是 `createParagraphExcerpt(paragraphId)`、`createFreeNote()` 和 `saveNoteContent(noteId, content)`。它们以当前学习会话为输入事实，必须先完成数据库写入再更新 Store 缓存。整段摘注由 workflow 收集并排序该段全部句子；持久化引用通过 `resolveSentenceNavigationTarget(sentences, sentenceId)` 回到同一导航路径，Notes UI 不保存时间副本。

模型能力记录是 SQLite 中的设置事实，Zustand 只缓存当前加载副本。记录不保存 API Key 明文；读取时必须按当前配置重新评估指纹，不能直接相信旧状态字符串。

当前默认 OpenAI-compatible endpoint/model 只在 `src/settings/default-runtime.ts` 定义。设置页连接测试使用用户实际选择的 LLM 配置；`live-qwen.test.ts` 通过 `RAIN_LIVE_LLM_*` 注入同一运行时配置，没有 Key 时跳过。历史 Evidence validator 可以固定历史指纹，但不得反向充当当前运行默认值。

新的角色分配必须经过 `decideModelRoleAssignment`，UI 禁用只是提示层，Store 是当前不可绕过的写入门禁。迁移期间已有旧分配会保留；本地视频启动时，`VideoImportController` 必须再次用启动快照中的能力记录裁决 ASR 和结构化角色，不能只相信已保存的角色 ID。`VideoListPage` 是当前唯一生产适配器，必须传入能力记录副本；`capabilities` 缺省只用于兼容尚未迁移的锁定 M03/M21 Harness，不是生产回退规则。

模型添加、删除和角色分配都必须先由 Store 生成完整候选 Runtime Settings 快照，等待 `saveRuntimeSettings` 成功后再同时发布 Zustand 与模块内模型池副本。失败时两个内存副本都保持原状并把错误返回 UI。`SettingsPage` 不得另行调用数据库做第二次 hydration；唯一启动加载入口是 Store 的 `createRuntimeSettingsInitializer`。该边界由 `runtime-settings-store.test.ts`、`runtime-settings-ui.test.tsx` 和 `settings-boundary.test.ts` 裁判。

Runtime Settings 首次加载完成前不得写入。加载后，模型、角色和能力记录的全部公开写动作共享 Store 内的一条提交队列，且候选快照只能在动作获得队列执行权后从最新状态构造；成功提交递增版本，较早启动的 initialize/retry 结果因此失效。该前端顺序边界由 `AC-LV-16` 管理，SQLite 的职责仍是保证队列中每个完整快照的原子性。

`scripts/run-runtime-settings-e2e.ps1` 是该边界的短桌面 Judge。它使用 `runtime-settings` E2E 配置把生产数据库 singleton 路由到系统临时目录中的隔离 SQLite，等待设置页公开 `loading/ready/error` hydration 状态，通过真实 UI 添加无 Key 测试 LLM，关闭并重启应用验证存在，再删除并第二次重启验证消失。该模式由 WebDriver 驱动；`RealE2eRunner` 只通过数据库公共 metadata interface 报告真实表/列供脚本按独立合同裁判，不启动视频 E2E 工作流，不调用模型、不下载 Whisper，也不产生 `Verified` Evidence。

同一脚本拥有短桌面 Judge 的失败可诊断性：每个关键阶段先更新阶段名；失败时在停止 driver 后把阶段、主错误和脱敏 stdout/stderr 写入系统临时目录的单份 `rain-runtime-settings-e2e-latest-failure`，再删除隔离 SQLite 与运行目录。新失败替换旧失败，成功清除 stale 诊断；诊断写入错误只能告警，不能替代主错误。

普通 `App` 只调用 `E2eAutomation` interface。Vite 默认把它解析到空 adapter，使 `real-e2e-runner.tsx` 及其 window interface 不进入普通生产产物；只有 E2E 脚本设置 `RAIN_E2E_BUILD=1` 时才解析到真实 adapter。`build-e2e-frontend.mjs` 提供跨平台、无 Tauri/live-key 的真实 E2E 前端构建入口；`harness:check` 先运行它，再运行普通构建，使两侧每轮都受裁判且成功后的 `dist` 仍是普通产物。`verify-e2e-build-isolation.mjs` 对两种真实 `dist` 的 JavaScript 与 JavaScript source map 执行互补裁判；独立临时产物 fixture 锁定 source-map 污染会被拒绝。

本地 Whisper 入池前，Store 必须调用 `requireInstalledWhisperModel`，通过生产 `list_whisper_models` 复核所选 size 的最终文件；表单 `done` 只控制交互，不能替代门禁。删除模型时，Store 在同一候选快照中移除模型、能力记录和所有引用它的角色，再交给 Runtime Settings 原子保存。两条规则分别由 `AC-MM-04` 和 `AC-LV-15` 管理。

学习页每次启动助手请求前必须从 Store 创建模型与能力记录快照，并通过同一个 `decideModelRoleAssignment` 裁决助手角色。通过后的请求使用快照中的 OpenAI-compatible endpoint、Key 和模型名，不得再硬编码供应商；此门禁只授权文本问答，不授权 vision。

结构化探针必须复用生产 `STAGE2_BLOCK_SYSTEM_PROMPT`、`buildStage2Blocks`、输出归一化和 `validateStage2BlockOutput`。不得另建一份更宽松的测试 schema，否则探针通过不能证明生产 Stage2 可用。

真实 E2E Runner 必须经 `VideoImportController` 进入导入流程，不得直接调用 `runPipeline`。完整运行结束后必须通过生产 Store 的 `loadVideo` 打开同一隔离数据库中的视频；证据 schema v2 由 `scripts/validate-evidence.ps1` 负责裁判三角色能力、负向门禁、生产入口、取消/重试、最终落库，以及 WebDriver 采集的学习页、播放器和段落 DOM 状态。截图只能作为可视附件，不能单独证明 UI 就绪。

`ui-proof` 重放只允许复用已有 schema v2 数据库补拍 UI 与短 ASR/CUDA 运行证据，不得重签 LLM 能力或改写长流水线结果。分阶段证据必须在 manifest 中记录生成时间和来源；若事件只能从已提交的重启证据恢复，只保留事件名称并明确 `recoveredFrom`，不得伪造时间戳。

## 5. 当前热点和控制策略

| 热点 | 当前规模 | 混合的职责 | 控制策略 |
| --- | ---: | --- | --- |
| `src/ui/components/settings/` | 页面编排约 349 行；其余组件 129-251 行 | 设置 UI 已按页面、自检、模型池、表单、角色选择和共享展示资源拆分 | 保持 `settings.tsx` 仅作公共 barrel；新行为进入对应组件，领域裁决继续留在 `src/settings/` |
| `src/models/database.ts` | 约 163 行 | 稳定公共导出和两种 adapter 构造 | 保持 `@/models/database` 稳定；业务持久化进入已有内部 module，不把公共入口重新长成实现集合 |
| `src-tauri/src/commands.rs` | 约 320 行 | command 的参数/路径适配 | ASR、模型下载和在线媒体进程控制分别归属深模块；command 只解析 Tauri State/应用数据路径并委托，不因文件长度拆分 |
| `src/pages/VideoListPage.tsx` | 约 568 行 | 列表 UI、搜索排序、文件/URL 输入、删除适配和错误展示 | 本地文件与 URL 流程均委托 `VideoImportController`；删除只结算 Controller 活动任务、调用公共查询/删除接口并发布提交结果；页面不得重新编排探测、下载、跨表清理、持久化事务或 Pipeline |
| `src/pages/StudyInterface.tsx` | 约 449 行 | 学习页组合、媒体/导航协调、笔记命令适配、助手流生命周期 | 保持页面为组合入口；已有规则继续下沉到 `src/study/` 等深模块。下一次修改助手会话行为时，优先设计小 interface 后提取其流生命周期，不做无行为目标的整页重写 |

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

- 新建 `video-import-controller.ts`；当前接口为 `importLocal/importUrl/start/cancel/acceptProgress`。
- 页面不再直接组合本地媒体探测、Pipeline 参数、失败状态修复和 Rust 取消。
- 数据库未准备好时导入按钮禁用，不再静默丢失用户操作。
- 新增 AC-LV-02 页面到数据库贯通测试。
- AC-LV-02、AC-LV-06、AC-LV-07、AC-LV-08、AC-LV-10 相关测试及完整前端测试保持通过。
- 当时未修改锁定 Harness；随后经用户批准的 2026-07-26 Harness Migration 已把该控制器纳入 M03/M21 的真实行为验收。

剩余工作：

- 在线 URL 的受控本地媒体交接已进入 `AC-LV-17`：Controller 拥有可追踪记录、失败/取消/重试和 Pipeline 交接，Rust `ytdlp` module 拥有可取消探测/下载、进度、临时目录和最终提交，页面只保留输入适配。真实站点差异与完整外网 Evidence 仍是独立 Gap。
- 模型能力记录、持久化、配置变化失效、角色分配拦截、三种角色探针以及本地导入/学习页运行入口门禁已实现。`ggml-large-v3.bin` CUDA + DashScope `qwen3-omni-flash`（结构化、文本助手）已有 schema v2 Evidence；下一个模型配置仍须独立探针和完整 E2E，不得继承这个 `Verified` 结论。
- 本地缩略图创建、持久化和卡片渲染由 `AC-LV-18` 控制；应用所有缩略图随 Video 删除及孤儿 GC 已由 `AC-VL-05/06` 冻结语义，但对应 Rust lifecycle module、生产接线和真实文件/SQLite Judge 仍为 Gap。

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

## 10. Core Release 新 AC 的模块归属

状态：`Confirmed contracts / implementation varies`（2026-08-02）。本节把 M1-S2 的 AC group 定位到深 module 或治理 Owner；它不要求一次性创建所有文件，也不能覆盖 `harness-coverage.md` 的 Partial/Gap 事实。

| AC group | 生产 Owner / 推荐 seam | 关键边界 |
| --- | --- | --- |
| `AC-RL-01..20` | Tauri release config、GPU overlay/bundle、installer lifecycle、数据库 migration deep command、artifact/Evidence validator、人类 release/legal/security owner | 主程序保持 CPU-safe；CUDA 只在隔离 worker；安装/升级/卸载/签名/发布/回滚各自独立裁判，页面或 AI 不拥有私钥和法律批准 |
| `AC-VL-01..04/07` | `VideoListPage` composition、`VideoCard`、公共 Database video query interface | 页面组合查询与动作，不复制排序/搜索/持久化规则；视觉与业务行为分层裁判 |
| `AC-VL-05/06` | 新的 Rust thumbnail lifecycle deep module + 现有数据库删除 workflow | 只处理 app-owned `thumbnails/`；数据库 commit、keep-set 和真实文件副作用由深 module 协调，永不接受任意用户路径 |
| `AC-SU-01..07` | `StudyInterface` composition、`src/study/` navigation/session、catalog、VideoZone、shortcut/focus policy、layout persistence | 页面保持组合入口；播放/选择/预览/面板焦点使用共享事实，不在组件间复制快捷键或持久状态 |
| `AC-UX-01..06` | `src/index.css` token system、生产组件、visual/accessibility policy | CSS token 是唯一视觉事实源；完整页面 visual/keyboard/axe/contrast Judge 不由 token 存在自证 |
| `AC-PF-01..05` | 独立 performance/soak runners + 对应 startup/List/Study/progress/App lifecycle Owner | runner 只测量，不成为生产 Owner；冻结机器、fixture、样本数、p95、资源斜率和退出残留必须写入 Evidence |
| `AC-AR-02` | `src/llm/` 和角色 request workflows | 所有 OpenAI-compatible LLM 请求留在前端 adapter；Rust command 精确集合不得出现 LLM HTTP 边界 |
| `AC-AR-03` | Tauri asset capability + 共享 `localMediaUrl` adapter | 只允许 app-owned 或用户明确选择的规范化本地路径；禁止任意文件系统通配 scope |
| `AC-AR-04` | 公共 Database interfaces + Zustand session Store | SQLite 是跨会话业务事实源；Store 只拥有当前会话选择/播放/UI 草稿，不恢复或复制持久业务事实 |
| `AC-AR-05` | App-scope import Owner + `VideoImportController` | Controller 生命周期高于页面；页面卸载/重挂不能制造第二 Owner、取消路径或迟到提交 |
| `AC-AR-06` | 单一 progress domain contract + Pipeline/Controller/event adapters | 五类判别联合、字段合法性、单调性、终态和 checkpoint retry 在域边界统一；UI 不推断或发明阶段 |
