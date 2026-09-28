# Rain Project State

> 状态：`Active`
> 作用：当前可验证快照与短期交接，不是项目日记、产品规格或验收标准。历史会话、旧验证和已合并改动应从 Git/PR 历史读取。

## Current control facts

Primary checkout: current Git worktree. Active control documents and runnable scripts must not depend on a legacy checkout location.

- 远端：`origin` 为公开 GitHub 仓库；本地 `master` 跟踪 `origin/master`。
- 保护规则：合并候选和 `master` push 都由独立 `windows-2025` 的 `Clean Windows Harness` 裁判；它运行 `npm ci` 和唯一完整入口 `npm run harness:check`。
- 本快照记录稳定的受保护基线；当前 worktree、分支和未提交变更必须由 `git status --short`、`git branch --show-current`、`git log -1 --oneline` 重新读取，不在此处复制。

## Current verified baseline

受保护 `origin/master` 是 `ba815605f852ee88ba079c3512a2649670ca0532`（PR #74 merge commit，视觉合同 S2「边框族」落地）；上一条基线是 `08a46b990c9e32313cfeec55962f9b09711acbed`（PR #73 merge commit，S1「主按钮族」），再上一条是 `45c0351322e84aec1e61ea9e9bce3de3d3ce1f9c`（PR #71 merge commit，视觉合同取值冻结），更早是 `75b102fadbf66ce70fa4d98890b44a9bb94ecaac`（PR #70，视觉合同治理）与 `9639410cf7ed76ad424d9507309970bd3397ed02`（PR #69，AC-SU-01 学习页长目录桌面证据）。

- PR #70 的 `Clean Windows Harness` run [`36369511974`](https://github.com/llbz510/rain/actions/runs/36369511974) 与其 master push run [`36370209231`](https://github.com/llbz510/rain/actions/runs/36370209231) 均为 `success`；PR #71 的 `Clean Windows Harness` run [`36377596015`](https://github.com/llbz510/rain/actions/runs/36377596015) 为 `success`。
- PR #73（head `93c32929`）的 `Clean Windows Harness` run [`36380219961`](https://github.com/llbz510/rain/actions/runs/36380219961) 与其 master push run [`36380976224`](https://github.com/llbz510/rain/actions/runs/36380976224) 均为 `success`；同 head 的路径过滤桌面 E2E：`Hosted Windows Video List Desktop E2E` run [`36380219934`](https://github.com/llbz510/rain/actions/runs/36380219934)、`Hosted Windows Study Catalog Desktop E2E` run [`36380219960`](https://github.com/llbz510/rain/actions/runs/36380219960)，同为 `success`。
- PR #74（head `90bf93bd`）的 `Clean Windows Harness` run [`36383945367`](https://github.com/llbz510/rain/actions/runs/36383945367) 与其 master push run [`36384825669`](https://github.com/llbz510/rain/actions/runs/36384825669) 均为 `success`。该 PR 只改了 `docs/**` 与 `src/ui/components/settings/**`、`src/__tests__/**`，**不在两个桌面 E2E 的路径过滤表内**（`video-list-desktop-e2e.yml` 关注 `src/pages/VideoListPage.tsx`、`src/ui/components/video-list.tsx` 等；`study-catalog-desktop-e2e.yml` 关注 `src/pages/StudyInterface.tsx`、`src/ui/components/catalog.tsx`、`src/ui/components/video.tsx` 等），因此本次只有 Harness 一个 workflow 运行——这是路径过滤的正常结果，不是被跳过。
- 更早基线（PR #65–#69）的 Hosted 结论保留在各自 PR 与其 run 记录中；本快照不复制它们。

这些成功只证明各自目标提交在干净 Hosted Windows 上通过默认 Harness；不替代真实桌面、GPU、模型、安装器或 Release Evidence。

## Current delivery direction

当前唯一开发方向是从 [`launch-feature-audit.md`](development/launch-feature-audit.md) 的 blocker ledger 逐个关闭一个用户可见、已 Confirmed 的 Launch feature Slice。该 ledger 只报告生产路径与缺口，不定义 AC、Judge、等级或完成状态。

M3/GPU/Release Evidence、受控 GPU artifact build、安装器、签名、许可、Release 和下载页均为 user-paused。已取消的受控 GPU run 没有产生 manifest、core/control artifact、build record 或 launcher；未经用户明确恢复不得调度或重跑相关 workflow，也不得据此升级任何 `AC-RL-*`。

