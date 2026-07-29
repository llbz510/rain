# Rain 验收标准

> 状态：Active
> 更新日期：2026-07-29
> 当前范围：本地视频导入主链路、在线 URL 到受控本地媒体的导入交接。其他产品模块会在后续受控梳理中逐步加入。

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

实现归属：数据库删除接口、Rust SQLite 单事务持久化。

裁判：公共数据库接口测试、M15 删除 Harness、Rust SQLite 成功与晚失败回滚测试、M20 真实 command 注册。

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

## 6. 当前明确不在已验收范围

- “解释当前画面”的视觉助手尚未实现完整验收。
- `product-decision-coverage.md` 中 54 条 `Proposed` 决策尚未形成覆盖其完整当前行为的 Confirmed AC；不能把局部实现或组件 Harness 当作完成。

UI 中未完成的能力应隐藏、禁用并明确标记，不能用无响应按钮表示“已实现”。

## 7. 完成定义

一个改动只有同时满足以下条件才算完成：

1. 指明它对应的 AC。
2. 没有改变未授权的产品语义。
3. 相关行为测试通过。
4. 影响真实主链路时，按风险更新或重跑真实证据。
5. 覆盖矩阵反映新增、增强或仍缺失的验证。
6. `docs/PROJECT_STATE.md` 记录改动和验证结果。
