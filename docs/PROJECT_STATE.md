# Rain Project State

> 状态：`Active`
> 作用：当前可验证快照与短期交接，不是项目日记、产品规格或验收标准。历史会话、旧验证和已合并改动应从 Git/PR 历史读取。

## Current control facts

Primary checkout: current Git worktree. Active control documents and runnable scripts must not depend on a legacy checkout location.

- 远端：`origin` 为公开 GitHub 仓库；本地 `master` 跟踪 `origin/master`。
- 保护规则：合并候选和 `master` push 都由独立 `windows-2025` 的 `Clean Windows Harness` 裁判；它运行 `npm ci` 和唯一完整入口 `npm run harness:check`。
- 本快照记录稳定的受保护基线；当前 worktree、分支和未提交变更必须由 `git status --short`、`git branch --show-current`、`git log -1 --oneline` 重新读取，不在此处复制。

## Current verified baseline

受保护 `origin/master` 是 `fbd93147bf646ee30766f7830552523ee8baa378`（PR #63 merge commit）。

- PR #63 的 `Clean Windows Harness` run [`33531938489`](https://github.com/llbz510/rain/actions/runs/33531938489) 为 `success`，自动 `master` push Harness run [`33533105726`](https://github.com/llbz510/rain/actions/runs/33533105726) 为 `success`。

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

当前 Slice 是已获用户明确授权的 `AC-VL-01` 单一局部缺口：生产 `VideoListPage → VideoCard` 必须让非 ready 卡片的粗状态徽章显示可读文字。持久 `pending` 显示“排队中”；持久 `failed` 显示“失败”并保留既有错误；无 live progress 的持久 `processing` 显示“正在处理”，有现有 progress listener 的真实 callback 后显示“正在处理 47%”，两者均保留既有阶段细节。Owner 是 `src/ui/components/video-list.tsx`；`src/ui/video-list.ts` 是 processing 基础文案的唯一事实，组件只从该 label 追加 live percent。公开 Judge 已合并入既有非锁定 `src/__tests__/video-list-page-recovery.test.tsx`，复用生产页面、公共内存数据库、progress listener、Pipeline mock 与设置 setup；删除独立的 status-badges 文件，减少一个 jsdom 测试文件/worker，但不宣称它必然修复 Hosted 抖动。PR #64 的第三次自动 `Clean Windows Harness` run `33611218222` 针对 head `f0537bc`：控制面与绝大多数前端通过，104 个 test files 中 102 passed / 1 skipped / 1 failed，769 tests 中 767 passed / 1 skipped / 1 failed；本 Slice recovery Judge、locked M17 component 及相关 video-list tests 均通过。唯一失败是用户暂停 Release 范围的 `scripts/nvidia-release-evidence.test.ts:1597`，用例 `binds runner control tooling to a clean canonical Git checkout, including untracked files` 触发默认 5000ms timeout。fixture 合并已将本轮负担降至 104 个文件，但未消除 Hosted I/O timeout，也不宣称修复。没有完整 GREEN、未 merge、未手动 rerun。该 Slice 不新增卡内 retry/cancel，不改 `ImportTaskDialog`、Pipeline 或进度协议，也不外推完整 `AC-VL-01`、`AC-UX-06` 或 Visual Evidence。合并后的 recovery Judge、locked M17 Harness 与相关视频列表回归、`npm.cmd exec -- tsc --noEmit`、`npm.cmd run build`、`npm.cmd run harness:control` 和 `git diff --check` 均已 GREEN。fixture/Judge 合并后的最终独立 Spec 与 Standards 双审均为 FINAL PASS，P0/P1/P2=0。完整 `npm test` 与 `harness:check` 仅本地未运行，Cargo/Rust、真实 Desktop、Visual Evidence、安装器、GPU、模型与 LLM 均未运行。`AC-VL-01` 仍为 Partial，Visual Evidence 未闭合；下一唯一动作是本次必要当前事实文档经双审后，将 amend head force-with-lease 推送到现有 PR #64，并仅等待正常自动 `Clean Windows Harness`。若同类无关 timeout 再失败则停止，不通过 no-op 或文档 churn 继续触发；需用户授权 manual rerun 或 Release/Harness 稳定化 Slice。成功前不合并、不手动 rerun/no-op，成功后合并并确认 master-push Harness。
