# Rain Project State

> 状态：`Active`
> 作用：当前可验证快照与短期交接，不是项目日记、产品规格或验收标准。历史会话、旧验证和已合并改动应从 Git/PR 历史读取。

## Current control facts

Primary checkout: current Git worktree. Active control documents and runnable scripts must not depend on a legacy checkout location.

- 远端：`origin` 为公开 GitHub 仓库；本地 `master` 跟踪 `origin/master`。
- 保护规则：合并候选和 `master` push 都由独立 `windows-2025` 的 `Clean Windows Harness` 裁判；它运行 `npm ci` 和唯一完整入口 `npm run harness:check`。
- 本快照记录稳定的受保护基线；当前 worktree、分支和未提交变更必须由 `git status --short`、`git branch --show-current`、`git log -1 --oneline` 重新读取，不在此处复制。

## Current verified baseline

受保护 `origin/master` 是 `8cc2243b48a239b33807a52309361ea64eed8c7e`（PR #76 merge commit，视觉合同 S4「类型色落地」）；上一条基线是 `c923a048160376b193d93b6a1aa127114fd15e5c`（PR #75 merge commit，S3「剩余控件取值归一」），再上一条是 `ba815605f852ee88ba079c3512a2649670ca0532`（PR #74，S2「边框族」）与 `08a46b990c9e32313cfeec55962f9b09711acbed`（PR #73，S1「主按钮族」）。

- PR #76（head `131bf504`）的 `Clean Windows Harness` run [`36398642088`](https://github.com/llbz510/rain/actions/runs/36398642088) 与其 master push run [`36399821516`](https://github.com/llbz510/rain/actions/runs/36399821516) 均为 `success`（本次改动不在任何桌面 E2E 的路径过滤表内，故只有 Harness 运行——这是过滤表的正常结果）。
- PR #75（head `33eff5ec`）的 `Clean Windows Harness` run [`36388138048`](https://github.com/llbz510/rain/actions/runs/36388138048) 与其 master push run [`36389002668`](https://github.com/llbz510/rain/actions/runs/36389002668) 均为 `success`；同 head 的路径过滤桌面 E2E `Hosted Windows Video List Desktop E2E` run [`36388138033`](https://github.com/llbz510/rain/actions/runs/36388138033) 同为 `success`（本次改到了 `src/pages/VideoListPage.tsx`，命中过滤表）。

- PR #70 的 `Clean Windows Harness` run [`36369511974`](https://github.com/llbz510/rain/actions/runs/36369511974) 与其 master push run [`36370209231`](https://github.com/llbz510/rain/actions/runs/36370209231) 均为 `success`；PR #71 的 `Clean Windows Harness` run [`36377596015`](https://github.com/llbz510/rain/actions/runs/36377596015) 为 `success`。
- PR #73（head `93c32929`）的 `Clean Windows Harness` run [`36380219961`](https://github.com/llbz510/rain/actions/runs/36380219961) 与其 master push run [`36380976224`](https://github.com/llbz510/rain/actions/runs/36380976224) 均为 `success`；同 head 的路径过滤桌面 E2E：`Hosted Windows Video List Desktop E2E` run [`36380219934`](https://github.com/llbz510/rain/actions/runs/36380219934)、`Hosted Windows Study Catalog Desktop E2E` run [`36380219960`](https://github.com/llbz510/rain/actions/runs/36380219960)，同为 `success`。
- PR #74（head `90bf93bd`）的 `Clean Windows Harness` run [`36383945367`](https://github.com/llbz510/rain/actions/runs/36383945367) 与其 master push run [`36384825669`](https://github.com/llbz510/rain/actions/runs/36384825669) 均为 `success`。该 PR 只改了 `docs/**` 与 `src/ui/components/settings/**`、`src/__tests__/**`，**不在两个桌面 E2E 的路径过滤表内**（`video-list-desktop-e2e.yml` 关注 `src/pages/VideoListPage.tsx`、`src/ui/components/video-list.tsx` 等；`study-catalog-desktop-e2e.yml` 关注 `src/pages/StudyInterface.tsx`、`src/ui/components/catalog.tsx`、`src/ui/components/video.tsx` 等），因此本次只有 Harness 一个 workflow 运行——这是路径过滤的正常结果，不是被跳过。
- 更早基线（PR #65–#69）的 Hosted 结论保留在各自 PR 与其 run 记录中；本快照不复制它们。

