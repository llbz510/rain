# Rain 项目控制地图

> 状态：Active
> 更新日期：2026-07-29
> 作用：告诉人和 AI 在不同问题上应该相信哪份资料，以及资料冲突时如何处理。

## 1. 事实源不是一个文件

Rain 的资料按“回答什么问题”分工。不要用一份文件回答所有问题。

| 问题 | 当前事实源 | 说明 |
| --- | --- | --- |
| 进入项目后必须遵守什么 | `AGENTS.md` | 环境、命令、Harness 限制和会话规则 |
| 项目中的核心词语是什么意思 | `CONTEXT.md` | 统一领域语言；不能单独证明实现已完成 |
| 当前项目已经验证到哪里 | `docs/PROJECT_STATE.md` | 当前状态、最近验证和已知风险 |
| 跨会话开发切片按什么流程和优先级执行 | `docs/development/agent-first-development-plan.md` | Active 会话/交付协议与候选队列；不新增产品语义，Proposed 切片仍需用户确认 |
| 从当前状态到正式发布按什么里程碑推进 | `docs/development/rain-project-delivery-plan.md` | Active 项目交付路线、Release 完成定义、全部 Proposed 决策路由和 RC/上线门禁；不自动授权新行为 |
| 用户希望产品做什么 | 根目录 `PRD.md` 和对应 `M*.md` | 已确认产品意图；不自动代表代码已经实现 |
| 99 条历史产品决策当前由什么控制 | `docs/development/product-decision-coverage.md` | 每条决策映射到 Confirmed AC、Proposed 或当前范围外；不是完成百分比 |
| 本地视频主链路当前按什么设计 | `docs/superpowers/specs/2026-07-17-rain-real-local-video-repair-design.md` | 已实施修复的设计依据；与更晚的事实冲突时需要重新确认 |
| 什么结果才算完成 | `docs/development/acceptance-standard.md` | 当前生效的验收条件 |
| 每条验收条件由什么证明 | `docs/development/harness-coverage.md` | AC、测试、真实证据和缺口的映射 |
| 控制文档是否自洽 | `npm run harness:control` | Confirmed AC、Owner、Judge、覆盖行、99 条产品决策去向、裁判文件和当前事实冲突的机械裁判 |
| Runtime Settings 是否真实跨桌面重启持久化 | `npm run e2e:runtime-settings` | 真实 Tauri、生产设置 UI、SQL plugin 和隔离 SQLite 的短 Judge；不证明模型能力或完整视频流程 |
| 真实 SQLite 是否具备当前必需表/列 | `npm run e2e:runtime-settings` | 应用经公共数据库 metadata interface 报告实际形状，脚本按独立字面合同裁判；不证明 schema 升级兼容或其他业务 CRUD |
| 普通生产构建是否排除了 E2E 自动化 | `npm run build` | 构建完成后扫描真实 `dist`，拒绝自动化标记 |
| 显式 E2E 前端构建是否装载了自动化 | `npm run build:e2e` | 不启动 Tauri、不使用 Key；扫描真实 `dist` 并反向要求全部自动化标记存在 |
| 完整门禁是否同时裁判两种构建 | `npm run harness:check` | 先构建 E2E 产物，再构建普通产物；成功后 `dist` 恢复为普通可发布前端产物 |
| 合并候选是否在独立干净环境通过默认门禁 | GitHub Actions workflow `Harness` / check `Clean Windows Harness` | `windows-2025` 干净 checkout 执行 `npm ci` 和 `npm run harness:check`；不替代 live-key、桌面 E2E 或 Evidence 决策 |
| Runtime Settings 桌面 Judge 是否能在独立干净环境重放 | GitHub Actions workflow `Runtime Settings Desktop E2E` | 仅 workflow_dispatch；目标提交上的真实 hosted run 执行 `npm run e2e:runtime-settings` 才能签发，不属于默认合并门禁 |
| Runtime Settings 桌面 Judge 失败在哪里诊断 | 系统临时目录 `rain-runtime-settings-e2e-latest-failure/summary.json` | 单份脱敏失败阶段、主错误和 driver logs；正常成功会清除 stale 诊断 |
| 哪个模块负责什么 | `docs/development/module-map.md` | 模块接口、依赖方向和迁移中的违规点 |
| 某一次真实运行发生了什么 | 对应 `evidence/rain-real-e2e-*/manifest.json` 及其证据包 | 只证明该次运行，不自动证明当前代码 |

