# Rain Project State

> 状态：`Active`
> 作用：当前可验证快照与短期交接，不是项目日记、产品规格或验收标准。历史会话、旧验证和已合并改动应从 Git/PR 历史读取。

## Current control facts

Primary checkout: current Git worktree. Active control documents and runnable scripts must not depend on a legacy checkout location.

- 远端：`origin` 为公开 GitHub 仓库；本地 `master` 跟踪 `origin/master`。
- 保护规则：合并候选和 `master` push 都由独立 `windows-2025` 的 `Clean Windows Harness` 裁判；它运行 `npm ci` 和唯一完整入口 `npm run harness:check`。
- 本快照记录稳定的受保护基线；当前 worktree、分支和未提交变更必须由 `git status --short`、`git branch --show-current`、`git log -1 --oneline` 重新读取，不在此处复制。

## Current verified baseline

受保护 `origin/master` 是 `4a0b14ce0bd3ed7a99c70d72fbf94807b8561dde`（PR #65 merge commit，`AC-VL-05` app-owned 缩略图删除）。

- PR #65 的两个 head 都在自动 `pull_request` `Clean Windows Harness` 上 `success`：judge-only head `5c984a7` 的 run [`36289060427`](https://github.com/llbz510/rain/actions/runs/36289060427)，最终 head `da3290d` 的 run [`36289620976`](https://github.com/llbz510/rain/actions/runs/36289620976)。
- 目标 `master` push 的 `Clean Windows Harness` run [`36290508492`](https://github.com/llbz510/rain/actions/runs/36290508492) 对 `4a0b14c` 为 `success`。
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
- `AC-VL-05` 的 app-owned 缩略图删除已随 PR #65 合并进受保护 `master`（`4a0b14c`）；`AC-VL-06` 孤儿 GC 已在受保护 PR #66 落地并取得 Hosted GREEN（实现提交 `fa75fbe` run `36292731562` success、最终 head `1c6164d` run `36293316122` success），剩余门禁仅为第二轮 Spec/Standards 独立复审与合并；`AC-AR-05/06` 的 app-scope import owner 与判别式 progress contract 仍是独立缺口。具体生产路径、现状和优先级以 Launch audit 为准。
- whole-repo `cargo fmt` 不能作为干净门禁：既有/locked Rust 差异会污染结果；新 Rust 文件仍必须使用 file-scoped `rustfmt`。
- `core.autocrlf` 可能造成 `Cargo.toml` ghost diff；是否真实变更必须以 `git diff` 判断。
- 本地可信 WebView 的前端 SQL plugin 需要 `sql:allow-execute`；若将来加载远程不可信内容，必须先重新收紧该 capability。

## Maintenance and current handoff

修改项目文件的会话必须同步本快照，但只能替换已过期的当前事实和本节交接，不得新增按日期的会话段落或 `## What changed` 时间线。每次交接保留一个可验证的当前 Slice：AC、Owner、公开 Judge、RED/GREEN、独立审查结果、未运行 Evidence、下一唯一动作；历史细节由 commit/PR 记录承载。

当前 Slice 是已获用户明确授权的 `AC-VL-06`：每次**成功**删除 Video 后，在同一个 Rust 深模块中运行有界的一轮孤儿收集，只删除 app-data `thumbnails/` 中**不在数据库 keep-set** 内的合法缩略图。Owner 是 `src-tauri/src/thumbnail_lifecycle.rs`（与已合并的 `AC-VL-05` 同一深 module）：keep-set 只来自真实 `video` 行，候选只认 `thumbnail_storage::thumbnail_path_for_video_id` 的同一 ID/命名白名单，删除复用 AC-VL-05 的受控句柄删除，`delete_video_atomically` 仍是薄 adapter。每轮有显式候选上限与失败上限（`ORPHAN_COLLECTION_POLICY`），运行级结果区分完整完成／达到候选上限／达到失败上限／部分失败／本轮未运行（已重入、keep-set 或受控目录不可用）；拿不到 keep-set 或受控目录不是普通目录时一律不删；受控目录被重定向为 junction、非合法命名条目、目录与重解析点一律保留；进程内同一 app-data root 不得重入；删除前按文件时间戳设保护窗口，覆盖 `src/pipeline/video-import-controller.ts:512` 写缩略图早于 `:534` 插 `video` 行之间的真实写窗口。失败面按用户已确认的 D4 不新增任何界面，只有结构化运行结果与既有 `eprintln!` 诊断通道（Windows GUI 构建下 stderr 可能不可见，属已知未闭合边界）。公开 Judge 是相邻非锁定 Rust `thumbnail_lifecycle_tests`，以真实内存 SQLite、隔离真实文件系统、真实 Windows 占用句柄与 junction、以及真实并发写入线程覆盖 keep-set、候选与失败上限、幂等、部分失败、fail-closed、受控目录重定向、进程内重入和并发写窗口，并断言用户源视频、模型与受控目录外文件字节不变。本 Slice 尚未合并：judge-only 提交 `ed98106` 的 Hosted run `36292438474` 在 `npm test` 阶段因 `scripts/nvidia-release-evidence.test.ts:2191` 的 15000ms 超时失败，而 `npm run harness:check` 以 `&&` 串联，故 `test:rust` 未执行、Judge 的 RED 未被观测；该失败与本 Slice 无关（该提交只改了一个 Rust 测试文件，vitest 不编译它）。实现提交 `fa75fbe` 的 Hosted run `36292731562` 与最终 head `1c6164d` 的 run `36293316122` 均为 success（`122 passed; 0 failed; 0 ignored`）。剩余门禁仅为第二轮 Spec/Standards 独立复审与受保护合并；本机未运行 Cargo/Rust 编译与 `cargo test`，也未运行真实桌面、GPU、模型、安装器或 Release Evidence。下一唯一动作是把 PR #66 head `1c6164d` 交给第二轮 Spec 与 Standards 独立复审；双 PASS 后由 Captain 受保护合并并确认 master push Harness，不得删除、放宽或跳过任何断言，也不得用 no-op 或纯文档改动刷取 run。
