# Rain Agent-first Development Plan

> 状态：`Active`（会话与交付流程）
> 更新日期：2026-08-02

> 产品语义边界：本文件不新增或修改 Active AC。下文标为 `Proposed` 的产品切片必须先由用户确认，才能进入 RED 或实现。
> 方法依据：[`docs/research/2026-08-02-agent-first-harness-principles.md`](../research/2026-08-02-agent-first-harness-principles.md)
> 项目总路线：[`docs/development/rain-project-delivery-plan.md`](rain-project-delivery-plan.md)

## 1. 当前基线

This opening snapshot is a historical plan-creation baseline, not the current project status. Use docs/PROJECT_STATE.md and the explicit status fields below for current facts.

本计划以 2026-08-02 的可验证事实为起点：

- 本地 `master` 与 `origin/master` 同为 `7e278a6`，开始审查时工作树干净。
- 本地 `npm run harness:control` 和 `npm run harness:check` 通过。
- 当前 HEAD 的 GitHub Actions `Clean Windows Harness` run `30739528593` 通过。
- 验收标准包含 89 条当前 Confirmed AC 和 1 条 Superseded AC；历史产品决策覆盖为 72 条 Confirmed AC 映射、23 条 Post-release Proposed、4 条 Out-of-scope。这些数量不是完成百分比；M1-S2 原 50 条 AC 中 `AC-RL-07` 已退役，其余多数仍为 Partial/Gap。
- 核心本地视频、学习页、Runtime Settings、数据库原子边界和默认 CI 已有 Strong Judge；当前最大的已确认缺口是 `AC-LV-21` 在受支持 NVIDIA 正式候选上的 Release Evidence。
- Hosted `Runtime Settings Desktop E2E` 最后一次成功仍是 `9251962` 的 run `30341065896`。后续 `AC-LV-20` 已扩展同一真实桌面脚本，当前 HEAD 尚无 Hosted Windows 重放。
- 本地存在已忽略的构建缓存、日志和历史 Evidence 运行物；它们不属于源码变更，也不得未经用户批准进行大规模清理。

## 2. 每个会话只交付一个 Slice

默认 Slice 单位是：

- 一条 Confirmed AC；或
- 一条 Confirmed AC 内可以独立裁判的单一缺口；或
- 一个等待用户确认、不得实现的 Proposed AC；或
- 一个不改变产品语义、由现有 AC 保护的单一架构重构。

一个 Slice 不得同时夹带第二项产品行为、无关重构、锁定 Harness Migration 或 Evidence 升级。若实现中发现第二个问题，记录到候选队列，除非它阻断当前 AC，否则留给下一会话。

## 3. 固定会话协议

### 3.1 Takeover

每个会话必须先执行：

```powershell
git status --short
git branch --show-current
git log -5 --oneline
npm run harness:control
```

然后按 `AGENTS.md` 阅读控制地图、领域语言、完整 `PROJECT_STATE.md`，以及本 Slice 对应的 AC、覆盖行、模块地图、spec、代码、测试和最近证据。仓库事实与旧交接不一致时，以当前命令和 Active 事实源为准。

### 3.2 Slice Contract

改代码前必须写清以下字段；可以先写在当轮工作说明中，完成后写入 `PROJECT_STATE.md`：

| 字段 | 必填内容 |
| --- | --- |
| Slice | 唯一 AC 或唯一缺口 |
| Observable result | 用户或外部系统能观察到的结果 |
| In scope | 本轮承诺交付的最小行为 |
| Out of scope | 明确不顺带实现的行为 |
| Owner | 负责让行为成立的生产模块 |
| Judge | 能让坏实现可靠失败的公开行为检查 |
| Evidence tier | 定向测试、完整 Harness、真实桌面或外部 Evidence 中的必要层级 |
| Allowed writes | 本轮允许修改的目录/文件类别 |
| Locked files | 默认禁止修改的 `harness/`、`src-tauri/tests/` 及其他受控文件 |