## 2. 文档状态

以后新增或修改设计文档，标题附近必须标记以下状态之一：

- `Proposed`：提议，尚未批准，不能指导实现。
- `Active`：当前有效，可指导实现。
- `Superseded`：已被新文档替代，只保留历史。
- `Historical`：记录过去过程，不能用于判断当前进度。

当前规则：

- `docs/superpowers/plans/` 全部是 `Historical`。
- `HANDOFF.md` 是 `Historical`，其中的决策必须回到当前 PRD/spec 核对。
- 根目录 `PRD.md` 和 `M*.md` 是产品意图来源，但实现状态必须由 AC、测试和证据判断。
- `docs/PROJECT_STATE.md` 是状态日志，不负责定义产品验收标准。

## 3. 冲突处理

发现冲突时，不允许 AI 自行选择一份资料然后继续开发。

| 冲突 | 正确处理 |
| --- | --- |
| PRD/spec 要求某行为，但测试没有覆盖 | 记录为 Harness 缺口；不能宣称该行为已完成 |
| 测试通过，但真实 E2E 失败 | 功能未完成；测试覆盖不足 |
| 当前代码行为与 Active AC 不同 | 记录为产品缺陷，除非用户明确修改 AC |
| 两份 Active 产品文档互相冲突 | 停止相关实现，列出差异，请用户决定 |
| 历史文档与当前文档冲突 | 以 Active 文档为准，并考虑给历史文档补状态标记 |
| 一次成功证据与当前代码版本不同 | 证据仍可保留，但不能作为当前版本完成证明 |

产品取舍只能由用户确认。AI 可以提出选项和影响，但不能静默改变产品语义。

## 4. 新会话阅读顺序

1. `AGENTS.md`
2. `docs/development/control-map.md`
3. `CONTEXT.md`
4. `docs/PROJECT_STATE.md`
5. `docs/development/agent-first-development-plan.md`
6. `docs/development/rain-project-delivery-plan.md`
7. 与任务有关的 AC、覆盖矩阵和模块地图
8. 与任务有关的 PRD/spec
9. 相关代码、测试和最近真实证据

不需要每次通读 99 条历史决策。先通过控制地图找到本次任务真正相关的资料。

`product-decision-coverage.md` 使用 `DEC-PRD-001` 至 `DEC-PRD-099` 表示 PRD 历史编号；本文件第 6 节的 `DEC-001` 等编号表示控制面建立后由用户确认的新决定。两套编号不可互相替代。

## 5. 受控变更流程

每次只处理一个可验证的小目标：

1. 选择一个 AC，或先新增一个 `Proposed` AC。
2. 确认实现模块和验证方式。
3. 如果验证不足，先补调用真实公开接口的行为测试；默认放在非锁定测试区。
4. 做最小实现或重构。
5. 运行该 AC 对应的测试。
6. 根据影响范围运行完整前端、Rust 或真实 E2E 验证。
7. 更新覆盖矩阵和 `PROJECT_STATE.md`。

修改锁定的 `harness/` 或 `src-tauri/tests/` 前，必须得到用户明确批准。批准 Harness Migration 后，必须先明确对应 AC 和替代裁判，再退役旧断言及其测试专用影子模块；迁移记录保存在 `docs/development/`。没有批准时仍按锁定处理。

## 6. 已确认产品决定

### DEC-001 多模型支持采用统一能力契约

状态：`Confirmed`（用户于 2026-07-26 选择方案 C）

Rain 正式支持模型池中的多种配置。模型是否可用于某个角色，不由供应商名称或固定白名单决定，而由该角色的统一能力契约决定。

支持状态分为：

- `Compatible`：当前配置通过对应角色的能力检查，可以被用户选择。
- `Verified`：除能力检查外，还通过 Rain 完整真实 E2E，可作为已验证配置展示。
- `Unavailable`：能力检查失败，不得被分配给该角色。

