# Rain Core Release Scope Contract

> 状态：`Active — user-confirmed`
> 更新日期：2026-08-02
> 路线图位置：M1-S1 Release Scope Contract
> 产品授权边界：用户已确认本文件的首发范围，并把公开分发形态修订为单一 GPU 增强通用安装包。本文件仍不修改 AC、产品决策处置或覆盖等级；Launch 行必须在 M1-S2 或后续原子 Slice 中获得 Confirmed AC 后才能实施或宣称完成。

## 1. Slice Contract

| 字段 | 本轮合同 |
| --- | --- |
| Slice | M1-S1：建立 Core Release Scope Contract |
| AC / Proposed AC | 产品范围治理缺口；不新增产品行为 AC |
| User-visible result | 用户得到一份逐条、无遗漏的首发/后续版本范围，并能一次确认或指出要调整的行 |
| In scope | 当前全部 Confirmed AC 的首发归属；54 条 Proposed 决策逐条归入 Launch 或 Post-release；既有 4 条 Out-of-scope 的首发边界；首发外部能力承诺 |
| Out of scope | 新增/确认 Release AC、产品代码、锁定 Harness、外部 workflow、模型/视频调用、安装器和 Evidence |
| Owner | 本文件拥有已确认的 Release Scope；M1-S2 release acceptance 与后续 `product-decision-coverage.md` 更新拥有正式产品行为语义 |
| Judge | 54 条当前 Proposed ID 完整、唯一且每条只有一个去向；Launch 行必须进入 M1-S2 AC 队列；用户确认记录；独立只读 Spec/Standards 审查 |
| Evidence tier | 文档控制面 + 独立审查；不产生运行时 Evidence |
| Allowed writes | 本文件、`control-map.md`、`rain-project-delivery-plan.md`、`agent-first-development-plan.md`、`PROJECT_STATE.md` |
| Locked files | `harness/`、`src-tauri/tests/`、现有 AC/coverage/product-decision dispositions 和全部产品源码 |

## 2. 范围状态的精确定义

- **Launch**：进入本次 Core Release。现有 Confirmed AC 继续按原文验收；当前仍为 Proposed 的行必须先在 M1-S2 或后续原子 Slice 中获得 Confirmed AC、Owner、Judge 和所需 Evidence，才能宣称完成。
- **Post-release**：不阻断本次 Core Release，继续保持 Proposed。首发 UI 不得展示依赖该能力的空按钮、假成功或暗示性承诺。
- **Out-of-scope**：本次和当前 post-release 队列都不计划实现，但并非永久删除需求。新增 Out-of-scope 必须由用户明确确认。

本合同中的“Launch”是发布范围，不是实现状态。它不把局部代码、旧 PRD、旧截图或旧 Evidence 变成完成证明。

## 3. 推荐的 Core Release 定位

Rain Core Release 推荐定位为：

> 一款 Windows x64 桌面学习应用，可靠导入本地视频，通过已安装的本地 Whisper 与已验证的 OpenAI-compatible 文本模型生成可学习结构，并提供持久化学习、笔记、文本助手、CPU-safe/GPU-worker 运行和可安装发布闭环。

推荐边界：

