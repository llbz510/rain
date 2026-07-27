# Rain Harness 覆盖矩阵

> 状态：Active
> 更新日期：2026-07-27
> 作用：说明每条 AC 由谁检查，以及现有检查能证明到什么程度。

## 1. 覆盖等级

| 等级 | 含义 |
| --- | --- |
| `Strong` | 通过公开接口执行真实行为，并断言结果、状态或副作用 |
| `Partial` | 只覆盖 AC 的一部分，或使用替身而未贯通关键模块 |
| `Evidence` | 真实应用、真实输入和真实外部依赖生成的可校验证据 |
| `Weak` | 只验证函数、常量、字段或文件存在，无法证明行为 |
| `Gap` | 没有可信检查 |

“有测试文件”不代表已经覆盖。判断标准是：把实现改坏以后，这个检查能不能可靠失败。

## 2. 本地视频主链路

| AC | 当前裁判 | 等级 | 当前结论与缺口 |
| --- | --- | --- | --- |
| AC-LV-01 | `preflight.test.ts`、`settings-preflight.test.tsx` | Strong | 覆盖阻塞项、警告项和秘密隐藏；真实桌面环境由 E2E/人工运行补充 |
| AC-LV-02 | `video-list-local-import.test.tsx`、M03/M21 Harness、M17 卡片测试 | Strong | M03/M21 已迁移到真实 `VideoImportController`、内存数据库和桌面命令适配器；覆盖“用户选文件 -> 探测 -> pending -> 启动 Pipeline”，并证明本地导入不调用 `yt-dlp` |
| AC-LV-03 | `pipeline-asr.test.ts`、真实证据 | Strong + Evidence | 已覆盖无模型、坏路径、无 demo fallback、ASR 失败不进 Stage2 |
| AC-LV-04 | `database-recovery.test.ts`、`pipeline-asr.test.ts` | Strong | 覆盖回滚和过期写入防护；Rust 与 SQLite 的真实事务由 E2E 补充 |
| AC-LV-05 | `stage2-runner.test.ts`、M04/M18 Harness、证据校验器 | Strong + Evidence | M04/M18 已迁移到当前 `stage2-contract` / `stage2-runner`，覆盖缺失、重复、外来、树错误、分块、重试、确定性合并和精确覆盖 |
| AC-LV-06 | `pipeline-asr.test.ts`、M03 Harness | Strong | M03 通过真实数据库状态转换和控制器检查批准路径，不再直接给对象赋值 |
| AC-LV-07 | `asr-abort.test.ts`、Pipeline 测试、取消证据 | Strong + Evidence | 真实证据包含取消事件链；UI 到 Rust 的时序风险仍需 E2E 保持 |
| AC-LV-08 | `pipeline-recovery.test.ts`、Stage2 检查点测试、重试证据 | Strong + Evidence | 已覆盖复用 ASR 和重跑坏检查点 |
| AC-LV-09 | `validate-evidence.ps1`、数据库摘要、WebDriver DOM 状态、学习页截图 | Evidence | schema v2 同时要求真实数据库内容与生产学习页、播放器、段落可见；普通单元测试或仅有 PNG 不能替代 |
| AC-LV-10 | `video-list-page-recovery.test.tsx`、`video-list-import.test.tsx` | Strong | 覆盖事件驱动 UI 和持久化终态；真实事件链由 E2E 补充 |
| AC-LV-11 | `validate-evidence.test.ts`、`validate-evidence.ps1` | Strong + Evidence | 覆盖哈希、乱码、demo、CUDA、结构、取消、重启、生产学习页 DOM、截图和秘密；schema v2 不再把“任意 PNG”当作 UI 已就绪 |
| AC-LV-12 | 上述能力/运行时测试、`qwen-health.test.ts`、`live-qwen.test.ts`、`validate-evidence.test.ts`、`validate-evidence.ps1`、真实 E2E Runner、`rain-real-e2e-20260726-195652` | Strong + Evidence（限定已验证组合） | 三角色探针、角色门禁、导入门禁和文本助手门禁均复用生产接口。schema v2 已真实验证 `ggml-large-v3.bin` CUDA ASR + DashScope `qwen3-omni-flash` 结构化与文本助手：当前默认配置、设置连接测试、可选 live smoke 和 E2E 默认值已对齐，但 live smoke 没有 Key 时必须跳过，不能代替 Evidence。该结论只覆盖此配置指纹和文本助手，不推广到其他 OpenAI-compatible 模型或 vision；其他配置仍需各自探针和完整 E2E。旧 schema v1 证据继续按原固定运行时规则验证 |

## 3. 学习页核心流程