当前 `ggml-large-v3.bin`（CUDA）+ `qwen3-omni-flash`（结构化与文本助手）+ DashScope endpoint 是 schema v2 证据下首个 `Verified` 组合，但不是永久白名单，也不代表 vision 已验证。

各角色最低能力：

- ASR：配置或本地模型可加载；能输出非空、时间单调的句子；错误和取消可识别。
- 结构化：能完成真实健康请求；能返回符合 Stage2 契约的 JSON；保留输入 sentence ID；支持错误分类和取消。
- 助手：能完成文本请求和停止；只有通过图像输入检查的配置才能标记 vision 能力。

模型名称、endpoint 或 Key 变化后，原能力结果失效，必须重新检查。运行中的导入使用启动时的配置快照，不被设置页后续修改悄悄替换。

### DEC-002 本地 Whisper 采用安装后入池

状态：`Confirmed`（用户于 2026-07-28 确认）

本地 Whisper 条目只有在生产 `list_whisper_models` 能发现对应最终文件后才能进入模型池。下载表单的完成状态不是唯一事实源；Store 必须通过同一个 installed-list interface 再次复核。入池只表示配置存在，不表示 ASR 能力已通过。

### DEC-003 删除模型不保留悬空运行时引用

状态：`Confirmed`（用户于 2026-07-28 确认）

删除模型时，模型条目、API Key、能力记录和三个角色中对该模型的全部引用作为一个 Runtime Settings 快照清理。未引用该模型的事实保持不变；提交失败时不得发布部分删除结果。

### DEC-004 Runtime Settings 写入采用单队列与版本门禁

状态：`Confirmed`（用户于 2026-07-28 确认）

首次设置加载完成前不接受写入。加载后，所有 Runtime Settings 公开动作按单队列提交，候选快照在轮到动作时从最新成功状态构造；成功写入后，任何更早启动但更晚返回的加载结果自动失效。该规则只排序前端动作，不替代 SQLite 对单个快照的原子事务。

### DEC-005 E2E 自动化采用构建期双 adapter 隔离

状态：`Confirmed`（用户于 2026-07-28 确认）

应用根模块只依赖 `E2eAutomation` interface。普通构建选择返回空的 adapter，显式 E2E 构建选择真实 Runner adapter；不得用普通运行时条件把完整自动化实现保留在发布 bundle 或其 JavaScript source map 中。`RAIN_E2E_BUILD=1` 产物是自动化构建，不是普通发布产物。

### DEC-006 Runtime Settings 桌面失败只保留单份脱敏诊断

状态：`Confirmed`（用户于 2026-07-28 确认）

短桌面 Judge 失败时，在系统临时目录保留单份 `rain-runtime-settings-e2e-latest-failure`，包含结构化阶段、主错误和脱敏 driver logs；新失败替换旧失败，成功清除 stale 诊断。诊断逻辑不得保存隔离 SQLite，不得泄露已知 LLM Key，也不得掩盖主错误。

### DEC-007 本地 Whisper 默认 GPU 优先并保留 CPU 安全回退

状态：`Confirmed`（用户于 2026-07-31 确认）

Rain 的本地 Whisper 默认偏好为 `Auto`。受支持的 NVIDIA CUDA 后端通过运行时探针时优先使用 GPU；CUDA worker 缺失、驱动不兼容、显存明显不足或后端工作进程失败时，`Auto` 必须给出可见原因并安全回退 CPU。用户可以显式选择 `Auto`、`NVIDIA GPU` 或 `CPU`；显式 GPU 不得静默回退。

Rain 主程序必须保持 CPU 安全且不得在装载时依赖 CUDA DLL。CUDA 推理由独立、版本化协议的 worker adapter 承担，CPU adapter 留在主进程；用户取消必须终止当前 adapter 的工作且不得触发另一个后端重跑。该决定以 `AC-LV-21` 和 `docs/superpowers/specs/2026-07-31-whisper-gpu-auto-fallback-design.md` 为准，覆盖 M20 决策94中“CPU/GPU 完全交给 binding”以及“不使用 CLI 子进程”的旧实现取舍，但不改变 `whisper-rs`、模型文件、Sentence 输出或 Stage2 合同。
