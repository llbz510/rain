# Rain 验收标准

> 状态：Active
> 更新日期：2026-07-26
> 当前范围：本地视频导入主链路。其他产品模块会在后续受控梳理中逐步加入。

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

## 3. 学习页核心流程

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

## 4. 当前明确不在已验收范围

- 在线 URL 下载和完整处理链路尚未通过真实验收。
- “解释当前画面”的视觉助手尚未实现完整验收。
- 全部 99 条历史产品决策尚未逐条映射到 AC。

UI 中未完成的能力应隐藏、禁用并明确标记，不能用无响应按钮表示“已实现”。

## 5. 完成定义

一个改动只有同时满足以下条件才算完成：

1. 指明它对应的 AC。
2. 没有改变未授权的产品语义。
3. 相关行为测试通过。
4. 影响真实主链路时，按风险更新或重跑真实证据。
5. 覆盖矩阵反映新增、增强或仍缺失的验证。
6. `docs/PROJECT_STATE.md` 记录改动和验证结果。
