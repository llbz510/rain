# Rain 项目完整落地计划

> 状态：`Active`（项目交付路线图）
> 更新日期：2026-08-02
> 适用范围：从当前已验证状态，持续推进到范围冻结、功能完成、Release Candidate、正式安装发布和上线后验证。
> 产品授权边界：本计划规定顺序、门禁和候选工作，不自动把 Proposed 产品行为升级为 Confirmed。新增行为仍必须先由用户确认 AC。
> 会话执行协议：`docs/development/agent-first-development-plan.md`

## 1. 计划要解决的问题

Rain 已经拥有可工作的本地视频主链路、学习页核心闭环、Runtime Settings、SQLite 原子持久化、模型能力门禁、CPU-safe/GPU-worker 架构、默认 Harness 和真实 Evidence。当前缺少的不是另一份“功能清单”，而是一条能跨许多短会话持续执行、最终得到可安装产品的完整交付路径。

本计划必须同时做到：

1. 明确什么叫“落地”，避免测试通过却没有可安装、可升级、可验证的产品。
2. 把 M1 开始时的 54 条 Proposed 历史决策全部放入明确的产品工作流或延期决策，不遗漏、不默认实现。
3. 把每个里程碑拆成单一 AC/单一缺口的 Slice，使任一新会话都能接续。
4. 为每个 Slice 指定 Owner、Judge、Evidence 层级和范围外行为。
5. 每个落实后的 Slice 必须由独立只读 AI 审查，发现关闭前不得交付。
6. 最终 Release Candidate 必须在精确提交上完成真实安装、双硬件环境、真实视频、秘密/许可和回滚检查。

## 2. “项目落地”的完成定义

Rain 只有同时满足以下条件才算完成一次正式落地：

### 2.1 产品范围已冻结

- 每条历史产品决策都有当前控制面去向。
- 所有计划进入本次发布的行为都有 Confirmed AC、Owner、Judge 和 Evidence 决策。
- 未进入本次发布的 Proposed 行为被明确标为 post-release 候选或 Out-of-scope；不得靠模糊措辞隐藏。
- 不存在两份 Active 文档对同一行为给出冲突语义。

### 2.2 功能与数据真实闭环

- 发布范围内所有 AC 至少为 Strong；依赖真实桌面、SQLite、文件系统、模型、GPU、外网或安装器的 AC 还必须取得对应 Evidence。
- 失败、取消、重试、重启、升级和卸载路径都有明确定义，不只覆盖成功路径。
- 用户本地源视频、API Key、SQLite 数据、应用所有派生文件和模型文件的所有权边界明确。
- UI 不展示无动作按钮、假成功、演示数据或未验收能力。

### 2.3 Release Candidate 可重放

- 精确 RC 提交通过本地 `npm run harness:check` 和独立 `Clean Windows Harness`。
- 目标 RC 提交完成当前 Hosted Runtime Settings Desktop E2E。
- 正式候选安装包在无 NVIDIA/CUDA 的干净 Windows 上完成安装、启动和 CPU 短样本。
- GPU 产品包在受支持 NVIDIA Windows 上完成安装、CUDA 短样本和 Auto/Forced GPU/CPU 行为。
- 正式安装、升级、卸载、应用数据保留/清理、签名、产物哈希和许可审查有可定位证据。
- 当前真实本地视频 canonical E2E 在 RC 提交上重新签发；旧 Evidence 不能自动继承。

### 2.4 可发布和可回滚

- 发布说明列出范围、依赖、模型、已知限制、隐私/成本提示和验证过的硬件。
- 安装包、校验和、签名信息和 Evidence manifest 可公开核对。
- 有明确的失败回滚、版本降级和数据兼容策略。
- 上线后有缺陷分级、诊断收集、紧急修复和复验流程。

## 3. 当前项目基线

本计划创建时的基线是已提交的 `495b5e5` 文档控制层；易变 Git 事实仍必须在执行时重新查询。

当前可靠结论：

- 90 条 AC 为 Confirmed；其中 50 条 M1-S2 AC 的当前覆盖仍全部为 Partial 或 Gap。
- M1-S2 正式迁移后的历史决策覆盖为 72 条 Confirmed AC 映射、23 条 Post-release Proposed、4 条 Out-of-scope。
- 本地视频导入、Stage2、学习页、模型管理、Runtime Settings、数据库原子边界和默认 Windows Harness 已形成强控制。
- `AC-LV-21` 只有 Strong 行为和本机 NVIDIA 短样本，尚无双环境 Release Evidence。
- Hosted Runtime Settings Judge 已在 `master` commit `a329059b8172dab82c7326deb0af322045a0c396` 上由 workflow_dispatch run `30756311932` 重放通过；该结论只属于此目标提交，后续相关桌面边界变化仍需重新签发。
- 应用所有缩略图的删除和孤儿 GC 已由 `AC-VL-05/06` 冻结语义，但实现与真实文件 Judge 仍是 Gap。
- risk 22 的 App-scope Controller Owner 与判别式 progress contract 已由 `AC-AR-05/06` 冻结，仍是非阻断实现债。
- schema 升级兼容、正式安装生命周期、签名和发布许可已有 `AC-RL-*` 合同，但实现、外部 Evidence 与人类批准仍缺失。

## 4. 交付策略：先 Core Release，再扩展完整产品面

