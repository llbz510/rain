# Rain Launch 功能路径审计

> 状态：Active
> 更新日期：2026-08-29

本审计只回答当前生产路径是 `Present`、`Partial`、`Shadow/adjacent` 还是 `Absent`，并记录局部入口与 blocker ledger；它不是第三份 AC 或“完成状态”事实源。AC 语义唯一来自 `acceptance-standard.md`，Judge 与 tier 唯一来自 `harness-coverage.md`。路径存在绝不等于 AC 已完成：除明确写为“无”“无新增必需”“仅补强”或“条件性未来重放”的行外，Required Evidence 状态中的任何未闭合项都是当前 blocker；`阻断：`只是显式强调，不是唯一判定条件。ledger 采用同一规则。

## Confirmed AC 生产路径（89 行；`AC-RL-07` 已 Superseded，未计入）

下表 AC 列为完整 AC 标识的紧凑写法：例如 `LV-01` 即 `AC-LV-01`，其余前缀同理；不代表另一套合同。

| AC | 生产路径 | 生产路由/公开入口或缺失点 | 当前 Judge/tier | Required Evidence 状态 | 当前禁令/下一合法动作 |
| --- | --- | --- | --- | --- |
| LV-01 | Present | 设置预检与运行时能力入口 | preflight/settings-preflight — Strong | 无；桌面仅补强 | 不把单测扩为桌面；按 AC 单独重放 |
| LV-02 | Present | VideoListPage → VideoImportController | local-import、M03/M21 — Strong | 无新增必需 | 保持现有公开入口 |
| LV-03 | Present | asr-runner → Pipeline → Rust | pipeline-asr — Strong + Historical Evidence | 精确 RC 真实 ASR | 禁止 demo/旧 Evidence 替代 |
| LV-04 | Present | 原子 ASR 保存接口 | recovery/pipeline-asr — Strong | 无；真实 SQLite/E2E 仅补强 | 不以内存替代事务 |
| LV-05 | Present | stage2-contract/runner | stage2、M04/M18 — Strong + Historical Evidence | 精确 RC 结构化重跑 | 禁止旧包签发当前目标 |
| LV-06 | Present | import-state/Pipeline | pipeline-asr、M03 — Strong | 无新增必需 | 保持批准状态机 |
| LV-07 | Present | 取消 UI → AbortSignal → worker | ASR abort/Pipeline — Strong + Historical Evidence | 当前 worker/RC 取消证据 | 禁止对象自证取消 |
| LV-08 | Present | Pipeline checkpoint recovery | recovery/stage2 — Strong + Historical Evidence | 精确 RC restart proof | 禁止旧证据升级 |
| LV-09 | Present（current-target Gap） | Pipeline 完成 → Store loadVideo | validate-evidence/DOM/screenshot — Historical Evidence / Gap | 当前目标真实 DB+DOM+截图 | 禁止普通 UI/PNG 替代 |
| LV-10 | Present | Tauri progress → 列表卡片 | recovery/import page — Strong | 无；真实事件链仅补强 | 不伪造事件 |
| LV-11 | Present | evidence validator | validate-evidence — Strong + Historical Evidence | 精确 RC 无秘密包 | 禁止历史 manifest 签发 RC |
| LV-12 | Present（current-target Gap） | capability → import/assistant gates | capability/live/E2E — Strong + Historical Evidence | isolated-worker 精确 RC 完整组合 | 无 Key smoke 不代替 Evidence |
| LV-13 | Present | VideoListPage → Controller → delete transaction | deletion/database/Rust — Strong | 无；桌面 E2E 仅补强 | 不绕过公共删除接口 |
| LV-14 | Present | Runtime Settings Store snapshot | settings/UI/SQLite/E2E — Strong | 条件性：改变该桌面边界后重放 | 不把 Store 当 SQLite |
| LV-15 | Present | Store removeModel snapshot | settings/UI/SQLite/E2E — Strong | 条件性：改变该桌面边界后重放 | 不拆分 Key/role 清理 |
| LV-16 | Present | Store queue/hydration | settings readiness/E2E — Strong | 条件性：改变该桌面边界后重放 | 不绕过队列 |
| LV-17 | Present（PR #97 已合并） | Controller URL handoff → Rust yt-dlp → 附着本地 filePath → ASR | URL/Rust/M20 + 生产 App composition | 旧 source=url 拒绝已实跑 RED；最小修复及真实交接 GREEN，双审 PASS，最终 head Harness/列表 Desktop success，已合并 | 真站点不在本 AC，禁止外网能力外推 |
| LV-18 | Present | thumbnail storage → VideoCard adapter | thumbnail ownership/Rust — Strong | 无；桌面 E2E 仅补强 | 不接受任意输出路径 |
| LV-19 | Present | App owner → ImportTaskDialog | dialog/Pipeline/page — Strong | 自动恢复不在本行 | 禁止卡片点击产生副作用 |
| LV-20 | Present | pending record → explicit continue | dialog/runtime-settings E2E — Strong | stale processing 不在本行 | 禁止自动启动 |
| LV-21 | Present（Release Evidence Gap） | whisper backend selector/worker | Rust/preference/GPU smoke — Strong；目标 Evidence Gap | NVIDIA target installer Auto/Forced/CPU/取消/错误 | 用户暂停 RL；不得运行 GPU/installer |
| MM-01 | Present | whisper_model_download | Rust download/M20 — Strong | 无新增必需 | 保持固定来源/哈希 |
| MM-02 | Present | 下载 lease/cancel | Rust download/M20 — Strong | 无新增必需 | 不放宽取消断言 |
| MM-03 | Present | AddModelForm 下载 UI | model-download/M19/M20 — Strong | 无新增必需 | 浏览器不得下载 |
| MM-04 | Present | Store installed-list gate | Store/form/M20/Rust — Strong | 无新增必需 | 安装不等于 ASR capability |
| ST-01 | Present | Store loadVideo → StudyInterface | content/store/study-load — Strong + Historical Evidence | 当前 Study/SQLite Desktop Evidence | 禁止历史证据签发当前目标 |
| ST-02 | Present | StudyInterface seek → media | M07/study playback/navigation — Strong | 无新增必需 | 维持唯一 playPosition |
| ST-03 | Present | media timeupdate → playPosition | M05/M07/study playback — Strong | 无新增必需 | 维持半开区间高亮 |
| ST-04 | Present | node navigation resolver | M05/study-navigation — Strong | 无新增必需 | 不复制导航规则 |
| ST-05 | Present | recordPlaybackProgress | database/M06/M15/study-progress — Strong | 无新增必需 | 不把当前位置当最远进度 |
| ST-06 | Present | note public workflows | notes/M08/M15/Rust — Strong | 无新增必需 | 不绕过原子 command |
| ST-07 | Present | assistant context/role gate | assistant/playback/capability — Strong + Historical Evidence | 精确 RC 文本 Evidence；vision 不在 AC | 禁止文本外推 vision |
| ST-08 | Present | StudyInterface layout composition | M16/study-layout — Strong | 无新增必需 | 不卸载 hidden media |
| HE-01 | Present | control-plane validator | validator + harness:control — Strong | 无新增必需 | 运行真实 control command |
| HE-02 | Present | E2E adapter build isolation | build isolation/build/E2E — Strong | 条件性：入口改动时双构建 | 不把 E2E 标记带入产物 |
| HE-03 | Present | runtime-settings diagnostics | script + deterministic fixture — Strong | 条件性：真实失败时保留脱敏诊断 | 禁止隐藏主错误 |
| HE-04 | Present | Harness workflow | hosted Clean Windows Harness — Strong | 条件性：新目标 Hosted gate | 不以本地代替 Hosted |
| HE-05 | Present | Runtime Settings hosted workflow | workflow_dispatch — Strong | 条件性：改变桌面边界后 target replay | 不 dispatch 本 Slice |
| HE-06 | Present | product-decision coverage validator | validator + harness:control — Strong | 无新增必需 | 不把映射当完成百分比 |
| AR-01 | Present | public Database + Rust transaction owners | architecture/database/Rust — Strong | 无新增必需 | 禁止页面 SQL/前端事务 |
| RL-01 | Absent | 无目标唯一公开 NSIS/Release 对账 | artifact contract — Gap | target installer + Release/SHA | 用户暂停 RL；不得 build/release |
| RL-02 | Partial | CPU-safe base + GPU overlay build seam | contract/build scripts — Partial | target installer resources/import/asset proof | 用户暂停 RL；不得 GPU build |
| RL-03 | Absent | 无干净首装生产 Judge | 无 — Gap | 隔离 Windows install/start/exit Evidence | 用户暂停 RL |
| RL-04 | Absent | 无同版本重装 Judge | 无 — Gap | real reinstall manifest/data | 用户暂停 RL |
| RL-05 | Absent | 无升级 fixture Judge | 无 — Gap | frozen fixture upgrade/fault Evidence | 用户暂停 RL |
| RL-06 | Absent | 无卸载 Judge | 无 — Gap | uninstall/reinstall/data/source hash | 用户暂停 RL |
| RL-08 | Partial | NVIDIA runner/adapters local seam | backend/Rust/GPU smoke/nvidia contract — Partial | target installer NVIDIA evidence | 用户暂停 RL；不得 GPU/installer |
| RL-09 | Absent | 无签名 Judge | 无 — Gap | trusted cert/timestamp/security approval | 用户暂停 RL |
| RL-10 | Absent | 无 manifest/SBOM Judge | artifact contract — Gap | target manifest/SBOM/notices | 用户暂停 RL |
| RL-11 | Absent | 无法律批准 | 无 — Gap | CUDA redistribution written approval | 用户暂停 RL |
| RL-12 | Partial | artifact generator/workflow static seams | contract/generator scanner — Partial | target hosted install/archive scan | 用户暂停 RL；不得 hosted build |
| RL-13 | Partial | persistence/Rust architecture seam | Rust/database policy — Partial | frozen SQLite production migration | 用户暂停 RL |
| RL-14 | Partial | evidence schema validator seam | validate-evidence — Partial | target installer/hash unified invalidation | 用户暂停 RL |
| RL-15 | Absent | 无可执行 defect policy Judge | 无 — Gap | severity fixture/blocker/approval | 用户暂停 RL |
| RL-16 | Absent | 无公开下载复验 | 无 — Gap | tag/download/signature/install | 用户暂停 RL |
| RL-17 | Absent | 无生产 observation Judge | 无 — Gap | authorization/redaction/revocation record | 用户暂停 RL |
| RL-18 | Absent | 无下载页/installer disclosure Judge | artifact contract — Gap | target disclosure/manifest/GPU reconciliation | 用户暂停 RL |
| RL-19 | Absent | 无 rollback exercise | 无 — Gap | signed rollback/data Evidence | 用户暂停 RL |
| RL-20 | Partial | Active control documents | scope/AC/coverage docs — Partial | target notes/artifact/Evidence/rollback reconciliation | 用户暂停 RL |
| VL-01 | Partial | VideoListPage → VideoCard task states/actions | dialog/page-recovery/M17 — Partial | 阻断：Strong + Visual Evidence；既有 recovery Judge 已锁定持久 pending/failed 粗状态文字、无 live progress 的“正在处理”与阶段细节，以及现有 progress listener callback 后的“正在处理 47%”与阶段细节 | 仅补局部 DOM Judge；AC 仍 Partial，Visual Evidence 未闭合，禁用 jsdom/假截图替代 |
| VL-02 | Present | queryVideos → VideoListPage sort | video-list-sorting/database-videos — Strong | 无新增必需 | 同一 fixture 的 Memory 与故意无序 SQLite adapter、以及生产 VideoListPage 已锁定默认最近学习、最近学习/导入时间/名称三档和每档稳定 ID tie-breaker；不外推 Desktop、Visual、Evidence 或其他列表 AC |
| VL-03 | Present | queryVideos → VideoListPage title search | title-query/list DOM — Strong（公开双 adapter + 生产 UI） | 无新增必需；无 Desktop 要求 | 同一 fixture 的 Memory、故意无序 SQLite public adapter 与生产页面已锁定 title-only、trim、ASCII case-insensitive、非空无匹配为空列表及清空搜索保留选定排序；不外推 AC-VL-04 或 Evidence |
| VL-04 | Present（PR #97 已合并） | 生产 App → VideoListPage → 实际 Controller/Pipeline/ASR | composition 三流程 — Strong；既有真实 Tauri/WebView2 Judge | 28 文件 / 266 项 GREEN；在线受控媒体交接断点已 RED/GREEN；独立两轴 PASS，各自 266 项；最终 head Harness/列表 Desktop success，已受保护合并 | jsdom 不代替 Desktop；Visual/Accessibility 分属其它 AC，截图只是附件 |
| VL-05 | Present | `thumbnail_lifecycle` → existing video deletion transaction → controlled thumbnail handle delete | Rust lifecycle/SQLite/real filesystem — Strong | 无新增必需；桌面仅可作补强 | 只删合法 ID 推导的 app-owned target；缺失目标两分支（app-data 根缺失、受控目录存在但文件缺失且重复运行幂等）、级联 ABORT 无文件副作用、真实占用句柄下失败可见且无半状态、释放后可重试均已裁判；提交后文件失败在当次会话可见并可重试，重启后的残留缩略图归 `AC-VL-06`，Windows junction/reparse fail-closed。不外推 Desktop/Visual/GPU/安装器/Release Evidence |
| VL-06 | Present | `thumbnail_lifecycle` → after-commit bounded orphan round over the controlled `thumbnails/` directory | Rust lifecycle/SQLite/real filesystem — Strong | 无新增必需；桌面/性能不在本行 | 只删合法 ID 推导、不在真实 `video` 行 keep-set 内且超出保护窗口的 app-owned target；候选上限、失败上限、幂等、部分失败、失败上限提前结束、进程内重入、受控目录逃逸与并发新建写窗口均已裁判；不外推 Desktop/Visual/GPU/安装器/Release Evidence |
| VL-07 | Partial | VideoCard thumbnail rendering | M17/thumbnail UI — Partial | 阻断：Strong + Desktop/Visual Evidence | 禁用 jsdom/假截图替代 |
| SU-01 | Present（PR #98当前目标核证） | StudyInterface → CatalogBar真实滚动边界与row resize | production navigation +真实Study Desktop — Strong + Desktop | head f5d50019 Desktop37906611566四项GREEN，双审各119项PASS，受保护合并 | 只闭合对应Desktop预算，不外推Visual |
| SU-02 | Partial | StudyInterface → CatalogBar 以 Store `playPosition` 推导当前 chapter/section，并提供由 `--anim-base` 控制的有向横向切换反馈；reduced-motion 无位移即时更新 | M05/playback、生产 StudyInterface DOM/CSS — Partial | 阻断：Strong + Desktop/Visual Evidence；公开 media `timeupdate` 与目录点击 Judge 已覆盖 current structure item、相邻 `playPosition` 样本决定的嵌套父/子播放/seek方向（同一 current 的后续样本不取消已启动动效）、连续前进/回退每次动画重启且不重挂 scroll owner、同级 paragraph 无动画；Judge 直接读取生产 `src/index.css`，锁定仅两套 A/B keyframe 各一次的精确 `translateX` from/to、唯一 `--anim-base: 200ms` 和 ±12px CSS 位移。运行中 `prefers-reduced-motion` change 立即取消并在偏好取消后的下一切换恢复，卸载会释放 listener。它不是 Tauri/Desktop 或 Visual Evidence | 不把局部 DOM/CSS Judge 当完成 |
| SU-03 | Present（PR #99已合并） | retained AI/NotesPanel →真实fetch/SSE、公共settings/notes | 生产HTTP输入及真实Study Desktop — Strong + Desktop | head fdcb9efe三个Hosted全绿、双审各148项PASS、protected merge与逐blob一致 | controlled SSE不签发模型能力/Visual |
| SU-04 | Present（PR #98已合并） | StudyInterface → layout proportions →公共settings | production pointer/remount +真实几何/SQLite restart — Strong + Desktop | head f5d50019两Hosted全绿、双审各119项PASS；合并tree与被审tree逐blob一致 | 已收口；GPU/Release仍暂停 |
| SU-05 | Partial（本 diff 将字幕生产接线由 Shadow 提升） | StudyInterface exact sentence → VideoZone；`subtitleOn` | study-playback、M07 — Partial | 阻断：Strong + Desktop/Visual Evidence | 禁止 nearest fallback、译文开关或假截图 |
| SU-06 | Partial | StudyInterface navigation/DiagramZone | navigation/M05 — Partial | 阻断：Strong + Desktop/Visual Evidence | 禁用 jsdom/假截图替代 |
| SU-07 | Strong | StudyInterface → shortcut/focus controller → Study media/Navigation/Notes | `study-shortcuts`、notes/playback/navigation/layout — Strong | 第四轮 Spec + Standards PASS（P0/P1/P2=0）；无 Desktop 要求 | 公开矩阵、邻接及 locked 只读回归已 GREEN；不外推 UX-06 或树/导图编辑，也不签发 Desktop/Visual/GPU/Release Evidence |
| UX-01 | Partial | index.css tokens + components | M13 CSS — Partial | 阻断：Strong + Visual Evidence | 禁用 token existence 自证 |
| UX-02 | Partial | token/component state surfaces | M13/component adjacent — Partial | 阻断：Strong + Visual Evidence | 禁用 jsdom/假截图替代 |
| UX-03 | Partial | typography tokens | M13 CSS — Partial | 阻断：Strong + Visual/Accessibility Evidence | 禁用 token existence 自证 |
| UX-04 | Partial | geometry tokens | M13 CSS — Partial | 阻断：Strong + Visual Evidence | 禁用 token existence 自证 |
| UX-05 | Partial | motion tokens | M13/component adjacent — Partial | 阻断：Strong + Desktop/Accessibility Evidence | 禁用 jsdom/假截图替代 |
| UX-06 | Partial | `VideoCard` 主打开动作 → 原生具名 button → `onOpen`/`onOpenImport` | `video-list-accessibility`（生产卡 Tab+Enter/公开 callback）— Partial | 阻断：其他 Launch 主操作、可见焦点、非纯颜色状态、axe、AA 与 Desktop/Accessibility Evidence | 此 Slice 仅关闭 ready/non-ready 视频卡键盘/名称局部缺口；不得外推为完整 accessibility Judge |
| PF-01 | Absent | 无 cold-start runner | 无 — Gap | frozen host 10x p95 | 先建 performance runner |
| PF-02 | Absent | 无 500-video runner | 无 — Gap | SQLite fixture/restart p95 | 先建 performance runner |
| PF-03 | Absent | 无 Study runner | 无 — Gap | ready fixture/media p95 | 先建 performance runner |
| PF-04 | Absent | 无 progress latency runner | 无 — Gap | 100 event end-to-end p95 | 先建 performance runner |
| PF-05 | Absent | 无 soak runner | 无 — Gap | 25-minute resource/exit Evidence | 先建 performance runner |
| AR-02 | Partial | front-end LLM request boundary | m20/LLM adjacent — Partial | role request/dependency/Desktop Evidence | 禁用静态存在自证 |
| AR-03 | Partial（当前授权范围Slice） | static app-owned scope → canonical SQLite local file restore →localMediaUrl | config negative RED/GREEN、25文件165项GREEN；真实WebView Desktop已核证 | 原head Desktop success，Rust测试装载失败；保留三条scope/SQLite断言并修复测试v6资源链接，修复候选双轴各165项PASS，最终文档复核/新head Hosted待完成 | 不新增任意路径grant command；不以jsdom替代Desktop、不跳过Rust |
| AR-04 | Partial | Database + Zustand ownership | architecture/store adjacent — Partial | unified dependency/adapter policy | 不复制持久业务事实 |
| AR-05 | Present | `AppImportOwner` → Controller；`App` 路由真实卸载/重挂列表 | app-import-owner/dialog/deletion/M21 — Strong | 无新增必需；生产 App + 真实 Pipeline/公共数据库 Judge 覆盖单飞、后台进度/完成、原任务取消和迟到结果 | 不外推 Tauri/SQLite Desktop、模型、Visual 或 Release Evidence |
| AR-06 | Present | `import-progress` domain → Pipeline/Controller/event adapters → 穷尽 UI projection | domain/controller/pipeline/typecheck/App — Strong | PR #96 受保护合并；独立两轴各 263 项及 head 完整 Hosted 全绿；无 Desktop 要求 | 保留 locked wire/tuple adapters，不外推 GPU/模型/Visual/Release Evidence |

