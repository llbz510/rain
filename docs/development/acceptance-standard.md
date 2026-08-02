# Rain 验收标准

> 状态：Active
> 更新日期：2026-08-02
> 当前范围：本地视频与学习主链路、Core Release 产品/发布合同、Engineering Harness 和架构边界。Confirmed 表示产品语义生效，不代表当前覆盖已经达到所需 Evidence tier。

## 1. AC 怎么使用

每条 AC 都必须回答四件事：

1. 用户或外部系统能观察到什么结果。
2. 哪个模块负责让结果成立。
3. 哪个独立检查负责发现结果失效。
4. 需要保存什么证据。

AC 状态：

- `Confirmed`：已有明确产品依据，当前生效。
- `Provisional`：根据当前实现和证据整理，等待用户确认产品语义。
- `Decision needed`：存在冲突，不得据此扩展功能。

测试通过不等于 AC 自动通过。只有该测试确实检查了 AC 描述的行为，才算有效验证。

## 2. 本地视频主链路

### AC-LV-01 运行前检查必须阻止不可运行的任务

状态：`Confirmed`

给定本地视频处理所需的 Whisper 或结构化模型配置不可用，当用户运行预检或开始处理时：

- UI 必须明确指出阻塞原因；
- 不得把任务显示为可正常完成；
- 错误信息不得泄露 API Key；
- 缺少可选的 `yt-dlp` 或助手模型只能作为本地视频流程的警告。

实现归属：`src/settings/preflight.ts`、设置 UI、运行时能力命令。

裁判：`src/__tests__/preflight.test.ts`、`src/__tests__/settings-preflight.test.tsx`。

### AC-LV-02 选择本地视频后立即形成可追踪记录

状态：`Confirmed`

当用户选择一个本地视频并确认导入时：

- 必须创建唯一 Video 记录；
- 初始状态为 `pending`；
- 视频必须立即出现在列表中；
- 本地导入不得依赖 `yt-dlp`。

实现归属：视频列表导入流程、数据库视频记录、导入任务模块。

裁判：`src/__tests__/video-list-local-import.test.tsx` 贯通用户点击、桌面适配器、数据库 `pending` 记录和列表卡片；M03/M21 Harness 直接调用 `VideoImportController` 和真实内存数据库检查导入、失败、取消与桌面命令参数。

### AC-LV-03 ASR 必须失败关闭

状态：`Confirmed`

当视频路径、Whisper 模型或 Whisper 输出无效时：

- 导入必须进入 `failed` 或 `cancelled`；
- 不得生成演示句子、默认句子或默认结构；
- ASR 失败后不得继续 Stage2；
- 原始错误应以可操作方式展示，后续持久化错误不得覆盖主要错误。

实现归属：`src/pipeline/asr-runner.ts`、`src/pipeline/pipeline-orchestrator.ts`、Rust Whisper 模块。

裁判：`src/__tests__/pipeline-asr.test.ts` 和真实 E2E 证据。

### AC-LV-04 ASR 结果必须原子持久化

状态：`Confirmed`

当 ASR 成功时，所有有效句子和语言信息必须作为一个完整结果保存。任一写入失败时：

- 不得留下半份句子；
- Video 状态不得错误前进；
- 已经处于终态的数据不得被过期任务覆盖。

实现归属：数据库原子操作、Rust/前端持久化接口、ASR 阶段。

裁判：`src/__tests__/database-recovery.test.ts`、`src/__tests__/pipeline-asr.test.ts`。

### AC-LV-05 Stage2 必须精确覆盖原始句子

状态：`Confirmed`

当 Stage2 完成时：

- 每个原始句子必须且只能属于一个结构段落；
- 不得出现缺失、重复、外来或乱序句子 ID；
- LLM 不得改写原始转录正文；
- 节点树、父子关系、时间范围和段落类型必须有效；
- 无效响应最多按当前重试策略重试，耗尽后进入失败，不得生成默认结构。

实现归属：`src/pipeline/stage2-contract.ts`、`src/pipeline/stage2-runner.ts`。

裁判：`src/__tests__/stage2-runner.test.ts`、证据校验器。

### AC-LV-06 导入状态只能沿批准路径变化

状态：`Confirmed`

成功路径：

`pending -> asr -> stage2 -> merging -> ready`

活动阶段可进入 `failed` 或 `cancelled`。`ready`、`failed`、`cancelled` 是终态，恢复必须通过明确的重试流程创建受控的新运行状态。

实现归属：`src/pipeline/import-state.ts`、Pipeline Orchestrator、数据库状态转换。

裁判：`src/__tests__/pipeline-asr.test.ts` 和数据库状态转换测试。

### AC-LV-07 取消必须真正停止当前工作

状态：`Confirmed`

当用户取消正在进行的本地视频导入时：

- 当前 Whisper 或 Qwen 工作必须收到取消信号；
- Video 最终状态为 `cancelled`，不得随后变为 `ready`；
- 已验证的恢复检查点可以保留；
- UI 必须提供重试入口。

实现归属：页面取消控制、Pipeline 的 `AbortSignal`、Rust 调度/Whisper 取消、数据库状态。

裁判：取消相关单元测试加真实 E2E 的 `cancellation-proof.json`。只修改内存任务对象不构成通过。

### AC-LV-08 重试必须从有效检查点恢复

状态：`Confirmed`

当失败或取消的任务重试时：

- 已完整持久化的 ASR 可以复用，不得无条件重跑 Whisper；
- 无效或不完整的 Stage2 检查点必须重跑；
- 最终仍必须经过完整覆盖校验和原子合并；
- 恢复过程不得产生重复句子或节点。

实现归属：Pipeline Orchestrator、Stage2 Runner、数据库检查点。

裁判：`src/__tests__/pipeline-recovery.test.ts`、`src/__tests__/stage2-runner.test.ts`、真实 E2E 的 `restart-proof.json`。

### AC-LV-09 只有持久化完成后才能显示 ready

状态：`Confirmed`

Video 只有在真实 ASR、通过校验的 Stage2 结构、句子和节点全部持久化成功后才能标记 `ready`。进入学习页后必须能读取真实视频、目录和转录。

实现归属：Pipeline Orchestrator、原子合并、学习页加载。

裁判：证据校验器必须确认数据库 `ready`、句子数量、节点数量、Qwen 块和截图；单纯 UI 显示 `ready` 不构成通过。

### AC-LV-10 列表进度必须来自实际任务

状态：`Confirmed`

处理中卡片必须显示当前真实阶段和百分比。任务失败、取消或完成后，卡片操作必须与持久化状态一致。

实现归属：Tauri progress 事件、进度监听、视频列表页面和卡片。

裁判：`src/__tests__/video-list-page-recovery.test.tsx`、`src/__tests__/video-list-import.test.tsx`；真实事件链仍由 E2E 证据补强。

### AC-LV-11 真实证据不得包含秘密或伪成功

状态：`Confirmed`

被用于宣称本地视频主链路可用的证据包必须：

- 指向真实输入视频并校验哈希；
- 包含非空、非演示、非乱码的转录；
- 包含真实结构化模型输出块和精确句子覆盖；
- 包含数据库、取消、重试、运行日志、PNG 截图，以及证明生产学习页、播放器和段落可见的 DOM 状态；
- 不包含 API Key 或类似秘密。

实现归属：真实 E2E Runner 和证据校验脚本。

裁判：`scripts/validate-evidence.ps1` 及其测试。

### AC-LV-12 支持的模型范围

状态：`Confirmed`

Rain 支持模型池中的多种配置。每个配置必须按被分配的角色通过统一能力契约：

- 未通过能力检查的配置不得被分配给该角色；
- 连接成功不等于结构化契约通过；
- 文本助手能力不等于 vision 能力；
- 配置发生变化后，旧能力检查结果失效；
- 运行中的导入使用启动时的配置快照；
- UI 必须区分 `Compatible`、`Verified` 和 `Unavailable`。

实现归属：模型能力契约、模型池、角色选择、预检、LLM 角色检查、ASR 运行时检查、`VideoImportController` 运行入口。

裁判：`model-capabilities.test.ts`、`model-pool.test.ts`、`preflight.test.ts`、`asr-capability.test.ts`、`structuring-capability.test.ts`、`assistant-capability.test.ts`、`video-import-capability-gate.test.ts`、`study-playback.test.tsx` 和对应角色的真实行为测试。完整真实 E2E 负责把一个兼容组合提升为 `Verified`；普通连接或文件存在检查不得产生 `Compatible` 或伪造 `Verified`。

### AC-LV-13 删除视频必须原子清理关联数据

状态：`Confirmed`

用户删除一个 Video 时，该 Video 及其 Node、Sentence（包括直接归属 Video ID 的 ASR 占位句子）、Note、Note-Sentence 引用和 import checkpoint 必须作为一个整体删除。任一步失败时，所有数据必须保持删除前状态；不得留下孤儿记录，也不得删除其他 Video 的数据。删除不存在的 Video 保持幂等。