为了避免 M1 开始时的 54 条 Proposed 同时展开，本计划采用两个连续目标。

### 4.1 已确认的 Core Release 范围

M1-S1 已确认本次首次正式落地至少包括：

- 当前所有 Confirmed AC；
- 证据新鲜度和 `AC-LV-21` 双环境发布证据；
- 正式安装、升级、卸载、签名、许可与产物分发；
- schema 升级兼容和应用所有缩略图生命周期；
- 视频列表排序、搜索、空状态和生产卡片闭环；
- 学习页基础布局、字幕、右侧面板、快捷键和最小可访问性；
- 现有受控 URL-to-local-media 接口；真实站点兼容与对应 Evidence 明确不进入首发；
- 发布范围内的视觉一致性、性能预算、诊断和文档。

### 4.2 已确认延后到 Core Release 之后

以下能力因风险、Evidence 成本或产品决策密度较高，M1-S1 已确认进入后续版本：

- 云端 ASR 三档完整产品化；
- 英文段落翻译；
- Vision 当前帧解释；
- 高级树编辑、撤销/重做与跳过合并；
- 需要登录态、播放列表或站点专用适配的在线导入；
- 非首发必需的精确动画和高级导图手势。

精确逐行去向以 Active [`release-scope-contract.md`](release-scope-contract.md) 为准。31 条 Launch 已获得 M1-S2 Confirmed AC；实现完成度仍只相信 [`harness-coverage.md`](harness-coverage.md) 的 Partial/Gap 与所需 Evidence。

## 5. 关键路径

```text
M0 控制基线
  -> M1 发布范围冻结
  -> M2 当前证据重放
  -> M3 Release Engineering 与双环境证据
  -> M4 数据/文件生命周期与架构深化
  -> M5 视频列表产品闭环
  -> M6 学习页交互闭环
  -> M9 视觉/可访问性/性能
  -> M10 Release Candidate 总验收
  -> M11 正式发布与上线后闭环

M7 本地模型/ASR Launch 缺口 ------> 在 M9 前完成
M7 云 ASR/语言/翻译扩展 ---------+
M8 Vision 与高级树编辑 ----------+--> 已确认进入 post-release
```

任何里程碑都不能仅以“代码写完”退出。退出条件必须包含定向 Judge、完整门禁、独立审查和状态交接。

## 6. 里程碑总览

| 里程碑 | 目标 | 预计 Slice 数 | 当前状态 | 退出条件 |
| --- | --- | ---: | --- | --- |
| M0 | 控制面与 agent-first 会话协议 | 2 | Complete | Active 计划、控制地图、独立审查规则可发现 |
| M1 | 发布范围冻结与 Release AC | 2–4 | Complete — M1-S1 + M1-S2 confirmed and reviewed | 每个候选簇为 Launch/Post-release/Out-of-scope，发布 AC Confirmed |
| M2 | 当前目标提交证据重放 | 1–3 | Complete — M2-S1 + M2-S2 | Hosted desktop Judge 对精确目标 SHA 通过或确定 RED 已关闭 |
| M3 | 安装、GPU/CPU、签名、许可与分发 | 6–10 | In progress — M3-S1 complete; M3-S2 next | 双环境安装证据、生命周期、签名和许可全部完成 |
| M4 | 数据、派生文件、schema 与架构边界 | 5–8 | Partial | 升级兼容、缩略图生命周期、risk 22 和架构政策完成 |
| M5 | 视频列表与导入任务产品闭环 | 6–9 | Partial | 排序/搜索/空状态/卡片/删除交互达到 Strong + 必要桌面证据；受控 URL 接口不被误写为真实站点承诺 |
| M6 | 学习页基础产品闭环 | 5–9 | Partial | 布局、目录、字幕、右侧面板、快捷键和会话稳定性完成 |
| M7 | 模型、ASR、语言与翻译 | 4–10 | Split — local core Launch; cloud/translation Post-release | Launch 的本地模型/ASR 均有独立 capability/Evidence；扩展不泄漏进首发 |
| M8 | 助手 Vision 与高级树编辑 | 7–15 | Post-release; existing text assistant remains Launch | 首发只保留现有 Confirmed 文本助手；Vision 与高级树编辑留在后续队列 |
| M9 | 视觉、可访问性、性能与可靠性 | 6–10 | Proposed | 视觉基准、键盘/读屏、性能预算和真实长运行通过 |
| M10 | Release Candidate 总验收 | 4–8 | Blocked by prior milestones | 精确 RC 全门禁、全 Evidence、无阻断审查发现 |
| M11 | 正式发布与上线后闭环 | 3–6 | Blocked by RC | 已签名发布、下载验证、回滚和首轮生产验证完成 |

预计 Slice 数是计划粒度，不是工期承诺。每个会话默认只完成一个 Slice。

### 6.1 工作包与 Slice 的编号语义

本文的 `M#-S#` 标题是**交付工作包**，用于表达依赖、范围和退出条件；它们不是可以直接交给 builder 的 Slice Contract。表中的“预计 Slice 数”是这些工作包预计拆出的原子执行单元。

任何工作包开始前，必须使用第 21 节模板拆成一个或多个 Slice。每个 Slice 只允许一个 Confirmed AC 或一个独立可裁判的 Evidence/治理缺口，并分别写明 Owner、Judge、Evidence tier、Out-of-scope、允许写入范围和独立 reviewer。工作包不得被直接标为“实现完成”，也不得用一个 GREEN 合并宣称多个不同 Judge 已通过。下文列出多个行为、环境或决策的工作包，执行时均逐条拆分；标题中的 `S` 仅为既有计划编号，不改变这一约束。

