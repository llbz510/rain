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
| ① 长目录两行结构 | `[data-catalog-row="structure"|"paragraph"]` 与其滚动 owner `[data-catalog-scroll-row=…]` 存在；**行项 = `[data-catalog-scroll-row="<level>"] > span`**（生产 `CatalogBar` 的真实行项：只带 `data-catalog-current` + 文本 + `onClick=onSeek(startTime)`，`src/ui/components/catalog.tsx:336-346`；`progress-indicator-*` 属 `SideTree`（`catalog.tsx:246`）、`paragraph-*` 属文本区，**都不在两行滚动区内**）；用 `/element/{id}/rect` 读 owner 与首/末行项，断言横向延伸 > owner 宽度（真实溢出 = 不换行）；行项条数与夹具声明交叉校验：结构行 = `chapterCount + sectionCount`、段落行 = `paragraphCount` |
| ② 当前项居中跟随 | 先经真实播放按钮进入播放态（生产的跟随只在 `isPlaying` 为真时生效，`catalog.tsx:306-316`），再真实点击中段行项「`E2E 章节 5`」（生产 `onClick=onSeek(startTime)`）；随后用 `/element/{id}/rect` 断言**生产自己标记的当前项** `[data-catalog-current="true"]`（必须唯一）满足 `|itemCenter − ownerCenter| ≤ 2px`。容差依据：生产的 `scrollIntoView({block:'nearest', inline:'center'})` 只做子像素对齐、目录行无额外内边距、中段行项两侧都有滚动余量；**2px 属待托管实测标定值**，实测差值/容差/当前项文本都写入 `observed`，禁止无依据放大 |
| ③ 边缘渐隐 owner | 左端（`scrollLeft=0`）必须「只右」——该前置由**真实 `/actions` 滚轮负 deltaX 回滚**建立（②已把两行滚到中段，回滚不改渐隐判据，且不是用 JS 改写 `scrollLeft`）；用真实滚轮滚到中段要求两侧同时出现；再滚到末端要求「只左」；每处核对 `aria-hidden="true"`。`pointer-events:none` 与方向渐变（left→`to right`、right→`to left`）用 computed style 作**标注来源**的补充证据；显隐完全由真实滚动几何决定 |
| ④ 暂停后不再强制跟随 | 前置：媒体暂停 → 真实点击行项「`E2E 章节 1`」（公开 seek 到 0）与「`E2E 章节 5`」：每次都必须**改变媒体 `currentTime`**（证明位置真的变了、且落在该节点时间窗内）而结构行 `scrollLeft` 相对基线不变；随后播放 2s 作正向对照（媒体真实推进 + 当前项仍被居中，与②同一机制），暂停后再做一次 seek 不变性断言。播放态跟随本身由②独立覆盖——生产的跟随只在 `isPlaying` 为真时生效，故「播放推进而 `scrollLeft` 必须不变」不是本 AC 的判据 |

## 3. 隔离与受控夹具

