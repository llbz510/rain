# Rain Project State

> 状态：`Active`
> 作用：当前可验证快照与短期交接，不是项目日记、产品规格或验收标准。历史会话、旧验证和已合并改动应从 Git/PR 历史读取。

## Current control facts

Primary checkout: current Git worktree. Active control documents and runnable scripts must not depend on a legacy checkout location.

- 远端：`origin` 为公开 GitHub 仓库；本地 `master` 跟踪 `origin/master`。
- 保护规则：合并候选和 `master` push 都由独立 `windows-2025` 的 `Clean Windows Harness` 裁判；它运行 `npm ci` 和唯一完整入口 `npm run harness:check`。
- 本快照记录稳定的受保护基线；当前 worktree、分支和未提交变更必须由 `git status --short`、`git branch --show-current`、`git log -1 --oneline` 重新读取，不在此处复制。

## Current verified baseline

受保护 `origin/master` 是 `9639410cf7ed76ad424d9507309970bd3397ed02`（PR #69 merge commit，AC-SU-01 学习页长目录桌面证据）；上一条基线是 `3cb4531ec060d66be0da8db5ebe9f8cca9f705db`（PR #68 merge commit，Harness 门禁稳定性修复）。

- PR #69 最终 head `37aa834cf4f781621c8bb116f36b47b1ee6f4140` 的三条自动检查均为 `success`：`Clean Windows Harness` run [`36323853613`](https://github.com/llbz510/rain/actions/runs/36323853613)、`Study Catalog Desktop E2E` run [`36323853590`](https://github.com/llbz510/rain/actions/runs/36323853590)、`Video List Desktop E2E` run [`36323853648`](https://github.com/llbz510/rain/actions/runs/36323853648)。
- 目标 `master` push 的 `Clean Windows Harness` run [`36324809247`](https://github.com/llbz510/rain/actions/runs/36324809247) 对 `9639410c` 为 `success`。
- 更早基线的 Hosted 结论保留在 PR #65–#68 与其 run 记录中；本快照不复制它们。

这些成功只证明各自目标提交在干净 Hosted Windows 上通过默认 Harness；不替代真实桌面、GPU、模型、安装器或 Release Evidence。

## Current delivery direction

当前唯一开发方向是从 [`launch-feature-audit.md`](development/launch-feature-audit.md) 的 blocker ledger 逐个关闭一个用户可见、已 Confirmed 的 Launch feature Slice。该 ledger 只报告生产路径与缺口，不定义 AC、Judge、等级或完成状态。

M3/GPU/Release Evidence、受控 GPU artifact build、安装器、签名、许可、Release 和下载页均为 user-paused。已取消的受控 GPU run 没有产生 manifest、core/control artifact、build record 或 launcher；未经用户明确恢复不得调度或重跑相关 workflow，也不得据此升级任何 `AC-RL-*`。

含 `Visual` 或 `Accessibility` 的候选（`AC-VL-01`/`VL-07`、`AC-SU-02`/`SU-05`/`SU-06`、`AC-UX-01`~`UX-06`）的视觉语义**不再缺少用户输入**：根目录 `M13-visual-design.md` 状态「已确认」，其决策 63–71、73–79、81 共 17 条已有明确产品依据（决策 72 已 `Out-of-scope` 并由 077 接管、决策 80 仍为 `Proposed`，两者处置见 `product-decision-coverage.md`），`docs/development/visual-contract.md` 已把这 17 条转成可裁判条目。但仍有三类工作没完成：① `VCQ-01`/`VCQ-02`/`VCQ-03` 三道**新的**取值与优先级判断必须由用户回答（`visual-contract.md` §6），它们不是 M13 已给出的语义；② 由独立视觉审查员对照该合同裁判真实桌面实测；③ 用已打通的桌面证据能力产出目标提交的真实运行与实测数据。M9-S1 覆盖的候选只到 `DEC-PRD-076`，M9-S2/M9-S3（可访问性、生产截图与视觉回归）仍需独立推进。在真实桌面实测产出前不得用 DOM 断言、jsdom 或截图单独替代 Visual Evidence。

## Effective evidence and boundaries

- [`canonical-evidence-freshness-2026-08-02.md`](development/canonical-evidence-freshness-2026-08-02.md) 是 tracked schema v2 Evidence 的当前新鲜度审计。`evidence/rain-real-e2e-20260726-195652/` 只证明其记录的 408b6db-era 配置和运行，不能证明当前 target、其他模型或 vision。
- `AC-HE-05` 的 Hosted Runtime Settings Judge 仅对 `a329059b8172dab82c7326deb0af322045a0c396` 的 workflow_dispatch run `30756311932` 签发；桌面边界变动后的目标提交仍需独立重放。
- `AC-HE-01` 的 `npm run harness:control` 只裁判控制面自洽；`AC-HE-06` 只裁判 99 条历史产品决策的当前去向。两者均不证明产品功能、SQLite/Tauri、真实媒体或 Release Evidence。
- [`visual-contract.md`](development/visual-contract.md) 只把 M13 已有产品依据的决策（63–71、73–79、81，共 17 条）转成可裁判数字与证据形态；它不定义 AC、不改变 AC 状态或 Evidence tier，也不构成任何 AC 的 Evidence。`VC-01`…`VC-19` 尚无任何一条取得真实实测。

## Active risks and boundaries

- 所有未关闭的 Required Evidence 仍是 blocker，除非对应 audit 行明确标为无新要求、supplement-only 或条件未来重放；测试存在不等于功能或 Evidence 已完成。
- `AC-RL-08` 仍是 `Partial`：现有 adapter/静态合同不构成目标安装器、受支持 NVIDIA 主机、模型和真实运行的 Release Evidence。该工作已 user-paused。
- `AC-VL-05` 的 app-owned 缩略图删除已随 PR #65 合并（`4a0b14c`）；`AC-VL-06` 孤儿 GC 已随 PR #66 合并（`3db8032`）；`AC-VL-04` 的视频列表页桌面证据已随 PR #67 合并（`23edfe8`）；`AC-SU-01` 的学习页长目录桌面证据已随 PR #69 合并（`9639410c`），其四项裁判在托管真实桌面运行上取得 GREEN，`AC-SU-01` 的 `Strong + Desktop Evidence` 预算等级可判定满足，等级变更留给后续控制面流程。`AC-VL-04` 的完整页面组合 Strong Judge、其余桌面条件与 Visual/Accessibility 仍未闭合；`AC-AR-05/06` 的 app-scope import owner 与判别式 progress contract 仍是独立缺口。具体生产路径、现状和优先级以 Launch audit 为准。
- 门禁稳定性修复已随 PR #68 合并（`3cb4531`）：三个 Release 范围测试文件的夹具改为一次构建后按用例派生，并按实测标定重活用例上限。该修复**不提升任何 AC 等级**。已登记、尚未处理的后续项：① `scripts/nvidia-release-evidence.test.ts` 的 PE 用例注释写「16 次契约调用」而静态清点为 15 次，属注释更正（不影响 30s 上限）；② 在托管负载下仍接近 15s 上限的用例（`nvidia-release-evidence` 的 `hygiene scopes`/`installed-tree reconciliation`/`installed CUDA payload set`，`release-artifact-generator` 的两个用例）；③ 把「6 次真实契约调用合并为 1 次 PowerShell 调用」列为后续候选（会改变用例调用结构、需重新论证断言强度，前轮已否决）。
- whole-repo `cargo fmt` 不能作为干净门禁：既有/locked Rust 差异会污染结果；新 Rust 文件仍必须使用 file-scoped `rustfmt`。
- `core.autocrlf` 可能造成 `Cargo.toml` ghost diff；是否真实变更必须以 `git diff` 判断。
- 本地可信 WebView 的前端 SQL plugin 需要 `sql:allow-execute`；若将来加载远程不可信内容，必须先重新收紧该 capability。
- 视觉/无障碍缺口已由 `visual-contract.md` 编号登记（`VCGAP-01`…`VCGAP-19` 共 19 条，只登记未修复）。当前最要紧的是：`VCGAP-09` 导入按钮与主按钮「白字压 `--color-accent #4a9eff`」实测 **2.75:1**（AA 普通文本要求 4.5:1）；`VCGAP-03` 段落四色令牌只定义、`src/` 内零使用；`VCGAP-01` 已确认的「无品牌强调色」被蓝色实底与蓝色下划线取代；`VCGAP-10`/`VCGAP-11` 控件与分隔边框 **1.53:1**/**1.36:1**（非文本要求 3:1）；`VCGAP-16` 控制栏高度实现为 80px 而 M13 决策 76 要求 40px。排期分两桶（逐条清单见该合同 §5.3，两桶合计 19 条）：**必须等用户回答 `VCQ-01`/`VCQ-02`/`VCQ-03` 的 12 条** = `VCGAP-01`、`VCGAP-03`、`VCGAP-04`、`VCGAP-05`、`VCGAP-09`、`VCGAP-10`、`VCGAP-11`、`VCGAP-12`、`VCGAP-13`、`VCGAP-14`、`VCGAP-15`、`VCGAP-17`；**不依赖颜色取舍、可独立排期的 7 条** = `VCGAP-02`、`VCGAP-06`、`VCGAP-07`、`VCGAP-08`、`VCGAP-16`、`VCGAP-18`、`VCGAP-19`。
- 下一轮之前必须先关闭的文档债：`harness-coverage.md` 中 `AC-UX-0*`/`AC-VL-01`/`AC-VL-07`/`AC-SU-0*` 行的「独立 visual review 缺失」表述（如 `AC-UX-01` 行）尚未引用 `visual-contract.md`，`launch-feature-audit.md` 对同一批行写的是「阻断：Strong + Visual Evidence」、也尚未引用该合同（该合同现已 Active，两者口径需在下一次替换式更新时对齐）；`AC-SU-01` 的等级闭合仍留在控制面流程中；STD-68/69 系列历史文档债（上一快照的过期「GREEN 尚未观测」项已由本快照替换式关闭，attachment `headSha` 说明与渐隐明细字段仍未补）。

## Maintenance and current handoff

修改项目文件的会话必须同步本快照，但只能替换已过期的当前事实和本节交接，不得新增按日期的会话段落或 `## What changed` 时间线。每次交接保留一个可验证的现行 Slice：AC、Owner、公开 Judge、RED/GREEN、独立审查结果、未运行 Evidence、下一唯一动作；历史细节由 commit/PR 记录承载。

上一个 Slice 是 `AC-SU-01`（学习页长目录桌面证据，PR #69，已合并 `9639410c`）：Owner 是生产 `StudyInterface` 与 `CatalogBar`、`video.tsx` 的媒体会话、`src/e2e/real-e2e-runner.tsx` 的 `study-catalog` 短模式、`src-tauri/src/e2e_config.rs` 的 E2E 门，以及 `scripts/run-study-catalog-e2e.ps1` 与 `.github/workflows/study-catalog-desktop-e2e.yml`。公开 Judge 是 `scripts/run-study-catalog-e2e.ps1`（真实 Tauri + 真实 WebView2/msedgedriver，W3C 元素端点读生产学习页 DOM 与几何）。四项裁判（①章节顶行/段落底行两行结构不换行 ②当前项居中跟随 ③边缘渐隐 owner ④暂停后真实滚轮 + `/actions` 指针点击不再强制跟随）已在托管真实桌面运行取得 GREEN，并留下受控 RED 记录（夹具不可判定 → 夹具已 seeded 但 `loadVideo` 要求 sentences 非空 → 补齐句子）。该 Slice 不签发 Visual/Accessibility Evidence。

当前 Slice 是**视觉合同治理**（纯文档/控制面，`docs/**` only，不触碰 `src/**`、`src-tauri/**`、`scripts/**`、`harness/**`）：Owner 是 `docs/development/visual-contract.md`（新增 Active 合同）、`docs/development/control-map.md`（事实源登记）与本快照。它把 `M13-visual-design.md` 中已有明确产品依据的 17 条决策（63–71、73–79、81；决策 72 已 `Out-of-scope` 由 077 接管、决策 80 仍为 `Proposed`，其样式细节见该合同 §4.3，不构成判据）逐条转成带可测数字（颜色值、对比度比值、几何像素、字号/行高/字重、动效时长、透明度）与允许误差的可裁判条目 `VC-01`…`VC-19`（`VC-18` 空号），定义视觉审查员流程（只读、对照合同、对数字判通过/需修，且明确「截图好看 ≠ 合规」），并编号登记 `VCGAP-01`…`VCGAP-19` 与三道待用户回答的选择题 `VCQ-01`/`VCQ-02`/`VCQ-03`。本 Slice **不签发任何 Visual Evidence、不改变任何 AC 状态或等级、不修复任何缺口**；其公开 Judge 是 `npm run harness:control`（控制面机械校验）加上两个独立只读审查代理（Spec 轴：判据是否忠实覆盖 M13 与各 AC、是否每条带可测数字、是否夹带新语义；Standards 轴：控制面规则、替换式更新、是否越界改代码、PR 描述与范围）。**未运行 Evidence**：任何真实桌面视觉实测（`VC-01`…`VC-19` 尚无一条取得证据）。**下一唯一动作**：用户回答 `VCQ-01`/`VCQ-02`/`VCQ-03`；在那之前只允许推进不依赖颜色取舍的 `VCGAP-02`/`VCGAP-06`/`VCGAP-07`/`VCGAP-08`/`VCGAP-16`/`VCGAP-18`/`VCGAP-19`（与该合同 §5.3 第二桶逐项一致）或先建立「真实桌面视觉实测 + 视觉审查员」这条证据通道。
