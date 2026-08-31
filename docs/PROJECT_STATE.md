# Rain Project State

> 状态：`Active`
> 作用：当前可验证快照与短期交接，不是项目日记、产品规格或验收标准。历史会话、旧验证和已合并改动应从 Git/PR 历史读取。

## Current control facts

Primary checkout: current Git worktree. Active control documents and runnable scripts must not depend on a legacy checkout location.

- 远端：`origin` 为公开 GitHub 仓库；本地 `master` 跟踪 `origin/master`。
- 保护规则：合并候选和 `master` push 都由独立 `windows-2025` 的 `Clean Windows Harness` 裁判；它运行 `npm ci` 和唯一完整入口 `npm run harness:check`。
- 本快照记录稳定的受保护基线；当前 worktree、分支和未提交变更必须由 `git status --short`、`git branch --show-current`、`git log -1 --oneline` 重新读取，不在此处复制。

## Current verified baseline

截至 2026-08-31，受保护 `origin/master` 是 `f200a0ecc48d0f4468326e9bf17331f138ba32cf`（PR #60 merge commit）。

- PR #59 已合并为 `02f138d4a5067554d464b5b92cb5daf75d06c6c1`；其 `Clean Windows Harness` run [`33346306370`](https://github.com/llbz510/rain/actions/runs/33346306370) 为 `success`。
- PR #60 的 `Clean Windows Harness` run [`33361689676`](https://github.com/llbz510/rain/actions/runs/33361689676) 为 `success`；该 run 的 PR head 是 `4c869930bd180ea575e3c5ca01d7e37dcefc62e6`，不是 merge commit。
- 上述 merge 的自动 `master` push Harness run [`33362355757`](https://github.com/llbz510/rain/actions/runs/33362355757) 为 `success`，head SHA 精确为 `f200a0ecc48d0f4468326e9bf17331f138ba32cf`。

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
- `AC-VL-05/06` 的 app-owned 缩略图删除与孤儿 GC 仍缺真实文件/SQLite Judge；`AC-AR-05/06` 的 app-scope import owner 与判别式 progress contract 仍是独立架构缺口。具体生产路径、现状和优先级以 Launch audit 为准。
- whole-repo `cargo fmt` 不能作为干净门禁：既有/locked Rust 差异会污染结果；新 Rust 文件仍必须使用 file-scoped `rustfmt`。
- `core.autocrlf` 可能造成 `Cargo.toml` ghost diff；是否真实变更必须以 `git diff` 判断。
- 本地可信 WebView 的前端 SQL plugin 需要 `sql:allow-execute`；若将来加载远程不可信内容，必须先重新收紧该 capability。

## Maintenance and current handoff

修改项目文件的会话必须同步本快照，但只能替换已过期的当前事实和本节交接，不得新增按日期的会话段落或 `## What changed` 时间线。每次交接保留一个可验证的当前 Slice：AC、Owner、公开 Judge、RED/GREEN、独立审查结果、未运行 Evidence、下一唯一动作；历史细节由 commit/PR 记录承载。

当前控制面维护 Slice 位于 `codex/project-state-snapshot`：`AGENTS.md`、本文件、`control-map.md`、`agent-first-development-plan.md`、`acceptance-standard.md` 和 `harness-coverage.md` 收敛快照职责；`scripts/control-plane-validator.mjs` 与未锁定 `scripts/control-plane-validator.test.ts` 固定公开 Judge 的结构合同。归属为 `AC-HE-01`，不修改产品功能、锁定 Harness、`src-tauri/tests/`、覆盖等级或 `AC-HE-06` 产品决策语义。新增 fixture 的同一 validator 直接调用先 RED，修复后 GREEN；定向 Vitest 22/22、`npm.cmd run harness:control` 与 `git diff --check` 均 GREEN。独立 Spec 与 Standards 最终均为 PASS，P0/P1/P2 均为 0；首轮 shared fixture/快照结构/Proposed 误报/操作风险，二轮 H3–H6/Markdown Proposed，三轮 CommonMark/交接日期，以及四轮 timeline 与 dated control path findings 均已关闭。下一唯一动作是提交、创建受保护 PR、等待自动 `Clean Windows Harness`、合并，并确认自动 master-push Harness。真实桌面/GPU/模型/安装器/Release Evidence 均不运行。