- `RAIN_E2E_MODE=1` + `RAIN_E2E_RUN_MODE=study-catalog` 只需要隔离 SQLite（`RAIN_E2E_DB_PATH`）与一份媒体文件路径（复用既有 `RAIN_E2E_VIDEO_PATH`）；不需要 evidence id、Whisper 模型或任何 LLM Key。
- **首次启动必须是真实空库**：短模式只武装夹具公开面，不导航、不启动导入、不写任何业务行。
- 夹具只经 `window.__RAIN_STUDY_CATALOG_FIXTURE__.seed()` 由脚本显式请求，仍走生产 `getDb()` / `insertVideo` / `insertNodes` / `insertSentences`：1 个 `status:'ready'`、`duration:14` 的视频；8 章 × 3 节，**恰好 32 段落**（生成规则 `paragraphIndex < 16 ? 2 : 1` ⇒ 文档序前 8 节各 2 段、其余 16 节各 1 段；`t49/t50` 定位到旧声明写 40 与生成规则不符，已按实测把**生成 / 声明 / 阈值 / 文档四者统一为 32**），章 1.75s / 节 0.583s，时间轴全部落在 `[0,14]`；**每个 paragraph 都必须有一条 sentence**（生产的 `loadVideo` 要求「至少一个 paragraph 且 sentences 非空」，见 `src/store/rain-store.ts:176/:180`，否则学习页永不出现）。
- 媒体形态：无外部工具依赖的 Node 生成 WAV（8000Hz / 16bit / 14s）。**该形态已被托管实证接受并真实推进**：run [`36312689535`](https://github.com/llbz510/rain/actions/runs/36312689535) 的 `wavPlayback={"present":true,"currentTime":10.109134,"readyState":4,"duration":14,"paused":false,"errorCode":null}` ⇒「改用 CI 内 ffmpeg 生成的短视频」这一分支**据实测关闭**，不再作为待办。
- 夹具落库后脚本**关闭并重建 WebDriver session**（真实进程重启），再真实点击生产列表卡主操作（`aria-label="打开视频：<标题>"`）进入学习页。

## 4. 失败诊断（脱敏、有界）

失败时在系统临时目录保留单份 `rain-study-catalog-e2e-latest-failure/`：`summary.json` + `tauri-driver.log` + `tauri-driver.err.log`。

`summary.json` 必须给出 `phase`、主错误、**非空 `missingConditions`** 与 `observed`。`observed` 已包含：能力探针结论（`/element/{id}/rect`、`/actions`）、`fixtureInterfaceStatus`、`fixtureStatusAfterRestart`、`catalogFixtureDeclaration`、`cardButtonCount` 与 `cardPrimaryActionLabels`（原文）、`studyPageWaitCriterion`（判据 + 超时阈值）、`studyPageTimeoutState`（`currentPage` / `role="alert"` 文案 / study-interface 与 video 存在性 / `video.error.code`）等；本 Judge 另写入定标事实：`catalogExpectedItemCounts`（由夹具声明推出的两行期望条数）、`catalogRowItemSemantics`（两行子项 childCount / spanCount / emptyTextCount / currentCount / 首末文本）、`catalogRowItemCalibration`（**行项选择器或条数不成立时先写入再 Fail-Condition**：两行子项的 tagName / `data-testid` / `data-catalog-current` / 文本前 20 字、`side-tree` 是否存在、渐隐元素存在性——使一次 run 就能定标 ①②③ 的全部选择器）、`currentItemFollowMediaState` / `currentItemTargetText` / `currentItemText` / `currentItemCenterDeltaPx` / `currentItemCenterSamples`、`pauseFollowSeek-*` / `pauseFollowPlayAdvance` / `pauseFollowPlayCenteredDeltaPx` / `pauseFollowAfterPlayRoundTrip` 等。已知 Key、`sk-*` 与 Bearer token 一律 `[REDACTED]`；诊断不含隔离 SQLite；成功 run 清理 stale 诊断。

**已知诊断缺口（已登记，未修）**：`tauri-driver` 的 stdout/stderr 在 failure artifact 中为 **0 字节**，因此定位必须依赖 `summary.json` 的 `observed` 与阶段名。依据：run [`36311722434`](https://github.com/llbz510/rain/actions/runs/36311722434) 的 artifact `study-catalog-desktop-e2e-failure`（压缩 867 字节）解包后只有三个文件 —— `summary.json` 1059 字节、`tauri-driver.log` **0 字节**、`tauri-driver.err.log` **0 字节**；捕获路径与本 Judge 脚本及 AC-VL-04 的既有 owner 完全相同（`scripts/run-study-catalog-e2e.ps1:557-561` 与 `scripts/run-video-list-e2e.ps1:622-626` 的 `Start-Process -RedirectStandardOutput/-RedirectStandardError -WindowStyle Hidden`），属**两条桌面 Judge 共有的既有模式**。0 字节有两种可能（重定向捕获失效 / `tauri-driver` 本就静默），区分二者需要脚本侧实验，且任何修法都必须同时论证对 AC-VL-04 owner 的影响，故本次只登记不修。

## 5. 截图（仅附件）

成功 run 最多写 1 张 `rain-study-catalog-e2e-attachment/video-list…png` 等价截图 + `ATTACHMENT-NOTICE.txt`，artifact 名称与说明都标注**「仅附件，不构成 Visual Evidence」**，保留期 7 天。截图不得作为唯一或主要裁判。

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