## 7. M0 — 控制基线

状态：`Complete`。

已经具备：

- 控制地图、领域语言、PROJECT_STATE、AC、覆盖矩阵和模块地图；
- 99 条历史产品决策的机械完整性；
- `harness:control`、`harness:check`、双构建隔离和干净 Windows CI；
- Active agent-first 会话协议；
- 每个已实现 Slice 后的独立只读 AI Spec + Standards 审查门。

剩余可选 Harness Slice：提出 `AC-HE-07`，把 review record 的必需字段、目标 SHA、AC、verdict 和发现关闭方式机械化。只有当人工流程出现遗漏时才实施，不为了流程美观提前增加门禁。

## 8. M1 — 发布范围冻结

### M1-S1 建立 Release Scope Contract

- **状态**：`Complete`。用户已确认 [`release-scope-contract.md`](release-scope-contract.md) 的 31 Launch / 23 Post-release / 0 新增 Out-of-scope，以及现有 4 条 Out-of-scope 不变。
- **产品决定**：本次发布是 Core Release；不承诺云端 ASR、翻译、Vision、高级树编辑或真实站点兼容。公开分发只有一个 GPU 增强通用安装包，但同一包必须保留 CPU-safe 主程序、CPU adapter 和无 NVIDIA 环境的可见回退。
- **输出**：Active 发布范围表把当时每个 Proposed 决策标记 Launch 或 Post-release；随后 M1-S2 只把 31 条 Launch 升为 Confirmed AC，仍不代表实现完成。
- **Owner**：Active `release-scope-contract.md` 拥有已确认的发布去向；M1-S2 release acceptance 接管正式行为语义；`product-decision-coverage.md` 继续只记录当前 disposition。
- **Judge**：54 条 Proposed 路由恰好为 31 Launch / 23 Post-release 且无重复或遗漏，既有 4 条 Out-of-scope 不变；用户确认和独立只读审查均已记录。
- **范围外**：本 Slice 不写实现。

### M1-S2 确认 Release AC

- **状态**：`Complete — user confirmed; formal control migration passed independent Spec + Standards review`。
- **输出**：[`release-acceptance-contract.md`](release-acceptance-contract.md) 提出 50 条原子 AC 及逐项 Evidence tier，逐行覆盖 31 条 Launch decision、risk 22a/22b 和 M1-S1 的 13 类发布缺口。
- **首发细节建议**：`Rain 0.1.0`、Windows x64、GitHub Releases、单一 NSIS `.exe`；默认卸载保留用户数据/模型并永不删除源视频；首次正式发布从冻结的 `c2eb4c4` 预发布 fixture 升级。
- **确认记录**：用户于 2026-08-02 整体确认；50 条 AC 已迁入 `acceptance-standard.md`/`harness-coverage.md`，31 条 Launch disposition 已更新。
- **迁移边界**：本 Slice 只更新正式控制面并接受独立审查，未同时写产品代码或运行 Evidence。

### M1 退出条件

- 用户已经确认 Release Scope 与 Release AC。
- 每条 Launch 行为能定位到现有或新 Confirmed AC。
- Post-release 行为保持 Proposed，不被实现代码静默带入。
- 独立 reviewer 确认范围完整且没有产品语义冲突。

## 9. M2 — 当前证据重放

### M2-S1 Hosted Runtime Settings replay

状态：`Complete` — run `30756311932` 对精确 `master` commit `a329059b8172dab82c7326deb0af322045a0c396` GREEN，且日志证明公开命令无 `-SkipBuild`、无 Rain secrets、真实 schema、add/restart/delete/restart 与 pending recovery。

- 执行时解析 `origin/master` 和 GitHub `master` 的完整 SHA并确认一致。
- 通过可调度 `master` ref 运行现有 workflow_dispatch。
- 核对 run `headSha`、无 `-SkipBuild`、无 secrets、真实 schema 和三进程重启行为。
- 失败只修一个真实 RED，不放宽产品断言。

### M2-S2 当前 canonical Evidence 审计

状态：`Complete` — audit recorded in `docs/development/canonical-evidence-freshness-2026-08-02.md`; independent Spec/Standards review passed, the current package is historical 408b6db-era Evidence, and exact-RC full rerun remains mandatory.

- 检查 schema v2 Evidence 的目标提交、配置指纹和当前代码差异。
- 逐条标记哪些结论仍可引用、哪些只属历史、哪些 RC 前必须重跑。
- 不运行收费模型；本 Slice 只做 Evidence freshness 判定。

### M2 退出条件

- Hosted desktop Judge 在执行时目标提交上 GREEN。
- RC 前必须重跑的真实 Evidence 清单明确。
- reviewer 独立核对目标 SHA、日志、诊断与证据边界。

## 10. M3 — Release Engineering 与双环境证据

### M3-S1 Release artifact contract

状态：`Complete` — 合同记录在 [`release-artifact-contract.md`](release-artifact-contract.md)，并通过独立 Spec + Standards review。本 Slice 只确认产物合同，不生成安装器、不跑 GPU/CPU Evidence、不签发许可或发布物。