- 当前全部 40 条 Confirmed AC 进入 Launch 基线，实际范围只以 AC 原文为准。
- 本地视频、现有受控 URL-to-local-media 接口、模型下载/能力门禁、Runtime Settings、学习页核心、原子持久化和 Harness 属于 Launch。
- 首发必须补齐正式安装、双硬件环境、schema 升级、派生文件生命周期、签名/许可、RC 和回滚合同；这些在 M1-S2 形成 Release AC。
- GPU 产品化属于 Launch。用户确认只公开分发一个 **GPU 增强通用安装包**：它同时包含 CPU-safe Rain 主程序、CPU adapter，以及隔离的 CUDA worker/runtime；不再提供独立的公开 CPU 安装包。兼容 NVIDIA 环境下 `Auto` 优先使用 CUDA；没有兼容 NVIDIA/驱动/runtime 时，应用仍须正常启动、显示原因并回退 CPU。Forced CPU/Forced GPU 的现有语义保持不变。发布页和安装器必须提前披露约 804 MB payload、硬件要求、失败/重试和 CPU fallback。普通 CPU-safe/Harness 构建继续作为内部验证产物存在，不作为第二个公开安装包。该边界须在 M1-S2 形成独立 Confirmed AC。
- 首发不承诺任何真实视频站点兼容性。`AC-LV-17` 只保证受控 HTTP(S) URL 进入 app-owned 本地媒体；真实站点 Evidence 属于 Post-release。
- 首发只承诺本地 Whisper ASR。云端 ASR、自动翻译、Vision 和高级树编辑进入 Post-release。
- 首发保留现有文本助手能力，但不承诺图像输入、当前帧解释或包含 Vision 暗示的完整助手视觉合同。
- risk 22 的 App-scope import Owner 与判别式 progress contract 属于 Launch 的行为保持架构工作，必须分别裁判；它们不授权新的导入行为，也不能合并成一次大重写。

## 4. 54 条 Proposed 决策的逐条推荐

### 4.1 Launch — 31 条

这些行为属于 Core Release 必需闭环，但在获得对应 Confirmed AC 和 Judge 前仍保持 Proposed。

| Decision | 推荐去向 | 首发边界与理由 | 目标工作包 |
| --- | --- | --- | --- |
| DEC-PRD-011 | Launch | 顶部双行目录是基础学习导航；必须从当前播放事实推导 | M6-S1 |
| DEC-PRD-012 | Launch | 目录进度和切换反馈属于基础可用性；具体时长进入视觉/减少动效 Judge | M6-S1、M9-S1 |
| DEC-PRD-013 | Launch | 长目录必须可滚动、定位当前项并有可理解边界 | M6-S1 |
| DEC-PRD-022 | Launch | AI/随记 Tab 是现有两类核心学习活动的生产入口 | M6-S2 |
| DEC-PRD-023 | Launch | 首发需要可用布局、比例记忆及字幕/转录分离；逐项拆 Slice | M6-S2、M6-S3 |
| DEC-PRD-053 | Launch | 核心快捷键及输入焦点门禁是桌面学习效率和安全边界 | M6-S5 |
| DEC-PRD-057 | Launch | ready/non-ready 卡片必须提供完整、可理解的信息层级 | M5-S3 |
| DEC-PRD-058 | Launch | 最近学习、导入时间和名称三档排序属于基础列表闭环 | M5-S1 |
| DEC-PRD-059 | Launch | 标题搜索属于基础列表闭环；不扩展标签或正文搜索 | M5-S1 |
| DEC-PRD-060 | Launch | 删除必须补齐 app-owned 缩略图删除与孤儿 GC，同时保留源视频 | M4-S2、M4-S3、M5-S4 |
| DEC-PRD-062 | Launch | 导入、排序、搜索、空状态和任务入口必须形成完整生产页面 | M5-S2 |
| DEC-PRD-063 | Launch | Core Release 只提供暗色主题，避免发布未验收的主题切换 | M9-S1 |
| DEC-PRD-064 | Launch | 最小中性色阶必须冻结并以生产画面验收 | M9-S1 |
| DEC-PRD-065 | Launch | 控件强调语义必须一致，不增加未定义品牌强调色 | M9-S1 |
| DEC-PRD-066 | Launch | 四类段落颜色映射是目录、文本和导图的共同语言 | M9-S1 |
| DEC-PRD-067 | Launch | 选中态必须跨组件一致且不只靠偶然样式 | M9-S1 |
| DEC-PRD-068 | Launch | 播放态和选中态同时出现时必须可区分 | M9-S1 |
| DEC-PRD-069 | Launch | 失败、处理和排队状态必须具有独立、可访问语义 | M9-S1、M9-S2 |
| DEC-PRD-070 | Launch | 目录进度与容器节点需要稳定视觉语义 | M9-S1 |
| DEC-PRD-071 | Launch | 段落类型胶囊是首发内容结构的可见标识 | M9-S1 |
| DEC-PRD-073 | Launch | 系统无衬线字体和受控字重构成最小排版合同 | M9-S1 |
| DEC-PRD-074 | Launch | 五档字号需绑定实际页面用途和可访问性 | M9-S1、M9-S2 |
| DEC-PRD-075 | Launch | 阅读页行距必须达到长文本可读性要求 | M9-S1、M9-S2 |
| DEC-PRD-076 | Launch | 间距、圆角、阴影和关键高度需要最小一致合同 | M9-S1 |
| DEC-PRD-077 | Launch | 列表响应式网格、16:9 缩略图和信息布局属于首发列表完成定义 | M5-S3、M9-S3 |
| DEC-PRD-078 | Launch | 原文字幕需要独立开关和真实 media 行为；不包含翻译 | M6-S3 |
| DEC-PRD-079 | Launch | 导图基础节点/连线、缩放和平移是现有导图查看体验的一部分 | M6-S4、M9-S1 |
| DEC-PRD-081 | Launch | 动效时长和系统减少动效必须作为可访问性合同 | M9-S1、M9-S2 |
| DEC-PRD-092 | Launch | 首发前确认前端 OpenAI-compatible LLM ownership，并增加必要负向 policy | M4-S6 |
| DEC-PRD-096 | Launch | 首发前确认本地媒体/缩略图只经批准的 asset protocol 边界 | M4-S6 |
| DEC-PRD-099 | Launch | 首发前确认 SQLite 持久事实与 Zustand 会话缓存边界 | M4-S6 |

