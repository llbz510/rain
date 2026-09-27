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
| ① 长目录两行结构 | `[data-catalog-row="structure"|"paragraph"]` 与其滚动 owner `[data-catalog-scroll-row=…]` 存在；用 `/element/{id}/rect` 读 owner 与首/末子元素，断言横向延伸 > owner 宽度（真实溢出 = 不换行）；结构行 `progress-indicator-*` ≥24、段落行 `paragraph-*` ≥40 |
| ② 当前项居中跟随 | 真实点击中段目录节点（公开 seek → 该节点成为当前项）后用 `/element/{id}/rect` 断言 `|itemCenter − ownerCenter| ≤ 2px`。容差依据：生产的 `scrollIntoView({block:'nearest', inline:'center'})` 只做子像素对齐、目录行无额外内边距、中段节点两侧都有滚动余量；实测差值写入 `observed` 供复审按托管实测定标 |
| ③ 边缘渐隐 owner | 初态（`scrollLeft=0`）必须「只右」；用**真实 `/actions` 滚轮**滚到中段要求两侧同时出现；再滚到末端要求「只左」；每处核对 `aria-hidden="true"`。`pointer-events:none` 与方向渐变（left→`to right`、right→`to left`）用 computed style 作**标注来源**的补充证据；显隐完全由真实滚动几何决定 |
| ④ 暂停后不再强制跟随 | 断言媒体已暂停 → 记录滚动 owner `scrollLeft` 基线 → 真实点击播放推进 2s（断言基线不变）→ 真实点击暂停（断言 `paused=true`）→ 依次真实点击起点节点（公开 seek 到 0）与另一节点，每次都断言基线不变 |

## 3. 隔离与受控夹具

- `RAIN_E2E_MODE=1` + `RAIN_E2E_RUN_MODE=study-catalog` 只需要隔离 SQLite（`RAIN_E2E_DB_PATH`）与一份媒体文件路径（复用既有 `RAIN_E2E_VIDEO_PATH`）；不需要 evidence id、Whisper 模型或任何 LLM Key。
- **首次启动必须是真实空库**：短模式只武装夹具公开面，不导航、不启动导入、不写任何业务行。
- 夹具只经 `window.__RAIN_STUDY_CATALOG_FIXTURE__.seed()` 由脚本显式请求，仍走生产 `getDb()` / `insertVideo` / `insertNodes` / `insertSentences`：1 个 `status:'ready'`、`duration:14` 的视频；8 章 × 3 节 + **恰好 40 段落**（前 16 节各 2 段、后 8 节各 1 段），章 1.75s / 节 0.583s，时间轴全部落在 `[0,14]`；**每个 paragraph 都必须有一条 sentence**（生产的 `loadVideo` 要求「至少一个 paragraph 且 sentences 非空」，见 `src/store/rain-store.ts:176/:180`，否则学习页永不出现）。
- 媒体形态：优先无外部工具依赖的 Node 生成 WAV；**该形态是否被 `<video>` 接受并推进 `currentTime` 至今未被观测**（上个 run 未跑进 `wav-playback-probe`）；若探针报告未推进，必须改用 CI 内 ffmpeg 生成的短视频并附探针证据。
- 夹具落库后脚本**关闭并重建 WebDriver session**（真实进程重启），再真实点击生产列表卡主操作（`aria-label="打开视频：<标题>"`）进入学习页。

## 4. 失败诊断（脱敏、有界）

失败时在系统临时目录保留单份 `rain-study-catalog-e2e-latest-failure/`：`summary.json` + `tauri-driver.log` + `tauri-driver.err.log`。

`summary.json` 必须给出 `phase`、主错误、**非空 `missingConditions`** 与 `observed`。`observed` 已包含：能力探针结论（`/element/{id}/rect`、`/actions`）、`fixtureInterfaceStatus`、`fixtureStatusAfterRestart`、`catalogFixtureDeclaration`、`cardButtonCount` 与 `cardPrimaryActionLabels`（原文）、`studyPageWaitCriterion`（判据 + 超时阈值）、`studyPageTimeoutState`（`currentPage` / `role="alert"` 文案 / study-interface 与 video 存在性 / `video.error.code`）等。已知 Key、`sk-*` 与 Bearer token 一律 `[REDACTED]`；诊断不含隔离 SQLite；成功 run 清理 stale 诊断。

**已知诊断缺口（已登记）**：`tauri-driver` 的 stdout/stderr 在失败 artifact 中为 0 字节（既有模式的系统性行为）——因此在能修好之前，定位必须依赖 `summary.json` 的 `observed`。

## 5. 截图（仅附件）

成功 run 最多写 1 张 `rain-study-catalog-e2e-attachment/video-list…png` 等价截图 + `ATTACHMENT-NOTICE.txt`，artifact 名称与说明都标注**「仅附件，不构成 Visual Evidence」**，保留期 7 天。截图不得作为唯一或主要裁判。

## 6. Hosted 触发与边界

- `.github/workflows/study-catalog-desktop-e2e.yml` 在 `pull_request`（paths 过滤到本 Judge 相关代码与脚本）上运行，使被审 head 上就有真实 run；`workflow_dispatch` 只是**合并后**的重放入口（新 workflow 文件在功能分支上无法 dispatch）。
- 该 workflow **不是** master 必需状态检查，不改分支保护，不修改受保护分支，不 dispatch 任何 Release/GPU workflow，不使用任何 Rain secret、模型或 Whisper。
- 与 AC-HE-05 的 owner（`runtime-settings-desktop-e2e.yml` + 其脚本）和 AC-VL-04 的 owner（`video-list-desktop-e2e.yml` + 其脚本）**完全独立**，本 Judge 不改动二者。
- **证据对应规则（STD-67-4）**：桌面证据对应被测 head 的**代码树**；`paths` 有意不含 `docs/**`，因此若仅文档改动使 head 前移，必须先用 `git diff <旧 head> <新 head> -- <代码路径>` 证明代码树未变，否则需在合并后以 `workflow_dispatch` 在合并提交上重放，才可引用该证据。
- 不参与 `harness:check`；默认 Harness 不运行任何桌面 Judge。

## 7. 未覆盖边界（诚实声明）

- 只覆盖第 2 节列出的四项条件；**不签发 Visual/Accessibility Evidence**，不覆盖 `AC-SU-02/SU-04/SU-05/SU-06`、`AC-VL-*`、`AC-UX-*` 或其他 AC。
- 合成媒体 ≠ 真实用户素材；媒体真实时长为 fixture 声明的 14s，目录时间轴必须落在该时长内。
- 本 Judge 的存在与通过**都不等于 `AC-SU-01` 已闭合**：闭合需独立 Spec 与 Standards 复审通过并受保护合并；在此之前文档只可写「其 `Strong + Desktop Evidence` 预算可判定满足」。
- `tauri-driver` 日志为 0 字节的既有诊断缺口见第 4 节。