- 定义 CPU-safe 主程序、GPU worker、CUDA runtime、模型文件和配置文件的精确安装位置。
- 定义版本、协议、SHA-256 manifest、文件权限和禁止打包的驱动 DLL。
- Judge 检查通用安装包中的 Rain 主程序无 CUDA 装载依赖，CUDA 只经资源 worker 获得；普通内部/Harness 构建继续完全不含 CUDA 资源。

### M3-S2 无 NVIDIA/CUDA 干净 Windows Evidence

- 从正式候选安装包安装，而不是从开发树运行。
- 证明应用启动、Runtime Settings 可用、Auto 显示回退原因、CPU 短样本输出非空且时间单调。
- 记录 OS、安装包哈希、目标提交、模型哈希、backend/device 和运行日志。

### M3-S3 NVIDIA Windows Evidence

- 安装与无 NVIDIA 环境相同的正式 GPU 增强通用候选包。
- 证明 Auto 使用 CUDA、Forced CUDA 成功、Forced CPU 不启动 worker。
- 验证取消、worker 崩溃分类、可见回退与模型错误不跨后端重跑。

### M3-S4 安装/升级/卸载生命周期工作包（执行前拆分）

- 干净安装；同版本重装；旧版到新版升级；卸载；再次安装。
- 明确应用数据、SQLite、模型、Evidence 和日志哪些保留、哪些删除。
- 安装失败和升级失败不得留下无法启动的半状态。
- 干净安装、同版本重装、版本升级、卸载和卸载后重装分别形成 Slice Contract；不能由一次安装成功替代整套生命周期 Judge。

### M3-S5 签名、供应链和许可工作包（执行前拆分）

- 决定 Windows 代码签名证书和私钥治理。
- 生成依赖清单/SBOM、第三方 notices 和 CUDA runtime 许可评审记录。
- 验证发布产物不含 live key、调试 override、开发路径、SQLite 或用户数据。

最低拆分如下；每一行在执行前仍须绑定 Confirmed AC 或独立治理缺口并填写第 21 节合同：

| Slice 候选 | 单一结果 | Owner | Judge / Evidence |
| --- | --- | --- | --- |
| M3-S5a | 代码签名证书与私钥治理 | 人类 release owner | 密钥不进入仓库/日志/构建 artifact；由目标候选包的签名验证记录裁判 |
| M3-S5b | 依赖清单、SBOM 与第三方 notices | 构建/发布脚本 Owner | 从精确 RC 生成的机器可读清单与 notices 完整性检查 |
| M3-S5c | CUDA runtime 再分发许可评审 | 人类 release/legal owner | 签署的许可评审记录；AI 和构建 GREEN 均不得自我批准 |
| M3-S5d | 发布 artifact 卫生扫描 | release checker Owner | 对 live key、调试 override、开发路径、SQLite、用户数据和意外 DLL 的自动扫描报告 |

### M3-S6 单一 GPU 增强通用安装包 UX

- 公开渠道只提供一个安装包，不再提供独立公开 CPU 安装包；同一包包含 CPU-safe Rain 主程序、CPU adapter 和隔离 CUDA worker/runtime。
- 发布页与安装器必须显示约 804 MB 大小、硬件要求、无兼容 NVIDIA 环境的 Auto 可见回退、Forced CPU/GPU、失败与重试。
- 普通 CPU-safe/Harness 构建继续作为 CI 与内部 release-evidence 产物，不得被误写成第二个公开安装包。
- 该产品边界已由 `AC-RL-02/07/08/18` 确认；构建脚本或现有 overlay 仍不能自我证明实现与 Release Evidence。

### M3 退出条件

- 同一 RC 候选在无 GPU 和 NVIDIA 环境都有正式安装证据。
- 安装/升级/卸载、签名、许可、哈希和分发 UX 均有 Confirmed AC 与 Judge。
- 无 P0/P1/P2 当前范围发现；所有 reviewer 结论持久化。

## 11. M4 — 数据、文件生命周期与架构深化

### M4-S1 schema upgrade compatibility

- 定义从当前最早受支持 schema 到新版本的迁移策略。
- 使用真实旧数据库 fixture，通过生产初始化/升级路径检查表、列、数据和约束。
- 任一步失败必须回滚或保留可恢复备份；不能只检查全新数据库。

### M4-S2 已知缩略图删除

- 先确认数据库删除成功但文件删除失败时的产品语义。
- Rust 深模块只接受 app-data 根和合法 Video ID，不接受任意用户路径。
- 真实文件系统 Judge 覆盖成功、缺失文件、拒绝访问、路径穿越和数据库失败补偿。

### M4-S3 孤儿缩略图 GC

- SQLite/公共接口生成 keep-set；Rust 只扫描受控 thumbnails 目录。
- 定义何时运行、删除上限、失败诊断和幂等重试。
- GC 不得删除用户源视频、模型或其他应用文件。

### M4-S4 App-scope import Owner

- 把 Controller 生命周期从隐藏挂载的 VideoListPage 提升到显式 App Owner。
- 页面真正卸载/重挂后，后台导入、取消、single-flight 和同记录更新仍成立。
- 保持 `AC-LV-19/20` 用户行为不变。

### M4-S5 discriminated progress contract

- 定义 download/asr/stage2/merging/terminal 的判别式 payload。
- producer、Pipeline、Controller、UI 和 Tauri event 使用同一合法状态集合。
- mutation Judge 必须让非法字段组合、倒退百分比和终态后更新失败。