实现归属：`VideoListPage` 通过公共数据库接口按需读取真实段落/笔记数量，先调用 `VideoImportController.cancelAndWait` 终止并等待同一 Video 的活动导入，再发起删除并发布已提交的列表结果；Controller 在结算期间阻止同一 Video 的新 start/retry，桌面取消失败必须立即返回且不得删除；`VideoCard` 负责单飞准备、确认、取消、进行中状态和可恢复错误；数据库删除接口与 Rust SQLite 单事务负责原子持久化。生产页面和组件不得自行拼接删除 SQL 或复制事务规则。

裁判：`src/__tests__/video-list-deletion.test.tsx` 通过生产 `VideoListPage`、真实内存数据库和公开组件交互证明真实数量、单飞准备、确认/取消、重复 start 不得隐藏活动任务、活动 Pipeline 迟到写入先完成再删除、慢速桌面取消期间不得启动新任务、取消命令失败立即可见且不删除、URL 发布交接取消后旧 Owner 必须释放且删除失败保留的记录仍可重试、提交后读取失败不产生 UI 假失败、无 Owner 时不存在静默确认动作、全部归属数据消失，以及准备/删除失败可见且可重试；公共数据库接口测试、M15 删除 Harness、M21 取消协议、Rust SQLite 成功与晚失败回滚测试、M20 真实 command 注册继续裁判双 adapter、桌面取消和事务结果。

### AC-LV-14 Runtime Settings 必须作为一个快照原子保存

状态：`Confirmed`

保存 Runtime Settings 时，模型列表、按模型 ID 分离的 API Key、三个角色和能力记录必须作为一个快照提交；被删除模型的旧 Key 必须在同一提交中清理。旧格式配置迁移也必须遵守同一规则。任一写入或删除失败时，保存前的所有 setting 必须保持不变，且不得影响无关 setting。Store 和设置 UI 也只有在该快照提交成功后才能发布添加、删除或角色变更；失败时必须保留提交前的内存状态并显示错误。模型列表和能力记录中不得保存 API Key 明文。

实现归属：Store Runtime Settings 提交门禁、Runtime Settings 持久化规划、数据库批量 Settings interface、Rust SQLite 单事务。Settings UI 只能调用 Store 的公开动作，不得自行读取或拼装持久化快照。

裁判：`runtime-settings-store.test.ts`、`runtime-settings-ui.test.tsx`、`settings-boundary.test.ts`、`model-pool.test.ts`、公共数据库 Settings 测试、Rust SQLite 成功与晚失败回滚测试、M20 真实 command 注册，以及 `scripts/run-runtime-settings-e2e.ps1` 对真实 Tauri/SQL plugin/隔离 SQLite 必需 schema 形状、添加与重启持久化的闭环。

### AC-LV-15 删除模型必须清理所有运行时引用

状态：`Confirmed`

用户删除模型池条目时，模型条目、该模型的能力记录、引用该模型的 ASR/结构化/助手角色以及独立 API Key 必须在同一个 Runtime Settings 快照中清理。一个模型同时承担多个角色时必须清理全部引用；未引用它的角色和其他模型事实保持不变。保存失败时，Store、设置 UI 和持久化 setting 都必须保持删除前状态。

实现归属：Store 模型删除动作负责构造无悬空引用的候选快照；`saveRuntimeSettings` 和 Rust SQLite 事务负责原子提交及旧 Key 清理。

裁判：`runtime-settings-store.test.ts` 通过 Store 公开删除动作检查提交快照和发布状态；`runtime-settings-ui.test.tsx` 检查失败时条目仍可见；`model-pool.test.ts`、公共数据库 Settings 测试和 Rust `settings_persistence` 测试继续裁判 Key 清理与事务回滚；`scripts/run-runtime-settings-e2e.ps1` 在删除后再次启动真实桌面应用，证明模型不会复活。

### AC-LV-16 Runtime Settings 初始化与写入必须有确定顺序

状态：`Confirmed`

Runtime Settings 首次加载成功前，Store 的公开设置动作必须拒绝写入且不得调用持久化。加载完成后，添加、删除、角色分配和能力记录写入必须进入同一提交队列；后一个动作只能在前一个动作结束后读取最新 Store 状态并构造候选快照，前一个动作失败也不能阻塞队列。任何设置加载或重试结果，如果早于其后成功提交的设置动作启动，则该加载结果已经过期，不得覆盖成功提交后的 Zustand 状态或模块内模型池副本。

实现归属：`src/store/rain-store.ts` 的 Runtime Settings 提交队列、提交版本和加载代次门禁。数据库仍只负责单个快照的原子事务，不负责前端动作排序。

裁判：`runtime-settings-store.test.ts` 分别证明未就绪时不持久化、并发动作串行且第二个快照包含第一个提交、晚返回的旧加载结果不能覆盖成功动作；既有 Store/UI/SQLite 裁判继续证明失败保留和单快照原子性；`scripts/run-runtime-settings-e2e.ps1` 等待生产设置页公开的 hydration 状态后才写入，并通过两次真实进程重启补强启动顺序。

### AC-LV-17 在线 URL 必须先形成受控本地媒体再进入现有 Pipeline

状态：`Confirmed`

用户提交一个绝对 HTTP(S) 视频 URL 后，Rain 必须通过桌面 `yt-dlp` 边界创建唯一、可追踪的 URL Video 记录，并在下载完成前保持 `processing/download`，不得把远程 URL 或未完成文件直接交给 ASR。下载进度必须通过现有任务进度协议可观察；取消必须终止对应子进程、清理本次临时输出并把同一记录持久化为 `cancelled/download`；探测、启动、下载、文件提交或交接失败必须失败关闭为 `failed/download`，保留不含秘密的可操作错误。成功下载必须先把应用数据目录中的最终本地 `filePath` 原子附着到同一记录，再转为 `pending` 并复用现有 `VideoImportController` / Pipeline；失败或取消后的重试复用同一记录，不得制造第二条 Video。播放列表、字幕优先、站点特定兼容承诺和完整外网 Evidence 不属于本 AC。

实现归属：`src/pipeline/video-import-controller.ts` 负责 URL 记录、下载状态、重试和现有 Pipeline 交接；`src/models/database-videos.ts` 负责下载元数据与最终本地文件附着的持久化门禁；Rust `ytdlp` module 负责 URL 校验、受调度的元数据探测、唯一临时目录、子进程进度/取消/清理和最终目录提交；`VideoListPage` 只负责桌面输入与错误展示。

裁判：`src/__tests__/video-import-url.test.ts` 通过 `VideoImportController` 公开 interface、真实内存数据库和 Tauri 外部 adapter 证明下载前记录、成功本地交接、进度、URL 秘密值脱敏、显式取消与调度器取消分类、初次发布及附着前后重试均无 Owner 空档、各交接失败关闭、清理失败不得伪装成取消成功，以及重试复用同一记录；数据库 Judge 路径把受门禁的 `filePath` 附着与 `pending` 发布分开，确保失败仍从 `processing/download` 进入终态而不绕过严格状态机；Rust `ytdlp` 邻接测试通过生产深 seam、受控真实子进程和隔离临时目录证明调度器完成、参数、进度、取消唤醒、Windows 进程树终止、临时输出清理失败可见与成功提交。测试不得访问真实视频站点或调用模型。

### AC-LV-18 本地缩略图必须由应用拥有并通过生产媒体桥接渲染

状态：`Confirmed`

本地视频导入必须在任何缩略图副作用前取得唯一 Video ID；生成的缩略图必须位于 Rain 应用数据目录的 `thumbnails/` 下，并以该 Video ID 决定唯一最终文件名。不得在用户源视频目录创建或覆盖缩略图，也不得允许前端指定任意输出路径。生成过程必须先写临时文件，只有非空结果才能原子替换最终文件；失败时不得留下新的临时文件或损坏既有最终文件，并且仍按既有合同以可见警告继续导入。成功返回的应用所有路径必须保存到同一 Video 记录。生产视频卡片必须通过与播放器一致的媒体 URL adapter 把本地缩略图路径转换为 Tauri asset URL；HTTP(S) 缩略图保持原 URL，空缩略图显示稳定的中性占位，不得把空字符串或原始 Windows 路径交给 `<img>`。

实现归属：Rust `thumbnail_storage` module 唯一拥有 app-data 路径、Video ID 校验、目录创建、临时文件、ffmpeg 调用与最终替换；`generate_thumbnail` command 只把 AppHandle 和输入适配到该深 module；`VideoImportController.importLocal` 只生成 Video ID、调用 command 并持久化返回路径；生产 `VideoCard` 复用播放器的 `localMediaUrl` interface，不自行拼接 asset URL。