### 4.2 Post-release — 23 条

这些能力不阻断 Core Release，继续保持 Proposed；现有被 Confirmed AC 覆盖的局部行为仍可留在首发，但不得扩展为本行完整承诺。

| Decision | 推荐去向 | 延后理由 | 目标工作包 |
| --- | --- | --- | --- |
| DEC-PRD-004 | Post-release | 不限深度的人工树编辑需要完整领域不变量和 SQLite 事务 | M8-B |
| DEC-PRD-006 | Post-release | 当前帧截图和 Vision 需要独立模型能力、隐私和真实图像 Evidence | M8-A |
| DEC-PRD-010 | Post-release | 现有文本助手可首发；类型化动作、保存回答和 Vision 的完整组合延后 | M8-A |
| DEC-PRD-015 | Post-release | 删除节点的内容迁移和恢复属于高风险树编辑 | M8-B |
| DEC-PRD-032 | Post-release | 云端 ASR 档位、长音频和供应商 Evidence 成本高；首发使用本地 Whisper | M7-S1 |
| DEC-PRD-033 | Post-release | 翻译需要生成、持久化、失败隔离和真实模型 Evidence | M7-S3、M7-S4 |
| DEC-PRD-035 | Post-release | “内容不丢”必须与完整树编辑事务一起实现 | M8-B |
| DEC-PRD-039 | Post-release | 左树/文本区编辑职责依赖完整高级树编辑闭环 | M8-B |
| DEC-PRD-042 | Post-release | reparent 时间门禁需要独立领域和回滚 Judge | M8-B |
| DEC-PRD-043 | Post-release | 类型胶囊保留展示；其编辑菜单随高级树编辑延后 | M8-B |
| DEC-PRD-044 | Post-release | 句子提取会重写结构与时间范围，需要原子事务 | M8-B |
| DEC-PRD-045 | Post-release | 节点合并和存活者选择需要原子事务与撤销 | M8-B |
| DEC-PRD-046 | Post-release | 删除保护、空容器和孤节点规则必须统一确认 | M8-B |
| DEC-PRD-050 | Post-release | 节点框 scrub 是非首发必需的高级导图手势 | M6-S4 |
| DEC-PRD-051 | Post-release | 现有导图继续只查看/导航；折叠手势进入后续版本 | M6-S4 |
| DEC-PRD-052 | Post-release | 左树编辑后导图同步依赖尚未进入首发的编辑 Owner | M8-B |
| DEC-PRD-080 | Post-release | 现有文本助手保持可用；含当前帧提示的完整视觉合同随 Vision 延后 | M8-A |
| DEC-PRD-083 | Post-release | 导入取消与助手停止已首发；结构编辑撤销栈随高级编辑延后 | M8-B |
| DEC-PRD-085 | Post-release | 自动语言检测、混合语言和翻译触发必须作为完整语言合同处理 | M7-S2 |
| DEC-PRD-086 | Post-release | 译文块、默认开关和展示依赖翻译持久化 | M7-S4 |
| DEC-PRD-088 | Post-release | 会话内撤销/重做只在高级编辑存在后有可验收意义 | M8-B |
| DEC-PRD-090 | Post-release | 跳过合并学习会改变 ready 树语义，需单独产品决定 | M8-B |
| DEC-PRD-091 | Post-release | 首发只提供原文字幕开关；完整独立译文开关随翻译进入后续版本 | M6-S3、M7-S4 |