### M4-S6 已确认架构政策的实现

- `DEC-PRD-092` / `AC-AR-02`：落实 LLM 请求的前端 OpenAI-compatible ownership。
- `DEC-PRD-096` / `AC-AR-03`：落实本地媒体/缩略图 asset protocol 边界。
- `DEC-PRD-099` / `AC-AR-04`：落实 Zustand 只缓存会话态，SQLite 保存持久事实。
- 对高复发违规增加负向 policy；不新增通用 DAL 或浅转发模块。

### M4 退出条件

- 旧数据库升级、缩略图生命周期和 import Owner 都有真实行为 Judge。
- 三条架构决策达到各自 Confirmed AC 的 Strong/Evidence 要求。
- risk 22 关闭，模块地图和 coverage 同步。

## 12. M5 — 视频列表与导入任务产品闭环

### M5-S1 查询与排序语义

- 实现 `AC-VL-02` 已确认的默认排序和最近学习、导入时间、名称三档规则。
- 标题搜索大小写、空值、清空和排序组合在 SQLite/内存 adapter 中一致。
- 不加入标签、正文搜索或未确认筛选。

### M5-S2 生产列表 UI

- 顶栏、导入入口、排序选择、搜索框、加载/错误/空状态完整。
- 非 ready 卡仍只打开任务详情；ready 卡只在完整加载成功后进入学习页。
- 页面与数据库/Controller 通过现有业务 interface 协作。

### M5-S3 卡片信息与网格

- ready/non-ready 字段、缩略图、状态、进度、错误和动作层级有明确 AC。
- 响应式网格、16:9 缩略图和最小宽度进入视觉 Judge，而不是只读 CSS 常量。

### M5-S4 删除端到端

- 数据库、活动任务结算、应用缩略图清理和源视频保留形成一个用户可理解结果。
- 必要时增加真实桌面删除 Judge；jsdom 不冒充桌面/文件 Evidence。

### M5-S5 长列表可靠性

- 大量 Video 的加载、搜索、排序、卡片更新和后台 progress 有性能预算。
- 避免 progress 造成全列表无界重渲染；失败诊断可定位。

### M5-S6 Post-release 真实站点 URL Evidence 工作包

- M1-S1 已确认真实站点兼容不进入 Core Release；Core Release 不执行本工作包，只在 Release Notes 说明受控 URL 接口不等于真实站点保证。
- 若后续版本由用户把具体站点提升为 Launch，则第一 Slice 只能支持公开、无需登录的单视频 HTTP(S) URL。登录态、播放列表、字幕优先、站点专用适配和永久兼容承诺必须分别决策，不得从现有 `yt-dlp` 调用静默推导。
- **Owner**：现有 `VideoImportController.importUrl`、Rust `ytdlp` 边界，以及专用 release-evidence runner/manifest；不得建立第二套 Video 或下载状态源。
- **Judge**：在用户批准的真实网络站点上，验证下载前已有可追踪记录、进度可见、取消/失败可重试、完成后交给 app-owned 本地路径和既有导入流水线，并按 M1 选择验证最终可播放或完整导入结果。
- **Evidence**：绑定精确目标 SHA、`yt-dlp` 版本、站点/域名、运行时间、下载文件 SHA-256、app-owned 路径、状态/事件/脱敏日志和秘密扫描。该证据只证明记录日期和站点上的兼容性，不构成永久站点保证。
- **Out-of-scope**：账号、Cookie、付费/受限内容、DRM 绕过、批量播放列表和未确认站点。凭据、源 URL 查询参数和用户媒体不得进入 artifact。
- 当前 Release Notes 必须明确：受控 URL 接口存在不等于承诺任何真实站点兼容性。

### M5 退出条件

- `DEC-PRD-057/058/059/060/062/077` 的发布范围全部由 Confirmed AC 控制。
- 生产页面 + 双 adapter + 文件/桌面边界的 Judge 达到相应等级。
- 独立 reviewer 和必要 visual reviewer 通过。
- Core Release 的 Release Notes 已记录不承诺站点兼容性；M5-S6 不阻断本次发布。

## 13. M6 — 学习页基础产品闭环

### M6-S1 顶部目录行为

- 确认双行层级、横向滚动、自动居中、暂停取消跟随、渐隐和约 200 ms 动效。
- 当前播放事实继续只来自 `playPosition`，不能出现第二份时间状态。

### M6-S2 右侧面板与布局记忆

- AI/随记 Tab、面板可见性、可调比例和跨会话记忆有单一 Owner。
- 三模式切换继续保留同一 media、选中、笔记和助手会话。

### M6-S3 字幕与译文控制

- Core Release 只提供原文字幕独立开关；翻译与译文开关已确认 Post-release，首发不得显示空按钮或暗示可用。
- 若未来通过显式 scope amendment 引入翻译，原文字幕和文本译文必须使用两个独立开关。
- 字幕来源、句子边界、显示时机和关闭行为通过真实 media Judge。

### M6-S4 导图交互

- Core Release 只验收基础节点/连线、缩放、平移、选择和已有导航边界。
- 节点折叠与 scrub 已确认 Post-release，首发不得展示依赖它们的空手势或控件。
- 导图继续不承担未确认的 reparent/多选编辑。