裁判：`src/__tests__/video-thumbnail-ownership.test.tsx` 通过生产 `VideoCard` 证明本地路径转换、HTTP(S) 保持和空图占位；经批准迁移的 M21 通过公开 `VideoImportController`、真实内存数据库和 Tauri adapter 证明前端只传 `filePath/videoId/timestamp` 并保存 Rust 返回路径；未锁定的 `video-import-local-id.test.ts` 证明两个 Controller 共享数据库并发导入时仍在缩略图调用前取得不同 Video ID，`video-list-local-import.test.tsx` 通过生产页面证明成功路径和“缩略图失败可见但导入继续”；Rust `thumbnail_storage_tests.rs` 通过真实媒体 fixture、隔离临时 app-data 和可控清理失败 seam 证明最终文件位置、非空提交、源目录不变、非法 Video ID 拒绝、普通失败无残留、既有最终文件保护，并在操作系统拒绝清理时保留失败诊断而不伪装成功。本 AC 不签发在线缩略图本地化、派生文件删除/GC、精确卡片视觉或真实桌面 E2E。

### AC-LV-19 非就绪视频卡必须无副作用地打开导入任务详情

状态：`Confirmed`

用户点击 `pending`、`processing`、`failed` 或 `cancelled` Video 卡时，Rain 必须只打开该 Video 的导入任务详情，不得因此启动、重试或取消 Pipeline，也不得改变持久化状态。详情必须显示 SQLite 中可恢复的状态、阶段和错误；活动任务收到进度事件时，还必须显示真实阶段、百分比、分块位置和重试状态。只有详情中的显式动作才能重试或取消：失败或已取消任务可重试，处理中任务可取消；关闭详情不得停止后台任务。任务完成、失败或取消后必须继续刷新并展示同一 Video 记录。

实现归属：`App` 在自身生命周期内保持唯一 `VideoListPage`/Controller Owner，不得因切换列表、设置或学习页丢失仍运行的前端 Pipeline；`VideoListPage` 只拥有当前详情目标和开关；生产 `ImportTaskDialog` 只展示任务事实并把显式动作适配到回调；`VideoImportController` 继续唯一拥有 start/retry/cancel 和任务生命周期；Stage2 runner 生成真实分块位置与重试状态，Pipeline/Controller 只传递并归一化；SQLite `Video` 是跨重启 status、stage、error 的事实源，实时进度只作为当前会话覆盖，不得另存为新的业务事实。

裁判：生产页面 Judge 通过公开卡片和 dialog 交互、真实内存数据库、公开 Video 读取及 Pipeline 外部 seam 证明：打开和关闭所有非就绪状态均无任务或持久化副作用；持久状态、错误和实时详细进度可见；只有显式重试会启动一次现有 Controller 路径，处理中任务即使来自进程重启也能经桌面取消并闭合持久态；关闭活动任务详情后后台继续，设置页往返后仍能取消原 Pipeline，并在终态刷新同一记录。Stage2 runner 与 Pipeline Judge 必须用真实多分块和失败重试 seam 证明 block/percent/retrying 由生产者产生并贯通公开回调，不得只向 UI 注入虚构事件。锁定 M17 继续只裁判 `openImportDialog` 组件合同，不得把点击卡片直接启动 Pipeline 当成替代 Judge。本 AC 只控制 `DEC-PRD-062` 的非就绪任务入口，不确认排序、搜索、顶栏、空状态或精确视觉。

### AC-LV-20 重启遗留的 pending 任务必须由用户显式继续

状态：`Confirmed`

前一应用进程遗留的 `pending / stage=null` Video 在新进程启动后必须保持空闲；启动扫描、打开或关闭任务详情均不得自动启动、重试、取消 Pipeline 或改变持久化状态。详情必须为这条状态提供明确的“继续导入”动作。只有用户点击该动作，当前应用生命周期内的 `VideoImportController` 才能启动同一个 Video ID；重复点击必须保持 single-flight，不得创建第二条 Video 或第二个活动 Pipeline。进度和终态必须更新原来的同一条 SQLite Video 记录；关闭详情不得取消显式启动的后台任务。

实现归属：由 `App` 生命周期保留的现有 `VideoListPage` / `VideoImportController` 继续作为唯一前端任务 Owner；Controller 负责同 Video ID 的 start、活动任务去重、Pipeline 和持久化结果，`VideoListPage` 只转发显式继续意图，`ImportTaskDialog` 只按持久状态渲染动作。该边界不要求把 Controller 提升到新的 App-scope module，也不引入启动扫描器、跨进程 lease 或持久任务队列。

裁判：`src/__tests__/video-import-task-dialog.test.tsx` 必须通过新挂载的生产页面、公开 Controller 和真实内存数据库证明重启遗留的 `pending/null` 记录保持空闲、打开/关闭无副作用、显式继续启动同一记录、重复点击 single-flight、关闭后后台继续且终态刷新原记录。`scripts/run-runtime-settings-e2e.ps1` 还必须在无 Key、无模型调用和无公网的真实 Windows/Tauri/隔离 SQLite 三次启动流程中写入 `pending/null`，重启证明没有自动启动，点击显式动作并证明同一行离开 `pending`、结果可见且再次重启后仍存在；运行时预检允许确定性失败关闭。默认 Harness 不运行该桌面 Judge。本 AC 不包含 stale `processing` 语义、自动启动、跨进程队列、缩略图删除/GC、risk 22 架构重构、`DEC-PRD-092` 或 `DEC-PRD-099`。

### AC-LV-21 本地 Whisper 默认优先 GPU 且必须安全回退

状态：`Confirmed`

本地 Whisper 的运行偏好必须支持 `auto`、`cuda` 和 `cpu`，旧设置缺失时默认 `auto`。偏好必须作为 Runtime Settings 快照的一部分通过既有单队列和 SQLite 原子事务保存；每次导入和 ASR 能力检查使用启动时的偏好快照。偏好变化后，旧 ASR capability 必须失效。

Rain 主程序和 CPU adapter 不得在装载时依赖 CUDA DLL。CUDA 推理由独立 worker adapter 承担。`auto` 在 CUDA 探针通过且显存没有明显不足时使用 CUDA；CUDA worker 不存在、驱动/runtime 不兼容、显存不足或 worker 启动/协议/崩溃失败时，必须保留可见回退原因并改用 CPU。显式 `cuda` 遇到同类问题必须失败关闭，不得静默回退；显式 `cpu` 不得启动 CUDA worker。确定的模型文件错误和用户取消均不得触发另一后端重跑。

运行时自检和设置页必须显示用户偏好、实际选择的后端、CUDA 设备或不可用原因。导入详情必须能观察实际 ASR 后端以及 Auto 回退原因。缺少 NVIDIA GPU、驱动或 CUDA runtime 时，Rain 仍必须能启动并完成 CPU 能力检查。

实现归属：`src-tauri/src/whisper_backend.rs` 拥有选择、探针、worker 协议、错误分类、取消和回退；`src-tauri/src/bin/rain-whisper-cuda.rs` 是 CUDA adapter；既有 `whisper.rs` 是 CPU adapter；`asr_execution.rs`、Runtime Settings、预检和设置/导入 UI 只调用该深 module 的 interface。GPU 产品构建由 `scripts/build-whisper-cuda-worker.ps1` 和独立 Tauri GPU 配置拥有，不得把 CUDA feature 设为默认 Rust/Harness feature。

裁判：Rust `whisper_backend` module tests 通过 fake worker adapter 证明选择、回退、强制 GPU 失败、强制 CPU、显存门禁和取消；`src/__tests__/whisper-backend-preference.test.ts`、`runtime-settings-store.test.ts`、`preflight.test.ts`、`pipeline-asr.test.ts` 和设置/导入生产 UI 测试证明偏好持久化、能力失效、命令快照和可见状态。构建 Judge 必须检查 CPU Rain 二进制没有 CUDA DLL import，CUDA worker 具备精确协议和 runtime 依赖。`Strong + Evidence` 还要求目标提交在真实 NVIDIA Windows 上完成 CUDA 短样本/主链路，并在无 CUDA 环境完成干净启动和 CPU 短样本；旧 CUDA Evidence 不自动签发本 AC。

## 3. Whisper 模型下载

本节来自 2026-07-27 对当前设置页、Rust command 和历史模型管理规格的核对，并于同日经用户确认。三条 AC 均为当前生效的 `Confirmed` 产品事实。

### AC-MM-01 下载成功必须得到完整且原子提交的模型文件

状态：`Confirmed`

Rain 只接受受支持的 Whisper model size，并由版本化 manifest 把 size 映射为固定文件名、受信 HTTPS 来源、期望字节数和 SHA-256。下载数据必须先写入目标目录中的唯一临时文件；只有字节数和哈希均通过后，才能原子替换最终文件并返回成功。网络失败、写入失败、长度错误、哈希错误或进程内取消不得留下被当成已安装模型的半文件，也不得破坏下载前已经存在且有效的最终文件。已经与 manifest 匹配的最终文件再次下载时应幂等返回。

`list_whisper_models` 不得列出临时文件；它继续负责发现应用模型目录中的最终文件，但“文件被列出”本身不等于通过 ASR capability probe。

实现归属：Rust `whisper_model_download` module 负责 manifest、流式写入、验证、临时文件和原子替换；`commands.rs` 只解析应用目录并调用其公开 interface。