没有 Confirmed AC 的新产品行为只能形成 `Proposed` 合同并停下来等待用户确认。需要修改锁定 Harness 时，必须单独申请 Harness Migration，先说明旧合同、替代 Judge 和退役项。

### 3.3 RED / Baseline

- 产品缺陷或新行为：先通过生产公开接口建立可复现 RED。
- 行为保持重构：先固定现有 GREEN 基线和防回归 Judge；不得伪造一个只检查文件/函数存在的 RED。
- 桌面、SQLite、进程、文件系统、GPU 或外部模型边界不能由内存对象自证。
- Judge 不能从同一个生产常量推导预期值后再证明该常量正确。

### 3.4 Implement and Verify

- 只做通过当前 Judge 所需的最小实现。
- 页面不吸收已有深模块的流程规则；触碰现有违规时按模块地图就地迁移，不做无目标大重写。
- 先跑定向 Judge，再按影响范围跑 TypeScript、Rust、构建、真实桌面或 Evidence。
- 代码交付默认必须通过 `npm run harness:check`；成功后 `dist` 必须是普通生产产物。
- PR 和 `master` 必须继续由独立 `Clean Windows Harness` 判断。live key、真实桌面、GPU、外网和安装包只在对应 AC 要求时运行。

### 3.5 Independent Review AI — 硬门禁

每个已落实的 Slice 在交付前必须由没有参与实现的独立 AI 只读审查。派发时优先使用全新上下文，并显式提供：

- 基准提交或明确 diff；
- 目标 AC/spec、In scope/Out of scope；
- Owner、Judge 与允许读取范围；
- 已运行命令及结果；
- 未运行的 Evidence 和已知边界；
- 禁止修改代码、测试、AC、覆盖等级和状态文档。

同一个独立 reviewer 按顺序完成两轴审查：

1. **Spec review**：逐条寻找违反 AC、越出范围、Owner 错位、证据不足或假完成的反例。
2. **Standards review**：检查模块边界、错误/取消/并发、数据与文件副作用、秘密、构建隔离、测试真实性和无关改动。

审查结果必须包含基准、逐条 AC 结论、P0/P1/P2 发现、缺失证据、复跑命令和明确 verdict。以下情况不得交付：

- 存在影响当前 Slice 正确性、数据/秘密安全或 Harness 真实性的 P0/P1/P2；
- reviewer 只说“测试通过”而未核对 AC；
- reviewer 参与过本轮实现或直接替实现者修代码；
- 缺少必要输入时 reviewer 通过猜测放行。

实现者修复发现后必须补 RED 或加强既有 Judge、重跑验证，并交回独立 reviewer 复核。纯范围外架构债可以记录为非阻断项，但不得伪装成已解决。

### 3.6 Handoff

完成后同步覆盖矩阵和 `PROJECT_STATE.md`，至少记录：

- 分支/提交和改动文件；
- 对应 AC、Owner、Judge；
- RED、修复与验证结果；
- independent review 的发现、关闭方式和 verdict；
- 未运行的真实 Evidence；
- 下一会话唯一最小动作。

下一会话不应依赖聊天记录才能恢复这些事实。

## 4. 候选工作队列（实际顺序以总交付计划为准）

本节的 P0–P5 是候选优先级标签，不是独立于总交付路线图的执行顺序。唯一权威顺序见 `docs/development/rain-project-delivery-plan.md`：先完成 M1 发布范围冻结和 Release AC，再执行 M2 的 Hosted replay 与 Evidence freshness，之后才进入 M3 和产品实现。

### P0 — 重放执行时目标提交的 Hosted Runtime Settings Judge

状态：`Complete` — workflow_dispatch run `30756311932` 已对 `master` commit `a329059b8172dab82c7326deb0af322045a0c396` 签发 GREEN；不改变产品代码。