这些成功只证明各自目标提交在干净 Hosted Windows 上通过默认 Harness；不替代真实桌面、GPU、模型、安装器或 Release Evidence。

## Current delivery direction

当前唯一开发方向是从 [`launch-feature-audit.md`](development/launch-feature-audit.md) 的 blocker ledger 逐个关闭一个用户可见、已 Confirmed 的 Launch feature Slice。该 ledger 只报告生产路径与缺口，不定义 AC、Judge、等级或完成状态。

M3/GPU/Release Evidence、受控 GPU artifact build、安装器、签名、许可、Release 和下载页均为 user-paused。已取消的受控 GPU run 没有产生 manifest、core/control artifact、build record 或 launcher；未经用户明确恢复不得调度或重跑相关 workflow，也不得据此升级任何 `AC-RL-*`。

含 `Visual` 或 `Accessibility` 的候选（`AC-VL-01`/`VL-07`、`AC-SU-02`/`SU-05`/`SU-06`、`AC-UX-01`~`UX-06`）的取值问题**已全部结清**：根目录 `M13-visual-design.md` 状态「已确认」，其决策 63–71、73–79、81 共 17 条已有明确产品依据（决策 72 已 `Out-of-scope` 并由 077 接管、决策 80 仍为 `Proposed`），`docs/development/visual-contract.md` 已把这 17 条转成可裁判条目；M13 只给定性的地方，其具体取值也已由用户于 2026-09-28 答复冻结（该合同 §6 的 `DEC-VC-01`…`04`：主按钮改描边款+其余只调色值、一律达标并冻结「承载文字的填充块不单独判定」的边界、按背景分两套调色板语义不变、状态叠加允许但文字必须达标），并标定到该合同 §5.5（全部为**计算验算**，不是真实桌面实测）。剩下两类工作：① 按该合同 §5.4 的 S1–S7 顺序修复 **23** 条缺口（§5.3 已登记 S1 关闭 5 条、S2 关闭 2 条、S3 关闭 3 条、S4 关闭 4 条、S5 关闭 3 条，**余 6 条**；修复走受保护 PR，合同自身不改产品代码）；② 由独立视觉审查员对照该合同裁判**真实桌面实测**，用已打通的桌面证据能力产出目标提交的真实运行与实测数据。M9-S1 覆盖的候选只到 `DEC-PRD-076`，M9-S2/M9-S3（可访问性、生产截图与视觉回归）仍需独立推进。在真实桌面实测产出前不得用 DOM 断言、jsdom 或截图单独替代 Visual Evidence。

## Effective evidence and boundaries

