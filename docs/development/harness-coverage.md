# Rain Harness 覆盖矩阵

> 状态：Active
> 更新日期：2026-07-29
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
| AC-LV-13 | `video-list-deletion.test.tsx`、`database-video-deletion.test.ts`、M15/M20/M21、Rust `video_deletion` tests | Strong（生产页面 + 活动任务结算 + 公共接口 + Rust 事务） | 生产页面按需单飞读取真实段落/笔记数量，支持确认/取消；删除前以 per-Video stopping gate 阻止重复/新 start，取消并等待全部活动任务，防止迟到 checkpoint 复活；桌面取消失败立即可见且不删除；URL 发布交接的取消必须在 Pipeline 接管前释放旧 Owner，使删除失败保留的记录仍可重试。事务提交后立即发布卡片移除，读取失败不得谎报删除失败，无 Owner 时没有静默确认。数据库与 Rust 真实 SQLite 继续锁定全部归属数据清理、隔离、末步失败回滚和缺失 Video 幂等；当前没有把该 jsdom Judge 称为桌面 E2E |
| AC-LV-14 | `runtime-settings-store.test.ts`、`runtime-settings-ui.test.tsx`、`settings-boundary.test.ts`、`database-settings.test.ts`、`model-pool.test.ts`、`run-runtime-settings-e2e.ps1`、M20、Rust `settings_persistence` tests | Strong（UI/Store 提交门禁 + 业务批次 + Rust 事务 + 真实桌面重启） | 添加、删除和角色选择只在快照落库后发布；失败保留两个内存副本并可见报错；Settings UI 不得绕过 Store hydration。模型快照保存与旧格式迁移均组装单批 mutation，Rust 锁定成功提交、无关 key 隔离和末步失败全回滚；短 E2E 证明无 Key 测试模型经真实 Tauri/SQL plugin/隔离 SQLite 添加后跨进程存在 |
| AC-LV-15 | `runtime-settings-store.test.ts`、`runtime-settings-ui.test.tsx`、`model-pool.test.ts`、`run-runtime-settings-e2e.ps1`、database Settings tests、Rust `settings_persistence` tests | Strong（Store 候选快照 + 持久化事务 + 真实桌面重启） | 公开删除动作把模型、全部角色引用和能力记录放入同一候选快照；旧 Key 由同一 mutation batch 清理；失败时 UI、Store 和 SQLite 均保留旧事实；短 E2E 删除后再次启动并证明条目没有复活 |
| AC-LV-16 | `runtime-settings-store.test.ts`、`settings-readiness-observability.test.tsx`、`run-runtime-settings-e2e.ps1`、既有 Runtime Settings Store/UI/SQLite tests | Strong（独立时序 + 真实启动 hydration + 既有纵向裁判） | 直接控制加载与保存 Promise 的完成顺序，证明未就绪拒绝、跨动作串行、第二快照继承首个提交和 stale hydration 失效；设置页公开 loading/ready/error 状态供桌面 Judge 等待，短 E2E 在 ready 后写入并跨两次进程重启；数据库事务协议不变 |
| AC-LV-17 | `video-import-url.test.ts`、`src-tauri/src/ytdlp_tests.rs`、M20 | Strong（公开 Controller 纵切 + 生产 Rust 深 seam + 受控真实子进程 + 精确注册边界） | Controller 与真实内存数据库证明外部进程前的唯一记录、失败关闭、URL 与独立 query secret 脱敏、进度、显式/调度器取消、初次发布及两类重试的连续 Owner、清理失败分类、交接失败关闭、受门禁的本地文件附着与严格 `download → pending` 发布，以及附着前后同记录重试；Rust Judge 直接执行生产调度 seam，并以真实 PowerShell 子进程和隔离临时目录证明可取消探测、下载进度、Windows 后代进程终止、清理失败可见、单文件目录提交和提交后幂等复用；经批准的 M20 只新增深 command `import_online_video` 并继续拒绝其他未批准 command。结论不扩展到真实站点兼容或完整外网 Evidence |
| AC-LV-18 | `video-thumbnail-ownership.test.tsx`、`video-list-local-import.test.tsx`、`video-import-local-id.test.ts`、M21、Rust `thumbnail_storage_tests.rs` | Strong（生产卡片 + 页面/Controller 公开路径 + 真实文件副作用） | 生产卡片通过既有 `localMediaUrl` 桥接本地绝对路径、保留 HTTP(S) 并为空值显示占位；未锁定 Controller Judge 证明两个 Controller 共享数据库并发导入时仍在任何缩略图副作用前取得唯一 Video ID，经批准迁移的 M21 仅证明前端只传 `filePath/videoId/timestamp` 并持久化 app-owned 返回路径；生产页面证明缩略图失败以包含底层诊断的非致命状态可见且 Pipeline 继续；Rust 深 module 通过真实媒体和隔离 app-data 证明非空原子提交、源目录不变、非法 ID 拒绝、普通失败无残留、既有最终文件保护，以及操作系统拒绝清理时失败不得被吞掉。在线缩略图本地化、删除/GC、精确视觉和桌面 E2E 不在本行 |
| AC-LV-19 | `video-import-task-dialog.test.tsx`、`stage2-runner.test.ts`、`pipeline-asr.test.ts`、`video-list-page-recovery.test.tsx`、`video-list-deletion.test.tsx`、M17 | Strong（生产页面/App 生命周期 + 生产 Stage2/Pipeline + 公开 Controller + 真实内存数据库） | 生产页面逐一证明 `pending/processing/failed/cancelled` 卡只打开同一记录详情且关闭无持久化或任务副作用；详情展示 SQLite 状态/阶段/错误和完整实时阶段、百分比、分块与重试事实，显式重试/取消才进入公开 Controller，关闭时后台继续并在完成后刷新。App 往返设置页的 Judge 证明同一前端 Pipeline Owner 没有因页面切换丢失；无内存 Owner 的重启遗留 `processing` 仍调用桌面取消并以精确持久态闭合。Stage2 runner 用真实两块及首块无效响应证明 block/retrying/percent 生产，Pipeline 与页面分别证明公开回调贯通和可见结果，不依赖虚构事件签发。删除竞态 Judge 还证明 URL 媒体发布后取消会把无人接管的 `pending` 收口为可重试 `cancelled/download` 并清除旧实时覆盖。M17 仍只保留局部卡片回调合同；进程重启后的 `pending` 自动恢复另列为当前风险，本行不签发桌面重启自动恢复或精确视觉 |