- **控制范围**：`AC-HE-05`，并核对后续加入同一脚本的 `AC-LV-20` 重启恢复路径。
- **结果**：执行前本地 `master`、`origin/master` 和 GitHub `master` 完整 SHA 一致；run `headSha` 精确匹配。公开命令无 `-SkipBuild`、无 Rain secrets，真实 SQLite schema、设置 add/restart/delete/restart 和 pending-import restart recovery 全部通过。
- **动作**：执行时先解析并记录完整目标 SHA，确认远端可调度 ref（通常为受保护的 `master`）正指向该 SHA，再通过该 ref 人工触发既有 `Runtime Settings Desktop E2E` workflow。不得把本文件记录的历史 HEAD 当作持续有效目标，不复制断言、不使用 `-SkipBuild`、不注入 Rain secrets。
- **通过 Judge**：目标 SHA 的 workflow_dispatch run 成功；真实 SQLite schema、设置 add/restart/delete/restart 和 pending-import restart recovery 全部由现有公开命令裁判。
- **失败处理**：保留既有单份脱敏诊断；下一 Slice 只修一个确定的环境或产品 RED，不放宽断言或用延长超时掩盖未知错误。
- **独立审查**：只读核对目标 SHA、workflow 命令、完整日志、artifact/秘密边界和 AC 结论；远端 GREEN 不能由本地 GREEN 替代。

### P1 — 补齐 AC-LV-21 的受支持 NVIDIA Release Evidence

状态：`Confirmed AC / Evidence Gap`；单一 GPU 增强安装包、受支持 NVIDIA 目标环境和最低要求披露由 `AC-RL-02/08/18` 控制，目标候选 Release Evidence 仍缺失。`AC-RL-07` 已由 2026-08-03 migration 退役。

第一个 Slice 只设计并确认可复放 Evidence 合同，不同时处理签名、许可和下载 UX：

- **结果**：在按 `CONTEXT.md` 生产 worker probe + 所选模型显存门禁判定合格的 Windows 目标上安装目标提交正式候选包，完成 Auto/Forced CUDA、Forced CPU、取消与失败分类短样本。
- **Owner**：CPU-safe Rain 主程序、现有 Whisper backend selector、CUDA worker、正式安装产物和隔离 release-evidence runner。
- **Judge**：检查已安装主程序无 CUDA 装载依赖；记录 GPU 型号、驱动、总/空闲显存、worker 协议、生产 probe、模型显存门禁及包/模型哈希；真实启动；Auto/Forced CUDA 使用 worker 并输出非空单调句子；Forced CPU 不启动 worker；取消、崩溃和模型错误分类正确；诊断脱敏且与目标 SHA/产物哈希绑定。
- **禁止替代**：debug worker override、fake worker、旧 CUDA Evidence、开发树直接运行、把无 NVIDIA 行为宣传为受支持能力。
- **独立审查**：按 `CONTEXT.md` 的唯一谓词核对主机资格、安装目标和提交一致、每个实际 backend/输出来自生产接口；只签发记录的精确 GPU/驱动配置，不外推未验证型号。

后续按已确认 `AC-RL-*` 分立 Slice 落实：

1. 单一 NSIS 安装、升级、卸载生命周期；
2. 代码签名与发布密钥治理；
3. CUDA runtime 重新分发条款的 release-owner 评审；
4. 约 804 MB GPU payload 的下载/安装 UX。

这四项不得被一次“GPU 包能构建”合并宣称完成。

### P2 — 为应用所有缩略图建立删除与孤儿 GC 产品合同

状态：`Confirmed AC / implementation Gap`；对应 `DEC-PRD-060` 与 `AC-VL-05/06`，不得把既有数据库级联删除冒充派生文件生命周期完成。

第一个原子 Slice 只实现 `AC-VL-05` 的已知 Video 缩略图删除合同；已确认边界包括：