### 4.3 既有 Out-of-scope — 4 条

本轮不改变当前处置：

| Decision | 当前边界 |
| --- | --- |
| DEC-PRD-031 | 不提供人工临时分块编辑器 |
| DEC-PRD-047 | 导图区不承担 reparent 或结构编辑 |
| DEC-PRD-061 | v1 不提供学习数据或视频导出 |
| DEC-PRD-072 | 早期卡片视觉草案由 DEC-PRD-077 替代 |

### 4.4 不属于 54 条 Proposed、但必须有首发去向的架构义务

| Obligation | 推荐去向 | 首发边界 | 目标工作包 |
| --- | --- | --- | --- |
| risk 22a：App-scope import Owner | Launch | 把 Controller 生命周期提升为显式 App Owner；保持 `AC-LV-19/20` 的后台继续、取消、single-flight 和同记录更新，不改变用户行为 | M4-S4 |
| risk 22b：判别式 progress contract | Launch | 用按阶段判别的合法 payload 统一 producer/Pipeline/Controller/UI/Tauri event；不新增进度阶段或产品承诺 | M4-S5 |

两项必须拆成独立行为保持 Slice。页面真正卸载/重挂和非法 payload mutation 分别是 Judge；文件长度、类型存在或对象自我赋值不能签发通过。

## 5. Launch 基线与新增缺口

### 5.1 已有 Launch 基线

当前 40 条 Confirmed AC 全部进入首发，但只继承现有覆盖结论：

- 本地视频与受控 URL-to-local-media 导入；
- ASR/Stage2 失败关闭、取消、重试、真实进度和原子持久化；
- 模型下载、角色能力、Runtime Settings 与 GPU Auto/CPU-safe 行为；
- 学习加载、导航、播放同步、进度、笔记、文本助手和布局会话；
- 控制面、双构建隔离、干净 Windows Harness、Hosted desktop 入口和数据库架构政策。

这不自动补齐 `AC-LV-21` 双环境 Release Evidence，也不把旧 Hosted run 或旧 canonical Evidence升级为当前 RC 证据。

### 5.2 M1-S2 必须形成的 Release AC 队列

用户已确认本范围。M1-S2 至少逐条提出并确认：

