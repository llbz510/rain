# Rain Project State

> 状态：`Active`
> 作用：当前可验证快照与短期交接，不是项目日记、产品规格或验收标准。历史会话、旧验证和已合并改动应从 Git/PR 历史读取。

## Current control facts

Primary checkout: current Git worktree. Active control documents and runnable scripts must not depend on a legacy checkout location.

- 远端：`origin` 为公开 GitHub 仓库；本地 `master` 跟踪 `origin/master`。
- 保护规则：合并候选和 `master` push 都由独立 `windows-2025` 的 `Clean Windows Harness` 裁判；它运行 `npm ci` 和唯一完整入口 `npm run harness:check`。
- 本快照记录稳定的受保护基线；当前 worktree、分支和未提交变更必须由 `git status --short`、`git branch --show-current`、`git log -1 --oneline` 重新读取，不在此处复制。

## Current verified baseline

最近已验证的受保护合并基线是 `86ecf2bc8393e2925ab3039f14514e7b6a4e5eb9`（PR #99：AC-SU-03 Tab/草稿/真实HTTP流桌面核证）。被审head `fdcb9efe` 的Harness [37911407268](https://github.com/llbz510/rain/actions/runs/37911407268)、Study Desktop [37911407315](https://github.com/llbz510/rain/actions/runs/37911407315)及Video List Desktop [37911407396](https://github.com/llbz510/rain/actions/runs/37911407396)均attempt1 success；独立Spec/Standards各自148项并最终PASS。真实PR merge checkout `c42b85ad`、本地候选、远端head与受保护合并tree均为 `8b6b9c2bce56f68459e93984a23872049d8d34ac`，递归412 blob逐一一致、3新增/10变更/0删除。master完整门禁 [37913077376](https://github.com/llbz510/rain/actions/runs/37913077376)已success，原始日志确认1143前端、互补隔离构建和Rust全绿。PR #98及更早历史回到Git/PR读取。