## 3. Whisper 模型下载

| AC | 当前裁判 | 等级 | 当前结论与缺口 |
| --- | --- | --- | --- |
| AC-MM-01 | Rust `whisper_model_download` tests、M20 | Strong | 固定上游 revision/文件名/字节数/SHA-256；本地 HTTP 与临时目录直接证明验证后提交、坏哈希清理、旧文件保留、替换失败保护和有效文件幂等复用；M20 锁定真实下载/列举 command |
| AC-MM-02 | Rust `whisper_model_download` tests、M20 | Strong | `Response::chunk` 增量写入和增量哈希；recording reporter 锁定单调进度；并发 fixture 锁定每型号单 writer、取消清理和干净重试；停滞网络 fixture 证明取消会唤醒等待中的读取；M20 锁定独立取消 command |
| AC-MM-03 | `whisper-model-download.test.tsx`、M19/M20 | Strong | 真实 `AddModelForm` 通过生产 Tauri adapter/event seam 展示数值进度、发出取消、区分取消/失败、允许重试、释放 listener，并在安装列表复核后才显示成功；浏览器仍禁用本地下载 |
| AC-MM-04 | `runtime-settings-store.test.ts`、`whisper-model-download.test.tsx`、M20、Rust `whisper_model_download` tests | Strong（Store 门禁 + 真实表单 + command/list） | 表单在安装验证前禁用保存；Store 公开添加动作再次调用共享 installed-list 校验，未安装时不触发 Runtime Settings 保存；安装只允许入池，不签发 ASR 能力 |

## 4. 学习页核心流程

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

## 5. Engineering Harness

