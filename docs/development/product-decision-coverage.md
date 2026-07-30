# Rain Product Decision Coverage

> 本表把历史编号 `DEC-PRD-001` 至 `DEC-PRD-099` 映射到当前控制面。编号和简述来自 PRD/M 文档中的现行产品意图；`HANDOFF.md` 只用于核对历史编号，不是本表的事实源。

## 处置语义

- `Confirmed AC`：本行概括的当前行为已由所列 Confirmed AC 控制；AC 原文决定实际验收范围，不能从本表外推更多完成结论。
- `Proposed`：产品意图仍保留，但尚无覆盖全部当前行为的 Confirmed AC。即使存在局部组件测试或实现，也不得据此宣称完整完成。
- `Out-of-scope`：该意图明确不在当前可执行验收范围，或已被后续决策替代；这不是永久删除需求。

混合决策按保守规则处理：只要当前意图仍包含未受 Confirmed AC 控制的必要行为，整行标为 `Proposed`，并在 Current control 中列出已有局部控制和剩余边界。

## 当前映射

| Decision | Current source | Disposition | Current control | Intent |
| --- | --- | --- | --- | --- |
| DEC-PRD-001 | `M01-positioning.md`、`M06-video-zone.md` | Confirmed AC | `AC-ST-01`、`AC-ST-02` | 学习页播放导入后的真实原视频，不建设手工动画系统 |
| DEC-PRD-002 | `M04-ai-processing.md`、`M18-long-video.md` | Confirmed AC | `AC-LV-03`、`AC-LV-05` | 处理管线为 ASR 后接 Stage2；长文本由 M18 包装分块 |
| DEC-PRD-003 | `M02-data-model.md`、`M04-ai-processing.md` | Confirmed AC | `AC-LV-05` | Stage2 段落类型限定为概念、例子、类比、过渡 |
| DEC-PRD-004 | `M02-data-model.md`、`M05-catalog-zone.md` | Proposed | Stage2 树有效性受 `AC-LV-05` 控制；不限深度的手动加深属于高级树编辑，尚无 AC | 数据模型不限深度、AI 默认三层，并允许用户继续加深容器层级 |
| DEC-PRD-005 | `M04-ai-processing.md`、`M07-text-zone.md` | Confirmed AC | `AC-LV-05` | LLM 不得改写或清洗原始转录正文 |
| DEC-PRD-006 | `M10-ai-assistant.md` | Proposed | 文本助手受 `AC-ST-07` 控制；当前帧截图、手动定帧和 vision 请求仍是 Evidence gap | 助手按需使用当前帧，用户可手动选定提问画面 |
| DEC-PRD-007 | `M19-settings.md` | Confirmed AC | `AC-LV-12`、`AC-LV-14`、`AC-LV-15`、`AC-LV-16` | ASR、结构化和助手三个角色独立选择模型并受能力门禁 |
| DEC-PRD-008 | `M03-video-import.md` | Confirmed AC | `AC-LV-02`、`AC-LV-17` | 同时支持本地文件与在线 HTTP(S) URL 的受控导入入口 |
| DEC-PRD-009 | `M08-excerpt-notes.md`、`M11-derivation-system.md` | Confirmed AC | `AC-ST-06` | v1 将摘注动作和随记统一为 Note 闭环；派生继续留在 v2 |
| DEC-PRD-010 | `M10-ai-assistant.md` | Proposed | 文本上下文、停止和可信引用受 `AC-ST-07` 控制；按类型快捷操作、保存回答完整交互和 vision 尚无统一 AC | 助手提供类型化快捷操作、通用操作和自由对话 |
| DEC-PRD-011 | `M05-catalog-zone.md` | Proposed | 当前播放位置统一受 `AC-ST-03` 控制；顶部双行目录的精确布局没有生产页 AC | 随播目录采用章节与小节顶行、段落底行的横向结构 |
| DEC-PRD-012 | `M05-catalog-zone.md` | Proposed | 进度事实受 `AC-ST-03` 控制；横滑和自动居中的具体动效未纳入 AC | 目录进度实时填充，跨章节或小节切换使用约 200ms 横滑 |
| DEC-PRD-013 | `M05-catalog-zone.md` | Proposed | 暂无生产行为 AC 覆盖滚动、居中、渐隐和暂停取消跟随的完整组合 | 目录项不折叠缩略，使用横向滚动、自动居中和边缘渐隐 |
| DEC-PRD-014 | `M05-catalog-zone.md`、`M16-layout.md` | Confirmed AC | `AC-ST-08` | 目录展开模式收起视频并由导图区接管视觉区域 |
| DEC-PRD-015 | `M05-catalog-zone.md`、`M08-excerpt-notes.md` | Proposed | 高级树编辑明确不在当前 Active AC 范围 | 删除节点必须迁移内容，并以再拆分作为恢复路径 |
| DEC-PRD-016 | `M02-data-model.md`、`M08-excerpt-notes.md` | Confirmed AC | `AC-ST-06` | 摘注是创建可编辑 Note 的动作，不保留独立 Excerpt 实体 |
| DEC-PRD-017 | `M02-data-model.md` | Confirmed AC | `AC-ST-06` | 摘注、自由笔记和 AI 笔记统一为带 source 的 Note |
| DEC-PRD-018 | `M02-data-model.md`、`M08-excerpt-notes.md` | Confirmed AC | `AC-ST-06` | Note 只引用稳定 sentence ID，不保存文本快照 |
| DEC-PRD-019 | `M16-layout.md` | Confirmed AC | `AC-ST-08` | 随播、文本展开、目录展开三模式共享同一学习事实 |
| DEC-PRD-020 | `M05-catalog-zone.md`、`M16-layout.md` | Confirmed AC | `AC-ST-04`、`AC-ST-08` | 左侧完整目录树与顶部目录横条承担不同导航职责 |
| DEC-PRD-021 | `M16-layout.md` | Confirmed AC | `AC-ST-08` | 文本与导图展开互斥，并可收起回随播模式 |
| DEC-PRD-022 | `M16-layout.md` | Proposed | `AC-ST-08` 只保证布局切换不丢会话；右侧 AI 与随记 Tab 的完整交互没有独立 AC | 右侧面板用 Tab 在 AI 助手与随记间切换 |
| DEC-PRD-023 | `M13-visual-design.md`、`M16-layout.md` | Proposed | CSS 令牌和局部 Harness 存在，但尺寸比例、拖拽记忆和字幕整体没有 Active AC | 布局比例可调并记忆，视频字幕与滚动转录稿分离 |
| DEC-PRD-024 | `M18-long-video.md` | Confirmed AC | `AC-LV-05`、`AC-LV-08` | M18 作为长文本 Stage2 的分块、处理、合并包装层 |
| DEC-PRD-025 | `M18-long-video.md` | Confirmed AC | `AC-LV-05` | 超过模型窗口 33% 的转录自动触发分块 |
| DEC-PRD-026 | `M18-long-video.md` | Confirmed AC | `AC-LV-05` | 分块按 token 预算并只在句子边界切割 |
| DEC-PRD-027 | `M18-long-video.md` | Confirmed AC | `AC-LV-05` | 后续块接收前置标题和上一块末段作为有界上下文 |
| DEC-PRD-028 | `M18-long-video.md` | Confirmed AC | `AC-LV-05` | 合并只处理紧凑元数据，并保持原始句子精确覆盖 |
| DEC-PRD-029 | `M18-long-video.md` | Confirmed AC | `AC-LV-05`、`AC-LV-08` | 结构化溢出通过校验、重切和有界重试失败关闭 |
| DEC-PRD-030 | `M17-video-list.md`、`M18-long-video.md` | Confirmed AC | `AC-LV-10` | 列表显示粗状态，导入界面显示来自真实任务的详细进度 |
| DEC-PRD-031 | `M18-long-video.md` | Out-of-scope | 当前不提供人工编辑临时分块；用户只调整阈值和最终树 | 不建设手动分块编辑器 |
| DEC-PRD-032 | `M04-ai-processing.md`、`M18-long-video.md`、`M19-settings.md` | Proposed | ASR 失败关闭、原子结果和角色能力分别受 `AC-LV-03`、`AC-LV-04`、`AC-LV-12` 控制；云端长音频供应商与不切块策略尚无完整 Evidence | 三档 ASR 统一为 Sentence，并要求云端档支持长音频和句级时间戳 |
| DEC-PRD-033 | `M04-ai-processing.md`、`M07-text-zone.md` | Proposed | 原文精确覆盖受 `AC-LV-05` 控制；段落级翻译生成、存储和展示没有独立 Active AC | 英文视频保留原文并另存段落级中文翻译 |
| DEC-PRD-034 | `M04-ai-processing.md` | Confirmed AC | `AC-LV-05` | Stage2 只返回 sentence 分组，正文由应用从原句拼接 |
| DEC-PRD-035 | `M05-catalog-zone.md`、`M18-long-video.md` | Proposed | 与 DEC-PRD-015 同属未进入 Active AC 的高级树编辑 | 将旧的“永不删节点”更新为“永不丢内容” |
| DEC-PRD-036 | `M02-data-model.md`、`M18-long-video.md` | Confirmed AC | `AC-ST-06` | 将笔记引用更新为稳定的句子级多引用 |
| DEC-PRD-037 | `M05-catalog-zone.md`、`M16-layout.md`、`M18-long-video.md` | Confirmed AC | `AC-ST-04` | 左侧目录树包含章、节、段落，并参与选择与跳转 |
| DEC-PRD-038 | `M05-catalog-zone.md` | Confirmed AC | `AC-ST-04` | 左树单击仅选中、双击跳转、右键留给编辑 |
| DEC-PRD-039 | `M05-catalog-zone.md`、`M07-text-zone.md` | Proposed | 导航行为受 `AC-ST-04` 控制；左树与文本区的完整编辑职责属于高级树编辑缺口 | 节点编辑集中在左树与文本区，横条只导航 |
| DEC-PRD-040 | `M05-catalog-zone.md` | Confirmed AC | `AC-ST-04` | 双击节点同步视频、文本和目录并保持播放状态 |
| DEC-PRD-041 | `M05-catalog-zone.md` | Confirmed AC | `AC-ST-03`、`AC-ST-04` | 播放和选择使用单一 Store 事实，高亮跟随句子 |
| DEC-PRD-042 | `M05-catalog-zone.md` | Proposed | 结构时间线关系受读取和导航规则间接约束；reparent 行为仍无 Active AC | 树结构必须保持时间顺序，跨时间 reparent 被拒绝 |
| DEC-PRD-043 | `M05-catalog-zone.md`、`M07-text-zone.md` | Proposed | 文本区高级编辑控件没有真实 UI 与数据库闭环 AC | 段落头常驻类型胶囊，并以悬停菜单执行节点编辑 |
| DEC-PRD-044 | `M05-catalog-zone.md`、`M07-text-zone.md` | Proposed | 高级树编辑缺口 | 连续句子可提取为新的兄弟段落并重算时间 |
| DEC-PRD-045 | `M05-catalog-zone.md` | Proposed | 高级树编辑缺口 | 只允许同父、同级、相邻节点合并并显式选择存活者 |
| DEC-PRD-046 | `M05-catalog-zone.md` | Proposed | 高级树编辑缺口 | 首个非空节点禁用删除，空容器与孤节点遵循显式边界 |
| DEC-PRD-047 | `M05-catalog-zone.md` | Out-of-scope | 当前导图区只承担查看、导航和选择；结构编辑留在左树 | 导图区不提供 reparent 或其他结构编辑 |
| DEC-PRD-048 | `M05-catalog-zone.md` | Confirmed AC | `AC-ST-04` | 导图沿用单击选择、双击三区跳转语义 |
| DEC-PRD-049 | `M05-catalog-zone.md`、`M16-layout.md` | Confirmed AC | `AC-ST-04` | 导图文本预览跟随选中节点的最早叶子，而非播放位置 |
| DEC-PRD-050 | `M05-catalog-zone.md` | Proposed | 节点框 scrub 尚无生产行为 AC | 目录展开模式中可在节点框内横向 scrub 对应时间范围 |
| DEC-PRD-051 | `M05-catalog-zone.md` | Proposed | 导图无编辑边界已记录；折叠和手势完整行为没有 Active AC | 导图无右键和多选，并允许用箭头折叠子树 |
| DEC-PRD-052 | `M05-catalog-zone.md` | Proposed | 依赖尚未验收的高级树编辑闭环 | 左树编辑后导图从同一 Store 自动同步 |
| DEC-PRD-053 | `M14-keyboard-shortcuts.md` | Proposed | 当前没有覆盖完整快捷键集、输入焦点门禁和 selectionOrigin 的生产 AC | 非输入态提供模式、播放、跳段、摘注、删除和面板快捷键 |
| DEC-PRD-054 | `M17-video-list.md` | Confirmed AC | `AC-ST-01` | v1 从列表打开单个 ready 视频；多视频标签留在 v2 |
| DEC-PRD-055 | `M17-video-list.md` | Confirmed AC | `AC-LV-02`、`AC-LV-06`、`AC-LV-10` | 导入立即产生卡片、后台串行处理并显示真实状态 |
| DEC-PRD-056 | `M02-data-model.md`、`M05-catalog-zone.md`、`M17-video-list.md` | Confirmed AC | `AC-ST-03`、`AC-ST-05` | 瞬时目录位置与持久最远进度分离，重开恢复 position |
| DEC-PRD-057 | `M13-visual-design.md`、`M17-video-list.md` | Proposed | 处理中状态受 `AC-LV-10` 控制；ready 卡片全部字段和精确网格没有 Active AC | ready 与非 ready 视频卡采用缩略图网格和不同信息层级 |
| DEC-PRD-058 | `M17-video-list.md` | Proposed | 数据库有排序实现级测试，但三档 UI 和默认选择没有产品 AC | 视频列表支持最近学习、导入时间、名称三种排序 |
| DEC-PRD-059 | `M01-positioning.md`、`M17-video-list.md` | Proposed | 标题查询有实现级测试；搜索 UI 与无筛选边界没有 Active AC | v1 只按标题关键词搜索，不建设标签、筛选或跨视频正文检索 |
| DEC-PRD-060 | `M15-data-persistence.md`、`M17-video-list.md` | Proposed | `AC-LV-13` 已确认数据库级联删除和保留本地源文件；M17 同时要求删除应用缩略图，但当前没有覆盖派生文件清理/GC 的 Active AC | 删除视频以单事务级联业务数据、删除应用缩略图，并保留用户本地源文件 |
| DEC-PRD-061 | `M17-video-list.md` | Out-of-scope | v1 不提供学习数据或视频导出 | 暂不实现导出 |
| DEC-PRD-062 | `M17-video-list.md` | Proposed | 状态一致性受 `AC-LV-10` 控制，非 ready 任务详情入口受 `AC-LV-19` 控制；排序、搜索、顶栏和空状态仍没有完整 Active AC | 列表提供导入、排序、搜索、空状态和非 ready 任务入口 |
| DEC-PRD-063 | `M13-visual-design.md` | Proposed | 暗色主题存在于实现，但没有 Active AC 禁止亮色或跟随系统 | 只提供暗色主题 |
| DEC-PRD-064 | `M13-visual-design.md` | Proposed | 中性色阶没有产品级视觉 Judge | 背景、面板、分隔和文字采用四档中性色阶 |
| DEC-PRD-065 | `M13-visual-design.md` | Proposed | 控件强调语义没有产品级视觉 Judge | 不使用品牌强调色，控件依靠灰白、明暗和字重 |
| DEC-PRD-066 | `M13-visual-design.md` | Proposed | 四个 CSS 颜色令牌有局部 Harness，但全界面唯一彩色语义没有 Active AC | 四种段落类型拥有全界面唯一的蓝、绿、橙、灰映射 |
| DEC-PRD-067 | `M13-visual-design.md` | Proposed | 选中态跨组件一致性没有产品级 Judge | 所有选中态以变暗表示 |
| DEC-PRD-068 | `M13-visual-design.md` | Proposed | 播放态与选中态叠加没有产品级 Judge | 当前播放变亮，选中与播放同现时叠加暗底和白亮条 |
| DEC-PRD-069 | `M13-visual-design.md` | Proposed | 状态色的跨列表语义没有 Active AC | 失败红、处理中黄、排队灰独立于强调色 |
| DEC-PRD-070 | `M13-visual-design.md` | Proposed | 目录节点填充与文字色没有生产视觉 AC | 段落进度用类型色，容器用中性色，节点文字保持白色 |
| DEC-PRD-071 | `M13-visual-design.md` | Proposed | 类型胶囊精确视觉没有生产视觉 AC | 文本区类型胶囊保留类型色文字、淡底和细边 |
| DEC-PRD-072 | `M13-visual-design.md` | Out-of-scope | 本行的部分卡片细节已由 DEC-PRD-077 明确替代；当前以 077 为准 | 早期列表卡片视觉草案不再单独作为当前合同 |
| DEC-PRD-073 | `M13-visual-design.md` | Proposed | 字体族和字重有实现但没有 Active AC | 使用系统无衬线单族、等宽数字特性和 400、600、700 字重 |
| DEC-PRD-074 | `M13-visual-design.md` | Proposed | 字号令牌有局部 Harness，但应用范围没有 Active AC | 使用 18、16、14、13、12 五档字号 |
| DEC-PRD-075 | `M13-visual-design.md` | Proposed | 阅读文本行距没有产品级 Judge | 正文、标题、次正文分别采用 1.7、1.3、1.5 行距 |
| DEC-PRD-076 | `M13-visual-design.md` | Proposed | 间距和圆角令牌有局部 Harness；阴影和关键高度的实际使用没有 Active AC | 统一间距、圆角、阴影和关键区域高度令牌 |
| DEC-PRD-077 | `M13-visual-design.md`、`M17-video-list.md` | Proposed | 卡片和空状态的精确生产视觉没有 Active AC | 视频列表使用 240px 下限响应式网格、16:9 缩略图和规定信息布局 |
| DEC-PRD-078 | `M13-visual-design.md` | Proposed | 字幕存在于历史规格；位置、尺寸、阴影与原文限定没有生产 AC | 视频字幕使用底部半透明框、16px 白字与原文逐句内容 |
| DEC-PRD-079 | `M13-visual-design.md` | Proposed | 导图选择与跳转受 `AC-ST-04` 控制；节点视觉、连线、缩放和平移没有 Active AC | 导图使用类型色节点、正交圆弧连线和限定缩放平移 |
| DEC-PRD-080 | `M13-visual-design.md` | Proposed | 文本助手核心受 `AC-ST-07` 控制；对话气泡、当前帧、芯片和输入手势没有统一 AC | 右侧助手采用气泡、快捷芯片、多行输入和当前帧提示 |
| DEC-PRD-081 | `M13-visual-design.md` | Proposed | 三档时长令牌有局部 Harness；动效映射和减少动效行为没有 Active AC | 动效统一为 120、200、320ms 并尊重系统减少动效设置 |
| DEC-PRD-082 | `M19-settings.md` | Confirmed AC | `AC-LV-12`、`AC-LV-14`、`AC-LV-15`、`AC-LV-16`、`AC-MM-03`、`AC-MM-04` | 模型池、角色选择、测试、vision 声明与本地 Whisper 安装门禁形成设置闭环 |
| DEC-PRD-083 | `M15-data-persistence.md`、`M18-long-video.md`、`M20-architecture.md` | Proposed | 导入取消受 `AC-LV-07`、助手停止受 `AC-ST-07` 控制；结构编辑撤销与重做仍无 Active AC | 导入可取消、助手流可停止，结构编辑保留会话内撤销栈 |
| DEC-PRD-084 | `M15-data-persistence.md` | Confirmed AC | `AC-LV-04`、`AC-LV-08`、`AC-LV-14`、`AC-ST-01`、`AC-ST-06` | SQLite、应用数据目录、统一 node、设置和恢复共同构成持久化事实源 |
| DEC-PRD-085 | `M04-ai-processing.md`、`M19-settings.md` | Proposed | 语言结果原子保存受 `AC-LV-04`、角色能力受 `AC-LV-12` 控制；三档纯自动检测和不可覆盖尚无完整 AC | ASR 自动检测主语言，英文触发翻译，用户不手动覆盖 |
| DEC-PRD-086 | `M07-text-zone.md` | Proposed | 原文播放和上下文已有 AC；翻译块、默认开关和不做句级高亮没有 Active AC | 英文段落在原文下显示中文翻译并由独立译文开关控制 |
| DEC-PRD-087 | `M10-ai-assistant.md` | Confirmed AC | `AC-ST-07` | 英文视频的助手上下文使用原始句子，不自动混入翻译 |
| DEC-PRD-088 | `M15-data-persistence.md` | Proposed | 高级树编辑及其会话内约 20 步撤销边界没有 Active AC | 撤销栈不跨会话，重做可选 |
| DEC-PRD-089 | `M15-data-persistence.md`、`M18-long-video.md` | Confirmed AC | `AC-LV-08` | 取消后的重试复用与中断恢复相同的有效检查点规则 |
| DEC-PRD-090 | `M18-long-video.md` | Proposed | 合并失败关闭与恢复受 `AC-LV-05`、`AC-LV-08` 部分控制；跳过合并直接学习没有 Active AC | 合并失败可只重试合并，也可显式跳过合并使用分块树 |
| DEC-PRD-091 | `M16-layout.md` | Proposed | 当前没有同时裁判字幕与译文两个独立开关的生产 AC | 字幕开关只管视频原文字幕，译文开关只管文本翻译块 |
| DEC-PRD-092 | `M20-architecture.md` | Proposed | M20 局部 Harness 禁止 LLM Tauri command；尚无 Active AC 把全部 Stage2、合并和助手直连职责作为合同 | 所有 LLM 请求由前端直接连接 OpenAI-compatible 接口 |
| DEC-PRD-093 | `M20-architecture.md` | Confirmed AC | `AC-AR-01` | 业务经前端公共数据库边界使用 SQL plugin；跨记录原子写由专用 Rust 事务 command 完成，不建设通用 Rust DAL |
| DEC-PRD-094 | `M20-architecture.md` | Confirmed AC | `AC-LV-03`、`AC-MM-01`、`AC-MM-02`、`AC-MM-04` | 本地 ASR 使用 Rust whisper-rs，并以安装与能力门禁约束模型 |
| DEC-PRD-095 | `M20-architecture.md` | Confirmed AC | `AC-LV-17` | 在线 URL 通过用户 PATH 中的 yt-dlp 形成受控本地媒体 |
| DEC-PRD-096 | `M20-architecture.md` | Proposed | 真实视频打开与跳转受 `AC-ST-01`、`AC-ST-02` 控制；convertFileSrc 和全 scope 的架构取舍没有 Active AC | 本地媒体和缩略图通过 convertFileSrc 与 asset protocol 播放 |
| DEC-PRD-097 | `M20-architecture.md` | Confirmed AC | `AC-LV-10` | 长任务进度和终态通过 Tauri event 推送到列表与导入界面 |
| DEC-PRD-098 | `M20-architecture.md` | Confirmed AC | `AC-LV-07`、`AC-LV-10` | 长任务异步调度、串行执行，并通过取消令牌停止 |
| DEC-PRD-099 | `M20-architecture.md` | Proposed | Store 顺序与学习事实分别受 `AC-LV-16`、`AC-ST-03`、`AC-ST-08` 控制；完整 Zustand 缓存与不持久业务数据边界没有单独 AC | Zustand 只保存 UI 会话态与当前视频缓存，持久业务事实留在 SQLite |

## 读取结论

- 41 条决策已有覆盖其当前概括行为的 Confirmed AC。
- 54 条决策保留为 Proposed；其中大量行为可能已有局部实现或组件 Harness，但尚不能形成完整完成声明。
- 4 条决策当前为 Out-of-scope：手动分块、导图区编辑、v1 导出和被后续视觉决定替代的早期卡片草案。

这些数量只用于发现控制面缺口，不是项目完成百分比。下一条开发边界应从 Proposed 中按失控风险、用户价值、Judge 成本和 Owner 清晰度排序，而不是按编号顺序补齐。