1. Windows x64 安装包身份、版本和发布渠道；
2. 单一 GPU 增强通用安装包：公开渠道只有一个安装包；其中 CPU-safe 主程序/adapter 与隔离 CUDA worker/runtime 共存；约 804 MB 大小披露、硬件要求、无 NVIDIA 环境启动与可见 CPU fallback、Forced CPU/GPU、失败重试，以及普通 CPU-safe/Harness 构建仅作内部验证产物均须由 Confirmed AC 裁判；
3. 干净安装、同版本重装、旧版升级、卸载和数据保留/清理；
4. 无 NVIDIA/CUDA 环境安装、启动、Auto 可见回退和 CPU 短样本；
5. NVIDIA 环境安装、CUDA/Forced CPU/Forced GPU 和取消/失败分类；
6. 签名、SHA-256、SBOM、第三方 notices 和 CUDA runtime 许可评审；
7. schema 支持起点、升级事务、失败回滚和备份；
8. app-owned 缩略图删除和孤儿 GC；
9. 31 条 Launch 决策逐行的 AC traceability matrix：视频列表、学习页基础交互、视觉、可访问性与性能预算均定位到现有或拟新增 AC、Owner、Judge、Evidence tier 和 Out-of-scope；不得只按工作簇汇总；
10. `DEC-PRD-092/096/099` 三条 Launch 架构决策分别获得 Confirmed AC；独立治理记录和负向 policy 只能充当对应 Judge，不能代替 AC，也不得由现有局部 Harness 自动继承；
11. risk 22a App-scope import Owner 的行为保持 AC/缺口、卸载/重挂 Judge 和范围外行为；
12. risk 22b 判别式 progress contract 的合法状态集、mutation Judge 和范围外行为；
13. RC Evidence 新鲜度、阻断缺陷等级、回滚和发布后观察。

每一项仍须拆为一个 AC 或一个独立可裁判缺口，不能把本清单当作一个大 AC。

## 6. 首发明确不承诺

- 任何真实站点、登录态、Cookie、播放列表、DRM、字幕优先或永久 URL 兼容性；
- 云端 ASR、英文自动翻译或混合语言完整策略；
- 图像输入、当前帧解释或 Vision capability；
- 树拆分/合并/reparent/删除、跳过合并或撤销/重做；
- 导图 scrub、折叠编辑或导图区结构编辑；
- 数据/视频导出、亮色主题或多平台安装包；
- 尚未通过目标 RC Evidence 的模型、GPU、站点或硬件组合。

Release Notes 必须把“不承诺”与“当前受控接口存在”分开描述，尤其不能把 `yt-dlp` command 存在写成真实站点保证。

## 7. 用户确认记录

用户在 2026-08-02 明确确认并修订了以下整体选择，本文件因此从 Proposed 进入 Active：

1. 31 条 Proposed 进入 Launch、23 条进入 Post-release、0 条新增 Out-of-scope；
2. 现有 4 条 Out-of-scope 处置不变；
3. Core Release 不承诺真实站点兼容、云端 ASR、翻译、Vision 和高级树编辑；
4. GPU 产品化进入 Launch，但公开分发形态由原建议的双安装包修订为一个 GPU 增强通用安装包；CPU-safe 主程序、CPU adapter、Auto 可见回退和 Forced CPU 仍是同一产品的必需组成，不得把“只发 GPU 版本”解释为删除 CPU 路径；
5. risk 22 两项行为保持架构工作进入 Launch 且分别实施；
6. 下一步是 M1-S2 按第 5.2 节建立并由用户确认 Release AC，而不是直接开始产品实现。

本确认冻结的是发布去向与安装包产品边界，不会自动把 31 条 Launch 行从 Proposed 提升为 Confirmed，也不会签发现有 Evidence。后续调整仍须按 Decision ID 或 Release AC 明确记录，并重新经过独立审查。

## 8. 本轮完成条件

- 当前 `product-decision-coverage.md` 的 54 条 Proposed ID 在第 4.1/4.2 节的处置表中恰好各出现一次；
- Launch/Post-release/新增 Out-of-scope 数量分别为 31/23/0；
- 本文件没有修改任何 AC 或 product-decision disposition；
- `npm run harness:control` 与 `git diff --check` 通过；
- 独立只读 reviewer 按 Spec 后 Standards 检查完整性、混合决策边界、越权和假完成；
- 审查发现及关闭方式写入 `PROJECT_STATE.md`；
- 用户确认记录与单一安装包修订已同步到全部 Active 计划；完成独立审查后，下一唯一动作进入 M1-S2。