裁判：Rust module 使用本地 HTTP fixture 和临时目录，直接覆盖成功提交、重复下载、截断响应、哈希错误、替换失败、旧文件保留和临时文件清理。测试不得访问真实 Hugging Face 或下载 GB 级模型。

### AC-MM-02 下载必须可观察、可取消且不整包占用内存

状态：`Confirmed`

下载响应必须按有界 chunk 增量读取和写入，不得把完整模型收集到单个内存 buffer。运行中必须发出单调递增的专用模型下载进度，至少包含 model size、已下载字节数、总字节数（服务端提供时）和可计算时的百分比。用户取消指定 model size 时，网络读取和文件写入必须停止，临时文件必须清理，结果必须与普通失败区分为 cancelled；随后重试必须从干净状态开始。

同一 model size 同时只能有一个 writer。重复启动不得创建第二个临时写入者，也不得取消或覆盖已在运行的任务。

实现归属：`whisper_model_download` module 持有按 model size 区分的下载 lease/cancellation token；Tauri 独立 `cancel_whisper_model_download` adapter 不能复用视频导入的 `cancel_import`。

裁判：Rust 本地 HTTP fixture 和 recording reporter 直接证明分块消费、进度单调、重复启动隔离、取消停止、停滞读取唤醒、取消清理和取消后重试。新增 command 对 M20 精确 command 集合的修改已由用户于 2026-07-27 明确批准，并记录在对应 Harness Migration 文档中。

### AC-MM-03 设置页必须展示真实下载状态

状态：`Confirmed`

桌面设置页必须订阅 AC-MM-02 的生产进度事件，显示实际进度，并在下载期间提供取消操作。只有 Rust command 完成且最终模型可由 `list_whisper_models` 发现后，UI 才能显示“已下载”；失败与取消必须显示不同状态并允许重试。关闭或重开表单不得把仍在运行或已经失败的任务伪装成成功。浏览器环境继续禁用本地 Whisper 下载。

实现归属：设置页模型下载 workflow 负责订阅/释放事件和 UI 状态；表单只收集 model size 和展示 workflow 状态；Rust 是下载任务和文件状态的事实源。

裁判：`whisper-model-download.test.tsx` 通过生产 Tauri adapter/event interface 驱动真实表单，覆盖进度、取消、失败、重试、监听释放和成功后刷新模型列表。静态文案、按钮存在或直接修改 React state 不构成通过。

### AC-MM-04 本地 Whisper 只有安装后才能进入模型池

状态：`Confirmed`

本地 Whisper 模型池条目只有在其 model size 对应的最终文件可由生产 `list_whisper_models` 发现后才能保存。下载按钮的本地 `done` 状态只负责改善交互，不能作为唯一门禁；Store 的公开添加动作必须再次通过生产 installed-list interface 复核，防止其他 UI、测试替身或未来调用方绕过。未安装、型号不受支持或列表查询失败时不得修改模型池或 Runtime Settings，并必须向用户返回可见错误。

已经安装且与 manifest 匹配的文件可通过 AC-MM-01 的幂等下载/复核流程进入模型池。模型进入池后仍为“已配置”，不因此获得 ASR `Compatible`；能力结论继续只由 ASR capability probe 签发。

实现归属：`whisper-model-download.ts` 公开 installed-list 校验 interface；Store 模型添加动作是不可绕过的入池门禁；`AddModelForm` 在当前选择未完成安装验证时禁用保存。

裁判：`runtime-settings-store.test.ts` 通过 Store 公开动作和生产 installed-list adapter seam 证明未安装时不保存；`whisper-model-download.test.tsx` 驱动真实表单，证明安装验证前不可保存、验证后才解锁。M20 与 Rust download tests 继续裁判 command、最终文件和列表协议；文件存在不替代 `asr-capability.test.ts`。

## 4. 学习页核心流程

本节只接纳已经由 M05-M10、M15-M16 和用户于 2026-07-26 确认继续梳理的核心学习行为。高级树编辑和 vision 仍不在本节范围。

### AC-ST-01 就绪视频必须完整、原子地打开

状态：`Confirmed`

用户打开 `ready` 视频时，应用必须先从同一 Video ID 读取视频元数据、目录、句子和笔记，再进入学习页。视频不存在、状态并非 `ready`、目录或句子缺失、数据库读取失败时，不得进入空白学习页；必须留在列表并显示可见错误。

实现归属：`loadVideo`、数据库查询接口、视频列表打开动作。

裁判：Store 真实数据库加载测试、视频列表到 Store 的失败行为测试、schema v2 学习页证据。

### AC-ST-02 文本和引用跳转必须驱动真实视频

状态：`Confirmed`

双击转录句子或点击可信 AI 引用后，Store 播放位置和真实 `<video>` 的 `currentTime` 必须跳到对应句子起点，并保持跳转前的播放/暂停状态。

实现归属：学习导航接口、文本区、AI 引用、视频适配器。

裁判：通过 `StudyInterface` 操作真实组件的集成测试；只断言 `onSeek` 回调不构成完整通过。

### AC-ST-03 播放位置必须统一驱动当前内容

状态：`Confirmed`

真实视频的时间更新必须写入唯一 `playPosition`。当前句子高亮、目录当前节点和随播滚动必须从这一状态推导，不能各自维护互相漂移的时间。

实现归属：视频适配器、学习导航规则、目录区、文本区。

裁判：视频时间事件到 Store、句子和目录 UI 的贯通测试。

### AC-ST-04 目录选择和三区跳转语义必须分离

状态：`Confirmed`

单击左树或导图节点只能选中，不得 seek。双击节点必须选择该节点、跳到其最早叶子句子的起点，并让对应文本与目录上下文可见；跳转不得改变播放/暂停状态。

实现归属：学习导航接口、目录区、文本区、视频适配器。

裁判：通过 `StudyInterface` 的单击/双击行为测试；只检查目录组件回调属于部分覆盖。

### AC-ST-05 学习进度必须持久化且可恢复

状态：`Confirmed`

播放过程中必须持久化该视频最远到达位置；回退播放不得降低该值。重新打开视频时从持久化位置恢复，并更新最近学习时间。

实现归属：播放会话、数据库 `updateVideoPosition`、视频加载。

裁判：真实数据库往返测试和学习页播放事件测试。

### AC-ST-06 摘注和随记必须经过数据库闭环

状态：`Confirmed`

摘注必须创建包含整段 sentence ID 的持久化 Note；自由笔记和编辑后的内容必须持久化。重开视频后仍可读取，点击引用必须跳回对应句子。只改变 React 局部状态不算保存成功。

实现归属：笔记流程接口、Notes UI、数据库 Note 操作、学习导航接口。

裁判：页面操作到数据库再重载的行为测试。

### AC-ST-07 文本助手必须使用当前学习上下文

状态：`Confirmed`

文本助手必须通过当前能力门禁，使用当前段落或邻近句子的原文上下文；停止必须中断真实流并忽略迟到 token；只有与当前来源 ID 和时间匹配的引用才可跳转。

实现归属：助手上下文、能力门禁、流式适配器、学习页。

裁判：`assistant-context.test.ts`、`study-playback.test.tsx`、能力测试和 schema v2 文本助手证据。此 AC 不授权 vision。

### AC-ST-08 三种布局不得改变学习事实

状态：`Confirmed`

随播、文本展开和导图展开只改变区域可见性。切换布局不得清空当前视频、播放位置、选择、笔记或助手会话。

实现归属：布局状态机、学习页组合。

裁判：M16 状态与真实组件测试。

## 5. Engineering Harness

### AC-HE-01 控制面必须能够机械发现事实与裁判漂移

状态：`Confirmed`

仓库必须提供一个快速、确定性的公开命令，检查所有 Confirmed AC 是否具有唯一 coverage 行、非空实现归属和裁判，并检查 coverage 引用的具体裁判文件是否存在。验收标准内部的重复/冲突状态，以及 `PROJECT_STATE.md` 当前事实区把 Confirmed AC 降回 Proposed 的陈述，必须使命令失败并指出具体 AC；历史时间线可以保留当时状态。

该检查只证明控制文档自洽，不得代替产品行为测试、真实 SQLite/Tauri 运行或 Evidence。完整交付入口必须在控制面通过后继续运行前端测试、E2E/普通互补前端构建和 Rust 测试；昂贵 live-key 与真实 E2E 是否必跑仍由对应产品 AC 决定。

实现归属：`scripts/control-plane-validator.mjs` 负责纯规则和真实仓库入口；`package.json` 提供快速 `harness:control` 与完整 `harness:check` 命令。

裁判：`control-plane-validator.test.ts` 使用独立小文档覆盖正常、缺 coverage、缺 Owner/Judge、裁判文件缺失、当前事实冲突和验收状态冲突；`npm run harness:control` 对真实 Rain 文档执行同一实现。

### AC-HE-02 普通生产构建不得包含 E2E 自动化实现

状态：`Confirmed`

