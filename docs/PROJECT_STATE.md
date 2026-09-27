# Rain Project State

> 状态：`Active`
> 作用：当前可验证快照与短期交接，不是项目日记、产品规格或验收标准。历史会话、旧验证和已合并改动应从 Git/PR 历史读取。

## Current control facts

Primary checkout: current Git worktree. Active control documents and runnable scripts must not depend on a legacy checkout location.

- 远端：`origin` 为公开 GitHub 仓库；本地 `master` 跟踪 `origin/master`。
- 保护规则：合并候选和 `master` push 都由独立 `windows-2025` 的 `Clean Windows Harness` 裁判；它运行 `npm ci` 和唯一完整入口 `npm run harness:check`。
- 本快照记录稳定的受保护基线；当前 worktree、分支和未提交变更必须由 `git status --short`、`git branch --show-current`、`git log -1 --oneline` 重新读取，不在此处复制。

## Current verified baseline

受保护 `origin/master` 是 `4ed97fb10692c965cb85074470c7342ea76902f4`（PR #64 merge commit）。

- PR #64 较早的自动 `Clean Windows Harness` run [`33611218222`](https://github.com/llbz510/rain/actions/runs/33611218222) 曾因 user-paused Release 范围的 NVIDIA evidence fixture 默认 5000ms timeout 而未形成完整 GREEN；它不证明 Harness 稳定性或本 Slice。最终 PR `Clean Windows Harness` run [`33612012707`](https://github.com/llbz510/rain/actions/runs/33612012707)（job `100189125588`，2026-09-02 09:03–09:14 UTC）为 `success`。
- 目标 `master` push 的 `Clean Windows Harness` run [`33613088916`](https://github.com/llbz510/rain/actions/runs/33613088916) 已 `success`：首次尝试在环境安装 FFmpeg 的 Chocolatey 504 失败，用户只授权一次 manual rerun，第二次成功。

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
- `AC-VL-05` 的 app-owned 缩略图删除已在当前未合并目标分支得到本地 Strong Judge；`AC-VL-06` 孤儿 GC、`AC-AR-05/06` 的 app-scope import owner 与判别式 progress contract 仍是独立缺口。具体生产路径、现状和优先级以 Launch audit 为准。
- whole-repo `cargo fmt` 不能作为干净门禁：既有/locked Rust 差异会污染结果；新 Rust 文件仍必须使用 file-scoped `rustfmt`。
- `core.autocrlf` 可能造成 `Cargo.toml` ghost diff；是否真实变更必须以 `git diff` 判断。
- 本地可信 WebView 的前端 SQL plugin 需要 `sql:allow-execute`；若将来加载远程不可信内容，必须先重新收紧该 capability。

## Maintenance and current handoff

修改项目文件的会话必须同步本快照，但只能替换已过期的当前事实和本节交接，不得新增按日期的会话段落或 `## What changed` 时间线。每次交接保留一个可验证的当前 Slice：AC、Owner、公开 Judge、RED/GREEN、独立审查结果、未运行 Evidence、下一唯一动作；历史细节由 commit/PR 记录承载。

当前 Slice 是已获用户明确授权的 `AC-VL-05`：已知 Video 的数据库删除提交后，只删除由合法 ID 推导的 `app-data/thumbnails/<videoId>.jpg`，绝不接收任意缩略图路径或删除用户源媒体。Owner 是 Rust `thumbnail_lifecycle` deep module，它复用 `video_deletion` SQLite transaction；`delete_video_atomically` 仅解析 app-data 并调用该生产 seam，`video_deletion.rs` 仍是事务内跨表删除与回滚的唯一执行者、不再是 command 入口。公开 Judge 是相邻非锁定 Rust `thumbnail_lifecycle_tests`，以真实内存 SQLite 和隔离真实文件系统覆盖级联成功、非法/path-like ID 在 commit 前拒绝、缺失目标的两个真实分支（app-data 根缺失，以及受控目录存在而 `<videoId>.jpg` 缺失且重复运行幂等）、数据库级联 ABORT 时不产生任何文件副作用、真实未共享 `FILE_SHARE_DELETE` 的占用句柄下错误可见且无半状态并在释放后可重试、真实目录删除失败后 Video 已缺失时受控重试、源/任意文件保持，以及 Windows 真实 junction 逃逸拒绝。Windows 路径在 blocking task 中打开目标句柄、核验其最终解析路径精确属于 resolved app-data，再通过同一句柄删除；reparse/directory 拒绝且 `FILE_DISPOSITION_INFO` 的一字节 ABI 由编译期断言锁定。已确认语义边界：提交后文件删除失败的可见错误与重试限于当次会话；重启后的残留缩略图归 `AC-VL-06` 孤儿 GC，`AC-VL-05` 不做跨会话补偿。第一轮独立 Spec 复审对该 target 判定 `needs_revision`（SR-1..SR-5），指出当时 5 个用例未覆盖生产最常见的缺失文件分支、真实访问失败与数据库失败补偿，且文档曾记录不成立的双审 `FINAL PASS`／`P0/P1/P2=0`；本轮补齐上述三项真实 Judge，并按 SR-4/SR-5 修正模块 owner 描述与产品语义边界、删除过期审查声明。本轮新增 Judge 针对未修改的生产代码即通过，说明缺口在覆盖而非行为，其覆盖的目标生产分支与可反证性以 file:line 记录在 PR 描述；`AC-VL-05` 的 RED/GREEN、门禁与等级结论只以 GitHub 托管 Windows 的 `Clean Windows Harness` 与第二轮独立复审为准，不以本机或本地快照结论替代。不外推 Desktop、Visual、GPU、安装器、模型、LLM 或 Release Evidence；当前 worktree 未安装 `node_modules`，故 TypeScript/前端筛选未运行，完整 Harness 也未本地运行。下一唯一动作是等待 PR #65 本轮 head 的 `Clean Windows Harness` 结论与第二轮 Spec/Standards 独立复审；两者通过前不合并，也不启动 `AC-VL-06` 实现。
