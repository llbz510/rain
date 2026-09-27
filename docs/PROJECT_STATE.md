# Rain Project State

> 状态：`Active`
> 作用：当前可验证快照与短期交接，不是项目日记、产品规格或验收标准。历史会话、旧验证和已合并改动应从 Git/PR 历史读取。

## Current control facts

Primary checkout: current Git worktree. Active control documents and runnable scripts must not depend on a legacy checkout location.

- 远端：`origin` 为公开 GitHub 仓库；本地 `master` 跟踪 `origin/master`。
- 保护规则：合并候选和 `master` push 都由独立 `windows-2025` 的 `Clean Windows Harness` 裁判；它运行 `npm ci` 和唯一完整入口 `npm run harness:check`。
- 本快照记录稳定的受保护基线；当前 worktree、分支和未提交变更必须由 `git status --short`、`git branch --show-current`、`git log -1 --oneline` 重新读取，不在此处复制。

## Current verified baseline

受保护 `origin/master` 是 `3db8032a007fd6d7e0cce84ea8c23fd9dd8f3a42`（PR #66 merge commit，`AC-VL-06` app-owned 孤儿缩略图 GC）；上一条基线是 `4a0b14ce0bd3ed7a99c70d72fbf94807b8561dde`（PR #65 merge commit，`AC-VL-05` app-owned 缩略图删除）。