- [`canonical-evidence-freshness-2026-08-02.md`](development/canonical-evidence-freshness-2026-08-02.md) 是 tracked schema v2 Evidence 的当前新鲜度审计。`evidence/rain-real-e2e-20260726-195652/` 只证明其记录的 408b6db-era 配置和运行，不能证明当前 target、其他模型或 vision。
- `AC-HE-05` 的 Hosted Runtime Settings Judge 仅对 `a329059b8172dab82c7326deb0af322045a0c396` 的 workflow_dispatch run `30756311932` 签发；桌面边界变动后的目标提交仍需独立重放。
- `AC-HE-01` 的 `npm run harness:control` 只裁判控制面自洽；`AC-HE-06` 只裁判 99 条历史产品决策的当前去向。两者均不证明产品功能、SQLite/Tauri、真实媒体或 Release Evidence。
- [`visual-contract.md`](development/visual-contract.md) 只把 M13 已有产品依据的决策（63–71、73–79、81，共 17 条）转成可裁判数字与证据形态；它不定义 AC、不改变 AC 状态或 Evidence tier，也不构成任何 AC 的 Evidence。`VC-01`…`VC-19` 尚无任何一条取得真实实测。已关闭缺口（§5.3 的 17 条）**大多**有「把取值改回旧值就会失败」的锁定测试：`src/__tests__/visual-contract-primary-actions.test.ts`（12 项，S1）、`visual-contract-settings-palette.test.ts`（15 项，S2）、`visual-contract-control-styles.test.ts`（9 项，S3 的 `VCGAP-21`/`VCGAP-22`）、`visual-contract-type-colors.test.ts`（**13 项**，S4 的 `VCGAP-03`/`05`/`14`/`15`）、`visual-contract-palette-parity.test.ts`（7 项，`VCGAP-04`——S4 已按必做项改成读真实源码并证明会失败）、`visual-contract-status-colors.test.ts`（8 项，S5 的 `VCGAP-12`/`13`/`23`）。锁定测试只证明**取值不回退**，不证明真实桌面观感与可达标。

## Active risks and boundaries