## Proof closure / blocker ledger

- `LV/ST`：带 Historical Evidence/current-target Gap 的行仍被精确目标 Evidence 阻断：`LV-03/05/07/08/09/11/12`、`ST-01/07`；此外 `LV-21` 的目标 NVIDIA Release Evidence Gap 也是 blocker（当前 user-paused）。`LV-01/04/10` 已 Strong，桌面/SQLite/真实事件仅为非阻断补强；不能用 jsdom、旧包或假截图替代真正 Required Evidence。
- `VL`：阻断 Desktop/Visual 的只有 `VL-01`（Visual）、`VL-04`（Desktop）与 `VL-07`（Desktop/Visual）。`VL-02` 已由 Strong 的双 adapter 与生产 UI Judge 覆盖，无 Desktop 要求；`VL-03` 仍只需 Strong 的双 adapter 与生产 UI Judge，不需 Desktop；`VL-05` 已由生产 lifecycle 的隔离真实文件系统与真实 SQLite Judge 覆盖；`VL-06` 也已落地于同一 Rust `thumbnail_lifecycle` 深 module：keep-set 来自真实 `video` 行，真实 SQLite + 隔离真实目录 + 并发新建写窗口 Judge 已就位，tier Strong，无新增必需。
- `SU/UX`：Desktop/Visual blocker 仅为 `SU-02`（Desktop/Visual）、`SU-03`（Desktop）、`SU-05`（Desktop/Visual）、`SU-06`（Desktop/Visual）、`UX-01/02/04`（Visual）、`UX-03`（Visual/Accessibility）、`UX-05/06`（Desktop/Accessibility）。`UX-06` 已有 VideoCard 局部生产键盘/名称 Judge，但其余 Launch 主操作、可见焦点、非纯颜色状态、axe、AA 与 Desktop Evidence 仍阻断。`SU-07` 只需 Strong，不要求 Desktop；截图只能作附件，不能单独裁判。
- `HE`：`HE-05` 只能由改变该桌面边界后的目标提交 workflow_dispatch 重放；本 Slice 不 dispatch。
- `PF`：每条都缺冻结主机、fixture、样本/p95 或 soak Evidence，不能由开发机感觉代替。
- `AR`：`AR-02/03/04` 仍需真实角色请求、Tauri capability/桌面或依赖政策；静态扫描/局部组件不等于完成。`AR-05` 已随 PR #95 合并；`AR-06` 已随 PR #96 受保护合并，独立双审与被审 head 完整 Hosted 均通过；两行均无新增 Desktop 要求。
- `RL`：所有 Release 工作为用户暂停。受控 GPU run 已取消且未生成/上传 manifest、core/control artifact、build record 或 launcher；只有用户明确恢复后才可排期。不得以取消运行或此审计升级任何 RL AC。