普通 `npm run build` 必须从构建产物中排除真实 E2E Runner、WebDriver window interface 和自动化状态 UI。应用根模块只依赖一个 `E2eAutomation` interface，由构建入口选择禁用 adapter；只有显式 E2E 构建才能选择真实 adapter，且该构建不得被当作普通发布产物。隔离不能破坏 Runtime Settings 短桌面 Judge 或完整 E2E Runner 的显式构建入口。

该规则不要求运行收费模型或重写 canonical Evidence。完整 E2E 的模型、视频和 Evidence 语义继续由 `AC-LV-11/12` 管理。

实现归属：`src/e2e/entry.tsx` 与 `enabled-entry.tsx` 提供同一构建 seam 的两个 adapter；`vite.config.ts` 只在 `RAIN_E2E_BUILD=1` 时选择真实 adapter；`build-e2e-frontend.mjs` 和桌面 E2E 脚本拥有该显式构建标志。

裁判：`verify-e2e-build-isolation.mjs` 扫描真实 `dist` 的 JavaScript 和 JavaScript source map，要求普通产物不存在三项自动化标记、E2E 产物全部存在；`verify-e2e-build-isolation.test.ts` 用独立临时产物证明仅藏在 source map 中的标记也会使普通产物裁判失败；`npm run build:e2e` 执行无 Tauri 的真实 E2E 前端构建及反向裁判，`npm run build` 执行普通产物裁判，`harness:check` 每次按此顺序运行两者并以普通产物结束；`run-runtime-settings-e2e.ps1` 进一步证明显式 E2E adapter 能在真实 Tauri 中运行。

### AC-HE-03 Runtime Settings 桌面 Judge 失败必须留下脱敏诊断

状态：`Confirmed`

`npm run e2e:runtime-settings` 失败时，必须在输出中报告一个确定的诊断目录，并保留结构化失败阶段、主错误和可用的 `tauri-driver` stdout/stderr。诊断不得包含运行前进程中的已知 LLM API Key、`sk-*` 凭据或 Bearer token；诊断捕获自身失败只能追加警告，不得覆盖原始 E2E 错误。

诊断采用单份 `rain-runtime-settings-e2e-latest-failure`，新失败替换旧失败，避免无限积累。正常成功必须清理该诊断和本次隔离数据库/运行目录，不能留下会被误认为当前失败的 stale 事实。

实现归属：`scripts/run-runtime-settings-e2e.ps1` 的阶段追踪、脱敏诊断写入、固定安全路径校验和成功/失败清理顺序。

裁判：用 `-SkipBuild -MaxSeconds 0` 对已经构建的 E2E 二进制制造确定性启动超时，检查 `summary.json` 的 `failed`/阶段/主错误、两份 driver 日志和注入 Key 缺失；随后正常运行 `npm run e2e:runtime-settings`，证明业务闭环通过且 `latest-failure` 被清理。

### AC-HE-04 合并候选必须由独立干净环境执行默认 Harness

状态：`Confirmed`

每个 pull request 和每次推送到默认分支，都必须在与开发者工作区隔离的 Windows hosted runner 中重新 checkout 当前提交、通过 lockfile 安装 JavaScript 依赖，并执行仓库唯一完整入口 `npm run harness:check`。远端不得另建一套更宽松的测试清单，也不得因 CI 环境失败而跳过控制面、前端测试、E2E/普通互补构建或 Rust 测试。

默认 CI 不得读取 live LLM Key、启动真实桌面 E2E、下载 Whisper 模型或生成/改写 Evidence；这些昂贵或含外部状态的 Judge 继续由对应 AC 显式决定。workflow 应采用最小只读仓库权限，并且 checkout 后不得留下可被项目脚本使用的写入凭据。

实现归属：`.github/workflows/harness.yml` 负责独立 runner、工具链、锁定依赖安装与唯一 Harness 入口；`package.json` 继续拥有 `harness:check` 的实际步骤，workflow 不复制其内部命令。

裁判：GitHub Actions 真实 pull request/push run 必须在 `Harness` workflow 中产生 `Clean Windows Harness` check，并在干净 `windows-2025` runner 上完成 `npm ci` 和 `npm run harness:check`；本地 YAML 读取或只断言 workflow 文件存在不能签发通过。

### AC-HE-05 Runtime Settings 桌面 Judge 必须可在独立 Hosted Windows 环境重放

状态：`Confirmed`

仓库必须提供一个仅由人工显式触发的 GitHub Hosted Windows 入口，从目标提交的干净 checkout 和锁定或机械核对的桌面工具链执行唯一公开行为命令 `npm run e2e:runtime-settings`。入口不得复制脚本中的 schema、DOM、持久化或重启断言，不得使用 `-SkipBuild`，也不得因环境失败跳过真实 Tauri Judge。

该入口必须保持最小只读仓库权限、不持久化 checkout 凭据、不接收 Rain secrets，并且不得进行模型连接、收费调用、Whisper 下载、完整视频导入或 Evidence 生成。它不属于默认 `harness:check`，不在 pull request 或 push 时自动执行，也不是必需合并检查；手动成功只证明该目标提交在该次 Hosted Windows 环境中通过 `AC-LV-14/15/16` 的短桌面闭环。

实现归属：`.github/workflows/runtime-settings-desktop-e2e.yml` 负责干净 Hosted Windows 环境、桌面工具链、安全权限和对现有 package 命令的单次委托；`src-tauri/src/e2e_config.rs` 与 `src-tauri/src/lib.rs` 只在 Runtime Settings E2E 模式把 Owner 提供的 WebView2 参数注入 Tauri window context；`package.json` 与 `scripts/run-runtime-settings-e2e.ps1` 继续分别拥有公开命令和全部产品行为裁判。

裁判：目标提交上的 GitHub Actions `Runtime Settings Desktop E2E` workflow_dispatch 真实 run 必须执行未带 `-SkipBuild` 的 `npm run e2e:runtime-settings` 并成功；YAML 存在、静态解析、本机运行或默认 `Harness` workflow 通过都不能单独签发本 AC。

### AC-HE-06 历史产品决策必须有完整且可机械检查的当前去向

状态：`Confirmed`

产品决策覆盖图必须把 `DEC-PRD-001` 至 `DEC-PRD-099` 各记录且只记录一次，并为每条决策提供当前 PRD/M 事实源、简明意图和唯一处置：`Confirmed AC`、`Proposed` 或 `Out-of-scope`。`Confirmed AC` 必须引用验收标准中现存且状态为 Confirmed 的 AC；`Proposed` 与 `Out-of-scope` 必须写明当前边界，不能用空值掩盖尚未验收或明确不做的意图。事实源只能指向仓库中现存的 `PRD.md` 或根级 `M*.md`，不得把 `HANDOFF.md`、历史计划或旧 Evidence 当作当前产品事实。

覆盖图只回答历史意图当前由什么控制，不把 PRD 的“已确认”措辞自动升级为实现完成，也不要求每条决策拥有独立 AC。修改产品行为仍必须遵守对应 AC 的 Owner/Judge 和 Harness Migration 规则。

实现归属：`docs/development/product-decision-coverage.md` 拥有 99 条当前映射；`scripts/control-plane-validator.mjs` 负责完整性、唯一性、处置、AC 引用和事实源规则。

裁判：`control-plane-validator.test.ts` 用独立 fixture 覆盖完整映射、缺失/重复编号、非法处置、未知或未确认 AC、空边界和失效事实源；`npm run harness:control` 对真实 Rain 覆盖图执行同一实现。

## 6. Architecture Boundary

### AC-AR-01 持久化访问与原子事务必须只有一个生产所有权

状态：`Confirmed`

业务页面、Store、Pipeline 和设置流程必须只通过 `@/models/database` 暴露的业务 interface 访问持久化，不得导入数据库内部 module 或自行拼接数据库流程。只有 `src/models/database.ts` 可以装载 `@tauri-apps/plugin-sql`；普通单记录读写可以由该公开入口背后的前端数据库内部 module 执行参数化 SQL。

凡是一个业务结果需要多个记录或多张表全部成功或全部失败，SQLite 路径必须由一次深 Tauri command 进入专用 Rust persistence module，并在一个连接上的真实事务中完成。前端生产源码不得自行发送 `BEGIN`、`COMMIT`、`ROLLBACK`、`SAVEPOINT` 或 `RELEASE`。Rust 只拥有这些明确的原子事务，不扩展为通用 DAL；`commands.rs` 仍只负责路径、参数和错误适配。内存 adapter 是快速行为裁判，不能单独签发真实 SQLite 原子性。

实现归属：`src/models/database.ts` 是稳定公共入口和唯一 SQL plugin owner；`src/models/database-*.ts` 拥有业务持久化接口与两种 adapter 行为；`src-tauri/src/*_persistence.rs` 拥有跨记录原子事务；`src-tauri/src/commands.rs` 是薄 Tauri adapter。