- 数据库提交后才删除已知 app-owned 缩略图；文件失败不得伪装成功，必须可见并允许受控重试；
- 只允许删除 app-data `thumbnails/` 中由合法 Video ID 推导的路径，拒绝任意路径和用户源媒体；
- 删除与 GC 共享一个 Rust thumbnail lifecycle 深模块，前端不拼接文件路径或补偿步骤；
- orphan keep-set、并发新建、幂等、部分失败和有界运行留给独立 `AC-VL-06` Slice。

随后以独立 `AC-VL-06` Slice 处理孤儿扫描与 GC。两个 Slice 都需要真实隔离文件系统 Judge；内存数据库或组件文案不能证明文件生命周期。

### P3 — 在扩展导入导航前关闭 risk 22 的两个架构债

状态：`Confirmed AC / architecture Gap`；risk 22a/22b 分别由 `AC-AR-05/06` 控制，仍须按两个独立 Slice 实现。

按两个独立 Slice 处理，不合并重写：

1. **App-scope import Owner**：把 `VideoImportController` 生命周期从“隐藏但保持挂载的完整 VideoListPage”提升为显式 App 级 Owner，同时保持 `AC-LV-19/20` 的取消、后台继续、single-flight 和同记录更新。
2. **Discriminated progress contract**：用一种有阶段判别的完整 payload 替代松散的 `stage/percent/details` 元组，让 producer、Pipeline、Controller 和 UI 不能组合出非法进度。

Judge 必须能在页面真正卸载/重挂或非法 payload mutation 时失败；不得因为文件较大而启动整页/整 Controller 重写。

### P4 — 完成高价值、低外部成本的视频列表闭环

状态：`Confirmed AC / implementation Gap`；`AC-VL-02/03/04` 已冻结排序、搜索和列表组合，仍须逐条实现并裁判。

先审计现有排序、搜索、顶栏和空状态的真实生产行为，再按已确认 AC 拆分：

1. 查询与排序语义：默认排序、三种排序、标题搜索、清空搜索和 SQLite/内存一致性；
2. 列表交互：空状态、导入入口、搜索/排序 UI 与非 ready 详情共存；
3. 精确视觉：按已确认 `AC-VL-07` 独立执行，不能由 CSS token 存在替代生产画面 Judge。

前两项可由生产 `VideoListPage` + 公共数据库接口 + 双 adapter 行为测试裁判；若涉及真实桌面布局或视觉，则增加截图/DOM/视觉 reviewer，而不是把 jsdom 称为完整视觉 Evidence。

### P5 — M1-S1 已确认的能力线路由

状态：`Superseded as a free-choice queue by the Active release scope`。

下列能力仍不得并行铺开。Core Release 线路已形成 Confirmed AC 和证据预算，必须按原子 Slice 关闭 coverage；Post-release 线路不阻断本次发布，也不得由局部实现静默带入：

| 能力线 | M1-S1 路由 | 主要未决边界 | 预计 Judge 成本 |
| --- | --- | --- | --- |
| 英文翻译 | Post-release | 生成、存储、显示、开关、原文不变 | 中到高，需真实模型 Evidence |
| Vision 当前帧解释 | Post-release | 截帧、模型图像能力、隐私、引用/时刻 | 高，需视觉模型 Evidence |
| 高级树编辑 | Post-release | 时间序、内容不丢、持久化、撤销/重做 | 高，需 UI + SQLite 纵向 Judge |
| 快捷键完整集 | Launch | 输入焦点门禁、selection origin、跨布局行为 | 中，生产页面行为 Judge |
| 精确视觉系统 | Launch | 卡片、目录、字幕、动效、无障碍 | 高，需视觉基准与独立 visual reviewer |
| 在线真实站点 | Post-release | 站点差异、登录、播放列表、长下载 | 高，需外网与可复放 Evidence |