| AC | 当前裁判 | 等级 | 当前结论与缺口 |
| --- | --- | --- | --- |
| AC-HE-01 | `control-plane-validator.test.ts`、`control-plane-validator.mjs`、`package.json` | Strong（纯规则 fixture + 真实仓库命令） | fixture 锁定缺覆盖、缺 Owner/Judge、裁判文件不存在、验收状态冲突和当前事实降级；`harness:control` 检查真实文档，`harness:check` 继续执行前端、E2E/普通互补构建和 Rust，不替代昂贵 Evidence 决策 |
| AC-HE-02 | `verify-e2e-build-isolation.test.ts`、`verify-e2e-build-isolation.mjs`、`build-e2e-frontend.mjs`、`package.json`、`run-runtime-settings-e2e.ps1` | Strong（独立污染 fixture + 每轮真实双构建产物 + 真实 Tauri 启动） | 普通构建扫描全部 JS 与 JS source map 并拒绝 E2E result/schema/status 标记；独立 fixture 证明仅存在于 source map 的标记不能漏过；`harness:check` 每轮先执行无 Tauri E2E 前端构建并反向要求三项标记存在，再以普通构建恢复 `dist`，防止禁用过度造成假绿；短桌面 Judge 证明启用 adapter 可被真实应用加载。完整收费 E2E 未因本次入口隔离重跑 |
| AC-HE-03 | `run-runtime-settings-e2e.ps1` | Strong（真实失败 + 真实成功） | `MaxSeconds=0` 的真实 Tauri 启动先证明失败退出仍保留 summary/driver logs、阶段和主错误，注入的探针 Key 不在任何文件中；随后完整无 Key 桌面闭环证明成功会清理单份 latest-failure。诊断捕获不替代产品 AC 或完整 Evidence |
| AC-HE-04 | `.github/workflows/harness.yml`、`package.json`、GitHub workflow `Harness` / check `Clean Windows Harness` | Strong（真实 hosted runner） | PR run `30327093540` 在干净 `windows-2025` checkout 以只读权限完成 `npm ci` 和唯一 `harness:check`：445 个前端测试、E2E/生产双构建和 96 个 Rust 测试通过；一项 live-key 测试跳过、一项真实 Whisper 模型测试 ignored，均符合既有显式合同 |
| AC-HE-05 | `.github/workflows/runtime-settings-desktop-e2e.yml`、`src-tauri/src/e2e_config.rs`、`src-tauri/src/lib.rs`、`package.json`、`run-runtime-settings-e2e.ps1`、GitHub workflow `Runtime Settings Desktop E2E` | Strong（真实 target-commit Hosted Windows run） | workflow_dispatch run `30341065896` 在 merge commit `9251962` 的干净 checkout 中核对 WebView2 Runtime/driver 150.0.4078.65，执行未带 `-SkipBuild` 的唯一公开命令，并完成真实 schema、添加、第一次重启保留、删除、第二次重启消失；failure artifact 为 0，未使用 Rain secrets、模型调用、Whisper 下载、视频导入或 Evidence。该结论只签发此目标提交，workflow 仍为人工且非必需门禁 |
| AC-HE-06 | `control-plane-validator.test.ts`、`control-plane-validator.mjs`、`product-decision-coverage.md` | Strong（纯规则 fixture + 真实 99 项映射） | fixture 锁定 001–099 完整唯一、三种处置、Confirmed AC 引用、非空边界和当前 PRD/M 事实源；`harness:control` 对真实覆盖图执行同一规则。该结论只证明意图有当前去向，不证明 Proposed 或 Out-of-scope 功能已实现 |

## 6. 架构 Harness 审计