裁判：`database-architecture-policy.test.ts` 用独立违规源码和真实生产树执行同一 policy，拒绝 SQL plugin 扩散、数据库内部 module 逃逸和前端事务控制；`database-boundary.test.ts`、M20/M15 Harness 继续锁定公共入口、command 集合和生产 ASR interface；数据库公共接口测试与 Rust persistence tests 分别裁判参数/错误传播和真实 SQLite 成功、迟失败回滚。静态边界、内存 adapter 或 SQL 调用序列中的任一项都不能独自证明事务正确。

## 7. Core Release 正式验收合同

本节由用户于 2026-08-02 整体确认，并通过 `harness-migration-2026-08-02-release-ac-control.md` 从 M1-S2 提案迁入。每条 AC 的当前实现强度与缺口以 `harness-coverage.md` 为准；`Confirmed` 只冻结产品行为、Owner、Judge、Evidence tier 和范围外边界，不能被解释为实现或 Evidence 已完成。

### AC-RL-01

状态：`Confirmed`

公开发布只有一个与目标 commit、`0.1.0`、`com.rain.app` 一致的 Windows x64 NSIS 安装器，GitHub Release 页面可定位其版本与 SHA

实现归属：Tauri config、release build script、人类 release owner。

裁判：干净 checkout 构建；安装器 metadata/文件名/版本/commit manifest 一致；公开页只有一个安装下载物。Required Evidence tier：Strong + Release Evidence。

明确范围外：MSI、portable、自动更新、非 x64、非 Windows。

### AC-RL-02

状态：`Confirmed`

单一安装器同时包含 CPU-safe 主程序/adapter 与隔离 CUDA worker/runtime；不存在第二个公开 CPU 包

实现归属：GPU bundle script、Tauri GPU overlay。

裁判：安装后主程序无 CUDA import；worker/runtime/manifest 齐全且不含 `nvcuda.dll`；公开 Release asset 只有该通用安装器。Required Evidence tier：Strong + Release Evidence。

明确范围外：把 CUDA feature 加入主程序/默认 Harness；静默按需下载；驱动 DLL 再分发；发布文案由 AC-RL-18 控制。

### AC-RL-03

状态：`Confirmed`

干净 Windows x64 可完成安装、首次启动、Runtime Settings 就绪和正常退出，不读取开发树或预装 Rain 数据

实现归属：installer、Rain startup。

裁判：独立 release-evidence runner 在无 Rain 缓存/数据库的隔离机器真实安装；进程、安装路径、首次 schema 和脱敏日志 Evidence。Required Evidence tier：Strong + Release Evidence。

明确范围外：升级、模型/GPU 能力成功、业务长 E2E。

### AC-RL-04

状态：`Confirmed`

同版本重装幂等：程序文件恢复到目标 manifest，已有设置/SQLite/模型不重复、不丢失，重装后可再次启动

实现归属：installer lifecycle owner。

裁判：`0.1.0 → 0.1.0` 真实重装；前后数据摘要、文件 manifest、启动日志。Required Evidence tier：Strong + Release Evidence。

明确范围外：跨版本 schema 升级、手工覆盖程序目录。

### AC-RL-05

状态：`Confirmed`

`0.1.0` 安装器在发现同 identifier 的冻结 `c2eb4c4` 数据/设置 fixture 时保留并交给版本化迁移；未来版本从上一公开安装版本升级；安装失败不得破坏原数据

实现归属：installer upgrade owner、database migration entry。

裁判：同 identifier 安装场景 + 冻结数据 fixture；安装失败故障注入；成功后交由 AC-RL-13 裁判迁移内容。Required Evidence tier：Strong + Release Evidence。

明确范围外：假造旧正式 installer、任意更古老开发快照、跨主版本降级。

### AC-RL-06

状态：`Confirmed`

默认卸载移除程序文件和注册项但保留用户数据/模型/设置/派生文件；重装恢复；用户源视频永不删除；彻底清理步骤在文档中显式列出

实现归属：installer uninstall owner、app-data policy。

裁判：卸载前后文件/注册/数据库摘要；重装恢复；源视频哈希不变；人工清理文档复核。Required Evidence tier：Strong + Release Evidence。

明确范围外：首发卸载器内“删除全部数据”复选框、自动删除用户源媒体。

### AC-RL-07

状态：`Confirmed`

无 NVIDIA GPU/驱动/CUDA runtime 的干净 Windows 安装同一候选包后可启动，`Auto` 显示原因并完成真实 CPU 短样本

实现归属：`whisper_backend`、universal installer。

裁判：隔离 Evidence runner 记录硬件/驱动清单、安装器哈希、主程序 CUDA import 检查、真实短媒体/模型非空单调句子、实际 backend=`cpu`。Required Evidence tier：Strong + Release Evidence。

明确范围外：fake worker、开发 override、只做 DLL 字符串检查。

### AC-RL-08

状态：`Confirmed`

受支持 NVIDIA Windows 安装同一候选包后，Auto/Forced CUDA/Forced CPU、取消与失败分类符合 `AC-LV-21` 并完成真实短样本

实现归属：`whisper_backend`、CUDA worker、universal installer。

裁判：独立 Evidence runner 记录 GPU/驱动、包/模型哈希；Auto 与 Forced CUDA 真实输出；Forced CPU 不启动 worker；取消/崩溃/模型错误 Evidence。Required Evidence tier：Strong + Release Evidence。

明确范围外：把本机旧 smoke 自动继承给 RC、跨所有 NVIDIA 型号承诺。

### AC-RL-09

状态：`Confirmed`

公开 installer 和主可执行文件使用受信任 Windows 代码签名；私钥不进入仓库、日志或 artifact

实现归属：人类 release/security owner、签名流水线。

裁判：目标下载物离线/在线签名验证、证书链/时间戳记录、secret scan。Required Evidence tier：Strong + Human approval + Release Evidence。

明确范围外：AI 自批证书、仓库保存私钥、自签名证书作为正式证明。

### AC-RL-10

状态：`Confirmed`

每个 RC/正式下载物同时发布 SHA-256、机器可读 artifact manifest、SBOM 和第三方 notices，且全部来自同一目标 SHA

实现归属：release manifest generator。

裁判：从安装器反算哈希；依赖/资源与 SBOM/notices 对账；目标 SHA/构建环境可定位。Required Evidence tier：Strong + Release Evidence。

明确范围外：法律批准、运行时能力 Evidence。

### AC-RL-11

状态：`Confirmed`

CUDA runtime 再分发在公开发布前取得人类 release/legal owner 的书面批准，批准范围与实际 DLL/版本一致

实现归属：人类 release/legal owner。

裁判：签署记录、DLL 清单/版本/来源/许可证逐项对账。Required Evidence tier：Human approval + Release Evidence。

明确范围外：AI 或测试代替法律判断；分发 `nvcuda.dll`。

### AC-RL-12

状态：`Confirmed`

发布产物不含 live key、调试 override、开发绝对路径、SQLite/用户数据、日志、旧 Evidence、source map 秘密或未批准 DLL

实现归属：artifact hygiene scanner、release owner。

裁判：解包 installer 扫描；secret/path/denylist；允许资源 manifest 精确白名单。Required Evidence tier：Strong + Release Evidence。

明确范围外：证明业务行为、替代代码审查。

### AC-RL-13

状态：`Confirmed`

数据库从冻结旧 fixture 通过版本化事务迁移到当前 schema；失败回滚或保留可恢复备份，重复启动幂等

实现归属：Database deep module、Rust migration command。

裁判：真实旧 SQLite fixture；生产初始化路径；成功数据/约束检查；逐步故障注入、备份和第二次启动。Required Evidence tier：Strong + Release Evidence。

明确范围外：只测空库；前端发送事务控制 SQL；支持未冻结任意 schema。

### AC-RL-14

状态：`Confirmed`

RC Evidence 只对精确 commit、installer hash、配置/模型/硬件指纹有效；影响对应边界的代码或产物变化使其失效

实现归属：Evidence manifest/validator、release evidence owner。

裁判：freshness policy 自动比较 target SHA/hash/config；过期 Evidence 必须被拒绝而非警告放行。Required Evidence tier：Strong。

明确范围外：自动删除历史 Evidence；把单元测试升级成真实 Evidence。

### AC-RL-15

状态：`Confirmed`

P0/P1 和影响 Launch AC、数据/秘密安全或 Evidence 真实性的 P2 阻断发布；非阻断 P2 必须进入 Release Notes 或已拥有 Owner/Judge 的后续队列

实现归属：human release owner、defect policy。

裁判：缺陷/审查 fixture 逐级触发阻断或允许；发布决策与例外有签署记录。Required Evidence tier：Strong + Human approval。

明确范围外：用 skip/ignore 降低严重度、在本 AC 执行回滚。

### AC-RL-16

状态：`Confirmed`

正式 tag 只引用已验收 RC；从用户可见 URL 重新下载的安装器与 RC 的签名、SHA-256 和 manifest 完全一致并可干净安装

实现归属：release publication owner。

裁判：独立 download verifier 完成 tag/commit/RC 对账、公开 URL 二次下载和签名/哈希/安装复验。Required Evidence tier：Strong + Release Evidence。

