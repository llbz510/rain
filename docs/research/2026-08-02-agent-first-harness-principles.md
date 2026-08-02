# Agent-first Harness 原则及其对 Rain 的适用方式

> 治理状态：`Proposed`（研究结论，仅供后续计划评审；不能直接授权产品实现、修改 Active AC 或迁移锁定 Harness）
> 研究日期：2026-08-02
> 研究范围：OpenAI 与 Anthropic 的一手工程文章，以及 `mewamew/huaizi-de-cows` 仓库在提交 `27c0744905fe7f34c2ec76ea543d2fd5286453fd` 的可见实践。

## 结论摘要

Rain 已经具备 agent-first Harness 的大部分控制面骨架：事实源地图、Active AC、Owner/Judge 映射、公开接口行为测试、真实桌面 Judge、独立 Windows CI、Evidence 分级和锁定 Harness Migration。下一阶段的重点不应是再造一套庞大流程，而应是把现有制度收敛成每个会话都能稳定执行的“小切片闭环”，并把“每个切片完成后由全新上下文的只读 AI 独立审查”写成计划级硬门禁。

推荐的最小闭环是：

1. 从当前事实源选一个已确认 AC，或先提交一个等待用户确认的 `Proposed` AC。
2. 在改代码前固定 Slice Contract：范围内、范围外、Owner、Judge、证据和允许修改的文件。
3. 先建立能失败的 RED 或明确记录现有 GREEN 基线，再做最小实现。
4. 实现者运行定向 Judge，并按影响范围运行完整门禁或真实桌面/Evidence Judge。
5. 由没有参与实现、使用全新上下文的只读审查 AI，先审 Spec/AC，再审代码与 Harness 质量。
6. 有发现就回到 RED/实现/验证；无阻断发现后才更新覆盖矩阵和 `PROJECT_STATE.md`，形成下一会话可接续的结构化交接。

## 一手来源事实

以下内容只陈述来源明确表达或仓库直接可见的事实；不等于它们已经自动适用于 Rain。

### F1. Harness 的核心是环境、反馈回路与可执行约束