| 规则 | 当前裁判 | 等级 | 问题 |
| --- | --- | --- | --- |
| AC-AR-01 | `database-architecture-policy.test.ts`、`database-boundary.test.ts`、M15/M20、数据库公共接口 tests、Rust persistence tests | Strong（负向 fixture + 真实生产树 + 公共接口 + Rust 事务） | policy fixture 独立证明 SQL plugin 越界、内部数据库 module 逃逸和前端事务控制都会失败，并对真实 `src/` 执行同一规则；M15 的 ASR 原子 Judge 已迁移到生产 `saveAsrAtomically`，Rust `asr_persistence` 直接证明第二条插入失败和 stale commit 时句子与 Video 状态一起回滚。普通单记录 SQL 仍封装在数据库内部 module；本行不授权通用 Rust DAL |
| LLM 只在前端调用 | `harness/m20-boundaries.test.ts` | Strong | 扫描真实 `src/llm/` 源码，禁止 `invoke` / `tauriInvoke` |
| Tauri command “包含且仅包含”规定命令 | `harness/m20-boundaries.test.ts` | Strong | 解析真实 `src-tauri/src/lib.rs` 的 `generate_handler!`，检查精确集合和重复项 |
| 数据库由前端边界模块访问 | `harness/m20-boundaries.test.ts` | Strong | 扫描真实前端源码，确保只有 `src/models/database.ts` 导入 Tauri SQL 插件 |
| 数据库 schema 形状 | M15 schema Harness、`database-schema.ts`、`real-e2e-runner-mode.test.tsx`、`run-runtime-settings-e2e.ps1` | Strong（内存 + 真实 SQLite 必需形状） | 内存字段和 Tauri 建表 SQL 来自同一生产事实源；M15 锁定公共 metadata interface 的内存合同。短桌面 Judge 再让生产 `getDb()` 通过真实 Tauri SQL plugin 初始化隔离 SQLite，由应用只报告 `listTables/getTableColumns` 实际值，脚本用独立字面合同检查 7 张表及必需列，避免生产 schema 常量自证；新增列的兼容/迁移政策仍不在本行范围内 |
| 数据库 adapter seam | `database-boundary.test.ts`、M15/M20 Harness | Strong（前端边界） | 公共 `Database` 不再声明内存版空实现的 `exec/query`；内部模块不能被生产调用者绕过公共 `database.ts` 入口。真实 SQL 事务仍由 Rust Harness/Evidence 裁判 |
| 导入状态与恢复 seam | `database-import-state.test.ts`、Pipeline recovery tests、M03/M15、Rust persistence tests | Strong（前端路径 + Rust 状态转换） | 公共入口保持不变；SQLite command 参数、内存比较并交换、持久句子恢复判断均有裁判。完整崩溃恢复体验仍由真实 Evidence 补充 |
| 原子导入持久化 seam | `database-import-atomic.test.ts`、`database-recovery.test.ts`、Pipeline/Stage2 tests、M04/M15/M18、Rust persistence tests | Strong（前端路径 + Rust 事务） | 锁定生产 command 参数和错误传播；M15 通过 `saveAsrAtomically` 裁判句子与 Video 阶段的共同提交和迟失败回滚，不再保护前端事务影子接口。内存与 Rust 共同覆盖失败回滚、过期写保护、树关系和句子精确归属；真实应用完成状态仍由 Evidence 裁判 |
| 学习内容持久化 seam | `database-content.test.ts`、M15、Pipeline/Stage2 tests、`study-load.test.tsx` | Strong（公共接口 + 双 adapter） | 公共 `database.ts` 导出不变；SQLite characterization 锁定完整 Node/Sentence 行、按 Node/Video 查询范围和映射，内存 adapter 与生产学习加载/导入测试覆盖可观察结果 |
| 笔记持久化 seam | `database-notes.test.ts`、M08/M15、`study-notes.test.tsx`、Rust `note_persistence`/command Harness | Strong（前端路径 + Rust 事务） | 公共入口不变；SQLite 写入通过单次 Rust command，在独占连接的真实事务中提交 Note 与全部引用；前端 payload/错误传播、Rust 成功与回滚、内存约束和生产页面重开闭环均有裁判 |
| Video 记录持久化 seam | `database-videos.test.ts`、M15 queries/CRUD、视频列表、`study-load.test.tsx`、`study-progress.test.tsx` | Strong（普通读写） | 公共导出不变；完整 Video 行往返、批准的三种排序、参数化搜索、状态、单调进度和最近学习时间均由 SQLite characterization 与内存/生产路径共同裁判 |
| Settings 持久化 seam | `database-settings.test.ts`、M15 settings/recovery、`model-pool.test.ts`、`model-capabilities.test.ts`、预检/设置 UI 测试 | Strong（公共接口 + 双 adapter） | SQLite characterization 锁定参数化 upsert/read/delete、空值/缺失值和错误传播；M15 锁定内存 CRUD；Key 分离、旧配置迁移、能力记录与配置变更失效由上层行为测试托管 |
| Runtime Settings 快照保存 | `runtime-settings-store.test.ts`、`runtime-settings-ui.test.tsx`、`settings-boundary.test.ts`、`database-settings.test.ts`、`model-pool.test.ts`、`run-runtime-settings-e2e.ps1`、M20、Rust `settings_persistence` tests | Strong（发布门禁 + 业务批次 + Rust 事务 + 真实桌面重启） | `AC-LV-14` 从 UI 可见结果、Store 状态、业务 mutation batch 到真实 SQLite 事务形成纵向裁判；失败不会发布内存假成功，SQLite 末步失败会回滚全部变更并保留无关 key；短 E2E 补上真实 Tauri/SQL plugin/schema 初始化与跨进程 hydration |
| 视频级联删除 seam | `video-list-deletion.test.tsx`、`database-video-deletion.test.ts`、M15/M20/M21、Rust `video_deletion` tests | Strong（生产页面 + 活动任务结算 + 公共接口 + Rust 事务） | `AC-LV-13` 从生产卡片的单飞真实计数、确认/取消、stop-new-work→cancel→await-all→delete、取消失败不删除、URL handoff Owner 释放、提交结果发布和失败可见，贯穿公共接口、前端单 command、内存全清理与隔离，直到真实 SQLite 成功/晚失败回滚/幂等；不冒充尚不存在的删除桌面 E2E |
| ASR Transcript seam | Rust `asr_transcript` tests、`pipeline-asr.test.ts`、真实证据 | Strong + Evidence | `AC-LV-03` 的 fail-closed 结果门禁由真实 `build_asr_transcript` 直接裁判：覆盖空结果、空白/乱码、无效/逆序/重叠时间戳、无词级时间戳回退、可疑 token、长段分句和全局唯一 ID；Pipeline 测试继续证明失败不进入 Stage2，真实 Evidence 补充 Whisper 运行结果。ASR 执行生命周期仍由 scheduler/events/command 测试和 Evidence 分别托管 |
| ASR Execution seam | Rust `asr_execution`/`scheduler` tests、`commands_harness`、`whisper_harness`、`pipeline-asr.test.ts`、取消证据 | Strong + Evidence | `AC-LV-03/07/10` 的一次执行由 `execute_asr` 托管；私有 backend/reporter seam 直接裁判 10/35/90/100 进度顺序、成功终态、后端失败和转换中取消，scheduler Harness 锁定串行化与过期任务隔离，Whisper Harness 锁定真实取消下沉，Pipeline/Evidence 补充跨前后端状态 |
| progress 事件名称和字段 | M20/M21 前端 Harness、Rust `events`/`commands` Harness | Strong | 覆盖事件订阅转发、重复监听释放、Rust camelCase 序列化和 ASR 子阶段 |
| Rust Harness 系统行为 | `src-tauri/tests/*_harness.rs` | Strong | 覆盖调度串行化、按视频取消、取消令牌、ffmpeg/Whisper/yt-dlp 非法输入、错误上下文和真实媒体 fixture |
| 视觉令牌 | `harness/m13-visual.test.ts` | Strong | 读取并装载应用实际使用的 `src/index.css`，通过 CSSOM 检查变量；不再维护 TS 复制品 |
| 学习页视频语言 | M07 Harness、`study-playback.test.tsx` | Strong | `loadVideo` 将数据库语言写入生产 store，英文译文显示不依赖测试 Context |
| 测试状态注入 | `harness/support/test-store-provider.tsx` | Test support | 只供测试使用；生产源码禁止导入 `harness/support` |
| Control Plane 一致性 | `control-plane-validator.test.ts`、`control-plane-validator.mjs`、`product-decision-coverage.md` | Strong（纯规则 + 真实仓库） | fixture 证明缺覆盖、缺 Owner/Judge、裁判文件不存在、验收状态冲突、当前事实降级，以及历史产品决策缺失/重复、非法处置、无效 AC 与事实源都会失败；`npm run harness:control` 对真实仓库执行同一 validator |