含 `Visual` 或 `Accessibility` 的候选（`AC-VL-01`/`VL-07`、`AC-SU-02`/`SU-05`/`SU-06`、`AC-UX-01`~`UX-06`）的取值问题**已全部结清**：根目录 `M13-visual-design.md` 状态「已确认」，其决策 63–71、73–79、81 共 17 条已有明确产品依据（决策 72 已 `Out-of-scope` 并由 077 接管、决策 80 仍为 `Proposed`），`docs/development/visual-contract.md` 已把这 17 条转成可裁判条目；M13 只给定性的地方，其具体取值也已由用户于 2026-09-28 答复冻结（该合同 §6 的 `DEC-VC-01`…`04`：主按钮改描边款+其余只调色值、一律达标并冻结「承载文字的填充块不单独判定」的边界、按背景分两套调色板语义不变、状态叠加允许但文字必须达标），并标定到该合同 §5.5（全部为**计算验算**，不是真实桌面实测）。剩下两类工作：① 按该合同 §5.4 的 S1–S7 顺序修复 **23** 条缺口（§5.3 已登记 S1 关闭 5 条、S2 关闭 2 条、S3 关闭 3 条，**余 13 条**；修复走受保护 PR，合同自身不改产品代码）；② 由独立视觉审查员对照该合同裁判**真实桌面实测**，用已打通的桌面证据能力产出目标提交的真实运行与实测数据。M9-S1 覆盖的候选只到 `DEC-PRD-076`，M9-S2/M9-S3（可访问性、生产截图与视觉回归）仍需独立推进。在真实桌面实测产出前不得用 DOM 断言、jsdom 或截图单独替代 Visual Evidence。

## Effective evidence and boundaries

- [`canonical-evidence-freshness-2026-08-02.md`](development/canonical-evidence-freshness-2026-08-02.md) 是 tracked schema v2 Evidence 的当前新鲜度审计。`evidence/rain-real-e2e-20260726-195652/` 只证明其记录的 408b6db-era 配置和运行，不能证明当前 target、其他模型或 vision。
- `AC-HE-05` 的 Hosted Runtime Settings Judge 仅对 `a329059b8172dab82c7326deb0af322045a0c396` 的 workflow_dispatch run `30756311932` 签发；桌面边界变动后的目标提交仍需独立重放。
- `AC-HE-01` 的 `npm run harness:control` 只裁判控制面自洽；`AC-HE-06` 只裁判 99 条历史产品决策的当前去向。两者均不证明产品功能、SQLite/Tauri、真实媒体或 Release Evidence。
- [`visual-contract.md`](development/visual-contract.md) 只把 M13 已有产品依据的决策（63–71、73–79、81，共 17 条）转成可裁判数字与证据形态；它不定义 AC、不改变 AC 状态或 Evidence tier，也不构成任何 AC 的 Evidence。`VC-01`…`VC-19` 尚无任何一条取得真实实测。已关闭缺口（§5.3 的 10 条）**大多**有「把取值改回旧值就会失败」的锁定测试：`src/__tests__/visual-contract-primary-actions.test.ts`（12 项，S1）、`visual-contract-settings-palette.test.ts`（15 项，S2）、`visual-contract-control-styles.test.ts`（9 项，S3 的 `VCGAP-21`/`VCGAP-22`）、`visual-contract-palette-parity.test.ts`（7 项，S3 的 `VCGAP-04`——**该裁判改动前后都绿**，它锁的是「两套并存/方向判据」，不是修复某个取值）。锁定测试只证明**取值不回退**，不证明真实桌面观感与可达标。

## Active risks and boundaries

