# Harness Migration — GPU-required Core Release

> 状态：Active
> 日期：2026-08-03
> 用户授权：用户先指示“跳过这个吧，默认有gpu显卡”，随后对“正式取消无 NVIDIA 支持、把 NVIDIA GPU 改成最低系统要求，并执行 Harness Migration”明确回复“是的”。

## 1. 旧合同

`AC-RL-07` 原为 Confirmed：同一正式候选必须在无 NVIDIA GPU、驱动和 CUDA runtime 的干净 Windows 上安装、启动，显示 Auto CPU fallback 原因，并完成真实 CPU 短样本。PR #29 增加 `scripts/run-no-nvidia-cpu-evidence.ps1` 和静态合同测试作为未来 Release Evidence runner；PR #30 修复 NSIS generator prerequisite。

该合同还出现在 `AC-LV-21` 的最终 Evidence 预算、M1/M3 范围与路线图、M3-S1 artifact contract、下载披露以及当前 coverage Gap 中。

## 2. 新合同与替代 Judge

Core Release 的受支持发布主机必须是 Windows x64，并具备受支持 NVIDIA GPU 和兼容驱动。资格只按 `CONTEXT.md` 的生产谓词判断：精确候选的版本化 worker 探针和所选 Evidence 模型显存门禁必须通过；M3-S3 只签发实际记录的 GPU/驱动配置，不得外推。无 NVIDIA 主机不再属于支持矩阵，也不再要求安装、启动或 CPU 短样本 Release Evidence。

- `AC-RL-07` 状态改为 `Superseded`，保留旧文字与迁移指针供审计。
- `AC-RL-08` 继续裁判受支持 NVIDIA 主机上的正式候选：先用生产 worker 探针和模型显存门禁判定资格，再裁判 Auto/Forced CUDA、Forced CPU、取消和失败分类。
- `AC-RL-18` 接管安装前最低硬件披露：受支持 NVIDIA GPU + 兼容驱动是必需条件，无 NVIDIA 不受支持；公开已验证配置只能来自有效 M3-S3 Evidence。
- `AC-LV-21` 继续裁判 CPU-safe 主程序、CPU adapter、Auto 可见回退、Forced CPU/GPU、取消与错误分类；它不再产生无 NVIDIA 发布支持承诺。

这不是 Evidence 降级或把未通过项标为完成，而是用户明确修订产品支持范围。`AC-RL-07` coverage 为 `Retired`，不计为 GREEN、Partial 或 Gap。

## 3. 保留边界

- Rain 主程序继续不得在装载时依赖 CUDA DLL。
- CUDA 继续只由隔离 worker adapter 承担；不得把 CUDA feature 设为普通主程序或默认 Harness feature。
- CPU adapter、显式 CPU 模式和 `Auto` 可见 CPU fallback 保留，用于受支持 NVIDIA 主机上的选择与故障处理。
- Forced GPU 继续失败关闭；模型错误和取消不得跨后端重跑。
- 普通 CPU-safe/Harness 构建继续不要求 CUDA Toolkit。

“GPU required”只定义发布支持矩阵，不授权删除 CPU 路径，也不证明目标安装器、签名、许可或 GPU Evidence 已完成。

## 4. 退役影子

以下活动 Judge/入口随旧合同一并退役；Git 历史保留其实现与审查记录：

- `scripts/run-no-nvidia-cpu-evidence.ps1`；
- `scripts/no-nvidia-cpu-evidence.test.ts`；
- `package.json` 的 `evidence:no-nvidia-cpu` 命令；
- M3-S2 no-NVIDIA Evidence 作为发布阻断 Slice 的当前状态。

不删除产品运行时的 CPU fallback 测试，因为它们仍裁判 `AC-LV-21` 的当前行为，不是 `AC-RL-07` 的影子。

## 5. 写集与锁定边界

本迁移只修改领域语言、环境说明、Active 控制/范围/验收/覆盖/路线图/spec、项目状态、非锁定 runner/test 和 package 命令。它不修改：

- `harness/`；
- `src-tauri/tests/`；
- 产品运行时代码；
- workflow；
- tracked Evidence 或生成安装器。

没有运行付费模型、真实视频、外部站点或新的 Release Evidence。

## 6. 验证与完成条件

提交前必须满足：

1. `acceptance-standard.md` 恰有 90 个唯一 AC ID，其中 89 个 `Confirmed`、`AC-RL-07` 一个 `Superseded`；
2. 每个 Confirmed AC 仍有唯一 coverage 行和非空 Owner/Judge；`AC-RL-07` 唯一 coverage 行为 `Retired`；
3. 99 条产品决策处置保持 72 Confirmed AC / 23 Proposed / 4 Out-of-scope；
4. 活动事实源不再把无 NVIDIA Evidence 写成发布阻断项，并一致指向 M3-S3；
5. 已退役 runner、静态测试和 npm 命令不存在；锁定 Harness、产品源码、workflow 和 Evidence 零改动；
6. `npm run harness:control`、机械审计、`git diff --check` 和完整 `npm run harness:check` 通过；
7. 独立只读 Spec 与 Standards reviewer 对同一稳定 staged diff 均返回 PASS，P0/P1/P2 为空；
8. PR 的 `Clean Windows Harness` 通过后才可合并。

合并后的唯一下一动作是 M3-S3：从精确新 `master` 重建正式候选，在受支持 NVIDIA Windows 上签发目标绑定的 GPU/Forced CPU/取消/错误分类 Evidence。
