# Rain Harness Migration — Core Release AC Control — 2026-08-02

> 状态：Active
> 授权：用户于 2026-08-02 在审阅已独立双轴通过的 M1-S2 合同后明确回复“确认”。
> 对应合同：`AC-RL-01..20`、`AC-VL-01..07`、`AC-SU-01..07`、`AC-UX-01..06`、`AC-PF-01..05`、`AC-AR-02..06`
> 目的：把 50 条已批准产品/发布合同迁入正式 acceptance/coverage 控制面，并把 M1-S1 的 31 条 Launch decision 从 Proposed 路由为 Confirmed AC；不修改产品实现或锁定测试。

## 1. 旧合同与迁移原因

迁移前，Active `release-scope-contract.md` 已把 54 条历史 Proposed decision 冻结为 31 Launch / 23 Post-release，但 31 条 Launch 仍只能引用 `release-acceptance-contract.md` 中的 Proposed candidate。`acceptance-standard.md`、`harness-coverage.md` 和 `product-decision-coverage.md` 尚未接管这些合同，因此控制面不能机械证明每条 Launch 行为已有正式 AC，也不能把已有局部覆盖与真实 Gap 分开。

用户确认的 M1-S2 提案已经冻结每条候选 AC 的单一可观察结果、生产 Owner、独立 Judge、Required Evidence tier 和明确范围外。本迁移只改变控制状态和事实路由，不把 Confirmed 解释为实现完成，不把局部测试提升为 Evidence。

## 2. 新正式合同与替代裁判

| 控制层 | 迁移后责任 | 防止的假完成 |
| --- | --- | --- |
| `acceptance-standard.md` | 逐条保存 50 个 Confirmed AC 的产品语义、Owner、Judge、Evidence tier 和范围外 | PRD、旧计划或组件存在不能替代当前产品合同 |
| `harness-coverage.md` | 每条新 AC 恰好一行，保守记录现有 `Partial`/`Gap` 与达到目标 tier 尚缺的 Judge/Evidence | Confirmed 状态、测试文件存在或本机旧 smoke 不能被写成完成 |
| `product-decision-coverage.md` | 31 条 Launch decision 改为 `Confirmed AC` 并引用新 AC；23 条 Post-release 和 4 条 Out-of-scope 不变 | 局部既有 AC 不能继续掩盖完整 Launch 行为，也不能把 Post-release 静默带入首发 |
| `npm run harness:control` | 机械检查 50 条新增 Confirmed AC 的唯一 coverage、Owner、Judge，以及 99 条 decision 的有效 Confirmed 引用 | 文档漏项、重复、状态冲突和未知 AC 不能进入提交 |

正式行为 Judge 仍由各 AC 指定的生产接口测试、真实文件/SQLite/Tauri、桌面/视觉/可访问性、性能/soak、Release Evidence 与人类批准分层承担。当前缺失项必须继续显示为 `Partial` 或 `Gap`，后续每个实现 Slice 只能关闭一个可独立裁判的边界。

## 3. 锁定文件与测试边界

本次不修改：

- `harness/`；
- `src-tauri/tests/`；
- 产品源码、workflow、安装器、模型或 Evidence。

本次只修改正式控制文档。没有删除、降低或改写既有 AC，也没有放宽 M20 command allowlist、数据库架构 policy、默认 Harness 或 Evidence validator。未来为某条新 AC 修改锁定 Harness 时，仍须独立获得对应的用户批准并另写精确 migration 记录。

迁移审查发现两个原提案内部的映射细节必须显式收口：`DEC-PRD-012/013` 的横向滑动与边缘渐隐已补入 `AC-SU-02/01`；`DEC-PRD-053` 的旧 M14 删除快捷键被用户同次确认的更具体 `AC-SU-07` 取代，Core 禁用 `Del/Backspace`，节点删除/编辑继续 Post-release。前者补齐已确认 Launch 意图，后者记录已确认的首发产品修订；二者都不授权本轮实现。

## 4. 退役影子与唯一事实源

- `release-acceptance-contract.md` 保留为用户确认与 31 行 traceability 记录；正式 AC 语义由 `acceptance-standard.md` 接管。
- 退役“31 条 Launch 仍是 Proposed”的当前状态；历史时间线保留原文字样。
- 不退役任何产品 module 或测试，因为本次没有实现替换。
- 50 条 AC 的完成强度只相信 `harness-coverage.md`；不得从 Confirmed、路线图状态或 proposal 表自行推断 GREEN。

## 5. 验证与完成条件

本迁移在提交前必须满足：

1. acceptance 中 50 个新 ID 唯一、状态均为 Confirmed、Owner/Judge 非空；
2. coverage 中对应 50 行唯一，且当前结论明确为 Partial 或 Gap，不伪造本轮 Evidence；
3. decision coverage 恰好 99 行，处置变为 72 Confirmed AC / 23 Proposed / 4 Out-of-scope，其中本轮 31 条与 Active scope 完全一致；
4. `npm run harness:control` 和 `git diff --check` 通过；
5. 独立只读 Spec 与 Standards reviewer 对同一稳定 diff 均无 P0/P1/P2；
6. `docs/PROJECT_STATE.md` 记录授权、变更、检查、审查 findings 与关闭方式。

本 docs-only Harness Migration 不运行完整 Harness、Hosted workflow、安装器、GPU/model/video、签名或 Release Evidence；这些不运行项必须在交付中明确报告，且所有相应 coverage Gap 保持可见。