- 所有未关闭的 Required Evidence 仍是 blocker，除非对应 audit 行明确标为无新要求、supplement-only 或条件未来重放；测试存在不等于功能或 Evidence 已完成。
- `AC-RL-08` 仍是 `Partial`：现有 adapter/静态合同不构成目标安装器、受支持 NVIDIA 主机、模型和真实运行的 Release Evidence。该工作已 user-paused。
- `AC-VL-05` 的 app-owned 缩略图删除已随 PR #65 合并（`4a0b14c`）；`AC-VL-06` 孤儿 GC 已随 PR #66 合并（`3db8032`）；`AC-VL-04` 的视频列表页桌面证据已随 PR #67 合并（`23edfe8`）；`AC-SU-01` 的学习页长目录桌面证据已随 PR #69 合并（`9639410c`），其四项裁判在托管真实桌面运行上取得 GREEN，`AC-SU-01` 的 `Strong + Desktop Evidence` 预算等级可判定满足，等级变更留给后续控制面流程。`AC-VL-04` 的完整页面组合 Strong Judge、其余桌面条件与 Visual/Accessibility 仍未闭合；`AC-AR-05/06` 的 app-scope import owner 与判别式 progress contract 仍是独立缺口。具体生产路径、现状和优先级以 Launch audit 为准。
- 门禁稳定性修复已随 PR #68 合并（`3cb4531`）：三个 Release 范围测试文件的夹具改为一次构建后按用例派生，并按实测标定重活用例上限。该修复**不提升任何 AC 等级**。已登记、尚未处理的后续项：① `scripts/nvidia-release-evidence.test.ts` 的 PE 用例注释写「16 次契约调用」而静态清点为 15 次，属注释更正（不影响 30s 上限）；② 在托管负载下仍接近 15s 上限的用例（`nvidia-release-evidence` 的 `hygiene scopes`/`installed-tree reconciliation`/`installed CUDA payload set`，`release-artifact-generator` 的两个用例）；③ 把「6 次真实契约调用合并为 1 次 PowerShell 调用」列为后续候选（会改变用例调用结构、需重新论证断言强度，前轮已否决）；④ **已观测到的负载相关 flake（不要再当新回归排查）**：PR #73 首次推送（head `150b2838`）的 `Clean Windows Harness` run [`36379387687`](https://github.com/llbz510/rain/actions/runs/36379387687) 在 `scripts/nvidia-release-evidence.test.ts`（72 项中 2 项）失败，错误为 `Test timed out in 5000ms`（`:1597`）与 `PowerShell test cleanup failed: terminate child 9292: the child process rejected SIGKILL`（`:1148`）、`Contract invocation failed: Child process timed out after 4000 ms and was terminated: pwsh.exe`；该文件在本轮**未被改动**（S1 只动 `src/index.css` 与三个 `src/` 前端文件），同一代码在 PR #72 的 run `36378798081` 上通过，PR #73 的下一次内容推送（head `93c32929`）未经重跑即变绿。判定为 Release/GPU 范围的既有 flake，**不得**用放宽超时、删改断言或 `--admin` 绕过它；若它再次拦住不相关 Slice，正确处理是把证据交回用户/Captain 决定是否重跑。
- whole-repo `cargo fmt` 不能作为干净门禁：既有/locked Rust 差异会污染结果；新 Rust 文件仍必须使用 file-scoped `rustfmt`。
- `core.autocrlf` 可能造成 `Cargo.toml` ghost diff；是否真实变更必须以 `git diff` 判断。
- 本地可信 WebView 的前端 SQL plugin 需要 `sql:allow-execute`；若将来加载远程不可信内容，必须先重新收紧该 capability。
- **本机网络限制（会反复踩，务必先读）**：`git push` / `git fetch` 到 `github.com:443` 会失败（`Failed to connect … port 443` / `Recv failure: Connection was reset`，实测连续 8 次失败、`Test-NetConnection github.com -Port 443` 为 `False`），而 **`api.github.com:443` 可达**、`gh` 命令正常。因此在本机推送分支必须走 **GitHub Git Data API**（`git/blobs` → `git/trees` → `git/commits` → 更新 `refs/heads/<branch>`），并在推送后**逐字节校验**远端 blob/tree 的 git SHA 与本地 `HEAD:<path>` 一致；三点注意：① 以 `git cat-file blob HEAD:<path>` 的字节为准（工作树在 Windows 上含 CRLF，`core.autocrlf` 会让远端 blob 与仓库约定不一致）；② 用 `base_tree` 建 tree 时必须**显式列出继承层级里的每一个被改文件**，否则同名条目会从父提交继承旧 blob；③ **API 合并不会更新本地引用**（`git cat-file -t <master-sha>` 会报 bad object，`git diff master` 会把已合并内容显示成新增），所以**每轮开工前必须先用 API 取回真实 master、把每个受影响文件同步成 master 的逐字节内容，再在其上施加本轮改动**，并用 `compare` API 核对最终 delta（PR #72 就因基点停在 PR #69 而试图净删 193 行已合并的合同内容，靠 Spec 轴审查才发现；`harness:control` 只扫 5 个控制面文件，**不校验 `visual-contract.md`**，这类回退它拦不住）。`gh pr create` / `gh pr merge` / `gh pr checks` 均不受影响。
- 视觉/无障碍缺口已由 `visual-contract.md` 编号登记（`VCGAP-01`…`VCGAP-23` 共 **23** 条：原登记 20 条，`VCGAP-21` 由 S2 复核发现，`VCGAP-22`/`VCGAP-23` 由 S3 复核发现；§5.3 已登记 S1 关闭 5 条、S2 关闭 2 条、S3 关闭 3 条，**余 13 条**），取值已在该合同 §5.5 冻结、排期顺序见 §5.4、关闭记录见 §5.3。**唯一在等输入的是一处产品语义问题**（`VCGAP-23`：深底两处提示弹窗用了浅底套的失败红 `#f85149` 与一个不在任何一套里的 `#d29922`；「警告」是否等同决策 69 的「处理中」需用户确认，或为其新增语义——已并入 S5 开工前结清）。当前最要紧的是 **S4 类型色落地**：`VCGAP-03`（`--color-concept/example/analogy/transition` 四色只定义、`src/` 内零使用）+ `VCGAP-05`（类型胶囊未实现）+ `VCGAP-14`/`VCGAP-15`（类型色压面板作文字 3.21:1 / 4.22:1 不达标）；S3 已把浅底套的同色细边锁定为**全色同色值**（对三底 4.70–7.45:1，最小 4.70 = 橙对 panel2），S4 落地深底胶囊时同样取全色同色值。其余重点：`VCGAP-12`/`VCGAP-13` 状态徽章白字压 `--color-example #10b981` **2.54:1**、压 `--color-analogy #f59e0b` **2.15:1**（S5）；`VCGAP-16` 控制栏高度实现为 80px 而决策 76 要求 40px（S7）。已关闭条目的「改造前」基线数字（§5.1/§5.2）保留不改，它们是反例锚点的依据。
- **仓库卫生（防复犯，务必先读）**：**主检出必须常驻 `master` 且工作树干净；一切功能分支改动都在独立 worktree 里做**（本机约定目录 `D:\xiangmu\rain-worktrees\`），不要让主检出停在功能分支上。**开工前先核对本地 `master` 与远端一致**：本机 `git fetch` 被阻断，因此核对方式是用 `gh api repos/llbz510/rain/git/commits/<master>` 取远端 tree SHA，与本地 `git rev-parse HEAD^{tree}`（或 `git ls-tree -r`）比对；不一致就先用 API 把受影响文件同步成远端逐字节内容。**从真实 master 重建 + 用 `compare` API 核 delta** 是唯一能防住「静默回退已合并内容」的做法——`harness:control` 只扫 5 个控制面文件（`acceptance-standard.md`、`harness-coverage.md`、`product-decision-coverage.md`、`PROJECT_STATE.md`、`rain-project-delivery-plan.md`），**拦不住 `visual-contract.md` 之类的静默回退**（PR #72 就是这么差点净删 193 行）。另注：`C:\Users\24627\.codex\worktrees\*` 是历史遗留目录，**不属当前工作流**，不要在其中开工。
- 下一轮之前必须先关闭的文档债：`harness-coverage.md` 中 `AC-UX-0*`/`AC-VL-01`/`AC-VL-07`/`AC-SU-0*` 行的「独立 visual review 缺失」表述（如 `AC-UX-01` 行）尚未引用 `visual-contract.md`，`launch-feature-audit.md` 对同一批行写的是「阻断：Strong + Visual Evidence」、也尚未引用该合同（该合同现已 Active，两者口径需在下一次替换式更新时对齐）；`AC-SU-01` 的等级闭合仍留在控制面流程中；STD-68/69 系列历史文档债（上一快照的过期「GREEN 尚未观测」项已由本快照替换式关闭，attachment `headSha` 说明与渐隐明细字段仍未补）。

## Maintenance and current handoff

修改项目文件的会话必须同步本快照，但只能替换已过期的当前事实和本节交接，不得新增按日期的会话段落或 `## What changed` 时间线。每次交接保留一个可验证的现行 Slice：AC、Owner、公开 Judge、RED/GREEN、独立审查结果、未运行 Evidence、下一唯一动作；历史细节由 commit/PR 记录承载。