- 所有未关闭的 Required Evidence 仍是 blocker，除非对应 audit 行明确标为无新要求、supplement-only 或条件未来重放；测试存在不等于功能或 Evidence 已完成。
- `AC-RL-08` 仍是 `Partial`：现有 adapter/静态合同不构成目标安装器、受支持 NVIDIA 主机、模型和真实运行的 Release Evidence。该工作已 user-paused。
- `AC-VL-05` 的 app-owned 缩略图删除已随 PR #65 合并（`4a0b14c`）；`AC-VL-06` 孤儿 GC 已随 PR #66 合并（`3db8032`）；`AC-VL-04` 的视频列表页桌面证据已随 PR #67 合并（`23edfe8`）；`AC-SU-01` 的学习页长目录桌面证据已随 PR #69 合并（`9639410c`），其四项裁判在托管真实桌面运行上取得 GREEN，`AC-SU-01` 的 `Strong + Desktop Evidence` 预算等级可判定满足，等级变更留给后续控制面流程。`AC-VL-04` 的完整页面组合 Strong Judge、其余桌面条件与 Visual/Accessibility 仍未闭合；`AC-AR-05/06` 的 app-scope import owner 与判别式 progress contract 仍是独立缺口。具体生产路径、现状和优先级以 Launch audit 为准。
- 门禁稳定性修复已随 PR #68 合并（`3cb4531`）：三个 Release 范围测试文件的夹具改为一次构建后按用例派生，并按实测标定重活用例上限。该修复**不提升任何 AC 等级**。已登记、尚未处理的后续项：① `scripts/nvidia-release-evidence.test.ts` 的 PE 用例注释写「16 次契约调用」而静态清点为 15 次，属注释更正（不影响 30s 上限）；② 在托管负载下仍接近 15s 上限的用例（`nvidia-release-evidence` 的 `hygiene scopes`/`installed-tree reconciliation`/`installed CUDA payload set`，`release-artifact-generator` 的两个用例）；③ 把「6 次真实契约调用合并为 1 次 PowerShell 调用」列为后续候选（会改变用例调用结构、需重新论证断言强度，前轮已否决）；④ **已观测到的负载相关 flake（不要再当新回归排查）**：PR #73 首次推送（head `150b2838`）的 `Clean Windows Harness` run [`36379387687`](https://github.com/llbz510/rain/actions/runs/36379387687) 在 `scripts/nvidia-release-evidence.test.ts`（72 项中 2 项）失败，错误为 `Test timed out in 5000ms`（`:1597`）与 `PowerShell test cleanup failed: terminate child 9292: the child process rejected SIGKILL`（`:1148`）、`Contract invocation failed: Child process timed out after 4000 ms and was terminated: pwsh.exe`；该文件在本轮**未被改动**（S1 只动 `src/index.css` 与三个 `src/` 前端文件），同一代码在 PR #72 的 run `36378798081` 上通过，PR #73 的下一次内容推送（head `93c32929`）未经重跑即变绿。判定为 Release/GPU 范围的既有 flake，**不得**用放宽超时、删改断言或 `--admin` 绕过它；若它再次拦住不相关 Slice，正确处理是把证据交回用户/Captain 决定是否重跑。
- whole-repo `cargo fmt` 不能作为干净门禁：既有/locked Rust 差异会污染结果；新 Rust 文件仍必须使用 file-scoped `rustfmt`。
- `core.autocrlf` 可能造成 `Cargo.toml` ghost diff；是否真实变更必须以 `git diff` 判断。
- 本地可信 WebView 的前端 SQL plugin 需要 `sql:allow-execute`；若将来加载远程不可信内容，必须先重新收紧该 capability。
- **本机网络限制（会反复踩，务必先读；已知环境限制 + 既有 workaround）**：`git push` / `git fetch` 到 `github.com:443` 会失败（`Failed to connect … port 443` / `Recv failure: Connection was reset`，实测连续 8 次失败、`Test-NetConnection github.com -Port 443` 为 `False`），而 **`api.github.com:443` 可达**、`gh` 命令正常。**既有 workaround**：一切「取远端 / 推远端」都走 API——推送用 **GitHub Git Data API**（`git/blobs` → `git/trees` → `git/commits` → 更新 `refs/heads/<branch>`）；核对一致性用 `gh api .../git/commits/<sha>` 取远端 tree SHA 与本地 `git rev-parse HEAD^{tree}` 比对，并用 `compare` API 核对 delta。因此 **`git fetch` 不可用**：本地不会有远端新建的提交对象，**本地 `master` 是一个「内容等价提交」**（S3 收尾时建立的本地 `master` = `2696ef61`，其 tree 与远端 master 的 tree 逐字节相同，已用 API 核对）——`git status` 提示与 `origin/master` diverged 属**过期的 remote-tracking 引用**，不是内容分叉，**不必排查**。三点注意：① 以 `git cat-file blob HEAD:<path>` 的字节为准（工作树在 Windows 上含 CRLF，`core.autocrlf` 会让远端 blob 与仓库约定不一致）；② 用 `base_tree` 建 tree 时必须**显式列出继承层级里的每一个被改文件**，否则同名条目会从父提交继承旧 blob；③ 每轮开工前必须用 API 取回真实 master 的 tree 与受影响文件内容再施加改动，并用 `compare` API 核对最终 delta（PR #72 就因基点停在 PR #69 而试图净删 193 行已合并的合同内容，靠 Spec 轴审查才发现）。`gh pr create` / `gh pr merge` / `gh pr checks` 均不受影响。
- 视觉/无障碍缺口已由 `visual-contract.md` 编号登记（`VCGAP-01`…`VCGAP-23` 共 **23** 条；§5.3 已登记 S1 关闭 5 条、S2 关闭 2 条、S3 关闭 3 条、S4 关闭 4 条、S5 关闭 3 条，**余 6 条**），取值已在该合同 §5.5 冻结、排期顺序见 §5.4、关闭记录见 §5.3。**没有任何缺口在等输入**（`VCGAP-23` 的语义问题用户已答复**选项 A**：三处统一改用本套「处理中」色、不新增语义，S5 已完成）。当前最要紧的是 **S6 列表卡视觉**：`VCGAP-06`（卡片信息布局）+ `VCGAP-19`（就绪卡进度条中性色）。其余重点：`VCGAP-06` 列表卡视觉（S6，与 `VCGAP-19`、`VCGAP-08`… 按 §5.4）；`VCGAP-16` 控制栏高度实现为 80px 而决策 76 要求 40px（S7）。已关闭条目的「改造前」基线数字（§5.1/§5.2）保留不改，它们是反例锚点的依据。
- **锁定 Harness 与合同取值冲突（S4 首次实例，已按用户批准处置）**：`harness/m13-visual.test.ts:22-29` 的期望值数组原先把段落四色令牌焊死为**实现自选、从未经用户批准**的旧值，与合同 §5.5.1 的已批准取值冲突（按合同改令牌会让门禁变红）。用户 2026-09-28 **明确批准方案 A**，授权范围严格限定为「只重钉那份期望值数组」；迁移记录见 [`harness-migration-2026-09-28-paragraph-type-token-values.md`](development/harness-migration-2026-09-28-paragraph-type-token-values.md)，处置规则已写进 `visual-contract.md` §7。**`src/index.css` 仍是段落四色的唯一真相源。**
- **仓库卫生（防复犯，务必先读）**：**主检出必须常驻 `master` 且工作树干净；一切功能分支改动都在独立 worktree 里做**（本机约定目录 `D:\xiangmu\rain-worktrees\`），不要让主检出停在功能分支上。**开工前先核对本地 `master` 与远端一致**：本机 `git fetch` 被阻断，因此核对方式是用 `gh api repos/llbz510/rain/git/commits/<master>` 取远端 tree SHA，与本地 `git rev-parse HEAD^{tree}`（或 `git ls-tree -r`）比对；不一致就先用 API 把受影响文件同步成远端逐字节内容。**从真实 master 重建 + 用 `compare` API 核 delta** 是唯一能防住「静默回退已合并内容」的做法——`harness:control` 只扫 5 个控制面文件（`acceptance-standard.md`、`harness-coverage.md`、`product-decision-coverage.md`、`PROJECT_STATE.md`、`rain-project-delivery-plan.md`），**拦不住 `visual-contract.md` 之类的静默回退**（PR #72 就是这么差点净删 193 行）。另注：`C:\Users\24627\.codex\worktrees\*` 是历史遗留目录，**不属当前工作流**，不要在其中开工。
- 下一轮之前必须先关闭的文档债：`harness-coverage.md` 中 `AC-UX-0*`/`AC-VL-01`/`AC-VL-07`/`AC-SU-0*` 行的「独立 visual review 缺失」表述（如 `AC-UX-01` 行）尚未引用 `visual-contract.md`，`launch-feature-audit.md` 对同一批行写的是「阻断：Strong + Visual Evidence」、也尚未引用该合同（该合同现已 Active，两者口径需在下一次替换式更新时对齐）；`AC-SU-01` 的等级闭合仍留在控制面流程中；STD-68/69 系列历史文档债（上一快照的过期「GREEN 尚未观测」项已由本快照替换式关闭，attachment `headSha` 说明与渐隐明细字段仍未补）。

## Maintenance and current handoff

修改项目文件的会话必须同步本快照，但只能替换已过期的当前事实和本节交接，不得新增按日期的会话段落或 `## What changed` 时间线。每次交接保留一个可验证的现行 Slice：AC、Owner、公开 Judge、RED/GREEN、独立审查结果、未运行 Evidence、下一唯一动作；历史细节由 commit/PR 记录承载。