### M6-S5 快捷键与焦点门禁

- 模式、播放、跳段、摘注、删除和面板快捷键逐条确认。
- 输入框、文本编辑、对话输入获得焦点时，危险快捷键不得触发。
- selection origin 与鼠标/键盘行为一致。

### M6 退出条件

- `DEC-PRD-011/012/013/022/023/053/078/079/081` 的 Launch 行为获得 Confirmed AC；`DEC-PRD-050/051/091` 保持 Post-release 且不泄漏进首发。
- Launch 行为有生产 StudyInterface Judge、真实 media 行为和必要视觉复核。

## 14. M7 — 模型、ASR、语言与翻译

### M7-S1 本地 ASR 发布缺口与 Post-release 云 ASR 队列

- Core Release 只支持本地 Whisper；完成现有本地 ASR 的 `AC-LV-21` 双环境 Release Evidence 和对应 Release AC。
- 云端短/长音频档已确认 Post-release，不得进入首发 UI、配置承诺或 RC Evidence。
- 若未来通过显式 scope amendment 提升云端档，每档都必须归一为 Sentence、句级时间戳、取消和失败分类；云端长音频需要真实供应商 Evidence，连接成功不算能力完成。

### M7-S2 语言检测合同

- `DEC-PRD-085` 已确认 Post-release，本工作包不阻断 Core Release。
- 决定自动检测、用户是否可覆盖、检测失败和混合语言策略。
- 语言结果与句子作为一个原子 ASR 结果保存。

### M7-S3 翻译生成与持久化

- `DEC-PRD-033` 已确认 Post-release，本工作包不阻断 Core Release。
- 英文原文不可改写；翻译按段落生成并单独存储。
- 翻译失败不得破坏 ready 原文或阻止不依赖翻译的学习。
- 配置变化、取消、重试和成本提示有明确定义。

### M7-S4 翻译 UI

- `DEC-PRD-086` 已确认 Post-release，本工作包不阻断 Core Release。
- 原文与中文译文展示、独立开关、重开恢复和助手上下文边界完整。
- 句子高亮继续作用于原文时间线，不能假造译文句级时间。

### M7 退出条件

- Core Release 的本地 Whisper/模型角色各有自己的 capability 和完整 Evidence，不继承旧配置 Verified。
- `DEC-PRD-032/033/085/086` 保持已确认的 Post-release 路由，除非用户以后显式修订 Release Scope。

## 15. M8 — 助手 Vision 与高级树编辑

本里程碑的 Proposed 扩展已确认 Post-release，不阻断 Core Release。现有 Confirmed 文本助手能力仍属于 Launch 基线；Vision 与高级树编辑只有在用户以后显式修订 Release Scope 后，才可能成为未来版本的发布门禁。

### M8-A 助手与 Vision

1. 类型化快捷操作、通用操作、保存回答和自由对话分别定义可观察结果。
2. Vision capability 必须独立于文本助手能力签发。
3. 当前帧由真实 media 在明确时间捕获；用户可确认/重选，隐私和图片大小可见。
4. 图像请求、取消、失败、迟到响应和引用边界通过真实模型 Evidence。
5. 对话气泡、快捷芯片、多行输入和当前帧提示经过生产 UI/视觉 Judge。

覆盖候选：`DEC-PRD-006/010/080`。

### M8-B 高级树编辑

按以下严格顺序实现，每项一个独立 Slice：

1. 纯领域不变量：不限深度、时间顺序、内容不丢、稳定句子 ID。
2. Rust/SQLite 原子编辑事务与旧树回滚。
3. 连续句子提取为兄弟段落。
4. 同父同级相邻节点合并并选择存活者。
5. reparent 时间门禁。
6. 删除节点的内容迁移、首个非空节点保护和空容器规则。
7. 左树/文本区编辑 UI；顶部目录只导航。
8. 导图自动同步且不获得编辑所有权。
9. 会话内撤销/重做栈、约 20 步上限和不跨重启边界。
10. 合并失败后只重试合并或显式采用分块树的产品决策。

覆盖候选：`DEC-PRD-004/015/035/039/042/043/044/045/046/052/083/088/090`。

### M8 退出条件

- 没有恢复 Harness-only `tree-ops` 或无 UI/持久化的假实现。
- 每个编辑操作通过生产 UI、领域不变量、真实 SQLite 成功/回滚和撤销 Judge。
- Vision 使用真实图像能力 Evidence；文本模型结果不能签发。

## 16. M9 — 视觉、可访问性、性能与可靠性

### M9-S1 视觉合同冻结

- 暗色主题、中性色阶、无品牌强调色、类型色、状态色、选中/播放叠加、字体、字号、行距、间距、圆角、阴影和关键高度逐项确认。
- CSS token 只作为实现事实；生产截图和真实交互才是视觉 Judge。

覆盖候选：`DEC-PRD-063/064/065/066/067/068/069/070/071/073/074/075/076`。

### M9-S2 可访问性

- 键盘可达、焦点可见、对话框焦点陷阱、语义角色、错误朗读、颜色对比和减少动效。
- 视频、进度、任务详情、设置和学习区不只依赖颜色表达状态。

### M9-S3 响应式和视觉回归

- 至少覆盖目标最小窗口、标准 1280×800 和高 DPI。
- 关键页面生成可复放截图/DOM 状态，由独立 visual reviewer 对照 Active 视觉合同。