| AC | 当前裁判 | 等级 | 当前结论与缺口 |
| --- | --- | --- | --- |
| AC-ST-01 | `database-content.test.ts`、`store-zustand-phase2.test.tsx`、`study-load.test.tsx`、schema v2 DOM/数据库证据 | Strong + Evidence | SQLite adapter 的 Node/Sentence 字段、查询范围和行映射有直接裁判；成功路径从真实数据库一次加载同一视频的元数据、结构、句子和笔记；缺失视频、非 ready 状态和缺少段落/句子的假 ready 记录都会留在列表并显示错误，不再静默进入空学习页 |
| AC-ST-02 | M07 组件 Harness、`study-playback.test.tsx`、`study-navigation.test.tsx` | Strong | 生产 `StudyInterface` 测试证明双击句子和点击通过 ID/时间校验的助手引用都会更新唯一 `playPosition` 与真实 media `currentTime`；播放和暂停状态均不被 seek 路径改变 |
| AC-ST-03 | M05/M07 组件 Harness、`study-playback.test.tsx`、`study-navigation.test.tsx` | Strong | 生产 `StudyInterface` 测试从真实 video `timeupdate` 贯通唯一 `playPosition`、半开区间句子高亮和目录当前态；播放时当前句滚入可视区，暂停时不强制滚动；播放状态由 Store 统一持有 |
| AC-ST-04 | M05 组件 Harness、`study-navigation.test.tsx` | Strong | 生产 `StudyInterface` 测试证明单击只选中；双击章节/节/段落统一解析到子树最早句子，更新 Store 与真实 media、定位对应文本并保持播放/暂停状态；地图预览展示所选节点的真实首段内容 |
| AC-ST-05 | `database-videos.test.ts`、M06 组件 Harness、M15 数据库 Harness、`study-progress.test.tsx` | Strong | SQLite characterization 直接锁定带 `position < $1` 的单调更新和独立 `lastStudiedAt` 写入；生产 `StudyInterface` 测试从真实 media `timeupdate` 写入数据库，证明 Store 当前时间可回退而持久化最远进度不下降；退出后重新加载会恢复 Store/media 位置 |
| AC-ST-06 | `database-notes.test.ts`、M08 数据库/组件 Harness、M15 数据库 Harness、`study-notes.test.tsx`、Rust `note_persistence`/command Harness | Strong | 生产 `StudyInterface` 测试证明整段摘注、自由笔记、编辑、重开读取和引用跳转闭环；前端协议测试锁定单次 `insert_note_atomically` 调用；Rust 在一个 SQLite 连接和事务中写 Note 与全部 sentence 引用，并用第二条重复引用失败直接证明两张表一起回滚 |
| AC-ST-07 | `assistant-context.test.ts`、`study-playback.test.tsx`、能力测试、schema v2 证据 | Strong + Evidence（文本） | 文本上下文、门禁、停止、迟到 token、可信引用和真实文本探针已覆盖；vision 明确不在此 AC |
| AC-ST-08 | M16 状态/组件 Harness、`study-layout.test.tsx` | Strong | M16 只裁判三模式枚举和局部可见性；生产 `StudyInterface` 测试证明三模式复用同一个 media 实例，布局切换只隐藏视频，不清空当前视频、位置、选择、笔记、助手会话或播放状态 |

学习页整体审计结论：现有 M05-M10、M16 Harness 并非无效，但多数只裁判单个组件、函数或占位组合。它们可以保留为局部裁判，不能独自签发跨 Store、媒体元素、SQLite 和多个区域的学习工作流完成状态；`AC-ST-01` 至 `AC-ST-08` 的 Strong 结论以对应生产路径测试为准。

## 4. 架构 Harness 审计

