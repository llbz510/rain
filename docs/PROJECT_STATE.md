# Rain Project State

> 状态：`Active`
> 作用：当前可验证快照与短期交接，不是项目日记、产品规格或验收标准。历史会话、旧验证和已合并改动应从 Git/PR 历史读取。

## Current control facts

Primary checkout: current Git worktree. Active control documents and runnable scripts must not depend on a legacy checkout location.

- 远端：`origin` 为公开 GitHub 仓库；本地 `master` 跟踪 `origin/master`。
- 保护规则：合并候选和 `master` push 都由独立 `windows-2025` 的 `Clean Windows Harness` 裁判；它运行 `npm ci` 和唯一完整入口 `npm run harness:check`。
- 本快照记录稳定的受保护基线；当前 worktree、分支和未提交变更必须由 `git status --short`、`git branch --show-current`、`git log -1 --oneline` 重新读取，不在此处复制。

## Current verified baseline

受保护 `origin/master` 是 `3cb4531ec060d66be0da8db5ebe9f8cca9f705db`（PR #68 merge commit，Harness 门禁稳定性修复）；上一条基线是 `23edfe899f4c8c6291b142c8733bc132bdfda219`（PR #67 merge commit，AC-VL-04 托管桌面证据骨架）。

- PR #65 的两个 head 都在自动 `pull_request` `Clean Windows Harness` 上 `success`：judge-only head `5c984a7` 的 run [`36289060427`](https://github.com/llbz510/rain/actions/runs/36289060427)，最终 head `da3290d` 的 run [`36289620976`](https://github.com/llbz510/rain/actions/runs/36289620976)。
- PR #66 最终 head `d7a5b829b1df541808d27841b2f05b96eaa467ed` 的 `pull_request` `Clean Windows Harness` run [`36295683660`](https://github.com/llbz510/rain/actions/runs/36295683660) 为 `success`。
- PR #67 最终 head `0e8a37727b9edfb50ae83b2e02a2656ee3d2e067` 的 `pull_request` `Clean Windows Harness` run [`36306994388`](https://github.com/llbz510/rain/actions/runs/36306994388) 与新增桌面 Judge run [`36306994378`](https://github.com/llbz510/rain/actions/runs/36306994378) 均为 `success`。
- PR #68 head `89df85070039e93064ce97a7fc75a62538ca87dc` 的 `Clean Windows Harness` run [`36309103608`](https://github.com/llbz510/rain/actions/runs/36309103608) 为 `success`（attempt=1）。
- 目标 `master` push 的 `Clean Windows Harness` run [`36290508492`](https://github.com/llbz510/rain/actions/runs/36290508492) 对 `4a0b14c`、run [`36296522628`](https://github.com/llbz510/rain/actions/runs/36296522628) 对 `3db8032`、run [`36310057838`](https://github.com/llbz510/rain/actions/runs/36310057838) 对 `3cb4531` 均为 `success`。

这些成功只证明各自目标提交在干净 Hosted Windows 上通过默认 Harness；不替代真实桌面、GPU、模型、安装器或 Release Evidence。

## Current delivery direction

当前唯一开发方向是从 [`launch-feature-audit.md`](development/launch-feature-audit.md) 的 blocker ledger 逐个关闭一个用户可见、已 Confirmed 的 Launch feature Slice。该 ledger 只报告生产路径与缺口，不定义 AC、Judge、等级或完成状态。

M3/GPU/Release Evidence、受控 GPU artifact build、安装器、签名、许可、Release 和下载页均为 user-paused。已取消的受控 GPU run 没有产生 manifest、core/control artifact、build record 或 launcher；未经用户明确恢复不得调度或重跑相关 workflow，也不得据此升级任何 `AC-RL-*`。

含 `Visual` 或 `Accessibility` 的候选（`AC-VL-01`/`VL-07`、`AC-SU-02`/`SU-05`/`SU-06`、`AC-UX-01`~`UX-06`）必须先冻结 M9-S1 视觉合同并由用户确认视觉语义，才可产生对应 Evidence；在那之前不得自行决定视觉语义或用 DOM 断言替代。

## Effective evidence and boundaries

- [`canonical-evidence-freshness-2026-08-02.md`](development/canonical-evidence-freshness-2026-08-02.md) 是 tracked schema v2 Evidence 的当前新鲜度审计。`evidence/rain-real-e2e-20260726-195652/` 只证明其记录的 408b6db-era 配置和运行，不能证明当前 target、其他模型或 vision。
- `AC-HE-05` 的 Hosted Runtime Settings Judge 仅对 `a329059b8172dab82c7326deb0af322045a0c396` 的 workflow_dispatch run `30756311932` 签发；桌面边界变动后的目标提交仍需独立重放。
- `AC-HE-01` 的 `npm run harness:control` 只裁判控制面自洽；`AC-HE-06` 只裁判 99 条历史产品决策的当前去向。两者均不证明产品功能、SQLite/Tauri、真实媒体或 Release Evidence。

## Active risks and boundaries

- 所有未关闭的 Required Evidence 仍是 blocker，除非对应 audit 行明确标为无新要求、supplement-only 或条件未来重放；测试存在不等于功能或 Evidence 已完成。
- `AC-RL-08` 仍是 `Partial`：现有 adapter/静态合同不构成目标安装器、受支持 NVIDIA 主机、模型和真实运行的 Release Evidence。该工作已 user-paused。
- `AC-VL-05` 的 app-owned 缩略图删除已随 PR #65 合并进受保护 `master`（`4a0b14c`）；`AC-VL-06` 孤儿 GC 已随 PR #66 合并（`3db8032`）；`AC-VL-04` 的视频列表页桌面证据已随 PR #67 合并（`23edfe8`，含新增 `video-list-desktop-e2e.yml` 与其 Judge 脚本），其 `Strong + Desktop Evidence` 预算中的完整页面组合 Strong Judge、其余桌面条件与 Visual/Accessibility 仍未闭合。`AC-AR-05/06` 的 app-scope import owner 与判别式 progress contract 仍是独立缺口。具体生产路径、现状和优先级以 Launch audit 为准。
- 门禁稳定性修复已随 PR #68 合并（`3cb4531`）：`scripts/controlled-candidate-source.test.ts` 的候选 git 夹具改为一次构建后按用例复制、`scripts/nvidia-release-evidence.test.ts` 的 manifest 表夹具改为一次构建后逐用例派生，并按实测为 4 个已触顶的重活用例标定上限。该修复**不提升任何 AC 等级**，只降低 `npm test` 随机超时打断其后的 `build:e2e`/`build`/`test:rust` 的概率。已登记、尚未处理的后续项：① `scripts/nvidia-release-evidence.test.ts` 的 PE 用例注释写「16 次契约调用」而静态清点为 15 次，属注释更正（不影响 30s 上限）；② 在托管负载下仍接近未改 15s 上限的用例（本机实测，按托管折算后剩余余量约 1.3×）：`nvidia-release-evidence` 的 `hygiene scopes` 2054ms、`installed-tree reconciliation` 2147ms、`installed CUDA payload set` 4696ms，`release-artifact-generator` 的 2762ms 与 1676ms；③ 把「6 次真实契约调用合并为 1 次 PowerShell 调用」列为后续候选（会改变用例调用结构、需重新论证断言强度，前轮已否决）。
- whole-repo `cargo fmt` 不能作为干净门禁：既有/locked Rust 差异会污染结果；新 Rust 文件仍必须使用 file-scoped `rustfmt`。
- `core.autocrlf` 可能造成 `Cargo.toml` ghost diff；是否真实变更必须以 `git diff` 判断。
- 本地可信 WebView 的前端 SQL plugin 需要 `sql:allow-execute`；若将来加载远程不可信内容，必须先重新收紧该 capability。

## Maintenance and current handoff

修改项目文件的会话必须同步本快照，但只能替换已过期的当前事实和本节交接，不得新增按日期的会话段落或 `## What changed` 时间线。每次交接保留一个可验证的现行 Slice：AC、Owner、公开 Judge、RED/GREEN、独立审查结果、未运行 Evidence、下一唯一动作；历史细节由 commit/PR 记录承载。

上一个 Slice 是门禁稳定性修复（PR #68，已合并 `3cb4531`）：目标只是在 `npm test` 首次失败时不再随机吞掉其后的 `build:e2e`/`build`/`test:rust`；不签发任何 Release/GPU/安装器/Evidence 结论，也不改变 `harness:check` 的 `&&` 链条语义。其 Hosted 证据、三个测试文件的 before/after 与负载归一化口径、复审登记项见 PR #68 与上文「Active risks」。

当前 Slice 是 `AC-SU-01`（学习页长目录桌面证据）：Owner 是生产 `StudyInterface` 与 `CatalogBar`（`src/ui/components/catalog.tsx`）、`video.tsx` 的媒体会话、`src/e2e/real-e2e-runner.tsx` 的 `study-catalog` 短模式、`src-tauri/src/e2e_config.rs` 的 E2E 门，以及新增的 `scripts/run-study-catalog-e2e.ps1` 与 `.github/workflows/study-catalog-desktop-e2e.yml`；AC-HE-05 与 AC-VL-04 的 owner workflow 与其脚本一字不动。公开 Judge 是 `scripts/run-study-catalog-e2e.ps1`：真实 Tauri + 真实 WebView2/msedgedriver，用 W3C 元素端点读生产学习页 DOM 与几何并做真实操作，裁判①两行结构（章节顶行/段落底行、横向不换行）②当前项居中跟随③边缘渐隐 owner（两个真 scroll owner 非交互/`aria-hidden`/方向渐变）④暂停后用**真实滚轮入视野 + `/actions` 真实指针点击**行项（起点 seek 到 0 与中段）改变媒体位置，但 `structure` 与 `paragraph` **两行**的 `scrollLeft` 均相对各自基线不变、且媒体 `currentTime` 落入该行项由夹具声明推出的时间窗（element-click 端点的「点击前先滚入视野」语义会污染滚动基线，故不再用于这一步），并以播放态「媒体真实推进 + 当前项仍被居中」作正向对照；fixture 使用无外部工具依赖的合成 WAV（**已被托管实证接受并真实推进**），媒体真实时长由 fixture 显式声明并写入诊断，目录时间轴必须落在该时长内。本 Slice **尚未合并**：第一段已结清连续两轮欠下的文档债、建立新 workflow 与 Judge 骨架，并在 PR 上取得**实质 RED**——能力探针回答宿主是否支持 `/element/{id}/rect` 与 W3C `/actions`，学习页长目录夹具未建立导致四项条件无法判定，脚本报出具体缺失条件并留下脱敏 `summary.json`（RED 与 GREEN 的 run 见该 PR）。四项裁判（①两行结构 ②当前项居中跟随 ③边缘渐隐 owner ④暂停后不再强制跟随）与 WAV 播放探针已在 head `d14f384` 落地；RED 已完成两阶段：第一次「夹具不可判定」，第二次「夹具已 seeded（8章/24节/32段、14s）但真实点击卡主操作后生产学习页未出现」，根因是生产 `loadVideo` 要求「至少一个 paragraph 且 sentences 非空」（`src/store/rain-store.ts:176/:180`），修正 = seed 经公开 `insertSentences` 为每个 paragraph 补一条 sentence。Hosted 结论（两条都属 head `055a2fa`，即 sentences 修正**之前**的 head）：`Clean Windows Harness` = success（run [`36311722420`](https://github.com/llbz510/rain/actions/runs/36311722420)）、新桌面 workflow = failure（run [`36311722434`](https://github.com/llbz510/rain/actions/runs/36311722434)，失败点 `phase=restart-and-open-study`：「Timed out waiting for the production study page.」；其 failure artifact 解包后为 `summary.json` 1059 字节 + 两个 **0 字节** driver 日志，且 `missingConditions` 为空、无 `studyPageTimeoutState` —— 正是修正前脚本，依据见 `docs/development/study-catalog-desktop-e2e.md` §4）。head `d14f384` 自己的三条 run（`36312506221`/`36312506232`/`36312506368`）被下一次推送按 `concurrency` 取消；随后两个仅改 `docs/**` 的 head（`51cc9f1`、`1a80de5`，`git diff d14f384 1a80de5 -- scripts src src-tauri/src/e2e_config.rs package.json .github` 为空）重跑出了 sentences 修正的第一份已结论托管证据：`1a80de5` 上 `Clean Windows Harness` = success（run [`36312689536`](https://github.com/llbz510/rain/actions/runs/36312689536)）、本桌面 workflow = failure（run [`36312689535`](https://github.com/llbz510/rain/actions/runs/36312689535)），失败点 `phase=judge-row-structure`，根因是裁判①的**行项选择器错误**（`progress-indicator-*` 属 `SideTree`、`paragraph-*` 属文本区，两行滚动区内命中 0；两行实际各 32 个真实行项 `<span data-catalog-current>`），并暴露夹具声明 `paragraphCount=40` 与实际产出 32 不符；行项/条数修正落在 head `a6cc618`，其代码树的托管结论为 `Clean Windows Harness` = success（run [`36313834076`](https://github.com/llbz510/rain/actions/runs/36313834076)）、本桌面 workflow = failure（run [`36313834100`](https://github.com/llbz510/rain/actions/runs/36313834100)，失败点 `phase=restart-and-open-study`：`fixtureStatusAfterRestart=absent` + `cardButtonCount=0`）——同一段逻辑在 `1a80de5` 的 run `36312689535` 上读到 `seeded` + 2 张卡并成功进入学习页，故该失败是**启动竞态（非确定性）**：夹具接口由 runner 在 `await getDb()`+`getVideoById()` 之后才发布（`real-e2e-runner.tsx:809-815`），而脚本读到列表页就立即读取。修复 = 首启与重启后都先做**有界等待**（500ms 轮询、上限 30s；不延长 `$MaxSeconds`）并按 `absent`/`idle`/`failed` 三态分别报出，另补 ① 的绝对下限（两行 ≥24 项）与 ③ 的左端断言（`scrollLeft ≤ 0.5` = 生产 `EDGE_FADE_EPSILON`）；`.github/workflows/study-catalog-desktop-e2e.yml` 的触发注释同步按实测更正（原「仅文档改动不会重触发本 Judge」已被证伪，STD-69-14）。成功路径的事实输出也已补齐（SR-t52-4）：`success-facts.json` 写入**成功时会上传的附件目录**并同时打进运行日志（② 的实测居中差值与实际容差、首启/重启握手的判据/采样数/耗时/最后状态、夹具 status 与卡片数、两行 extent/owner、WAV 观测），并把此前**从未被调用**的仅附件截图接回成功路径，使文档 §5 的承诺与实际一致。之后 head `d36bfac` 的 run [`36314741172`](https://github.com/llbz510/rain/actions/runs/36314741172) **首次完整执行四项裁判**：①②③ 通过、仅 ④ 失败（`baseline=2072 after=0`）；经 t56 只读诊断判定为 **element-click 端点「点击前先滚入视野」语义（裁判口径）**、非产品缺陷（生产滚动写入点逐条排除，旁证 `src/__tests__/study-navigation.test.tsx:648-657`），修复 = ④ 改用「真实滚轮入视野 → 重录两行基线 → `/actions` 指针点击 in-view centre」+ 双行见证 + `currentTime` 落窗（t57）。该修复后的 run [`36321757895`](https://github.com/llbz510/rain/actions/runs/36321757895) 仍为 failure（`phase=judge-pause-stops-follow`，`第④项前置不成立：真实滚轮未能在有界步数内把行项「E2E 章节 1」滚入 owner 可视框 | wheelSteps=8 fullyInside=False itemLeft=-1872 itemWidth=65 ownerLeft=200 ownerWidth=508`）：t58/t59/t60 三方独立诊断一致判定为 `Move-CatalogRowItemIntoView` 的**滚轮分量符号反向**（`ownerCenter − itemCenter` 与宿主约定「正 deltaX 增大 scrollLeft」相反 ⇒ 目标在最左而行已在 max 2072 时 8 步零位移，恒等式 `ownerLeft − scrollLeft = itemLeft = −1872` 吻合），修复 = 符号改正为 `itemCenter − ownerCenter` + 新增**无进展检测**（每步写 `pauseFollowIntoViewSteps-*`，某步未变化即以具名条件 Fail）（t61）；同 head 的 `Clean Windows Harness` 与 `Hosted Windows Video List Desktop E2E` 均为 success，且该 run 的 `observed` 首次证明 **①②③ 托管通过**（① 32/32 项 + extent 2580.36/2499.09 vs owner 508；② `currentItemCenterDeltaPx=0.125` vs 容差 2；③ 只右(0)→两侧(800)→只左(2072) + `aria-hidden` + 方向渐变 + 左端 ≤0.5）。**已决事实**：合成 WAV 被 `<video>` 接受并真实推进（run `36312689535` 的 `wavPlayback`：`currentTime=10.109134`/`readyState=4`/`duration=14`/`errorCode=null`）⇒ 不需要 ffmpeg 媒体回退；sentences 根因修复同 run 实证（`fixtureStatusAfterRestart=seeded`、卡主操作标签正确、学习页真实出现，裁判①的几何半边 `structureRow 508→extent 2580.36`、`paragraphRow 508→2499.09` 通过）。GREEN 尚未观测：裁判①的条数半边（真实行项选择器 + 生成/声明/阈值/文档统一为 32）与裁判②③④仍待下一次托管 run 判定。`pull_request` 的 `paths` 过滤按 PR 相对基线的累计 diff 判定，仅改 docs 的推送也会在新 head 上重跑三条 workflow 并取消同 ref 上一轮。**不得预先宣告 AC-SU-01 闭合**：若后继段落取得双绿并通过独立 Spec/Standards 复审、受保护合并，其 `Strong + Desktop Evidence` 预算方可判定满足，等级变更留给后续流程；本 Slice 不签发 Visual/Accessibility Evidence、不外推其他 AC、不升级任何 `AC-RL-*`。未运行 Evidence：Visual/Accessibility、GPU/模型/安装器/Release。本机未运行 Cargo/Rust 编译与 `cargo test`、`harness:check`、真实 Tauri 桌面应用、GPU、模型、LLM 或真实安装包。下一唯一动作：在「④ 滚轮符号修正 + 无进展检测、首启/重启有界等待 + 三态分类、成功路径事实输出、④ 的指针触发与双行见证、① 绝对下限、③ 左端断言」的修复 head 上取得本桌面 workflow 与 `Clean Windows Harness` 双绿——四项裁判必须全部判定，② 的 2px 容差与 ④ 的双行见证均按托管实测复核；双绿后交独立 Spec 与 Standards 复审，再走受保护 PR 合并。