### M9-S4 性能预算

- 应用冷启动、列表加载、ready 视频打开、搜索排序、长转录渲染和导入 progress 设预算。
- CPU/GPU ASR 性能只在可比环境记录，不把本机数值当跨设备保证。
- 长运行检查内存增长、listener 泄漏、子进程残留和 SQLite WAL 行为。

### M9-S5 可靠性与诊断

- 每个桌面/外部 Judge定义失败目录、脱敏规则、保留上限和成功清理。
- 诊断不得保存 Key、用户 SQLite、源视频或无界日志。

### M9 退出条件

- Core Release 页面通过视觉、键盘、焦点、对比度、减少动效和性能 Judge。
- 所有视觉 Proposed 决策均有 Launch/Post-release 去向。
- visual reviewer 与综合 reviewer 均通过。

## 17. M10 — Release Candidate 总验收

### M10-S1 RC freeze

- 建立 release branch/tag candidate；记录完整 SHA。
- 冻结产品行为，只允许阻断修复、证据和发布文档变更。
- 每个修复重新运行对应 Judge 和 independent review。

### M10-S2 全部门禁

必须在精确 RC 上通过：

```powershell
npm ci
npm run harness:check
npm run e2e:runtime-settings
$rcEvidenceManifest = 'evidence\2026-08-02-rc\manifest.json'
npm run validate:evidence -- -EvidenceManifest $rcEvidenceManifest
```

并通过独立 `Clean Windows Harness` 和目标提交 Hosted Desktop run。live-key/真实视频命令按 AC 使用隔离环境执行，不能把 secrets 写入命令历史、日志或 artifact。

### M10-S3 canonical real E2E

- 使用确认的真实视频、Whisper backend、结构化模型和文本助手配置。
- 经过生产 `VideoImportController`、SQLite、学习页、取消、重试、重启和 WebDriver DOM/截图。
- 生成新的 RC evidence ID、manifest、哈希、配置指纹和秘密扫描结果。

### M10-S4 安装矩阵

| 环境 | 必须证明 |
| --- | --- |
| 干净 Windows、无 NVIDIA/CUDA | 安装同一个 GPU 增强通用候选包、启动、Auto 可见回退、CPU 短样本、卸载 |
| 支持 NVIDIA Windows | 安装同一个 GPU 增强通用候选包、CUDA probe、GPU 短样本、Forced CPU/GPU、卸载 |
| 旧版升级环境 | schema/设置/视频/笔记/模型保留，失败可回滚 |
| 重装环境 | 数据保留策略和安装器幂等 |

### M10-S5 安全与发布审查

- tracked tree、Git 历史候选差异、产物和 source map 秘密扫描；
- 依赖漏洞、许可证、SBOM、签名和哈希；
- Tauri capability、asset protocol、URL、路径和外部进程边界；
- 发布说明与已知限制和真实证据一致。

### M10-S6 独立最终审查

至少进行：

1. Spec/AC reviewer；
2. Standards/security reviewer；
3. visual reviewer；
4. release evidence reviewer。

这些 reviewer 都不得参与被审查实现。任何 Launch AC 缺 Judge、证据过期、P0/P1 或影响当前范围的 P2 都阻断 RC。

### M10 退出条件

- 精确 RC 所有门禁、Evidence、安装矩阵和审查 PASS。
- 没有未解释 skip/ignore；现有显式 live-key skip 和真实模型 ignore 的发布结论已由相应 Evidence 补上。
- 版本、签名、哈希、release notes 和回滚方案就绪。

## 18. M11 — 正式发布与上线后闭环

### M11-S1 发布

- 从已验收 RC 创建正式 tag，不重建不同来源的未知二进制。
- 上传签名安装包、SHA-256、第三方 notices、SBOM 和 release notes。
- 发布页明确只有一个 GPU 增强通用安装包，并说明其中的 CPU/GPU 行为、硬件要求、Auto 回退、模型下载大小和已验证配置。

### M11-S2 下载后独立验证

- 从用户可见下载地址重新下载正式产物。
- 核对签名与哈希，在干净机再次安装启动。
- 证明公开文件与 RC 审查文件完全一致。

### M11-S3 生产观察

- 首轮真实用户/目标机器检查安装、首次启动、模型下载、导入、学习和卸载。
- 只收集用户授权的脱敏诊断；默认不上传视频、转录、Key 或 SQLite。
- 缺陷按 P0/P1/P2 分类并绑定对应 AC/Judge。

### M11-S4 热修复与回滚

- P0：停止分发、发布已知问题和安全回滚指引。
- P1：创建单一修复 Slice，重跑相关 Evidence 和完整 RC 门禁。
- P2：进入计划队列，不绕过独立 review 或降低 AC。

### M11 退出条件

- 正式下载产物独立验证通过。
- 没有首轮阻断缺陷，或阻断缺陷已经修复并重新发布。
- PROJECT_STATE 记录正式版本、tag、产物哈希、证据、已知限制和下一版本候选。

## 19. M1 起始 54 条决策的完整路由

下表确保 M1 起始的 54 条 Proposed 决策都进入明确里程碑。M1-S2 已把其中 31 条 Launch 行迁为 Confirmed AC；23 条 Post-release 继续 Proposed。