| 规则 | 当前裁判 | 等级 | 问题 |
| --- | --- | --- | --- |
| LLM 只在前端调用 | `harness/m20-boundaries.test.ts` | Strong | 扫描真实 `src/llm/` 源码，禁止 `invoke` / `tauriInvoke` |
| Tauri command “包含且仅包含”规定命令 | `harness/m20-boundaries.test.ts` | Strong | 解析真实 `src-tauri/src/lib.rs` 的 `generate_handler!`，检查精确集合和重复项 |
| 数据库由前端边界模块访问 | `harness/m20-boundaries.test.ts` | Strong | 扫描真实前端源码，确保只有 `src/models/database.ts` 导入 Tauri SQL 插件 |
| 数据库 schema 形状 | M15 schema Harness、`database-schema.ts` | Strong（内存形状）/ Partial（真实 SQLite） | 内存字段和 Tauri 建表 SQL 现在来自同一事实源，消除双份定义漂移；M15 仍只执行内存 adapter，真实 SQLite 初始化需要 Tauri 运行或 Evidence 补充 |
| 数据库 adapter seam | `database-boundary.test.ts`、M15/M20 Harness | Strong（前端边界） | 公共 `Database` 不再声明内存版空实现的 `exec/query`；内部模块不能被生产调用者绕过公共 `database.ts` 入口。真实 SQL 事务仍由 Rust Harness/Evidence 裁判 |
| 导入状态与恢复 seam | `database-import-state.test.ts`、Pipeline recovery tests、M03/M15、Rust persistence tests | Strong（前端路径 + Rust 状态转换） | 公共入口保持不变；SQLite command 参数、内存比较并交换、持久句子恢复判断均有裁判。完整崩溃恢复体验仍由真实 Evidence 补充 |
| 原子导入持久化 seam | `database-import-atomic.test.ts`、`database-recovery.test.ts`、Pipeline/Stage2 tests、M04/M15/M18、Rust persistence tests | Strong（前端路径 + Rust 事务） | 锁定 SQLite command 参数和直接事务顺序；内存与 Rust 共同覆盖失败回滚、过期写保护、树关系和句子精确归属。真实应用完成状态仍由 Evidence 裁判 |
| 学习内容持久化 seam | `database-content.test.ts`、M15、Pipeline/Stage2 tests、`study-load.test.tsx` | Strong（公共接口 + 双 adapter） | 公共 `database.ts` 导出不变；SQLite characterization 锁定完整 Node/Sentence 行、按 Node/Video 查询范围和映射，内存 adapter 与生产学习加载/导入测试覆盖可观察结果 |
| 笔记持久化 seam | `database-notes.test.ts`、M08/M15、`study-notes.test.tsx`、Rust `note_persistence`/command Harness | Strong（前端路径 + Rust 事务） | 公共入口不变；SQLite 写入通过单次 Rust command，在独占连接的真实事务中提交 Note 与全部引用；前端 payload/错误传播、Rust 成功与回滚、内存约束和生产页面重开闭环均有裁判 |
| Video 记录持久化 seam | `database-videos.test.ts`、M15 queries/CRUD、视频列表、`study-load.test.tsx`、`study-progress.test.tsx` | Strong（普通读写） | 公共导出不变；完整 Video 行往返、批准的三种排序、参数化搜索、状态、单调进度和最近学习时间均由 SQLite characterization 与内存/生产路径共同裁判 |
| 视频级联删除 seam | M15 schema CRUD | Partial | 只有内存 ready-video 删除成功路径；当前内存实现会漏删 `node_id = videoId` 的 ASR 占位句子，SQLite 六次 SQL-plugin 删除没有单连接事务证明，且该行为尚无独立 AC |
| progress 事件名称和字段 | M20/M21 前端 Harness、Rust `events`/`commands` Harness | Strong | 覆盖事件订阅转发、重复监听释放、Rust camelCase 序列化和 ASR 子阶段 |
| Rust Harness 系统行为 | `src-tauri/tests/*_harness.rs` | Strong | 覆盖调度串行化、按视频取消、取消令牌、ffmpeg/Whisper/yt-dlp 非法输入、错误上下文和真实媒体 fixture |
| 视觉令牌 | `harness/m13-visual.test.ts` | Strong | 读取并装载应用实际使用的 `src/index.css`，通过 CSSOM 检查变量；不再维护 TS 复制品 |
| 学习页视频语言 | M07 Harness、`study-playback.test.tsx` | Strong | `loadVideo` 将数据库语言写入生产 store，英文译文显示不依赖测试 Context |
| 测试状态注入 | `harness/support/test-store-provider.tsx` | Test support | 只供测试使用；生产源码禁止导入 `harness/support` |

2026-07-26 经用户批准完成两轮 Harness Migration。旧的影子注册表、假导入队列、未接入树编辑、视觉令牌复制品、旧 ASR 标准化和恒真 Rust 测试已被真实接口行为测试替代或明确退役；详见 `harness-migration-2026-07-26.md`。

## 5. 当前不设“已完成”门禁的能力

| 能力 | 状态 | 处理规则 |
| --- | --- | --- |
| 高级树编辑（拆分、合并、重挂、改类型） | Proposed | 没有 Active AC 和真实 UI/数据库闭环；不得恢复只供 Harness 调用的 `tree-ops` |
| 在线 URL 完整导入 | Gap | 进入验收范围前，不得用空 `start_import` command 或字幕/API 标准化函数表示已实现 |
| Vision 解释当前画面 | Gap | 必须有截图、图像请求和模型能力验证后才能加入完成门禁 |

## 6. 变更时如何查表

例如修改取消逻辑：

1. 查到对应 `AC-LV-07`。
2. 实现应集中在取消接口、Pipeline signal 和 Rust task。
3. 至少运行取消/ASR/Pipeline 相关测试。
4. 如果修改了跨前后端取消协议，必须重跑真实取消证据，不能只看单元测试。
5. 更新本表的等级或缺口。

这就是“每条 AC 被谁管”：实现模块负责让它成立，裁判负责在它失效时报警。