明确范围外：发布后重新构建不同二进制；只核对文件名。

### AC-RL-17

状态：`Confirmed`

首轮生产观察只收集用户明确授权的脱敏诊断，不上传视频、转录、API Key 或 SQLite；缺陷绑定版本、AC、Judge 和严重度

实现归属：support/privacy owner、diagnostic exporter。

裁判：同意流程、诊断 schema/secret scan、撤回/不上传路径、首轮缺陷记录。Required Evidence tier：Strong + Production observation。

明确范围外：默认遥测、远程采集用户内容、把观察当成 AC Evidence。

### AC-RL-18

状态：`Confirmed`

下载页与安装器在安装前披露单一安装包、约 804 MB、NVIDIA/模型要求、无兼容环境的 Auto 可见 CPU fallback、Forced CPU/GPU、失败/重试和数据保留

实现归属：release/download disclosure owner、installer UI。

裁判：下载页 + 安装器真实 UI/文本 Judge，并与 installer manifest、GPU/runtime 行为 Evidence 对账；不得把受控 URL 写成真实站点保证。Required Evidence tier：Strong + Desktop/Visual + Release Evidence。

明确范围外：Release Notes、营销性扩大承诺、未验证硬件/模型兼容性。

### AC-RL-19

状态：`Confirmed`

回滚只能到签名、哈希已知且与当前用户数据兼容的已验收版本；不兼容时停止分发并提供备份/恢复指引，不静默降级 schema

实现归属：human release owner、rollback runbook、database compatibility owner。

裁判：已安装 RC 回滚演练；签名/哈希/数据库兼容检查；不兼容 fixture 必须拒绝并保留数据。Required Evidence tier：Strong + Human approval + Release Evidence。

明确范围外：缺陷严重度判定、自动跨主版本降级。

### AC-RL-20

状态：`Confirmed`

Release Notes 精确列出 Launch、Post-release 与不承诺能力、已验证配置、已知限制、非阻断 P2 和回滚方式，且不得把候选或局部 Evidence 写成已交付事实

实现归属：release notes owner、scope contract。

裁判：Release Notes 与 Active scope、Confirmed AC/coverage、目标 artifact、有效 Evidence、缺陷队列和回滚 runbook 逐项对账。Required Evidence tier：Strong + Release Evidence。

明确范围外：下载页/安装器 UI、营销性扩大承诺、未验证硬件/模型兼容性。

### AC-VL-01

状态：`Confirmed`

ready/non-ready 卡片按持久状态展示规定的信息层级，状态、错误、进度和可用动作不互相伪装

实现归属：VideoListPage 查询层、VideoCard。

裁判：生产页面 + 公共数据库双 adapter；各状态 DOM/视觉 Judge；错误动作可恢复。Required Evidence tier：Strong + Visual Evidence。

明确范围外：排序、搜索、网格尺寸、真实桌面 Evidence。

### AC-VL-02

状态：`Confirmed`

列表默认最近学习，并支持最近学习/导入时间/名称三种确定排序；SQLite 与内存 adapter 同义

实现归属：Database query interface、VideoListPage controls。

裁判：同一 fixture 在双 adapter 和生产 UI 中顺序一致；稳定 tie-breaker。Required Evidence tier：Strong。

明确范围外：标签、筛选、正文搜索。

### AC-VL-03

状态：`Confirmed`

标题关键词搜索只作用于视频标题，可清空并与当前排序组合；没有结果与数据库失败可区分

实现归属：Database query interface、VideoListPage controls。

裁判：双 adapter 大小写/空白/无结果 fixture + 生产 UI。Required Evidence tier：Strong。

明确范围外：标签、笔记/字幕全文、模糊语义扩展。

### AC-VL-04

状态：`Confirmed`

生产列表页把导入入口、排序、搜索、空库、无搜索结果和非 ready 详情入口组合为完整可用页面，不出现空动作

实现归属：VideoListPage composition。

裁判：生产页面行为 Judge；空库/过滤空/失败/任务详情；必要桌面 DOM。Required Evidence tier：Strong + Desktop Evidence。

明确范围外：卡片精确视觉、真实站点兼容。

### AC-VL-05

状态：`Confirmed`

删除已知 Video 在数据库提交后删除其合法 app-owned 缩略图；失败语义可见且绝不删除用户源视频或任意路径

实现归属：Rust thumbnail lifecycle module、database deletion workflow。

裁判：隔离真实文件系统 + 真实 SQLite；非法 ID/path、删除失败、源视频哈希、重试。Required Evidence tier：Strong。

明确范围外：孤儿扫描、安装器卸载数据策略。

### AC-VL-06

状态：`Confirmed`

孤儿 GC 只删除 app-data `thumbnails/` 中不在数据库 keep-set 的合法缩略图，幂等、有界且失败可诊断

实现归属：Rust thumbnail lifecycle module。

裁判：隔离真实目录/SQLite keep-set；路径逃逸、并发新建、重复运行、部分失败。Required Evidence tier：Strong。

明确范围外：用户媒体、模型、任意 app-data 清理、启动时无界阻塞。

### AC-VL-07

状态：`Confirmed`

视频页使用 240px 下限响应式网格、16:9 缩略图和已确认的信息布局；窄宽度不裁掉主操作

实现归属：VideoCard + list layout。

裁判：生产桌面多 viewport DOM/截图 + 独立 visual reviewer。Required Evidence tier：Strong + Desktop/Visual Evidence。

明确范围外：移动端、亮色主题、列表虚拟化性能。

### AC-SU-01

状态：`Confirmed`

顶部目录以章节/小节顶行和段落底行横向展示，可滚动、自动定位当前项，以边缘渐隐提示可继续滚动，并在暂停后停止强制跟随

实现归属：Study catalog view、Study Navigation。

裁判：生产 StudyInterface + 真实播放位置；长目录、边缘渐隐、手动滚动、播放/暂停行为 Judge。Required Evidence tier：Strong + Desktop Evidence。

明确范围外：目录结构编辑、折叠、scrub。

### AC-SU-02

状态：`Confirmed`

目录进度只由统一播放事实推导，章节/小节切换使用受控约 200ms 横向滑动反馈且不制造第二份时间状态

实现归属：Study catalog view、playPosition interface。

裁判：时间推进/跳转/暂停 fixture；横向滑动 DOM 样式、时长与 reduced-motion 状态；复用 `AC-ST-03`。Required Evidence tier：Strong + Desktop/Visual Evidence。

明确范围外：任意动画系统、持久化新的当前位置。

### AC-SU-03

状态：`Confirmed`

右侧面板以 AI/随记 Tab 切换，切换不丢助手会话、笔记草稿或当前学习事实，隐藏区不重复发起副作用

实现归属：Study Page Composition、assistant/notes owners。

裁判：生产页面切换、未完成流/编辑状态、重新显示 Judge。Required Evidence tier：Strong + Desktop Evidence。

明确范围外：Vision、AI 笔记自动生成、多窗口。

### AC-SU-04

状态：`Confirmed`

三种布局的区域比例可调并跨会话恢复，布局变化不卸载媒体会话或改变选择/播放/笔记事实

实现归属：Study Page Composition、layout persistence。

裁判：生产页面拖拽/重启；Store/SQLite 设置；真实 media 实例稳定。Required Evidence tier：Strong + Desktop Evidence。

明确范围外：任意窗口管理、无限布局、自定义主题。

### AC-SU-05

状态：`Confirmed`

Core Release 只提供原文字幕开关；字幕来自真实当前句，位于视频底部半透明容器，关闭后不影响转录文本；不显示译文开关

实现归属：VideoZone、Study Session。

裁判：真实 media 时间推进 + 生产 DOM/截图；开关/重开；无翻译控件。Required Evidence tier：Strong + Desktop/Visual Evidence。

明确范围外：翻译、外部字幕优先、字幕编辑。

### AC-SU-06

状态：`Confirmed`

导图以已持久结构显示类型色节点、正交圆弧连线，并支持有界缩放/平移/选择和既有双击导航

实现归属：mind-map view、Study Navigation。

裁判：生产数据/页面；缩放边界、平移、选择/播放区分、双击跳转、视觉 Judge。Required Evidence tier：Strong + Desktop/Visual Evidence。

明确范围外：折叠、scrub、reparent、多选结构编辑。

### AC-SU-07

状态：`Confirmed`

非输入态精确支持：`1/2/3` 分别切换随播/文本展开/目录展开布局；反引号摘注当前播放段；`Space` 播放/暂停；`←/→` ±5s；`Shift+←/→` ±10s；`↑/↓` 音量；`N/P` 选择下一/上一段、seek 到该段并同步更新预览；`Tab` 在 AI/随记面板间切换并把焦点送入目标面板输入框。输入态只保留 `Enter` 发送与 `Alt+Enter` 换行并屏蔽全局键。Core Release 的 `Del/Backspace` 必须禁用，因为高级树删除为 Post-release

实现归属：Study shortcut controller、focus policy。