- PR #65 的两个 head 都在自动 `pull_request` `Clean Windows Harness` 上 `success`：judge-only head `5c984a7` 的 run [`36289060427`](https://github.com/llbz510/rain/actions/runs/36289060427)，最终 head `da3290d` 的 run [`36289620976`](https://github.com/llbz510/rain/actions/runs/36289620976)。
- PR #66 最终 head `d7a5b829b1df541808d27841b2f05b96eaa467ed` 的 `pull_request` `Clean Windows Harness` run [`36295683660`](https://github.com/llbz510/rain/actions/runs/36295683660) 为 `success`。
- 目标 `master` push 的 `Clean Windows Harness` run [`36290508492`](https://github.com/llbz510/rain/actions/runs/36290508492) 对 `4a0b14c` 为 `success`；run [`36296522628`](https://github.com/llbz510/rain/actions/runs/36296522628) 对 `3db8032` 为 `success`。
- 同范围仍有一个已知不稳定点：`scripts/nvidia-release-evidence.test.ts` 曾在 `pull_request` run [`36292438474`](https://github.com/llbz510/rain/actions/runs/36292438474) 于 `npm test` 阶段以 15000ms 超时失败。它属 user-paused Release 范围的既有抖动；由于 `npm run harness:check` 以 `&&` 串联，该失败会阻断其后的 `test:rust`，因此失败 run 不能用来判断 Rust Judge。

这些成功只证明各自目标提交在干净 Hosted Windows 上通过默认 Harness；不替代真实桌面、GPU、模型、安装器或 Release Evidence。

## Current delivery direction

当前唯一开发方向是从 [`launch-feature-audit.md`](development/launch-feature-audit.md) 的 blocker ledger 逐个关闭一个用户可见、已 Confirmed 的 Launch feature Slice。该 ledger 只报告生产路径与缺口，不定义 AC、Judge、等级或完成状态。

M3/GPU/Release Evidence、受控 GPU artifact build、安装器、签名、许可、Release 和下载页均为 user-paused。已取消的受控 GPU run 没有产生 manifest、core/control artifact、build record 或 launcher；未经用户明确恢复不得调度或重跑相关 workflow，也不得据此升级任何 `AC-RL-*`。

## Effective evidence and boundaries

- [`canonical-evidence-freshness-2026-08-02.md`](development/canonical-evidence-freshness-2026-08-02.md) 是 tracked schema v2 Evidence 的当前新鲜度审计。`evidence/rain-real-e2e-20260726-195652/` 只证明其记录的 408b6db-era 配置和运行，不能证明当前 target、其他模型或 vision。
- `AC-HE-05` 的 Hosted Runtime Settings Judge 仅对 `a329059b8172dab82c7326deb0af322045a0c396` 的 workflow_dispatch run `30756311932` 签发；桌面边界变动后的目标提交仍需独立重放。
- `AC-HE-01` 的 `npm run harness:control` 只裁判控制面自洽；`AC-HE-06` 只裁判 99 条历史产品决策的当前去向。两者均不证明产品功能、SQLite/Tauri、真实媒体或 Release Evidence。

## Active risks and boundaries

- 所有未关闭的 Required Evidence 仍是 blocker，除非对应 audit 行明确标为无新要求、supplement-only 或条件未来重放；测试存在不等于功能或 Evidence 已完成。
- `AC-RL-08` 仍是 `Partial`：现有 adapter/静态合同不构成目标安装器、受支持 NVIDIA 主机、模型和真实运行的 Release Evidence。该工作已 user-paused。
- `AC-VL-05` 的 app-owned 缩略图删除已随 PR #65 合并进受保护 `master`（`4a0b14c`）；`AC-VL-06` 孤儿 GC 已在受保护 PR #66 落地并取得 Hosted GREEN（实现提交 `fa75fbe` run `36292731562` success、最终 head `d7a5b82` run `36295683660` success），第 2 轮 Spec 与 Standards 复审已确认关闭并已随 PR #66 合并（`3db8032`）；`AC-VL-04` 的桌面证据仍只有最小骨架、其完整页面组合与 Desktop 结论尚未签发；`AC-AR-05/06` 的 app-scope import owner 与判别式 progress contract 仍是独立缺口。具体生产路径、现状和优先级以 Launch audit 为准。
- whole-repo `cargo fmt` 不能作为干净门禁：既有/locked Rust 差异会污染结果；新 Rust 文件仍必须使用 file-scoped `rustfmt`。
- `core.autocrlf` 可能造成 `Cargo.toml` ghost diff；是否真实变更必须以 `git diff` 判断。
- 本地可信 WebView 的前端 SQL plugin 需要 `sql:allow-execute`；若将来加载远程不可信内容，必须先重新收紧该 capability。

## Maintenance and current handoff

修改项目文件的会话必须同步本快照，但只能替换已过期的当前事实和本节交接，不得新增按日期的会话段落或 `## What changed` 时间线。每次交接保留一个可验证的当前 Slice：AC、Owner、公开 Judge、RED/GREEN、独立审查结果、未运行 Evidence、下一唯一动作；历史细节由 commit/PR 记录承载。

当前 Slice 是已获用户明确授权的 `AC-VL-06`：每次**成功**删除 Video 后，在同一个 Rust 深模块中运行有界的一轮孤儿收集，只删除 app-data `thumbnails/` 中**不在数据库 keep-set** 内的合法缩略图。Owner 是 `src-tauri/src/thumbnail_lifecycle.rs`（与已合并的 `AC-VL-05` 同一深 module）：keep-set 只来自真实 `video` 行，候选只认 `thumbnail_storage::thumbnail_path_for_video_id` 的同一 ID/命名白名单，删除复用 AC-VL-05 的受控句柄删除，`delete_video_atomically` 仍是薄 adapter。每轮有显式候选上限与失败上限（`ORPHAN_COLLECTION_POLICY`），运行级结果区分完整完成／达到候选上限／达到失败上限／部分失败／本轮未运行（已重入、keep-set 或受控目录不可用）；拿不到 keep-set 或受控目录不是普通目录时一律不删；受控目录被重定向为 junction、非合法命名条目、目录与重解析点一律保留；进程内同一 app-data root 不得重入；删除前按文件时间戳设保护窗口，覆盖 `src/pipeline/video-import-controller.ts:512` 写缩略图早于 `:534` 插 `video` 行之间的真实写窗口。失败面按用户已确认的 D4 不新增任何界面：只有结构化运行结果与本 PR 新增的受控 stderr 诊断行（lib crate 首次使用 `eprintln!`；仓库既有先例在 `src-tauri/src/bin/rain-whisper-cuda.rs` 的 CUDA worker 二进制，不在 lib crate），且 Windows GUI 构建下 stderr 可能不可见仍是已知未闭合边界。公开 Judge 是相邻非锁定 Rust `thumbnail_lifecycle_tests`，以真实内存 SQLite、隔离真实文件系统、真实 Windows 占用句柄与 junction、以及真实并发写入线程覆盖 keep-set、候选与失败上限、幂等、部分失败、fail-closed、受控目录重定向、进程内重入和并发写窗口，并断言用户源视频、模型与受控目录外文件字节不变。上一个 Slice 是 `AC-VL-06` 孤儿缩略图 GC，已随受保护 PR #66 合并进 `master`（merge commit `3db8032`）：每次**成功**删除 Video 后在同一个 Rust 深模块中运行有界一轮孤儿收集，只删除 app-data `thumbnails/` 中不在真实 `video` keep-set 内的合法缩略图；keep-set、命名白名单、受控句柄删除、显式候选/失败上限、fail-closed、受控目录重定向、进程内重入与缩略图写窗口都由相邻非锁定 Rust Judge 以真实内存 SQLite、隔离真实目录、真实 Windows 占用句柄与真实并发写线程裁判。其可归因 RED 是 judge-only 提交 `ed98106` 的 run `36292438474` 在未修改的生产代码上以 `error[E0433]` 无法编译；Hosted 证据为实现提交 `fa75fbe` 的 run `36292731562`、文档提交 `1c6164d` 的 run `36293316122`、修复提交 `e4eebb0` 的 run `36295173478` 与最终 head `d7a5b82` 的 run `36295683660` 均 `success`（`122 passed; 0 failed; 0 ignored`）。

当前 Slice 是 `AC-VL-04` 视频列表页桌面证据的最小托管骨架，仍在受保护 PR 上、尚未合并。AC/用户可见结果：在托管 Windows 上真实启动 Rain、到达生产视频列表页，并以真实 WebDriver 桌面 DOM 与真实点击裁判顶栏组合、空库具名原生 CTA 打开既有「本地文件」「在线视频」菜单、过滤空状态、非 ready 卡进入任务详情与失败卡状态；Evidence tier 保持 `Strong + Desktop Evidence`，截图只是附件、不构成 Visual Evidence，不外推其他 14 条 AC、不升级 `AC-RL-*`。Owner 是生产视频列表页与卡/任务详情 dialog、`src/e2e/real-e2e-runner.tsx` 的 `video-list` 短模式（受控夹具经生产 `getDb()`/`insertVideo` 公共 interface 写入）、`src-tauri/src/e2e_config.rs` 的 E2E 门，以及新增的 `scripts/run-video-list-e2e.ps1` 与 `.github/workflows/video-list-desktop-e2e.yml`；AC-HE-05 的 owner workflow 与其脚本一字不动。RED/GREEN：先在 PR head 上让会真实失败的桌面断言骨架报出「受控夹具未建立 ⇒ 非 ready 卡进入任务详情、失败卡状态、真实卡片集合上的过滤空无法判定」这三个具体缺失条件并留下 `rain-video-list-e2e-latest-failure/summary.json`，再补齐受控夹具取得 GREEN，且不放宽断言、不跳过步骤、不改产品行为；桌面 run 与同一 head 的 Harness run 见 PR 与本 Slice 任务产出。未运行 Evidence：完整页面组合的 Strong Judge、其他桌面条件、Visual/Accessibility、GPU/模型/安装器/Release。本机未运行 Cargo/Rust 编译与 `cargo test`、`harness:check`、真实 Tauri 桌面应用、GPU、模型、LLM 或真实安装包。下一唯一动作：把该 PR 的冻结 head 交给独立 Spec 与 Standards 复审，两条均通过后由 Captain 受保护合并并确认 master push Harness。