| 工作簇 | M1 起始 decision | 目标里程碑 | 当前去向 |
| --- | --- | --- | --- |
| 高级树编辑与恢复 | 004, 015, 035, 039, 042, 043, 044, 045, 046, 052, 083, 088, 090 | M8 | 全部 Post-release |
| 助手与 Vision | 006, 010, 080 | M8 | Proposed 扩展全部 Post-release；现有 Confirmed 文本助手仍在 Launch 基线 |
| 目录、布局、字幕、快捷键 | 011, 012, 013, 022, 023, 050, 051, 053, 078, 079, 081, 091 | M6 | 011/012/013/022/023/053/078/079/081 Launch；050/051/091 Post-release |
| 云端 ASR、语言与翻译 | 032, 033, 085, 086 | M7 | 全部 Post-release；本地 ASR 由现有 Confirmed AC 保持 Launch |
| 视频列表与派生文件 | 057, 058, 059, 060, 062, 077 | M4/M5 | 全部 Launch |
| 视觉系统 | 063, 064, 065, 066, 067, 068, 069, 070, 071, 073, 074, 075, 076 | M9 | 全部 Launch |
| 架构边界 | 092, 096, 099 | M4 | 全部 Launch；分别由 `AC-AR-02/03/04` Confirmed |

总数检查：13 + 3 + 12 + 4 + 6 + 13 + 3 = 54。

## 20. 跨里程碑工程规则

### 20.1 分支和提交

- 每个实现 Slice 使用 `codex/<ac-or-gap>-<short-name>` 分支。
- 一个 Slice 默认一个产品提交；文档 handoff 可单独提交。
- 不直接在受保护 `master` 上开发或推送。
- PR 必须引用 AC、Owner、Judge、Evidence 和 independent review verdict。

### 20.2 测试成本分层

| 层级 | 何时运行 |
| --- | --- |
| `harness:control` + 定向 Judge | 每个 Slice 反复运行 |
| TypeScript/file-scoped Rust format | 修改对应语言时 |
| `harness:check` | 每个代码交付 Slice |
| Hosted desktop | 桌面/跨进程边界或 Evidence freshness 要求时 |
| 双环境安装 | release/Whisper backend/安装器变更时 |
| live model / real video / external site | AC 明确需要且用户授权成本与外部状态时 |

### 20.3 独立审查

- builder 不得担任 reviewer。
- reviewer 默认只读、全新上下文、先 Spec 后 Standards。
- visual change 增加 visual reviewer；release 增加 evidence reviewer。
- 发现必须进入 RED、policy、coverage 或 PROJECT_STATE，不能只留在聊天。

### 20.4 状态维护

- 每个 Slice 开始前重跑 takeover。
- 每个 Slice 完成后更新 coverage 与 PROJECT_STATE。
- 当前里程碑、已完成 Slice、阻断项和下一唯一动作必须可由仓库恢复。
- 旧计划和旧 Evidence 只保留历史价值，不证明当前完成。

## 21. 每个 Slice 的落地模板

```text
Slice:
AC / Proposed AC:
User-visible result:
In scope:
Out of scope:
Owner:
Judge:
Evidence tier:
Allowed writes:
Locked files:

RED or baseline:
Implementation:
Targeted verification:
Full verification:
Independent review:
Findings and closure:
Unverified boundaries:
Branch / commit / PR:
Next single action:
```

缺少任一关键字段时，不开始实现。

## 22. 阻断和决策处理

- **产品语义未确认**：停在 Proposed，向用户列选项和影响。
- **两份 Active 文档冲突**：停止相关实现，不能自行选一份。
- **锁定 Harness 与新行为冲突**：申请 Harness Migration；先替代 Judge，后退役旧断言。
- **真实 E2E 失败、单元测试通过**：功能未完成，补真实 RED。
- **外部环境不可用**：保留 Gap，不用 mock 提升 Evidence。
- **secret/数据泄漏风险**：立即停止发布路径，先隔离和审计。
- **安装/升级可能破坏用户数据**：阻断 Release Candidate。

## 23. 当前推荐执行顺序

在本计划获得独立审查并提交后，后续会话严格按以下顺序开始：

1. M1-S1：`Complete` — 用户已确认 Core Release 范围、post-release 能力簇和单一 GPU 增强通用安装包边界。
2. M1-S2：`Complete` — 用户已确认 50 条 AC，正式 acceptance/coverage/disposition 已迁移并通过独立 Spec + Standards 双轴审查。
3. M2-S1：`Complete` — workflow_dispatch run `30756311932` 已对精确 `master` commit `a329059b8172dab82c7326deb0af322045a0c396` 重放通过。
4. M2-S2：`Complete` — schema v2 包保留为 408b6db-era 历史 Evidence；独立 Spec/Standards gate 已通过。
5. M3-S1：`Complete` — [`release-artifact-contract.md`](release-artifact-contract.md) 已定义正式产物合同，并通过独立 Spec + Standards review。
6. M3-S2：`In progress` — 当前 Slice 建立无 NVIDIA/CUDA CPU Evidence runner；真实干净 Windows 运行和 Evidence 审查仍是下一原子动作。

完成上述六个工作包所需的原子 Slice 前，不并行启动翻译、Vision 或高级树编辑。M3 之后依赖图允许 M4 和经确认的产品工作流并行，但每个独立 worktree 仍只承载一个可验证 Slice，并在合并前重新基于最新主线运行 Harness 与独立审查。
