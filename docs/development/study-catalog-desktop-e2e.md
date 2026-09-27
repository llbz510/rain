# Study Catalog 桌面 E2E（AC-SU-01 最小托管骨架）

> 状态：Active
> 更新日期：2026-09-27
> 作用：为 `AC-SU-01` 提供**真实桌面 DOM + 真实操作/滚动**的最小托管裁判。它不是产品规格、不签发 `Visual Evidence`、不覆盖其他 AC。
> 位置：`scripts/run-study-catalog-e2e.ps1`（行为 Judge）、`.github/workflows/study-catalog-desktop-e2e.yml`（Hosted Windows 入口）、`src/e2e/real-e2e-runner.tsx` 的 `study-catalog` 短模式（受控夹具）、`src-tauri/src/e2e_config.rs`（E2E 门）。

## 1. 公开命令

```powershell
npm run e2e:study-catalog
```

脚本自持全部行为断言；`-SkipBuild` 只用于本机对已构建二进制的重放，Hosted workflow 一律不带该参数。

## 2. 裁判内容（AC-SU-01 的四项桌面条件）

判据是**真实 WebDriver 读到的生产学习页 DOM/几何**与**真实点击与 W3C `/actions` 滚轮**，不是截图：

| 条件 | 判据 |
| --- | --- |
| ① 长目录两行结构 | `[data-catalog-row="structure"|"paragraph"]` 与其滚动 owner `[data-catalog-scroll-row=…]` 存在；**行项 = `[data-catalog-scroll-row="<level>"] > span`**（生产 `CatalogBar` 的真实行项：只带 `data-catalog-current` + 文本 + `onClick=onSeek(startTime)`，`src/ui/components/catalog.tsx:336-346`；`progress-indicator-*` 属 `SideTree`（`catalog.tsx:246`）、`paragraph-*` 属文本区，**都不在两行滚动区内**）；用 `/element/{id}/rect` 读 owner 与首/末行项，断言横向延伸 > owner 宽度（真实溢出 = 不换行）；行项条数与夹具声明交叉校验：结构行 = `chapterCount + sectionCount`、段落行 = `paragraphCount`；另有与声明无关的**绝对下限：两行各 ≥24 项**（防声明缩水），真正的规模守卫仍是几何代理——真实横向溢出（实测为 owner 视口的 5.1×/4.9×） |
| ② 当前项居中跟随 | 先经真实播放按钮进入播放态（生产的跟随只在 `isPlaying` 为真时生效，`catalog.tsx:306-316`），再真实点击中段行项「`E2E 章节 5`」（生产 `onClick=onSeek(startTime)`）；随后用 `/element/{id}/rect` 断言**生产自己标记的当前项** `[data-catalog-current="true"]`（必须唯一）满足 `|itemCenter − ownerCenter| ≤ 2px`。容差依据：生产的 `scrollIntoView({block:'nearest', inline:'center'})` 只做子像素对齐、目录行无额外内边距、中段行项两侧都有滚动余量；**2px 属待托管实测标定值**，实测差值/容差/当前项文本都写入 `observed`，禁止无依据放大；成功 run 同样写出这些值（`success-facts.json` + 运行日志，见 §5） |
| ③ 边缘渐隐 owner | 左端（`scrollLeft=0`）必须「只右」——该前置由**真实 `/actions` 滚轮负 deltaX 回滚**建立（②已把两行滚到中段，回滚不改渐隐判据，且不是用 JS 改写 `scrollLeft`）；用真实滚轮滚到中段要求两侧同时出现；再滚到末端要求「只左」；每处核对 `aria-hidden="true"`。`pointer-events:none` 与方向渐变（left→`to right`、right→`to left`）用 computed style 作**标注来源**的补充证据；显隐完全由真实滚动几何决定；回滚后**显式断言 `scrollLeft ≤ 0.5`**（= 生产 `EDGE_FADE_EPSILON`，`catalog.tsx:76`、`:131`），不留 ≤0.5px 的假通过窗口 |
| ④ 暂停后不再强制跟随 | 前置：媒体暂停 → 对行项「`E2E 章节 1`」「`E2E 章节 5`」各做一次**公开 seek**：先用**真实 `/actions` 滚轮**把目标行项滚入 owner 可视框（不用任何 JS 滚动）→ **重录两行基线** → 用**真实 `/actions` 指针**（`pointerMove` 到该行项 in-view centre → `pointerDown`/`pointerUp`；**不用 element-click 端点**）点击它 ⇒ 断言（i）媒体 `currentTime` 落入该行项由夹具声明推出的时间窗（排除「其实没点到」的假通过）、（ii）`structure` 与 `paragraph` **两行** `scrollLeft` 相对各自基线均不变（生产的两个 follow effect 同门控，若真的强制跟随两行会同时被居中）。随后播放 2s 作正向对照（媒体真实推进 + 当前项仍被居中，与②同一机制），暂停后再做一次同样的 seek 断言。播放态跟随由②独立覆盖——生产的跟随只在 `isPlaying` 为真时生效，故「播放推进而 `scrollLeft` 必须不变」不是本 AC 的判据 |