实际顺序以完整交付路线图和 Active `release-scope-contract.md` 为准。不得按 DEC 编号顺序机械补齐原始 54 条决策，也不得把 Confirmed Launch 合同误称为实现完成。

## 5. 持续 Harness 改进队列

这些不是默认产品 Slice，只有出现真实复发或明确风险时才提升：

- 为文档更新时间、热点规模等当前 `harness:control` 未检查的元数据增加低成本 doc-gardening，而不是扩大控制面为自证系统。
- 将反复出现的非法依赖升级为带修复指引的负向 policy；一次性风格偏好不写成门禁。
- 每个新 Harness 记录捕获过的 RED、保护的 AC、成本与退役条件；模型/架构改变后一次移除一个组件验证其是否仍 load-bearing。
- 保持真实模型、GPU、外网和安装 Evidence 目标提交化；旧证据可保留，但不能自动升级新版本。
- 保持 review 反馈进入测试、policy、覆盖矩阵或 `PROJECT_STATE.md`，不得只消失在会话里。

## 6. 明确不做

- 不把 `docs/superpowers/plans/` 的历史勾选状态当当前进度。
- 不一次性“完成”M1 起始的 54 条决策。
- 不因 agent-first 名义降低分支保护、完整 Harness、真实 SQLite/Tauri 或 Evidence 要求。
- 不让 builder 修改 AC/锁定 Harness 来追求 GREEN。
- 不用三个以上代理处理一个普通小修复；独立 reviewer 是每个已实现 Slice 的最低必需分离。
- 不按文件行数启动大规模重写。
- 不未经批准清理大型缓存、历史 Evidence 或工作树。

## 7. 下一会话唯一推荐动作

当前原子 Slice 是 **M3 controlled merged-target artifact build**。它从 `3006757838b972b511917663e4ba8328804607d6` 的精确候选源码构建受控 NSIS 候选，但 workflow/generator 位于后续、独立记录的 tooling commit；两者不得混淆。该 Slice 只建立标准 `windows-2025` hosted Windows 构建：固定且校验精确为 4.0.0 的 CMake 展开目录必须同时服务 CUDA worker 和独立 Tauri/Cargo 主构建，完成两个消费者后才在 always/finally cleanup 中删除；以 source-derived installer 文件名/kind 与基本 MZ/PE 形状进入唯一 TEMP 的真实静默安装，从实际 installed tree 反算 artifact manifest，同时保留 7-Zip installer archive 解包 hygiene Judge 作为增量扫描。读取真实 installed tree 完成后，finally 运行生成的 uninstaller `/S`、核对退出、完整 payload 与可观察系统副作用清理，并聚合清除安装根、archive 根、owned target 与 CMake TEMP 的错误；再生成独立 build record 和手工管理员 Evidence launcher。为避免循环，first core upload 仅含 installer/manifest/checksums；其 digest 才允许写入 record，随后才生成 launcher 并第二次上传 control artifact。它不 dispatch workflow、不生成 Release Evidence、不发布 GitHub Release、不运行本机 Cargo/installer/GPU/model/LLM，也不把 `AC-RL-01/02/08/10/12` 升级。

先以 fake installed-tree、fake installer-archive、fake process/system-side-effect adapter、PowerShell CLI、runner provenance、launcher 与 workflow safety seams 完成 RED-to-GREEN；随后才可通过 PR、现有 Clean Windows Harness、独立 Spec/Standards review 和受保护合并。原 `AC-RL-12` 解包 Judge 未经 Harness Migration 不得退役；archive scan 是 installed-tree scan 的增量合同，不可互相替代。只有合并后由用户人工 dispatch 的 workflow 才能构建精确 target；只有用户手工以管理员身份运行生成 launcher 且 provider readiness 通过，才可考虑真实 M3-S3 Evidence。reviewer 必须独立核对 candidate target SHA、tooling SHA、record、artifact bytes、日志和证据边界。