2026-07-26 经用户批准完成两轮 Harness Migration。旧的影子注册表、假导入队列、未接入树编辑、视觉令牌复制品、旧 ASR 标准化和恒真 Rust 测试已被真实接口行为测试替代或明确退役；详见 `harness-migration-2026-07-26.md`。

## 7. 当前不设“已完成”门禁的能力

| 能力 | 状态 | 处理规则 |
| --- | --- | --- |
| 高级树编辑（拆分、合并、重挂、改类型） | Proposed | 没有 Active AC 和真实 UI/数据库闭环；不得恢复只供 Harness 调用的 `tree-ops` |
| 在线 URL 真实站点兼容与完整外网 Evidence | Gap | `AC-LV-17` 只确认无网络的受控本地交接；站点差异、登录态、播放列表、多小时/GB 级下载和完整模型链路仍需独立 Evidence |
| Vision 解释当前画面 | Gap | 必须有截图、图像请求和模型能力验证后才能加入完成门禁 |

## 8. 变更时如何查表

例如修改取消逻辑：

1. 查到对应 `AC-LV-07`。
2. 实现应集中在取消接口、Pipeline signal 和 Rust task。
3. 至少运行取消/ASR/Pipeline 相关测试。
4. 如果修改了跨前后端取消协议，必须重跑真实取消证据，不能只看单元测试。
5. 更新本表的等级或缺口。

这就是“每条 AC 被谁管”：实现模块负责让它成立，裁判负责在它失效时报警。