**判据路线、阈值与规模登记（以托管实测为依据）**
- **路线 A（采用）**：只读目录行自身的生产标记——`[data-catalog-scroll-row="<level>"] > span` 计数、`data-catalog-current="true"` 定位当前项、行内文本（`E2E 章节 N` / `E2E 段落 N`）定位具体项；**不借用** side-tree 的 `progress-indicator-*` 或文本区的 `paragraph-*`。
- **路线 B（未采用，登记备选）**：为生产目录项补稳定 `data-testid`（owner：`src/ui/components/catalog.tsx` 的 `CatalogBar.renderNode`，拟名 `catalog-item-<level>-<nodeId>`）。不采用的理由：现有 `data-catalog-current` + 行内文本已能稳定定位与计数，补 testid 要改产品组件却对判据无增量；若将来目录项文本改为可变或需要无文本定位，改走路线 B 并在此同步 testid 名称与 owner。
- **阈值形态与托管实测**：结构行期望 = `chapterCount + sectionCount`、段落行期望 = `paragraphCount`（取自夹具声明，断言为**等值**，比旧的 `≥24` / `≥40` 下界更强）；run [`36312689535`](https://github.com/llbz510/rain/actions/runs/36312689535) 实测 `structureRowChildren=32`、`paragraphRowChildren=32`、`structureRow` 508 → extent 2580.36、`paragraphRow` 508 → extent 2499.09。**旧表述「结构行 `progress-indicator-*` ≥24、段落行 `paragraph-*` ≥40」已废弃**（同一 run 实测命中 0，属选择器错误；40 亦与生成规则不符）。
- **32 项是否仍足以裁判本 AC**：两行各 32 项，横向延伸约为 owner 视口宽度的 5.1×（2580.36 / 508）与 4.9×（2499.09 / 508）⇒ 满足「长目录、横向可滚动」，③ 正是在两端与中段判出渐隐 owner 的方向切换；14s 时间轴内当前项切换 30+ 次，足以裁判 ② 的自动定位。故统一为 32 **不削弱任何判据**。
- **启动竞态与三态分类（STD-69-11）**：夹具接口由 runner 异步武装——它先 `await getDb()` + `await getVideoById()` 才 `publishCatalogFixture(...)`（`src/e2e/real-e2e-runner.tsx:809-815`），列表卡也要等同一次查询渲染完。因此**首次启动**与**夹具落库后重启**的读取都必须先做**有界等待**（500ms 轮询，上限 30s）：首启只等「接口已武装」（首启的正确状态就是 `idle` = 真实空库）；重启后等「接口状态已知 **且** 卡片 ≥1」。超时后按 `absent` / `idle` / `failed` **三态分别报出**——`absent` 只意味着「app 还在启动 / runner 未进入短模式」，**不能**当成「隔离库没有夹具行」。不延长 `$MaxSeconds`、不放宽任何断言：`idle` / `failed` / 无卡仍必然失败。
- 实测依据：同一段逻辑在 `1a80de5` 的 run [`36312689535`](https://github.com/llbz510/rain/actions/runs/36312689535) 读到 `fixtureStatusAfterRestart=seeded` + 2 张卡并成功进入学习页，而在 `9271305` 的 run [`36313834100`](https://github.com/llbz510/rain/actions/runs/36313834100) 读到 `absent` + 0 张卡 ⇒ 确定是启动竞态（非确定性），不是产品缺陷。
- **触发方式登记（t56/t57，裁判④）**：`element-click` 端点（`POST /element/{id}/click`）带 UA「**点击前先滚入视野**」语义。实测 run [`36314741172`](https://github.com/llbz510/rain/actions/runs/36314741172)：结构行最大 `scrollLeft=2072`（owner 508 / extent 2580.36）、目标行项 index 0 在可视框外，点击送达（`currentTime` 7.051835 → 0）但该行被驱动滚成 `scrollLeft=0` ⇒ 旧 ④ 的「单行 scrollLeft 不变」判据会被驱动行为污染。生产侧全部滚动写入点已逐条排除（`catalog.tsx:225` 不可达、`:313`/`:325` 与 `text-zone.tsx:35` 均以 `isPlaying` 为门控、`text-zone.tsx:41` 仅由 `textScrollTarget` 触发），并有 `src/__tests__/study-navigation.test.tsx:648-657` 的跟踪断言旁证 ⇒ 该 RED 属**裁判口径**而非产品缺陷。故 ④ 的暂停态 seek 改用 `/actions` 真实指针（Actions API 不做预滚）触发，见证加强为**双行 + 时间窗**；判据语义（暂停 + 公开 seek ⇒ 不强制跟随）与 AC 覆盖不变、敏感性上升。
- **入视野助手的方向约定与 RED 入档（SR-t58-3，t60 三方诊断 / t61 修复）**：实测 RED = run [`36321757895`](https://github.com/llbz510/rain/actions/runs/36321757895)（head `827bab6`），`phase=judge-pause-stops-follow`、`第④项前置不成立：真实滚轮未能在有界步数内把行项「E2E 章节 1」滚入 owner 可视框（无法对其 in-view centre 发真实指针点击） | wheelSteps=8 fullyInside=False itemLeft=-1872 itemWidth=65 ownerLeft=200 ownerWidth=508`。根因：`Move-CatalogRowItemIntoView` 的步长写成 `ownerCenter − itemCenter`，与本脚本实测的宿主约定「**正 deltaX 增大 scrollLeft**」相反（依据 ③ 的实测：4×+200 → 800；16×+2000 → max 2072；−2000 → 0）⇒ 目标行项在最左、行已在 `maximumScrollLeft=2072` 时每步都被钳制，8 步**零位移**（恒等式 `ownerLeft − scrollLeft = 200 − 2072 = itemLeft = −1872` 与实测吻合）。修复：符号改为 `itemCenter − ownerCenter`（保留 ±800 限幅与有界步数），并新增**无进展检测**——每步前后读 `scrollLeft`、把 `(step, delta, scrollLeftBefore, scrollLeftAfter)` 写入 `pauseFollowIntoViewSteps-*` 事实，某步位置未变即立刻以具名条件 Fail；本次 8 步空转正是被「安静烧完上界步数」掩盖的。

## 3. 隔离与受控夹具

- `RAIN_E2E_MODE=1` + `RAIN_E2E_RUN_MODE=study-catalog` 只需要隔离 SQLite（`RAIN_E2E_DB_PATH`）与一份媒体文件路径（复用既有 `RAIN_E2E_VIDEO_PATH`）；不需要 evidence id、Whisper 模型或任何 LLM Key。
- **首次启动必须是真实空库**：短模式只武装夹具公开面，不导航、不启动导入、不写任何业务行。
- 夹具只经 `window.__RAIN_STUDY_CATALOG_FIXTURE__.seed()` 由脚本显式请求，仍走生产 `getDb()` / `insertVideo` / `insertNodes` / `insertSentences`：1 个 `status:'ready'`、`duration:14` 的视频；8 章 × 3 节，**恰好 32 段落**（生成规则 `paragraphIndex < 16 ? 2 : 1` ⇒ 文档序前 8 节各 2 段、其余 16 节各 1 段；`t49/t50` 定位到旧声明写 40 与生成规则不符，已按实测把**生成 / 声明 / 阈值 / 文档四者统一为 32**（实测依据：run [`36312689535`](https://github.com/llbz510/rain/actions/runs/36312689535) 的 `paragraphRowChildren=32`，规模充分性见 §2 的判据登记），章 1.75s / 节 0.583s，时间轴全部落在 `[0,14]`；**每个 paragraph 都必须有一条 sentence**（生产的 `loadVideo` 要求「至少一个 paragraph 且 sentences 非空」，见 `src/store/rain-store.ts:176/:180`，否则学习页永不出现）。
- 媒体形态：无外部工具依赖的 Node 生成 WAV（8000Hz / 16bit / 14s）。**该形态已被托管实证接受并真实推进**：run [`36312689535`](https://github.com/llbz510/rain/actions/runs/36312689535) 的 `wavPlayback={"present":true,"currentTime":10.109134,"readyState":4,"duration":14,"paused":false,"errorCode":null}` ⇒「改用 CI 内 ffmpeg 生成的短视频」这一分支**据实测关闭**，不再作为待办。
- 夹具落库后脚本**关闭并重建 WebDriver session**（真实进程重启），再真实点击生产列表卡主操作（`aria-label="打开视频：<标题>"`）进入学习页；重启后与首次启动的读取都必须先做**有界等待 + 三态分类**（见 §2 的启动竞态登记）。

## 4. 失败诊断（脱敏、有界）

失败时在系统临时目录保留单份 `rain-study-catalog-e2e-latest-failure/`：`summary.json` + `tauri-driver.log` + `tauri-driver.err.log`。

`summary.json` 必须给出 `phase`、主错误、**非空 `missingConditions`** 与 `observed`。`observed` 已包含：能力探针结论（`/element/{id}/rect`、`/actions`）、`fixtureInterfaceStatus` / `fixtureInterfaceWaitSamples` / `fixtureInterfaceWaitCriterion`（首启有界等待）、`fixtureStatusAfterRestart` / `cardButtonCount` / `restartWaitSamples` / `restartWaitCriterion`（重启后有界等待与三态分类）、`catalogFixtureDeclaration`、`cardPrimaryActionLabels`（原文）、`studyPageWaitCriterion`（判据 + 超时阈值）、`studyPageTimeoutState`（`currentPage` / `role="alert"` 文案 / study-interface 与 video 存在性 / `video.error.code`）等；本 Judge 另写入定标事实：`catalogExpectedItemCounts`（由夹具声明推出的两行期望条数）、`catalogRowItemSemantics`（两行子项 childCount / spanCount / emptyTextCount / currentCount / 首末文本）、`catalogRowItemCalibration`（**行项选择器或条数不成立时先写入再 Fail-Condition**：两行子项的 tagName / `data-testid` / `data-catalog-current` / 文本前 20 字、`side-tree` 是否存在、渐隐元素存在性——使一次 run 就能定标 ①②③ 的全部选择器）、`currentItemFollowMediaState` / `currentItemTargetText` / `currentItemText` / `currentItemCenterDeltaPx` / `currentItemCenterSamples`、`pauseFollowPreState` / `pauseFollowRowBaselineAtStart` / `pauseFollowWitness`（④ 每次 seek 的汇总：目标行项、`currentTime` 前后与目标时间窗、**两行**基线与 after、点击后可见性）/ `pauseFollow<prefix>IntoView-*`（真实滚轮入视野的步数与可见性）/ `pauseFollow<prefix>IntoViewSteps-*`（逐步 `(step, delta, scrollLeftBefore, scrollLeftAfter)`；某步无进展即在下一步前以具名条件 Fail）/ `pauseFollow<prefix>Seek-*` / `pauseFollowPlayAdvance` / `pauseFollowPlayCenteredDeltaPx` / `pauseFollowAfterPlayRoundTrip` / `pauseFollowPointerClickError`（指针点击未送达时的错误原文）/ `structureRowScrollMetrics` / `paragraphRowScrollMetrics`（两行 `scrollLeft`/`scrollWidth`/`clientWidth`/`maximumScrollLeft`）等。已知 Key、`sk-*` 与 Bearer token 一律 `[REDACTED]`；诊断不含隔离 SQLite；成功 run 清理 stale 诊断；**成功 run 的同类事实写入附件目录的 `success-facts.json` 并打进运行日志（见 §5）**。

**已知诊断缺口（已登记，未修）**：`tauri-driver` 的 stdout/stderr 在 failure artifact 中为 **0 字节**，因此定位必须依赖 `summary.json` 的 `observed` 与阶段名。依据：run [`36311722434`](https://github.com/llbz510/rain/actions/runs/36311722434) 的 artifact `study-catalog-desktop-e2e-failure`（压缩 867 字节）解包后只有三个文件 —— `summary.json` 1059 字节、`tauri-driver.log` **0 字节**、`tauri-driver.err.log` **0 字节**；捕获路径与本 Judge 脚本及 AC-VL-04 的既有 owner 完全相同（`scripts/run-study-catalog-e2e.ps1:557-561` 与 `scripts/run-video-list-e2e.ps1:622-626` 的 `Start-Process -RedirectStandardOutput/-RedirectStandardError -WindowStyle Hidden`），属**两条桌面 Judge 共有的既有模式**。0 字节有两种可能（重定向捕获失效 / `tauri-driver` 本就静默），区分二者需要脚本侧实验，且任何修法都必须同时论证对 AC-VL-04 owner 的影响，故本次只登记不修。

## 5. 截图（仅附件）

成功 run 会写 1 张 `rain-study-catalog-e2e-attachment/study-catalog-desktop-dom.png` + `ATTACHMENT-NOTICE.txt` + **`success-facts.json`**，artifact 名称与说明都标注**「仅附件，不构成 Visual Evidence」**，保留期 7 天。截图不得作为唯一或主要裁判。

- **成功路径事实（SR-t52-4）**：`success-facts.json` 按固定顺序记录判据事实，并由脚本同时打进运行日志——② 的实测居中差值 `currentItemCenterDeltaPx` 与实际容差 `currentItemCenterTolerancePx`（含当前项文本与采样数）、首启/重启握手的 `status`/采样数/`ElapsedMs`/判据/最后状态、夹具声明与期望条数、两行 `extent`/owner 宽度、WAV 观测、④ 的 `pauseFollowWitness`（每次 seek 的两行基线与 after、`currentTime` 落窗、点击后可见性）与两行 `*RowScrollMetrics`。因此「2px 容差是否有托管实测依据」与「④ 的双行见证」在 GREEN run 上同样可核对，而不是只存在于失败 `summary.json` 里。`Save-WebDriverScreenshot` 此前从未被调用（文档承诺的附件实际不存在），现已接回成功路径。

## 6. Hosted 触发与边界

- `.github/workflows/study-catalog-desktop-e2e.yml` 在 `pull_request`（paths 过滤到本 Judge 相关代码与脚本）上运行，使被审 head 上就有真实 run；`workflow_dispatch` 只是**合并后**的重放入口（新 workflow 文件在功能分支上无法 dispatch）。
- 该 workflow **不是** master 必需状态检查，不改分支保护，不修改受保护分支，不 dispatch 任何 Release/GPU workflow，不使用任何 Rain secret、模型或 Whisper。
- 与 AC-HE-05 的 owner（`runtime-settings-desktop-e2e.yml` + 其脚本）和 AC-VL-04 的 owner（`video-list-desktop-e2e.yml` + 其脚本）**完全独立**，本 Judge 不改动二者。
- **证据对应规则（STD-67-4）**：桌面证据对应被测 head 的**代码树**；`paths` 有意不含 `docs/**`，因此若仅文档改动使 head 前移，必须先用 `git diff <旧 head> <新 head> -- <代码路径>` 证明代码树未变，否则需在合并后以 `workflow_dispatch` 在合并提交上重放，才可引用该证据。实测补充：`pull_request` 事件的 `paths` 过滤按 **PR 相对基线的累计 diff** 判定，因此仅改 `docs/**` 的推送同样会在新 head 上重跑本 workflow，并因 `concurrency` 取消同一 ref 的上一轮（本分支实测：`d14f384` 的三条 run `36312506221`/`36312506232`/`36312506368` 被 `51cc9f1` 的推送取消）——取消属常态，引用证据仍须先证明代码树未变。
- 不参与 `harness:check`；默认 Harness 不运行任何桌面 Judge。

## 7. 未覆盖边界（诚实声明）

- 只覆盖第 2 节列出的四项条件；**不签发 Visual/Accessibility Evidence**，不覆盖 `AC-SU-02/SU-04/SU-05/SU-06`、`AC-VL-*`、`AC-UX-*` 或其他 AC。
- 合成媒体 ≠ 真实用户素材；媒体真实时长为 fixture 声明的 14s，目录时间轴必须落在该时长内。
- 本 Judge 的存在与通过**都不等于 `AC-SU-01` 已闭合**：闭合需独立 Spec 与 Standards 复审通过并受保护合并；在此之前文档只可写「其 `Strong + Desktop Evidence` 预算可判定满足」。
- `tauri-driver` 日志为 0 字节的既有诊断缺口见第 4 节。