上一个 Slice 是 **S4「类型色落地」**（PR #76 合并 `8cc2243b`，合同 §5.4 第四段）：Owner 是 `src/index.css`（四个段落色令牌改 §5.5.1「彩字态」值 `#5b9bf8`/`#3ecf8e`/`#f0a13c`/`#9e9e9e`）、新增 `src/ui/components/type-capsule.tsx`（决策 71 形态 + 8px 圆角）渲染在 `src/ui/components/text-zone.tsx` 既有的 `data-type-badge` 占位处、`notes.tsx` 裸值改令牌，以及**经用户批准的锁定 Harness 期望值重钉**（`harness/m13-visual.test.ts:28`；迁移记录 `docs/development/harness-migration-2026-09-28-paragraph-type-token-values.md`）。公开 Judge：`visual-contract-type-colors.test.ts`（13 项）+ 改造后的 `visual-contract-palette-parity.test.ts`（7 项，方向判据改读真实源码，S3 必做项已结）。RED/GREEN：回退实现后 type-colors 9 项 + parity 1 项失败（共 10），恢复后 22 项全绿；全量前端 109 文件 / 825 项。独立审查为 t1 双轴（8 项）+ t2 双轴（17 项）+ t3 双轴复核（Standards PASS；Spec 指出 4 个「S4 前」标注错误已修）。该 Slice 不签发任何 Visual Evidence。