上一个 Slice 是 **S2「边框族」**（PR #74 合并 `ba815605`，合同 §5.4 第二段）：Owner 是 `src/ui/components/settings/shared.ts` **一个文件**——`border rgba(255,255,255,.08) → #6e7074`、`border2 rgba(255,255,255,.05) → #7c828c`（按 `DEC-VC-02` 边界 4「1px 边框一律 ≥3:1」）、`dimmer #6e7681 → #868f99`（取 §5.5.2 允许的第三档），**无任何版式改动**。公开 Judge 是 `src/__tests__/visual-contract-settings-palette.test.ts`（15 项，含三处反例锚点与两处来源守卫）。RED/GREEN：把三个取值改回旧值后 **6 项失败**，恢复后 **15 passed**。其文档回填同时更正了灰档三处写串的比值（`5.77 / 4.83 / 5.42` → `5.27 / 4.83 / 5.77`）与「半透明白无法 ≥3:1」的错误论断（实为 `alpha ≥ 0.3283` 的取舍）。独立审查为 Spec 轴 + Standards 轴各一轮 + 终审复算；终审发现的 §6.1 自相矛盾与 `#1c232c` 阈值不精确均在推送前修正。该 Slice 不签发任何 Visual Evidence。**其唯一的待办追认已结清**：Captain 于 2026-09-28 批复「聚焦圈措辞属口径更正（非取值变更），不改为浅底单独渲染 `#e6edf3`，S3 挂起解除」。