## Proposed 局部面（23 条；不改变产品语义）

| DEC-PRD | 当前局部面与边界 | 后续用户选择 |
| --- | --- | --- |
| 004 | `parentId` 存在；没有加深 UI | 确认并建 AC 或保持隐藏 |
| 006 | `supportsVision` 元数据；无帧/vision 请求 | 确认并建 AC 或保持隐藏 |
| 010 | QuickActions 与自由对话局部可见 | 确认并建 AC 或隐藏 |
| 015 | 无删除迁移 | 确认并建 AC 或保持隐藏 |
| 032 | Confirmed 本地 ASR 子行为；云长音频未闭合 | 确认并建 AC 或保持隐藏 |
| 033 | translation 字段可持久；翻译合同未确认 | 确认并建 AC 或隐藏 |
| 035 | 无高级编辑 | 确认并建 AC 或保持隐藏 |
| 039 | 导航有、编辑无 | 确认并建 AC 或保持隐藏 |
| 042 | 无 reparent | 确认并建 AC 或保持隐藏 |
| 043 | type badge 局部；无编辑菜单 | 确认并建 AC 或保持隐藏 |
| 044 | 无提取 | 确认并建 AC 或保持隐藏 |
| 045 | 无合并 | 确认并建 AC 或保持隐藏 |
| 046 | 无生产删除 | 确认并建 AC 或保持隐藏 |
| 050 | 无 scrub | 确认并建 AC 或保持隐藏 |
| 051 | 无折叠 | 确认并建 AC 或保持隐藏 |
| 052 | 共享 Store 读取同步；无编辑 | 确认并建 AC 或保持隐藏 |
| 080 | chat/QuickActions 局部；无当前帧完整 UI | 确认并建 AC 或隐藏 |
| 083 | 取消/停止是 Confirmed 子行为；undoStack 潜伏 | 确认并建 AC 或保持隐藏 |
| 085 | 语言字段/部分自动结果；三档翻译合同无 | 确认并建 AC 或隐藏 |
| 086 | `translationOn` 默认 true、有数据时译文块可见；无独立开关（Proposed 泄漏） | 确认并建 AC 或隐藏 |
| 088 | 20 步 undoStack 潜伏；无生产编辑/redo | 确认并建 AC 或保持隐藏 |
| 090 | checkpoint/合并重试子行为有；跳过无 | 确认并建 AC 或保持隐藏 |
| 091 | 两状态分离；只有字幕控件 | 确认并建 AC 或隐藏 |

QuickActions 与译文块均须由用户随后选择“确认并建 AC”或“隐藏”；本 Slice 不作该产品决定。