裁判：生产页面逐键、首/末段 no-op、各输入/编辑焦点、三布局映射、seek/选中/预览/面板焦点副作用 Judge。Required Evidence tier：Strong。

明确范围外：树/导图键盘导航、AI 快捷操作、用户自定义键位、节点删除/编辑。

### AC-UX-01

状态：`Confirmed`

首发只提供暗色主题；背景/面板/分隔/文字使用冻结中性色阶，通用控件不用品牌强调色

实现归属：design tokens、production components。

裁判：全部首发页面生产截图/token 使用扫描 + visual reviewer。Required Evidence tier：Strong + Visual Evidence。

明确范围外：亮色/系统主题、品牌色系统。

### AC-UX-02

状态：`Confirmed`

段落类型、选中、播放、失败/处理/排队、进度、容器和类型胶囊使用唯一且跨组件一致的语义映射

实现归属：semantic visual tokens、catalog/text/list/mind-map components。

裁判：多状态生产 fixture + 截图/DOM；禁止组件私建冲突颜色。Required Evidence tier：Strong + Visual Evidence。

明确范围外：新段落类型、用户自定义配色。

### AC-UX-03

状态：`Confirmed`

全应用使用系统无衬线、规定字重与 18/16/14/13/12 字号；阅读正文/标题/次正文采用已确认行距并在长文本保持可读

实现归属：typography tokens、production text components。

裁判：token policy + 生产长文本多 viewport visual/accessibility review。Required Evidence tier：Strong + Visual/Accessibility Evidence。

明确范围外：富文本编辑器、用户字体选择。

### AC-UX-04

状态：`Confirmed`

间距、圆角、阴影、控件和关键区域高度只使用冻结令牌；真实页面不存在偶然的一次性几何系统

实现归属：geometry tokens、production layout/components。

裁判：token policy + 生产页面截图/DOM measurement；例外白名单。Required Evidence tier：Strong + Visual Evidence。

明确范围外：像素级适配所有 DPI、用户自定义密度。

### AC-UX-05

状态：`Confirmed`

交互动效只使用 120/200/320ms 档位；系统减少动效时取消位移/缩放并保留即时状态反馈

实现归属：motion tokens、production components。

裁判：浏览器/桌面 reduced-motion 模式；目录/面板/卡片真实状态 Judge。Required Evidence tier：Strong + Desktop/Accessibility Evidence。

明确范围外：视频播放动画、操作系统窗口动画。

### AC-UX-06

状态：`Confirmed`

所有 Launch 主操作可用键盘到达并有可见焦点、可访问名称和非纯颜色状态；文本/控件达到 AA 对比度阈值

实现归属：UI composition、accessibility policy。

裁判：生产页面 axe/DOM/键盘遍历 + 对比度检查 + 独立 accessibility review。Required Evidence tier：Strong + Desktop/Accessibility Evidence。

明确范围外：完整 WCAG 认证、读屏器全语言矩阵。

### AC-PF-01

状态：`Confirmed`

在冻结的 Windows x64 release-reference 机器上，冷启动至可交互的 10 次有效测量 p95 ≤5s

实现归属：app startup owner。

裁判：performance runner 记录正式候选包、空/典型数据 fixture、机器指纹和一次不计入的预备运行；每次杀净进程后执行真实冷启动，10 次有效样本以 p95 阻断。Required Evidence tier：Strong + Performance Evidence。

明确范围外：模型加载/推理、所有硬件保证。

### AC-PF-02

状态：`Confirmed`

500 视频固定 fixture 的列表首屏达到可操作状态的 10 次有效测量 p95 ≤2s

实现归属：Database/List owner。

裁判：performance runner 在正式候选包和固定 SQLite fixture 上每次重启，记录 10 次有效时间戳并以 p95 阻断。Required Evidence tier：Strong + Performance Evidence。

明确范围外：搜索全库基准、无限列表、所有硬件保证。

### AC-PF-03

状态：`Confirmed`

ready 视频从用户打开到学习页骨架和已持久学习事实可见的 10 次有效测量 p95 ≤3s

实现归属：Study Session owner。

裁判：performance runner 使用正式候选包、固定 ready fixture/本地媒体，重置到同一列表状态后打开 10 次并以 p95 阻断。Required Evidence tier：Strong + Performance Evidence。

明确范围外：视频首帧解码、模型调用。

### AC-PF-04

状态：`Confirmed`

已被生产 Controller 接收的合法导入进度到任务详情可见反馈 p95 ≤500ms

实现归属：progress contract/Controller/UI owners。

裁判：performance runner 对固定事件序列和生产页面记录至少 100 次端到端时间戳并以 p95 阻断。Required Evidence tier：Strong + Performance Evidence。

明确范围外：外部下载/ASR/LLM 本身速度。

### AC-PF-05

状态：`Confirmed`

正式候选包先预热 5 分钟，再连续 25 分钟重复列表/学习/导入取消：每轮结束 listener/worker/子进程计数不得高于预热基线，working set 线性回归斜率 ≤1 MiB/min 且末值 ≤预热基线 +50 MiB；退出后无 Rain 子进程残留

实现归属：App lifecycle、Import/Whisper owners。

裁判：reliability runner 执行固定操作循环，记录进程/句柄/listener/working-set 时间序列、基线、回归计算和退出后进程检查；独立 reliability review。Required Evidence tier：Strong + Soak Evidence。

明确范围外：模型自身固定内存、跨日 soak、所有第三方驱动泄漏保证。

### AC-AR-02

状态：`Confirmed`

Stage2、合并和文本助手的 OpenAI-compatible 请求只由前端 LLM adapter 发起；Rust/Tauri 不新增 LLM HTTP command

实现归属：`src/llm/`、capability/request workflows。

裁判：生产请求接口测试 + 负向 dependency/command policy；真实模型按角色 Evidence。Required Evidence tier：Strong。

明确范围外：本地 Whisper、代理服务器、Vision。

### AC-AR-03

状态：`Confirmed`

本地媒体/缩略图只通过限定 app-owned/用户明确选择路径的 asset protocol 能力暴露；生产 scope 不允许通配任意文件系统

实现归属：Tauri capability/asset scope、localMediaUrl adapter。

裁判：capability config 负向 policy + 允许/拒绝真实路径桌面 Judge；路径规范化。Required Evidence tier：Strong + Desktop Evidence。

明确范围外：通用文件浏览器、任意 `convertFileSrc`、网络 URL policy。

### AC-AR-04

状态：`Confirmed`

SQLite 是跨会话业务事实源，Zustand 只保存当前会话选择/播放/UI 草稿；重启不得从 Store 恢复伪业务事实，页面不得复制持久化

实现归属：Database interfaces、Store/session owners。

裁判：重启/重新加载行为 Judge + dependency policy + 双 adapter。Required Evidence tier：Strong。

明确范围外：替换 Zustand、通用 Rust DAL、云同步。

### AC-AR-05

状态：`Confirmed`

`VideoImportController` 由显式 App-scope Owner 持有；页面真正卸载/重挂仍保持同一任务、取消、single-flight 和同记录更新

实现归属：App import owner、VideoImportController。

裁判：生产 App 路由卸载/重挂 Judge；后台任务与迟到结果；无双 Owner。Required Evidence tier：Strong。

明确范围外：跨进程队列、启动自动扫描、新导入行为。

### AC-AR-06

状态：`Confirmed`

导入进度只允许五类判别：`download`（percent，可选 bytes）、`asr`（`extraction/transcription/finalization`、percent、backend/fallback）、`stage2`（percent、blockCurrent/blockTotal、retrying）、`merging`（percent）、`terminal`（`ready/failed/cancelled`，失败才有 error）。公共字段为 videoId；percent 必须 0..100 且同阶段不倒退，blockCurrent 必须在 1..blockTotal，terminal 后拒绝任何更新；本地导入可跳过 download，重试只可从持久 checkpoint 对应阶段重新开始

实现归属：progress domain contract、Pipeline/Controller/event adapters。

裁判：compile-time exhaustive handling + 非法字段组合/未知阶段/倒退百分比/非法 block/终态后 mutation Judge + 全部真实阶段回归。Required Evidence tier：Strong。

明确范围外：新进度阶段、改变现有可见阶段顺序、重写整个 Pipeline。


## 8. 当前明确不在已验收范围

- “解释当前画面”的视觉助手尚未实现完整验收。
- `product-decision-coverage.md` 中 23 条 Post-release `Proposed` 决策尚未形成覆盖其完整当前行为的 Confirmed AC；不能把局部实现或组件 Harness 当作完成。

UI 中未完成的能力应隐藏、禁用并明确标记，不能用无响应按钮表示“已实现”。

## 9. 完成定义

一个改动只有同时满足以下条件才算完成：

1. 指明它对应的 AC。
2. 没有改变未授权的产品语义。
3. 相关行为测试通过。
4. 影响真实主链路时，按风险更新或重跑真实证据。
5. 覆盖矩阵反映新增、增强或仍缺失的验证。
6. `docs/PROJECT_STATE.md` 记录改动和验证结果。