当前 Slice 是 **S5「状态色」**（`VCGAP-12` + `VCGAP-13` + `VCGAP-23`，合同 §5.4 第五段）：Owner 是 `src/ui/components/video-list.tsx`（状态徽章由「无底色裸文本」改为**白字压填充态**的填充块（圆角 4px）：失败 `#a82e26` 6.81 / 处理中 `#7a5a00` 6.38 / 排队 `#5b6470` 6.00）与 `src/pages/VideoListPage.tsx`（三处提示由 `#f85149`（浅底套失败红）与 `#d29922`（不在任何一套）改为本套「处理中」彩字态 `#e3b341`，即用户 2026-09-28 答复的**选项 A**，不新增「警告」语义）。公开 Judge 是新增 `src/__tests__/visual-contract-status-colors.test.ts`（8 项：读真实组件源码与令牌、实算比值；含「白字压绿/橙/类型色必须仍 <4.5:1」的反例锚点与「白字上界 `1.05/(L_bg+0.05)`、这些背景 L > 0.183333」这条**可证的不可能**）。RED/GREEN：回退两处实现后该裁判**整文件失败**（beforeAll 解析不到源码锚点 → 8 项 skipped、文件 failed），恢复后 **8 项全绿**；值级改错则让对应断言单独失败。**未运行 Evidence**：任何真实桌面视觉实测。**下一唯一动作**：S6「列表卡视觉」——`VCGAP-06`（卡片信息布局）+ `VCGAP-19`（就绪卡进度条中性色），测试先行 + 双轴独立审查 + 终审 + 受保护 PR + 代码与文档一次推送。

**写法纪律（Captain 要求，适用于本文件与 `visual-contract.md`）**：凡涉及「不可达/不可能」的论断，**必须给出可达性证明或反证（边界值、可行区间、反例）**；拿不出证明就只能写成**明示的取舍**（说明放弃哪一维、代价是什么、可选项是什么），**不得用「不可能」为取舍背书**。已发生两次并都按此更正：填充态对页背景的可行带 `[0.152926, 0.183333]`（宽 0.0304，取舍而非不可能）、半透明白细边的 `alpha ≥ 0.3284 / 0.3327 / 0.3341`（按 0.0001 网格取最小可行值；观感取舍而非不可能）。**数值写法附带要求**：引用 alpha 阈值必须与「先四舍五入到字节再算比值」的口径一致（写出最小可行 alpha 与其渲染色），否则会出现「阈值差一格、渲染色对不上」的自相矛盾。

**交接提醒（务必遵守）**：本机 `github.com:443` 被阻断，本地 `master` 引用不会随 API 合并更新，而 PR 是通过 GitHub Git Data API 推送/合并的——**下一轮动手前必须先用 API 取回真实 master 的内容重建工作树与全部受影响文件**（先逐文件核对「本地内容 == 真实 master 内容」，再在其上施加本轮改动，最后用 `compare` API 核对 delta）。PR #72 就因分支基点停在 PR #69 而把 PR #70/#71 的文档整段回退（相对真实 master 净删 193 行契约），靠 Spec 轴审查才发现；此类回退不会被 `harness:control` 拦住（它只扫 5 个控制面文件，不校验 `visual-contract.md`）。重建后必须逐文件核对「本地内容 == 真实 master 内容」，再在其上施加本次改动，并用 `git diff` 判断范围。