- OpenAI 把人的主要工作描述为设计环境、表达意图和构造反馈回路；遇到失败时，团队寻找缺失的能力、工具、抽象或可执行约束，而不是只要求模型“再努力一次”。文章还明确概括为“Humans steer. Agents execute.”（[OpenAI：Harness engineering](https://openai.com/index/harness-engineering/)）
- OpenAI 的实例把测试、CI、文档、可观测性和内部工具都视为 agent 工程系统的一部分，而非应用代码之外的附属物。（[OpenAI：Harness engineering](https://openai.com/index/harness-engineering/)）

### F2. 仓库知识应是可导航、可版本化、可机械检查的事实系统

- OpenAI 建议给 agent “地图”而不是千页说明书：短 `AGENTS.md` 作为目录，结构化 `docs/` 作为系统事实源，并通过渐进披露让 agent 按任务进入相关材料。（[OpenAI：Harness engineering](https://openai.com/index/harness-engineering/)）
- 该团队用 linter、CI 和定期 doc-gardening 检查文档结构、链接、时效与代码事实的漂移；计划、决策日志、技术债也作为仓库内一等制品保存。（[OpenAI：Harness engineering](https://openai.com/index/harness-engineering/)）

### F3. 应机械保护不变量，同时给局部实现留自由

- OpenAI 强调执行架构不变量而不是微观规定实现；其示例使用固定层次、受限依赖方向、自定义 lint 和结构测试来阻止架构漂移，且把可修复提示写进 lint 错误。（[OpenAI：Harness engineering](https://openai.com/index/harness-engineering/)）
- OpenAI 同时说明 agent 会复制仓库中的好坏模式，因此把反复出现的人类判断编码成“golden principles”，用持续的小规模清理抑制熵增。（[OpenAI：Harness engineering](https://openai.com/index/harness-engineering/)）

### F4. 长任务需要可交接的小块，但 Harness 结构不是永恒不变

- Anthropic 报告长任务中会出现上下文失去连贯性和提前收尾；其早期方案使用“新上下文 + 结构化交接”跨会话延续工作，并明确指出交接制品必须足以让下一 agent 接续。（[Anthropic：Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)）
- 其后在更强模型上移除了 context reset 和固定 sprint，但保留 planner 与 evaluator；文章的结论不是始终采用同一种编排，而是针对真实轨迹逐项检验 Harness 组件是否仍然“load-bearing”。（[Anthropic：Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)）

### F5. 实现者与评估者分离能缓解自我宽容，但评估者也必须调校

- Anthropic 观察到 agent 审查自己产物时容易过度正面；把 generator 与 evaluator 分离后，更容易把 evaluator 调成怀疑式审查，并形成可迭代的外部反馈。（[Anthropic：Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)）
- 这种分离不是自动可靠：文章记录 evaluator 曾发现问题后又说服自己放行，且会浅测边缘情况；作者通过阅读真实 QA 轨迹、对照人工判断并迭代 evaluator 提示才改善判定。（[Anthropic：Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)）

### F6. “完成”应在实现前转译成可测试合同，并由真实应用行为裁判

- Anthropic 的 generator 与 evaluator 在每个工作块开始前协商 contract，明确交付内容与可测试行为；实现完成后 evaluator 使用 Playwright 操作真实运行应用，同时检查 UI、API 与数据库状态，而不只阅读代码。（[Anthropic：Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)）
- 文章也把主观质量拆为具体评分维度，并用硬阈值判定；这不会消除主观性，但能让判断更稳定、可复查。（[Anthropic：Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)）

### F7. 完整 Harness 显著增加成本，应按任务风险选择

- Anthropic 的一个对比实验中，完整 Harness 运行约 6 小时、成本约 200 美元，而单 agent 约 20 分钟、9 美元；完整 Harness 的核心功能质量更好，但代价显著。（[Anthropic：Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)）
- 后续文章明确提出从最简单方案开始、只在需要时增加复杂度；随着模型能力变化，应一次移除一个组件并观察质量影响，而不是永久保留所有脚手架。（[Anthropic：Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)）

### F8. `huaizi-de-cows` 把角色分离落实成仓库内可复用协议

- 该仓库的 `AGENTS.md` 固定了 `builder`、`test-author`、`acceptance-checker`、`visual-reviewer`、`reviewer` 五类角色；实现者不能担任最终 reviewer，不能为通过测试而降低验收标准，视觉改动还需先经过独立视觉复核。（[`AGENTS.md`](https://github.com/mewamew/huaizi-de-cows/blob/27c0744905fe7f34c2ec76ea543d2fd5286453fd/AGENTS.md)）
- 其 reviewer 协议要求全新上下文、只读、默认“不通过”，先逐条核对外部验收标准和证据，再检查代码质量；缺输入时停止而不是猜测。（[`reviewer.toml`](https://github.com/mewamew/huaizi-de-cows/blob/27c0744905fe7f34c2ec76ea543d2fd5286453fd/.codex/agents/reviewer.toml)，[`builder-reviewer-separation.md`](https://github.com/mewamew/huaizi-de-cows/blob/27c0744905fe7f34c2ec76ea543d2fd5286453fd/docs/builder-reviewer-separation.md)）
- 其 acceptance-checker 只建立“标准编号 ↔ 真实测试”映射，把只跑通、断言别的行为或随意写死待定值判作假覆盖；该角色既不实现也不写测试。（[`acceptance-checker.toml`](https://github.com/mewamew/huaizi-de-cows/blob/27c0744905fe7f34c2ec76ea543d2fd5286453fd/.codex/agents/acceptance-checker.toml)）
- 其子 agent 指南要求主 agent 在派发前提供 spec、AC、测试入口、可读写范围、禁止修改项和返回格式；并行仅用于互不覆盖且可独立验证的任务，最终仍由主 agent 统一复核。（[`subagent-guide.md`](https://github.com/mewamew/huaizi-de-cows/blob/27c0744905fe7f34c2ec76ea543d2fd5286453fd/docs/subagent-guide.md)）
- 该仓库另设 Experience Library，只允许记录真实复现并已解决的问题，再把高频复发项提升为每轮必读短规则。（[`Experience Library`](https://github.com/mewamew/huaizi-de-cows/blob/27c0744905fe7f34c2ec76ea543d2fd5286453fd/docs/experience-library/README.md)）

## 对 Rain 的推论

以下是基于上述事实和 Rain 当前控制面的工程判断，不是来源原文，也不是已经批准的产品决定。

### R1. 保留现有控制面，不另起平行体系

Rain 已有 [控制地图](../development/control-map.md)、[验收标准](../development/acceptance-standard.md)、[覆盖矩阵](../development/harness-coverage.md)、[模块地图](../development/module-map.md) 和 [项目状态](../PROJECT_STATE.md)。这已经对应 OpenAI 所说的“入口地图 + 深层事实源 + 机械检查”。下一步应补强这些接口之间的执行纪律，而不是再建第二套“agent 计划/完成度”文档。

### R2. 每次会话只承诺一个可验证切片

Rain 的默认计划单位应是一个 AC 或一个 AC 内可独立判定的缺口；跨会话不要求同一个 agent 保持记忆，而要求上一会话留下足够结构化的事实。一个切片至少包含：

- AC 与用户可见结果；
- 明确的范围内/范围外；
- 实现 Owner 与允许修改范围；
- 预期 RED、定向 Judge、完整门禁和必要 Evidence；
- 当前已完成事实、失败事实、下一步最小动作。

如果没有 Active AC，新行为必须先保持 `Proposed` 并等待用户确认；不能让 planner 或 builder 静默扩展产品语义。

### R3. 把独立审查设为每个切片的必经门，而不是最终大审

用户要求“每次部分计划落实后要有独立的审查 AI”，适合采用固定的两段只读审查：

1. **Spec review**：全新上下文，逐条核对 AC、范围外、Owner/Judge、真实证据；缺证据默认不通过。
2. **Standards review**：在 Spec review 之后检查模块边界、错误处理、测试真实性、秘密/产物风险与无关改动。

审查 AI 不得改代码、测试、AC、覆盖等级或 `PROJECT_STATE.md`。实现者修复发现后，必须重跑相关 Judge，再由独立审查复核关闭；主 agent 对最终结论负责，不能直接照搬 reviewer 的“通过”。

### R4. 独立审查输入应固定，避免 reviewer 临场发明标准

每次派发 reviewer 时必须给出：基准提交或明确 diff、目标 AC、相关 spec、测试入口、允许读取/禁止修改范围、本次验证输出和未验证边界。Reviewer 的任务应明确为“找反例与缺证据”，而不是泛泛“看看有没有问题”。这直接吸收 `huaizi-de-cows` 的角色协议，也修正 Anthropic 记录的 evaluator 自我放宽问题。

### R5. Judge 要尽量穿过真实公开接口，并与风险分层

Rain 应继续坚持覆盖矩阵中的 Strong 定义：行为测试必须让坏实现可靠失败。建议按成本分层：

- **每次切片**：`npm run harness:control`、相关前端/Rust 行为 Judge、类型/格式检查。
- **代码交付**：`npm run harness:check`，保持 E2E/普通构建互补裁判和干净 Windows CI。
- **桌面或跨进程边界变化**：运行对应的真实 Tauri 短 Judge；不能用 jsdom 或常量检查替代。
- **真实模型、GPU、外网、安装包与视觉结果**：只有对应 AC 明确需要时才生成 Evidence，记录目标提交与运行环境，不能把旧证据自动继承给新版本。

这不是要求所有切片都跑最昂贵的 Judge，而是要求计划事先说明为什么某一层足够、哪些结论仍是 Gap。

### R6. 优先投资 agent 可读的运行状态与失败诊断

当一个失败只能靠人工盯 UI、猜 SQLite 或翻长日志定位时，优先补公共 metadata、结构化状态、脱敏 failure summary、稳定 DOM seam 或可复放脚本。Rain 现有 Runtime Settings 失败目录和 Evidence manifest 是正确方向；下一步每个新桌面 Judge 都应声明失败保留什么、成功清除什么、哪些秘密和大型状态绝不保留。

### R7. 架构规则应从文档升级为负向机械裁判

对高复发边界（页面绕过 Store/Controller、业务层直连 SQL、普通 bundle 泄漏 E2E、CPU 主程序装载 CUDA、Harness-only 影子模块）应优先使用结构测试或 lint 拒绝非法依赖。规则只在发生真实违规或有明确高风险时新增，错误信息应告诉后续 agent 正确 Owner 和修复入口。

### R8. 建立有证据的 Harness 垃圾回收，而不是堆门禁

每个新 Harness 组件都应记录它捕获过的具体失败、保护的 AC、维护成本和退役条件。模型、架构或产品边界变化后，应通过一次一项的实验判断该组件是否仍有增益。锁定 Harness 的修改继续走用户批准的 Harness Migration：先给替代 Judge，再退役旧断言，不可为了省时直接弱化。

### R9. 不应原样照搬的做法

- OpenAI 在其高吞吐环境中采用较少阻塞门禁，但该文章也明确这是特定吞吐/纠错成本下的取舍。Rain 包含本地文件、SQLite、外部模型、GPU worker 和发布安装风险，不应据此削弱现有保护分支、完整 Harness 或 Evidence 边界。
- Anthropic 的完整 planner/generator/evaluator 多轮循环成本很高。Rain 不需要给每个小修复配置三代理和多轮 QA；只有跨多个模块、主观 UI/体验或超出当前模型稳定能力的切片才值得增加专门 evaluator 或视觉 reviewer。
- `huaizi-de-cows` 的角色名称和 Godot 专用视觉流程不应机械复制。Rain 应复用其“必要输入、只读、默认不通过、实现/验收分离”的协议思想，并把 Judge 换成 Tauri/React/Rust/SQLite/模型证据的实际边界。

## 建议纳入后续开发计划的会话协议

| 阶段 | 本会话必须产出 | 退出条件 |
| --- | --- | --- |
| Takeover | Git 状态、控制面检查、相关 AC/覆盖/模块/状态事实 | 当前基线无未解释冲突 |
| Contract | 单一切片、范围外、Owner、Judge、证据层级、允许修改范围 | 用户已确认新产品语义；否则仅停留在 `Proposed` |
| RED / Baseline | 能失败的行为 Judge，或证明无需新增测试的现有基线 | Judge 与 AC 的可观察结果直接相关 |
| Implement | 最小实现，禁止静默改 AC/锁定 Harness | 定向 Judge 通过 |
| Verify | 按风险运行前端、Rust、构建、桌面或 Evidence 层 | 只声明实际验证到的等级 |
| Independent review | 全新上下文、只读，先 Spec 后 Standards | 无阻断发现；发现项已修复并重验 |
| Handoff | 覆盖矩阵与 `PROJECT_STATE.md`、命令结果、未验证边界、下一最小切片 | 新会话无需聊天上下文即可接续 |

独立审查报告建议统一包含：基准、审查范围、逐条 AC 结论、P0/P1/P2 发现、缺失证据、已复跑命令、明确的“通过/不通过”。如果 reviewer 只说“测试都过了”或只做风格建议，不构成独立验收。

## 对当前 Rain 的优先含义

基于 [当前项目状态](../PROJECT_STATE.md) 的已知事实，最紧迫的 Harness 工作不是扩大功能面，而是：

1. 把“每个切片完成后必须由独立 AI 复核”固化进接下来的执行计划和交付模板。
2. 对已有 release Evidence Gap（尤其 `AC-LV-21` 的无 NVIDIA/CUDA 干净 Windows 安装/CPU 短样本、安装生命周期、签名与分发审查）保持诚实分级；没有目标环境证据就不升级覆盖等级。
3. 对风险 22 的 App-scope Controller Owner 与 progress 判别合同，仅在用户确认独立架构 AC、RED 和 Judge 后推进；不能以“agent-first 重构”为名无行为目标地改写。
4. 对缩略图删除/孤儿 GC 等没有 Active AC 的行为，先提出产品合同和失败策略，再实施。
5. 后续每个切片都保存 reviewer 的阻断发现及关闭方式，让审查反馈能沉淀为测试、结构规则或状态文档，而不是消失在聊天中。

## 来源

- OpenAI, [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/).
- Anthropic, [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps).
- mewamew, [`huaizi-de-cows` repository at `27c0744`](https://github.com/mewamew/huaizi-de-cows/tree/27c0744905fe7f34c2ec76ea543d2fd5286453fd).