当前 Slice 是 **S3「剩余控件取值归一」**（`VCGAP-04` + `VCGAP-21`，并登记并关闭 `VCGAP-22`，合同 §5.4 第三段）：Owner 是 `src/ui/components/settings/shared.ts`（`primaryBtn` 改描边款：`COLORS.panel` + `1px COLORS.border` + `COLORS.fg`；`TAG_STYLES` 三个 `borderColor` 与 `dangerBtn` 边框由 `alpha .3` 叠色改为**全色同色值**）与 `src/pages/VideoListPage.tsx`（`modalBtnPrimaryStyle` 改描边款）。公开 Judge 是新增两个：`src/__tests__/visual-contract-control-styles.test.ts`（**9 项**，`VCGAP-21` + `VCGAP-22`，含 3 处反例锚点与 1 处淡底 alpha 边界守卫）与 `src/__tests__/visual-contract-palette-parity.test.ts`（**7 项**，`VCGAP-04`：锁「两套并存、各自达标、互不混用」与**中性色**方向判据；其**类型色方向判据当前只是 S4 目标值锚点、读不到真实源码、没有失败能力**，合同 §5.3 已如实降级，S4 必须改成读真实源码再真判）。RED/GREEN：把两处实现文件按 S2 状态回退后 control-styles **5 项失败**（深底描边款断言、浅底描边款断言、`TAG_STYLES` 细边、`dangerBtn` 细边、旧 12% 白实底字面量守卫），恢复后两个裁判 **16 项全绿**；**parity 裁判改动前后都绿**，如实登记为「部分锁定」而非「修复」。同一轮复核还**新登记 `VCGAP-23`**（深底两处提示弹窗用浅底失败红 `#f85149` 与不在任何一套的 `#d29922`；非 AA 缺口，修法需一次语义决定，已并入 S5 开工前结清），并把「同色细边取全色值」这一 `DEC-VC-02` 边界 4 的从严读法、以及撤销它的做法一并写进合同 §5.3。**未运行 Evidence**：任何真实桌面视觉实测。**下一唯一动作**：S4「类型色落地」——`VCGAP-03` + `VCGAP-05` + `VCGAP-14`/`VCGAP-15`（深底胶囊的细边同样取全色同色值），测试先行 + 双轴独立审查 + 终审 + 受保护 PR + 代码与文档一次推送。

**写法纪律（Captain 要求，适用于本文件与 `visual-contract.md`）**：凡涉及「不可达/不可能」的论断，**必须给出可达性证明或反证（边界值、可行区间、反例）**；拿不出证明就只能写成**明示的取舍**（说明放弃哪一维、代价是什么、可选项是什么），**不得用「不可能」为取舍背书**。已发生两次并都按此更正：填充态对页背景的可行带 `[0.152926, 0.183333]`（宽 0.0304，取舍而非不可能）、半透明白细边的 `alpha ≥ 0.3284 / 0.3327 / 0.3341`（按 0.0001 网格取最小可行值；观感取舍而非不可能）。**数值写法附带要求**：引用 alpha 阈值必须与「先四舍五入到字节再算比值」的口径一致（写出最小可行 alpha 与其渲染色），否则会出现「阈值差一格、渲染色对不上」的自相矛盾。

**交接提醒（务必遵守）**：本机 `github.com:443` 被阻断，本地 `master` 引用不会随 API 合并更新，而 PR 是通过 GitHub Git Data API 推送/合并的——**下一轮动手前必须先用 API 取回真实 master 的内容重建工作树与全部受影响文件**（先逐文件核对「本地内容 == 真实 master 内容」，再在其上施加本轮改动，最后用 `compare` API 核对 delta）。PR #72 就因分支基点停在 PR #69 而把 PR #70/#71 的文档整段回退（相对真实 master 净删 193 行契约），靠 Spec 轴审查才发现；此类回退不会被 `harness:control` 拦住（它只扫 5 个控制面文件，不校验 `visual-contract.md`）。重建后必须逐文件核对「本地内容 == 真实 master 内容」，再在其上施加本次改动，并用 `git diff` 判断范围。