- 独立视觉目标上的 `Visual Evidence` run [37747848432](https://github.com/llbz510/rain/actions/runs/37747848432) 为 `success`（workflow_dispatch，target/head 均为 `0c6a08be`，diagnostic=true）。本次唯一包是 `visual-0c6a08be-20261008-081210`，含 41 条记录、3 张真实截图；采集器自校验、workflow 二次校验和下载后的本机复核均通过 §3.4 第 1–3 项形状校验。该包目前保存在 Actions artifact，尚未入库，也没有 V2 verdict。
- 通道由 `resolve_target` / `channel` / `collect` 三个 job 分工；checkout、构建前 HEAD 与 collector 输入使用同一个目标 SHA，诊断校验、形状校验、summary 和上传只消费 collector 输出的本次 `package_path`。真实采集仍按显式开关执行，不挂到每个 PR。
- 本次 34 份诊断 dump 均有浏览器原始圆角双值及 selectedSource；34/34 命中 `borderTopLeftRadius`，所以本次真实 WebView2 没有触发 shorthand fallback，不得把它写成真机 fallback 已验证。诊断不入库、不参与视觉判定。历史包 PR #87 已关闭且未合并，不能替代本次输入；`VC-01`…`VC-19` 仍无任何一条完成独立裁判，任何 AC/Evidence tier 均未升级。

默认门禁成功只证明对应提交在干净 Hosted Windows 上通过 Harness；真实采集成功只提供 §3.4 第 1–3 项输入。两者均不替代独立视觉裁判、GPU、模型、安装器或 Release Evidence。

## Current delivery direction

当前唯一开发方向是从 [`launch-feature-audit.md`](development/launch-feature-audit.md) 的 blocker ledger 逐个关闭一个用户可见、已 Confirmed 的 Launch feature Slice。该 ledger 只报告生产路径与缺口，不定义 AC、Judge、等级或完成状态。

M3/GPU/Release Evidence、受控 GPU artifact build、安装器、签名、许可、Release 和下载页均为 user-paused。已取消的受控 GPU run 没有产生 manifest、core/control artifact、build record 或 launcher；未经用户明确恢复不得调度或重跑相关 workflow，也不得据此升级任何 `AC-RL-*`。

含 `Visual` 或 `Accessibility` 的候选取值已由 `visual-contract.md` 转成可裁判条目，`VCGAP-01`…`VCGAP-23` 的实现缺口台账为 23/23 关闭；这只证明冻结取值已落地并有防回退判据。真实 Hosted WebView2 包现已通过 §3.4 第 1–3 项形状校验，但仍未产生独立审查员的第 4 项 verdict；本次 diagnostic 已记录 raw 双值及命中来源，34/34 命中 longhand，未触发 fallback。`VC-01`…`VC-19` 仍无一条完成裁判，任何 AC/Evidence tier 均不得据此升级。

## Effective evidence and boundaries

- [`canonical-evidence-freshness-2026-08-02.md`](development/canonical-evidence-freshness-2026-08-02.md) 是 tracked schema v2 Evidence 的当前新鲜度审计。`evidence/rain-real-e2e-20260726-195652/` 只证明其记录的 408b6db-era 配置和运行，不能证明当前 target、其他模型或 vision。
- `AC-HE-05` 的 Hosted Runtime Settings Judge 仅对 `a329059b8172dab82c7326deb0af322045a0c396` 的 workflow_dispatch run `30756311932` 签发；桌面边界变动后的目标提交仍需独立重放。
- `AC-HE-01` 的 `npm run harness:control` 只裁判控制面自洽；`AC-HE-06` 只裁判 99 条历史产品决策的当前去向。两者均不证明产品功能、SQLite/Tauri、真实媒体或 Release Evidence。
- [`visual-contract.md`](development/visual-contract.md) 只把 M13 已有产品依据的决策转成可裁判数字与证据形态；它不定义 AC、不改变 AC 状态或 Evidence tier。最新真实 Hosted WebView2 采集已通过 §3.4 第 1–3 项形状校验，但该成功不包含 V2 的逐条 `pass`/`needs_revision`，且当次 diagnostic 的 raw/source 读数只证明 longhand 命中，不能证明 fallback 被触发；因此 `VC-01`…`VC-19` 仍无任何一条完成裁判。§5.3 的 23 条关闭项及其锁定测试只证明实现取值不回退，不证明真实桌面观感达标。

## Active risks and boundaries

- 所有未关闭的 Required Evidence 仍是 blocker，除非对应 audit 行明确标为无新要求、supplement-only 或条件未来重放；测试存在不等于功能或 Evidence 已完成。
- `AC-RL-08` 仍是 `Partial`：现有 adapter/静态合同不构成目标安装器、受支持 NVIDIA 主机、模型和真实运行的 Release Evidence。该工作已 user-paused。
- `AC-VL-05` 的 app-owned 缩略图删除已随 PR #65 合并（`4a0b14c`）；`AC-VL-06` 孤儿 GC 已随 PR #66 合并（`3db8032`）；`AC-VL-04` 的视频列表页桌面证据已随 PR #67 合并（`23edfe8`）；`AC-SU-01` 的学习页长目录桌面证据已随 PR #69 合并（`9639410c`），其四项裁判在托管真实桌面运行上取得 GREEN，`AC-SU-01` 的 `Strong + Desktop Evidence` 预算等级可判定满足，当前目标已随PR #98真实重放与双审后替换式同步coverage。`AC-VL-04` 已随 PR #97 受保护合并：完整 App 组合 Judge 与受控 URL 本地媒体 ASR 接线通过独立两轴各 266 项和最终 head Harness/真实列表 Desktop Judge。该 AC 只要求 Strong + Desktop；独立视觉/无障碍仍由其对应 AC 裁判。`AC-AR-05` 已随 PR #95 合并；`AC-AR-06` 已随 PR #96 受保护合并，独立两轴各自 263 项与被审 head 三个 Hosted 门禁全绿。具体生产路径、现状和优先级以 Launch audit 为准。
- 门禁稳定性修复已随 PR #68 合并（`3cb4531`）：三个 Release 范围测试文件的夹具改为一次构建后按用例派生，并按实测标定重活用例上限。该修复**不提升任何 AC 等级**。已登记、尚未处理的后续项：① `scripts/nvidia-release-evidence.test.ts` 的 PE 用例注释写「16 次契约调用」而静态清点为 15 次，属注释更正（不影响 30s 上限）；② 在托管负载下仍接近 15s 上限的用例（`nvidia-release-evidence` 的 `hygiene scopes`/`installed-tree reconciliation`/`installed CUDA payload set`，`release-artifact-generator` 的两个用例）；③ 把「6 次真实契约调用合并为 1 次 PowerShell 调用」列为后续候选（会改变用例调用结构、需重新论证断言强度，前轮已否决）；④ **已观测到的负载相关 flake（不要再当新回归排查）**：PR #73 首次推送（head `150b2838`）的 `Clean Windows Harness` run [`36379387687`](https://github.com/llbz510/rain/actions/runs/36379387687) 在 `scripts/nvidia-release-evidence.test.ts`（72 项中 2 项）失败，错误为 `Test timed out in 5000ms`（`:1597`）与 `PowerShell test cleanup failed: terminate child 9292: the child process rejected SIGKILL`（`:1148`）、`Contract invocation failed: Child process timed out after 4000 ms and was terminated: pwsh.exe`；该文件在本轮**未被改动**（S1 只动 `src/index.css` 与三个 `src/` 前端文件），同一代码在 PR #72 的 run `36378798081` 上通过，PR #73 的下一次内容推送（head `93c32929`）未经重跑即变绿。判定为 Release/GPU 范围的既有 flake，**不得**用放宽超时、删改断言或 `--admin` 绕过它；若它再次拦住不相关 Slice，正确处理是把证据交回用户/Captain 决定是否重跑。
- whole-repo `cargo fmt` 不能作为干净门禁：既有/locked Rust 差异会污染结果；新 Rust 文件仍必须使用 file-scoped `rustfmt`。
- `core.autocrlf` 可能造成 `Cargo.toml` ghost diff；是否真实变更必须以 `git diff` 判断。
- 本地可信 WebView 的前端 SQL plugin 需要 `sql:allow-execute`；若将来加载远程不可信内容，必须先重新收紧该 capability。
- **门禁稳定性（新形态，2026-09-30 首次登记；与「个别用例超时」那一类不同）**：`Clean Windows Harness` 出现过「**全部用例通过、却判门禁红**」的失败形态：`Test Files 114 passed | 1 skipped (115)` / `Tests 953 passed | 1 skipped (954)`，退出码来自 vitest worker 的 RPC 超时 `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`（伴随 `Errors 1 error`）。**已观测三次（逐字同签名）**：① PR #86 合并提交 `c2c75601` 的 master push run [`36655522137`](https://github.com/llbz510/rain/actions/runs/36655522137)；② 证据包 PR #87 的 run [`36657373124`](https://github.com/llbz510/rain/actions/runs/36657373124) attempt 1；③ 同 run 经 Captain 授权重跑后的 attempt 2。**机制**：worker 通过 RPC 回调主进程的 `onTaskUpdate`，`createSafeRpc` 的超时钩子直接 `throw`（vitest 3.2.7 `dist/chunks/rpc.*.js`），该错误以**未处理错误**冒泡，vitest 默认把它当失败 → exit 1；即「全绿却红」是**设计使然的 fail-closed 行为**（该默认正确，不得关闭）。它比「个别用例超时」更危险：**零测试失败也会红着挡住无关改动**（PR #87 只新增 `evidence/**` 46 个文件、不改任何代码/测试/配置）。**处置原则**：只做**同提交、同 workflow**的重跑且**须由 Captain/用户逐次授权**；**不得**放宽断言或超时、删用例、加 `skip`/`todo`、`--admin`，也不得设 `dangerouslyIgnoreUnhandledErrors` 之类的抑制开关。**候选缓解（未采纳，须先实测）**：降低 worker 并发（`maxWorkers: 2` 或 `poolOptions.threads.maxThreads: 2`；更强为 `fileParallelism: false`）——采纳前需在托管 runner 上做基线/候选各 N 次的对照实测，且配置变更合并前须经 Captain 批准。
- **本机网络限制（会反复踩，务必先读；已知环境限制 + 既有 workaround）**：`git push` / `git fetch` 到 `github.com:443` 会失败（`Failed to connect … port 443` / `Recv failure: Connection was reset`，实测连续 8 次失败、`Test-NetConnection github.com -Port 443` 为 `False`），而 **`api.github.com:443` 可达**、`gh` 命令正常。**既有 workaround**：一切「取远端 / 推远端」都走 API——推送用 **GitHub Git Data API**（`git/blobs` → `git/trees` → `git/commits` → 更新 `refs/heads/<branch>`）；核对一致性用 `gh api .../git/commits/<sha>` 取远端 tree SHA 与本地 `git rev-parse HEAD^{tree}` 比对，并用 `compare` API 核对 delta。因此 **`git fetch` 不可用**：本地不会有远端新建的提交对象，**本地 `master` 是一个「内容等价提交」**（sha 必须现场用 `git rev-parse master` 读取，不要引用本快照写下的具体值；它的 tree 与该轮开工时的远端 master tree 逐字节相同，已用 API 核对）——`git status` 提示与 `origin/master` diverged 属**过期的 remote-tracking 引用**，不是内容分叉，**不必排查**。三点注意：① 以 `git cat-file blob HEAD:<path>` 的字节为准（工作树在 Windows 上含 CRLF，`core.autocrlf` 会让远端 blob 与仓库约定不一致）；② 用 `base_tree` 建 tree 时必须**显式列出继承层级里的每一个被改文件**，否则同名条目会从父提交继承旧 blob；③ 每轮开工前必须用 API 取回真实 master 的 tree 与受影响文件内容再施加改动，并用 `compare` API 核对最终 delta（PR #72 就因基点停在 PR #69 而试图净删 193 行已合并的合同内容，靠 Spec 轴审查才发现）。`gh pr create` / `gh pr merge` / `gh pr checks` 均不受影响。
- 视觉/无障碍实现缺口台账仍为 `VCGAP-01`…`VCGAP-23` 全部关闭（23/23），且没有等待用户输入的取值项；剩余工作是独立视觉裁判，不是继续补产品取值。真实桌面通道已经成功产出并通过 §3.4 第 1–3 项形状校验，但无 V2 verdict，且旧 diagnostic 缺 raw longhand，故不得推断 fallback 已在真机触发，也不得升级任何 `VC-xx` 或 AC。
- **锁定 Harness 与合同取值冲突（S4 首次实例，已按用户批准处置）**：`harness/m13-visual.test.ts:22-29` 的期望值数组原先把段落四色令牌焊死为**实现自选、从未经用户批准**的旧值，与合同 §5.5.1 的已批准取值冲突（按合同改令牌会让门禁变红）。用户 2026-09-28 **明确批准方案 A**，授权范围严格限定为「只重钉那份期望值数组」；迁移记录见 [`harness-migration-2026-09-28-paragraph-type-token-values.md`](development/harness-migration-2026-09-28-paragraph-type-token-values.md)，处置规则已写进 `visual-contract.md` §7。**`src/index.css` 仍是段落四色的唯一真相源。**
- **仓库卫生（防复犯，务必先读）**：**主检出必须常驻 `master` 且工作树干净；一切功能分支改动都在独立 worktree 里做**（本机约定目录 `D:\xiangmu\rain-worktrees\`），不要让主检出停在功能分支上。**开工前先核对本地 `master` 与远端一致**：本机 `git fetch` 被阻断，因此核对方式是用 `gh api repos/llbz510/rain/git/commits/<master>` 取远端 tree SHA，与本地 `git rev-parse HEAD^{tree}`（或 `git ls-tree -r`）比对；不一致就先用 API 把受影响文件同步成远端逐字节内容。**从真实 master 重建 + 用 `compare` API 核 delta** 是唯一能防住「静默回退已合并内容」的做法——`harness:control` 只扫 5 个控制面文件（`acceptance-standard.md`、`harness-coverage.md`、`product-decision-coverage.md`、`PROJECT_STATE.md`、`rain-project-delivery-plan.md`），**拦不住 `visual-contract.md` 之类的静默回退**（PR #72 就是这么差点净删 193 行）。另注：`C:\Users\24627\.codex\worktrees\*` 是历史遗留目录，**不属当前工作流**，不要在其中开工。
- **`compare` API 的文件清单不足以证明"没有回退"（一次实践事故得出的检查法，不是理论推演）**：GitHub `compare` 的 `files` 是**累积口径**——一个把其余文件**静默回退到 base** 的提交，在它眼里**仍然显示正常**（本次实测：一个 tree 只剩 `PROJECT_STATE.md` 改动、其余 11 个文件全回到 master 的提交，`compare` 依旧报 `files=12 / 0 删除`；靠它不可能发现）。**权威检查是两棵递归 tree 的全 blob map 比对**：对 base 与 head 各取一次 `gh api "repos/<owner>/<repo>/git/trees/<tree_sha>?recursive=1" -X GET`，各自建 `path → blob sha` 全表，比对得出 `added / changed / removed` 三类；**判据是 `removed = 0` 且 `changed ∪ added` 恰好等于本轮预期改动集**。**逐 blob 核 sha 优先于读文件内容**：`gh api .../contents/<path>?ref=<sha>` 看内容只作旁证、不作判据。本次事故的成因是建 tree 时误用 `base_tree = <master tree>` 而非**父提交的 tree**；拦下它靠的正是逐 blob 比对（`src/index.css` 的 blob sha 回到了 master 版）。
- 下一轮之前必须先关闭的文档债：`harness-coverage.md` 中 `AC-UX-0*`/`AC-VL-01`/`AC-VL-07`/`AC-SU-0*` 行的「独立 visual review 缺失」表述（如 `AC-UX-01` 行）尚未引用 `visual-contract.md`，`launch-feature-audit.md` 对同一批行写的是「阻断：Strong + Visual Evidence」、也尚未引用该合同（该合同现已 Active，两者口径需在下一次替换式更新时对齐）；`AC-SU-01` 与 `AC-SU-04` 已据PR #98最终head真实Desktop与双审替换式同步coverage；STD-68/69 系列历史文档债（上一快照的过期「GREEN 尚未观测」项已由本快照替换式关闭，attachment `headSha` 说明与渐隐明细字段仍未补）。

## Maintenance and current handoff

修改项目文件的会话必须同步本快照，但只能替换已过期的当前事实和本节交接，不得新增按日期的会话段落或 `## What changed` 时间线。每次交接保留一个可验证的现行 Slice：AC、Owner、公开 Judge、RED/GREEN、独立审查结果、未运行 Evidence、下一唯一动作；历史细节由 commit/PR 记录承载。

当前 Slice 是 **AC-AR-03 本地媒体asset授权范围**。Owner为Tauri静态scope、`asset_scope.rs`启动恢复和既有共享`localMediaUrl`；不新增command或通用授权接口。负向config policy在原生产`["**"]`上RED，固定为app-owned `thumbnails/*`与`online-videos/**`后GREEN。原生dialog继续只授权明确选择的单文件；启动从同一canonical SQLite的`source=local`/绝对`file_path`记录恢复精确单文件授权，Tauri负责规范化和glob字面转义。新增Rust公开scope/真实SQLite裁判仅Hosted运行。既有Study Desktop新增真实asset fetch：首次未授权403、公共Video记录持久化并关进程重启后媒体200、字面括号及合法current-dir dot段规范化、app-owned缩略图/下载200，相邻未选文件及两个根的越界路径403；后续SU01/SU03/SU04桌面条件保持。Captain定向25文件165项GREEN；任意通配、丢成功输出、丢状态判据、丢字节判据四类隔离注入均RED/还原GREEN，tsc/control/PS AST/diff通过；独立Spec/Standards均PASS且各自实跑25文件165项，当前候选Hosted尚未执行，AC-AR-03保持Partial。AC-SU-03已随PR #99核证、受保护合并且master门禁全绿，Strong + Desktop预算满足。GPU/M3/Release仍暂停，本机未跑重活。**下一唯一动作**：两轴已完成独立实跑与候选复核，GitDataAPI逐blob推送，读取当前head的Harness/Study/Video List真实日志；全绿后指定head受保护合并并核tree/mirror。

**写法纪律（Captain 要求，适用于本文件与 `visual-contract.md`）**：凡涉及「不可达/不可能」的论断，**必须给出可达性证明或反证（边界值、可行区间、反例）**；拿不出证明就只能写成**明示的取舍**（说明放弃哪一维、代价是什么、可选项是什么），**不得用「不可能」为取舍背书**。已发生两次并都按此更正：填充态对页背景的可行带 `[0.152926, 0.183333]`（宽 0.0304，取舍而非不可能）、半透明白细边的 `alpha ≥ 0.3284 / 0.3327 / 0.3341`（按 0.0001 网格取最小可行值；观感取舍而非不可能）。**数值写法附带要求**：引用 alpha 阈值必须与「先四舍五入到字节再算比值」的口径一致（写出最小可行 alpha 与其渲染色），否则会出现「阈值差一格、渲染色对不上」的自相矛盾。

**用户 2026-09-29 批准的产品显示决定**：「最近学习」小字**超过一年不再显示 `N 天前`**，改显示**具体日期**（本地时区，`YYYY-MM-DD`）；`0` 仍为「未学习」，天/小时/分钟/刚刚其余档位不变。裁判为 `src/__tests__/video-list-last-studied-date.test.ts`（含"把规则改回 `N 天前` 必红"的反例锚点）。同批把锁定 Harness 的 U52 用例里两处**子串/裸数字匹配**（`getByText(/25/)`、`getByText(/8/)`）改成按 `data-testid` 的**整句精确断言**：旧写法会命中卡片上恰好含该数字的「最近学习」文本，使门禁**按日期发作**（2026-09-29 事故：同一份代码前一天全绿、次日全红）。授权、旧断言原文与冲突证据、判据强度对比、允许/禁止边界见 `docs/development/harness-migration-2026-09-29-m17-delete-confirm-precision.md`。该显示决定属 `AC-UX-01` 覆盖的用户可见卡片信息（合同侧对应 `VC-10`②「最近学习」小字与 `VC-11` 的进度条信息族，见 `visual-contract.md` §4.2 的编号对照）；它**不**改变任何 AC 状态、**不**签发任何 Evidence。该规则与写法纪律同段，适用于本文件与 `visual-contract.md`。

**证据出处纪律**：引用任何运行证据（job log、`failure.json`、artifact）之前，**必须先核对这份证据出自哪一次运行、那一次运行的配置是什么**；证据与结论**不同源**（即未核实那次运行的配置是否就是结论所描述的那种配置）时，只能写成**待验证假设**，不得作为因果依据。已犯过一次并按此更正：视觉采集通道的说明里曾用**第 1 次**运行的 `DevToolsActivePort` 失败去论证**第 6 次**的原因，而第 1 次运行的驱动参数恰恰**是带调试端口的**，方向相反；同一次更正还撤掉了一条"用第 5 次运行反证"的假对照——第 5 次运行的预检**自己显式设了** `RAIN_E2E_RUN_MODE`，不能用来证明"该变量为空时端口照样开"。

**返工必须重证守卫**：守卫（回归断言、校验器、门禁脚本）在返工后可能**变瞎**——尤其当返工改动了守卫所依赖的结构时。因此每次返工都必须**重放注入**：注入真实回归、确认守卫真的会红（保留原始输出），还原后确认转绿，并把结果写进 PR。已按此更正：某次把驱动生命周期收成函数并搬到脚本顶层的返工中，"函数被定义在 try 内"这条守卫被删掉了定义计数断言、只剩"首个定义是否在列 0"；随后在 try 体内**新增**一个同名函数时，运行时后定义者遮蔽顶层定义，守卫仍 `57 passed` 全绿。另有两类同类盲区实测确认并已补断言：每模式派生 `--port` 时 `--native-port` 未同步偏移（两个端口撞成同一个值，违反 tauri-driver 的硬要求）、以及"脚本级端口未回写（函数内裸赋值只建局部变量）"。

**交接提醒（务必遵守）**：本机 `github.com:443` 被阻断，本地 `master` 引用不会随 API 合并更新，而 PR 是通过 GitHub Git Data API 推送/合并的——**下一轮动手前必须先用 API 取回真实 master 的内容重建工作树与全部受影响文件**（先逐文件核对「本地内容 == 真实 master 内容」，再在其上施加本轮改动，最后用 `compare` API 核对 delta）。PR #72 就因分支基点停在 PR #69 而把 PR #70/#71 的文档整段回退（相对真实 master 净删 193 行契约），靠 Spec 轴审查才发现；此类回退不会被 `harness:control` 拦住（它只扫 5 个控制面文件，不校验 `visual-contract.md`）。重建后必须逐文件核对「本地内容 == 真实 master 内容」，再在其上施加本次改动，并用 `git diff` 判断范围。
