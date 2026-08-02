# Rain Core Release Acceptance Contract

> 状态：`Active — user confirmed; formal control migration complete`
> 更新日期：2026-08-02
> 路线图位置：M1-S2 Confirm Release AC
> 上游范围：Active [`release-scope-contract.md`](release-scope-contract.md)
> 授权边界：用户已于 2026-08-02 整体确认本文件。正式语义迁入 `acceptance-standard.md`、当前强度迁入 `harness-coverage.md`；本次确认仍不授权产品实现、外部 workflow、签名或 Evidence。

## 1. Slice Contract

| 字段 | 本轮合同 |
| --- | --- |
| Slice | M1-S2：确认并迁移完整 Release AC matrix |
| Observable result | 用户可一次审阅首发下载物、生命周期、发布门禁和 31 条 Launch 决策的逐行 AC 去向 |
| In scope | 20 条发布/生命周期 Confirmed AC；7 条视频列表 AC；7 条学习页 AC；6 条视觉/可访问性 AC；5 条性能/长运行 AC；5 条架构 AC；31 条 Launch 决策逐行 traceability；risk 22 两项独立路由 |
| Out of scope | 产品代码；锁定 Harness 测试；安装器运行；模型/GPU/视频/外网 Evidence；workflow；签名或法律批准 |
| Owner | 本文件保存确认与 traceability；`acceptance-standard.md` 和 `harness-coverage.md` 接管正式 AC/覆盖语义 |
| Judge | AC ID 唯一；每条 AC 只有一个可独立裁判的结果；31 条 Launch 决策逐行映射 Confirmed AC；发布队列 13 类缺口全部映射；Post-release/Out-of-scope 不泄漏；独立只读 Spec + Standards 审查 |
| Evidence tier | 文档控制面 + 独立审查；本轮不产生运行时 Evidence |
| Allowed writes | 本文件、`acceptance-standard.md`、`harness-coverage.md`、`product-decision-coverage.md`、`module-map.md`、`release-scope-contract.md`、`control-map.md`、两份 Active 计划、Harness Migration 记录和 `PROJECT_STATE.md` |
| Locked files | `harness/`、`src-tauri/tests/`、产品源码、workflow 和 Evidence |

## 2. 已确认首发产品细节

除 M1-S1 已确认的范围外，用户于 2026-08-02 进一步确认以下 Release 细节：

1. 首个公开版本为 `Rain 0.1.0`，只发布 Windows x64。
2. 用户可见下载物只有一个 NSIS `.exe` 安装器，建议命名 `Rain_0.1.0_x64-setup.exe`，通过 GitHub Releases 发布；不同时发布 MSI、portable、CPU-only 或其他平台安装包。
3. 同一安装包包含 CPU-safe Rain 主程序、CPU adapter 和隔离 CUDA worker/runtime。无兼容 NVIDIA 环境仍可安装、启动并使用 CPU。
4. 安装器卸载默认只移除程序文件，保留 SQLite、设置、笔记、模型和应用拥有的媒体派生文件，供重装恢复；用户源视频永不由卸载器删除。发布文档提供明确的“彻底清理应用数据”人工步骤，但首发不增加卸载器删除数据复选框。
5. 首次正式发布必须在已有同 identifier 的安装场景中读取并原子迁移一个冻结的 `c2eb4c4` 数据库/设置 fixture；该 fixture 不冒充不存在的旧正式安装器。后续版本还必须覆盖“上一公开版本 → 当前版本”。升级失败保留可恢复备份并拒绝进入半迁移应用。
6. P0、P1 和影响 Launch AC/数据/安全/Evidence 真实性的 P2 阻断 RC；普通非阻断 P2 必须进入 Release Notes 或后续队列。

以上六项已经整体确认；后续改变任一项必须按对应 AC 重新走产品确认与 Harness Migration。

## 3. Confirmed Release AC registry — 20 条

| Confirmed AC | 单一可观察合同 | Owner | Judge / Evidence | 明确范围外 |
| --- | --- | --- | --- | --- |
| AC-RL-01 | 公开发布只有一个与目标 commit、`0.1.0`、`com.rain.app` 一致的 Windows x64 NSIS 安装器，GitHub Release 页面可定位其版本与 SHA | Tauri config、release build script、人类 release owner | 干净 checkout 构建；安装器 metadata/文件名/版本/commit manifest 一致；公开页只有一个安装下载物 | MSI、portable、自动更新、非 x64、非 Windows |
| AC-RL-02 | 单一安装器同时包含 CPU-safe 主程序/adapter 与隔离 CUDA worker/runtime；不存在第二个公开 CPU 包 | GPU bundle script、Tauri GPU overlay | 安装后主程序无 CUDA import；worker/runtime/manifest 齐全且不含 `nvcuda.dll`；公开 Release asset 只有该通用安装器 | 把 CUDA feature 加入主程序/默认 Harness；静默按需下载；驱动 DLL 再分发；发布文案由 AC-RL-18 控制 |
| AC-RL-03 | 干净 Windows x64 可完成安装、首次启动、Runtime Settings 就绪和正常退出，不读取开发树或预装 Rain 数据 | installer、Rain startup | 独立 release-evidence runner 在无 Rain 缓存/数据库的隔离机器真实安装；进程、安装路径、首次 schema 和脱敏日志 Evidence | 升级、模型/GPU 能力成功、业务长 E2E |
| AC-RL-04 | 同版本重装幂等：程序文件恢复到目标 manifest，已有设置/SQLite/模型不重复、不丢失，重装后可再次启动 | installer lifecycle owner | `0.1.0 → 0.1.0` 真实重装；前后数据摘要、文件 manifest、启动日志 | 跨版本 schema 升级、手工覆盖程序目录 |
| AC-RL-05 | `0.1.0` 安装器在发现同 identifier 的冻结 `c2eb4c4` 数据/设置 fixture 时保留并交给版本化迁移；未来版本从上一公开安装版本升级；安装失败不得破坏原数据 | installer upgrade owner、database migration entry | 同 identifier 安装场景 + 冻结数据 fixture；安装失败故障注入；成功后交由 AC-RL-13 裁判迁移内容 | 假造旧正式 installer、任意更古老开发快照、跨主版本降级 |
| AC-RL-06 | 默认卸载移除程序文件和注册项但保留用户数据/模型/设置/派生文件；重装恢复；用户源视频永不删除；彻底清理步骤在文档中显式列出 | installer uninstall owner、app-data policy | 卸载前后文件/注册/数据库摘要；重装恢复；源视频哈希不变；人工清理文档复核 | 首发卸载器内“删除全部数据”复选框、自动删除用户源媒体 |
| AC-RL-07 | 无 NVIDIA GPU/驱动/CUDA runtime 的干净 Windows 安装同一候选包后可启动，`Auto` 显示原因并完成真实 CPU 短样本 | `whisper_backend`、universal installer | 隔离 Evidence runner 记录硬件/驱动清单、安装器哈希、主程序 CUDA import 检查、真实短媒体/模型非空单调句子、实际 backend=`cpu` | fake worker、开发 override、只做 DLL 字符串检查 |
| AC-RL-08 | 受支持 NVIDIA Windows 安装同一候选包后，Auto/Forced CUDA/Forced CPU、取消与失败分类符合 `AC-LV-21` 并完成真实短样本 | `whisper_backend`、CUDA worker、universal installer | 独立 Evidence runner 记录 GPU/驱动、包/模型哈希；Auto 与 Forced CUDA 真实输出；Forced CPU 不启动 worker；取消/崩溃/模型错误 Evidence | 把本机旧 smoke 自动继承给 RC、跨所有 NVIDIA 型号承诺 |
| AC-RL-09 | 公开 installer 和主可执行文件使用受信任 Windows 代码签名；私钥不进入仓库、日志或 artifact | 人类 release/security owner、签名流水线 | 目标下载物离线/在线签名验证、证书链/时间戳记录、secret scan | AI 自批证书、仓库保存私钥、自签名证书作为正式证明 |
| AC-RL-10 | 每个 RC/正式下载物同时发布 SHA-256、机器可读 artifact manifest、SBOM 和第三方 notices，且全部来自同一目标 SHA | release manifest generator | 从安装器反算哈希；依赖/资源与 SBOM/notices 对账；目标 SHA/构建环境可定位 | 法律批准、运行时能力 Evidence |
| AC-RL-11 | CUDA runtime 再分发在公开发布前取得人类 release/legal owner 的书面批准，批准范围与实际 DLL/版本一致 | 人类 release/legal owner | 签署记录、DLL 清单/版本/来源/许可证逐项对账 | AI 或测试代替法律判断；分发 `nvcuda.dll` |
| AC-RL-12 | 发布产物不含 live key、调试 override、开发绝对路径、SQLite/用户数据、日志、旧 Evidence、source map 秘密或未批准 DLL | artifact hygiene scanner、release owner | 解包 installer 扫描；secret/path/denylist；允许资源 manifest 精确白名单 | 证明业务行为、替代代码审查 |
| AC-RL-13 | 数据库从冻结旧 fixture 通过版本化事务迁移到当前 schema；失败回滚或保留可恢复备份，重复启动幂等 | Database deep module、Rust migration command | 真实旧 SQLite fixture；生产初始化路径；成功数据/约束检查；逐步故障注入、备份和第二次启动 | 只测空库；前端发送事务控制 SQL；支持未冻结任意 schema |
| AC-RL-14 | RC Evidence 只对精确 commit、installer hash、配置/模型/硬件指纹有效；影响对应边界的代码或产物变化使其失效 | Evidence manifest/validator、release evidence owner | freshness policy 自动比较 target SHA/hash/config；过期 Evidence 必须被拒绝而非警告放行 | 自动删除历史 Evidence；把单元测试升级成真实 Evidence |
| AC-RL-15 | P0/P1 和影响 Launch AC、数据/秘密安全或 Evidence 真实性的 P2 阻断发布；非阻断 P2 必须进入 Release Notes 或已拥有 Owner/Judge 的后续队列 | human release owner、defect policy | 缺陷/审查 fixture 逐级触发阻断或允许；发布决策与例外有签署记录 | 用 skip/ignore 降低严重度、在本 AC 执行回滚 |
| AC-RL-16 | 正式 tag 只引用已验收 RC；从用户可见 URL 重新下载的安装器与 RC 的签名、SHA-256 和 manifest 完全一致并可干净安装 | release publication owner | 独立 download verifier 完成 tag/commit/RC 对账、公开 URL 二次下载和签名/哈希/安装复验 | 发布后重新构建不同二进制；只核对文件名 |
| AC-RL-17 | 首轮生产观察只收集用户明确授权的脱敏诊断，不上传视频、转录、API Key 或 SQLite；缺陷绑定版本、AC、Judge 和严重度 | support/privacy owner、diagnostic exporter | 同意流程、诊断 schema/secret scan、撤回/不上传路径、首轮缺陷记录 | 默认遥测、远程采集用户内容、把观察当成 AC Evidence |
| AC-RL-18 | 下载页与安装器在安装前披露单一安装包、约 804 MB、NVIDIA/模型要求、无兼容环境的 Auto 可见 CPU fallback、Forced CPU/GPU、失败/重试和数据保留 | release/download disclosure owner、installer UI | 下载页 + 安装器真实 UI/文本 Judge，并与 installer manifest、GPU/runtime 行为 Evidence 对账；不得把受控 URL 写成真实站点保证 | Release Notes、营销性扩大承诺、未验证硬件/模型兼容性 |
| AC-RL-19 | 回滚只能到签名、哈希已知且与当前用户数据兼容的已验收版本；不兼容时停止分发并提供备份/恢复指引，不静默降级 schema | human release owner、rollback runbook、database compatibility owner | 已安装 RC 回滚演练；签名/哈希/数据库兼容检查；不兼容 fixture 必须拒绝并保留数据 | 缺陷严重度判定、自动跨主版本降级 |
| AC-RL-20 | Release Notes 精确列出 Launch、Post-release 与不承诺能力、已验证配置、已知限制、非阻断 P2 和回滚方式，且不得把候选或局部 Evidence 写成已交付事实 | release notes owner、scope contract | Release Notes 与 Active scope、Confirmed AC/coverage、目标 artifact、有效 Evidence、缺陷队列和回滚 runbook 逐项对账 | 下载页/安装器 UI、营销性扩大承诺、未验证硬件/模型兼容性 |

## 4. Confirmed product and architecture AC registry — 30 条

### 4.1 视频列表与派生文件 — 7 条

| Confirmed AC | 单一可观察合同 | Owner | Judge / Evidence | 明确范围外 |
| --- | --- | --- | --- | --- |
| AC-VL-01 | ready/non-ready 卡片按持久状态展示规定的信息层级，状态、错误、进度和可用动作不互相伪装 | VideoListPage 查询层、VideoCard | 生产页面 + 公共数据库双 adapter；各状态 DOM/视觉 Judge；错误动作可恢复 | 排序、搜索、网格尺寸、真实桌面 Evidence |
| AC-VL-02 | 列表默认最近学习，并支持最近学习/导入时间/名称三种确定排序；SQLite 与内存 adapter 同义 | Database query interface、VideoListPage controls | 同一 fixture 在双 adapter 和生产 UI 中顺序一致；稳定 tie-breaker | 标签、筛选、正文搜索 |
| AC-VL-03 | 标题关键词搜索只作用于视频标题，可清空并与当前排序组合；没有结果与数据库失败可区分 | Database query interface、VideoListPage controls | 双 adapter 大小写/空白/无结果 fixture + 生产 UI | 标签、笔记/字幕全文、模糊语义扩展 |
| AC-VL-04 | 生产列表页把导入入口、排序、搜索、空库、无搜索结果和非 ready 详情入口组合为完整可用页面，不出现空动作 | VideoListPage composition | 生产页面行为 Judge；空库/过滤空/失败/任务详情；必要桌面 DOM | 卡片精确视觉、真实站点兼容 |
| AC-VL-05 | 删除已知 Video 在数据库提交后删除其合法 app-owned 缩略图；失败语义可见且绝不删除用户源视频或任意路径 | Rust thumbnail lifecycle module、database deletion workflow | 隔离真实文件系统 + 真实 SQLite；非法 ID/path、删除失败、源视频哈希、重试 | 孤儿扫描、安装器卸载数据策略 |
| AC-VL-06 | 孤儿 GC 只删除 app-data `thumbnails/` 中不在数据库 keep-set 的合法缩略图，幂等、有界且失败可诊断 | Rust thumbnail lifecycle module | 隔离真实目录/SQLite keep-set；路径逃逸、并发新建、重复运行、部分失败 | 用户媒体、模型、任意 app-data 清理、启动时无界阻塞 |
| AC-VL-07 | 视频页使用 240px 下限响应式网格、16:9 缩略图和已确认的信息布局；窄宽度不裁掉主操作 | VideoCard + list layout | 生产桌面多 viewport DOM/截图 + 独立 visual reviewer | 移动端、亮色主题、列表虚拟化性能 |

### 4.2 学习页基础交互 — 7 条

| Confirmed AC | 单一可观察合同 | Owner | Judge / Evidence | 明确范围外 |
| --- | --- | --- | --- | --- |
| AC-SU-01 | 顶部目录以章节/小节顶行和段落底行横向展示，可滚动、自动定位当前项，以边缘渐隐提示可继续滚动，并在暂停后停止强制跟随 | Study catalog view、Study Navigation | 生产 StudyInterface + 真实播放位置；长目录、边缘渐隐、手动滚动、播放/暂停行为 Judge | 目录结构编辑、折叠、scrub |
| AC-SU-02 | 目录进度只由统一播放事实推导，章节/小节切换使用受控约 200ms 横向滑动反馈且不制造第二份时间状态 | Study catalog view、playPosition interface | 时间推进/跳转/暂停 fixture；横向滑动 DOM 样式、时长与 reduced-motion 状态；复用 `AC-ST-03` | 任意动画系统、持久化新的当前位置 |
| AC-SU-03 | 右侧面板以 AI/随记 Tab 切换，切换不丢助手会话、笔记草稿或当前学习事实，隐藏区不重复发起副作用 | Study Page Composition、assistant/notes owners | 生产页面切换、未完成流/编辑状态、重新显示 Judge | Vision、AI 笔记自动生成、多窗口 |
| AC-SU-04 | 三种布局的区域比例可调并跨会话恢复，布局变化不卸载媒体会话或改变选择/播放/笔记事实 | Study Page Composition、layout persistence | 生产页面拖拽/重启；Store/SQLite 设置；真实 media 实例稳定 | 任意窗口管理、无限布局、自定义主题 |
| AC-SU-05 | Core Release 只提供原文字幕开关；字幕来自真实当前句，位于视频底部半透明容器，关闭后不影响转录文本；不显示译文开关 | VideoZone、Study Session | 真实 media 时间推进 + 生产 DOM/截图；开关/重开；无翻译控件 | 翻译、外部字幕优先、字幕编辑 |
| AC-SU-06 | 导图以已持久结构显示类型色节点、正交圆弧连线，并支持有界缩放/平移/选择和既有双击导航 | mind-map view、Study Navigation | 生产数据/页面；缩放边界、平移、选择/播放区分、双击跳转、视觉 Judge | 折叠、scrub、reparent、多选结构编辑 |
| AC-SU-07 | 非输入态精确支持：`1/2/3` 分别切换随播/文本展开/目录展开布局；反引号摘注当前播放段；`Space` 播放/暂停；`←/→` ±5s；`Shift+←/→` ±10s；`↑/↓` 音量；`N/P` 选择下一/上一段、seek 到该段并同步更新预览；`Tab` 在 AI/随记面板间切换并把焦点送入目标面板输入框。输入态只保留 `Enter` 发送与 `Alt+Enter` 换行并屏蔽全局键。Core Release 的 `Del/Backspace` 必须禁用，因为高级树删除为 Post-release | Study shortcut controller、focus policy | 生产页面逐键、首/末段 no-op、各输入/编辑焦点、三布局映射、seek/选中/预览/面板焦点副作用 Judge | 树/导图键盘导航、AI 快捷操作、用户自定义键位、节点删除/编辑 |

### 4.3 视觉、可访问性和性能 — 11 条

| Confirmed AC | 单一可观察合同 | Owner | Judge / Evidence | 明确范围外 |
| --- | --- | --- | --- | --- |
| AC-UX-01 | 首发只提供暗色主题；背景/面板/分隔/文字使用冻结中性色阶，通用控件不用品牌强调色 | design tokens、production components | 全部首发页面生产截图/token 使用扫描 + visual reviewer | 亮色/系统主题、品牌色系统 |
| AC-UX-02 | 段落类型、选中、播放、失败/处理/排队、进度、容器和类型胶囊使用唯一且跨组件一致的语义映射 | semantic visual tokens、catalog/text/list/mind-map components | 多状态生产 fixture + 截图/DOM；禁止组件私建冲突颜色 | 新段落类型、用户自定义配色 |
| AC-UX-03 | 全应用使用系统无衬线、规定字重与 18/16/14/13/12 字号；阅读正文/标题/次正文采用已确认行距并在长文本保持可读 | typography tokens、production text components | token policy + 生产长文本多 viewport visual/accessibility review | 富文本编辑器、用户字体选择 |
| AC-UX-04 | 间距、圆角、阴影、控件和关键区域高度只使用冻结令牌；真实页面不存在偶然的一次性几何系统 | geometry tokens、production layout/components | token policy + 生产页面截图/DOM measurement；例外白名单 | 像素级适配所有 DPI、用户自定义密度 |
| AC-UX-05 | 交互动效只使用 120/200/320ms 档位；系统减少动效时取消位移/缩放并保留即时状态反馈 | motion tokens、production components | 浏览器/桌面 reduced-motion 模式；目录/面板/卡片真实状态 Judge | 视频播放动画、操作系统窗口动画 |
| AC-UX-06 | 所有 Launch 主操作可用键盘到达并有可见焦点、可访问名称和非纯颜色状态；文本/控件达到 AA 对比度阈值 | UI composition、accessibility policy | 生产页面 axe/DOM/键盘遍历 + 对比度检查 + 独立 accessibility review | 完整 WCAG 认证、读屏器全语言矩阵 |
| AC-PF-01 | 在冻结的 Windows x64 release-reference 机器上，冷启动至可交互的 10 次有效测量 p95 ≤5s | app startup owner | performance runner 记录正式候选包、空/典型数据 fixture、机器指纹和一次不计入的预备运行；每次杀净进程后执行真实冷启动，10 次有效样本以 p95 阻断 | 模型加载/推理、所有硬件保证 |
| AC-PF-02 | 500 视频固定 fixture 的列表首屏达到可操作状态的 10 次有效测量 p95 ≤2s | Database/List owner | performance runner 在正式候选包和固定 SQLite fixture 上每次重启，记录 10 次有效时间戳并以 p95 阻断 | 搜索全库基准、无限列表、所有硬件保证 |
| AC-PF-03 | ready 视频从用户打开到学习页骨架和已持久学习事实可见的 10 次有效测量 p95 ≤3s | Study Session owner | performance runner 使用正式候选包、固定 ready fixture/本地媒体，重置到同一列表状态后打开 10 次并以 p95 阻断 | 视频首帧解码、模型调用 |
| AC-PF-04 | 已被生产 Controller 接收的合法导入进度到任务详情可见反馈 p95 ≤500ms | progress contract/Controller/UI owners | performance runner 对固定事件序列和生产页面记录至少 100 次端到端时间戳并以 p95 阻断 | 外部下载/ASR/LLM 本身速度 |
| AC-PF-05 | 正式候选包先预热 5 分钟，再连续 25 分钟重复列表/学习/导入取消：每轮结束 listener/worker/子进程计数不得高于预热基线，working set 线性回归斜率 ≤1 MiB/min 且末值 ≤预热基线 +50 MiB；退出后无 Rain 子进程残留 | App lifecycle、Import/Whisper owners | reliability runner 执行固定操作循环，记录进程/句柄/listener/working-set 时间序列、基线、回归计算和退出后进程检查；独立 reliability review | 模型自身固定内存、跨日 soak、所有第三方驱动泄漏保证 |

### 4.4 架构边界与 risk 22 — 5 条

| Confirmed AC | 单一可观察合同 | Owner | Judge / Evidence | 明确范围外 |
| --- | --- | --- | --- | --- |
| AC-AR-02 | Stage2、合并和文本助手的 OpenAI-compatible 请求只由前端 LLM adapter 发起；Rust/Tauri 不新增 LLM HTTP command | `src/llm/`、capability/request workflows | 生产请求接口测试 + 负向 dependency/command policy；真实模型按角色 Evidence | 本地 Whisper、代理服务器、Vision |
| AC-AR-03 | 本地媒体/缩略图只通过限定 app-owned/用户明确选择路径的 asset protocol 能力暴露；生产 scope 不允许通配任意文件系统 | Tauri capability/asset scope、localMediaUrl adapter | capability config 负向 policy + 允许/拒绝真实路径桌面 Judge；路径规范化 | 通用文件浏览器、任意 `convertFileSrc`、网络 URL policy |
| AC-AR-04 | SQLite 是跨会话业务事实源，Zustand 只保存当前会话选择/播放/UI 草稿；重启不得从 Store 恢复伪业务事实，页面不得复制持久化 | Database interfaces、Store/session owners | 重启/重新加载行为 Judge + dependency policy + 双 adapter | 替换 Zustand、通用 Rust DAL、云同步 |
| AC-AR-05 | `VideoImportController` 由显式 App-scope Owner 持有；页面真正卸载/重挂仍保持同一任务、取消、single-flight 和同记录更新 | App import owner、VideoImportController | 生产 App 路由卸载/重挂 Judge；后台任务与迟到结果；无双 Owner | 跨进程队列、启动自动扫描、新导入行为 |
| AC-AR-06 | 导入进度只允许五类判别：`download`（percent，可选 bytes）、`asr`（`extraction/transcription/finalization`、percent、backend/fallback）、`stage2`（percent、blockCurrent/blockTotal、retrying）、`merging`（percent）、`terminal`（`ready/failed/cancelled`，失败才有 error）。公共字段为 videoId；percent 必须 0..100 且同阶段不倒退，blockCurrent 必须在 1..blockTotal，terminal 后拒绝任何更新；本地导入可跳过 download，重试只可从持久 checkpoint 对应阶段重新开始 | progress domain contract、Pipeline/Controller/event adapters | compile-time exhaustive handling + 非法字段组合/未知阶段/倒退百分比/非法 block/终态后 mutation Judge + 全部真实阶段回归 | 新进度阶段、改变现有可见阶段顺序、重写整个 Pipeline |

### 4.5 Required Evidence tier — 50 条逐项预算

层级定义：`Strong` 表示生产公开接口或深 module 的确定性 Judge；`Release Evidence` 表示绑定目标 installer/SHA/真实 OS 或硬件的外部证据；`Desktop/Visual/Accessibility Evidence` 表示真实 Tauri/生产页面及相应独立 reviewer；`Performance/Soak Evidence` 表示冻结机器与 fixture 的统计或长运行；`Human approval` 表示 AI 和自动化不得自批的 release/legal 决定。组合层级必须全部满足。

| Candidate | Required Evidence tier | Graduation artifact |
| --- | --- | --- |
| `AC-RL-01` | Strong + Release Evidence | 干净 checkout 构建记录、installer metadata、公开 asset/SHA 对账 |
| `AC-RL-02` | Strong + Release Evidence | 二进制 import/resource manifest 与公开单一 asset |
| `AC-RL-03` | Strong + Release Evidence | 干净 Windows 首装/启动日志 |
| `AC-RL-04` | Strong + Release Evidence | 同版本重装前后数据/manifest |
| `AC-RL-05` | Strong + Release Evidence | 同 identifier 数据 fixture 的安装升级/故障注入 |
| `AC-RL-06` | Strong + Release Evidence | 卸载/重装/源视频哈希 Evidence |
| `AC-RL-07` | Strong + Release Evidence | 无 NVIDIA 环境安装、回退、CPU 短样本 |
| `AC-RL-08` | Strong + Release Evidence | NVIDIA 环境 Auto/Forced/取消/错误短样本 |
| `AC-RL-09` | Strong + Human approval + Release Evidence | 证书治理记录与目标 artifact 签名验证 |
| `AC-RL-10` | Strong + Release Evidence | SHA、manifest、SBOM、notices 对账 |
| `AC-RL-11` | Human approval + Release Evidence | 签署的 CUDA DLL/版本/许可清单 |
| `AC-RL-12` | Strong + Release Evidence | 解包 artifact hygiene/secret scan |
| `AC-RL-13` | Strong + Release Evidence | 真实旧 SQLite fixture 事务迁移、备份与失败回滚 |
| `AC-RL-14` | Strong | freshness validator 的目标 SHA/hash/config mutation Judge |
| `AC-RL-15` | Strong + Human approval | 缺陷分级 fixture 与签署的发布决定 |
| `AC-RL-16` | Strong + Release Evidence | 正式 URL 二次下载、签名/哈希/安装复验 |
| `AC-RL-17` | Strong + Production observation | 授权/脱敏诊断与首轮缺陷记录 |
| `AC-RL-18` | Strong + Desktop/Visual + Release Evidence | 下载页、安装器与 artifact/GPU runtime Evidence 对账 |
| `AC-RL-19` | Strong + Human approval + Release Evidence | 签名已知版本的回滚/拒绝降级演练 |
| `AC-RL-20` | Strong + Release Evidence | Release Notes 与 scope/AC/artifact/Evidence/缺陷/回滚逐项对账 |
| `AC-VL-01` | Strong + Visual Evidence | 生产卡片多状态 DOM/截图 |
| `AC-VL-02` | Strong | 双 adapter + 生产 UI 排序 |
| `AC-VL-03` | Strong | 双 adapter + 生产 UI 搜索 |
| `AC-VL-04` | Strong + Desktop Evidence | 生产列表页空库/无结果/失败/任务入口 |
| `AC-VL-05` | Strong | 真实 SQLite + 隔离文件系统删除 Judge |
| `AC-VL-06` | Strong | 真实 keep-set + 隔离目录 GC Judge |
| `AC-VL-07` | Strong + Desktop/Visual Evidence | 多 viewport 生产卡片截图/DOM |
| `AC-SU-01` | Strong + Desktop Evidence | 生产长目录、边缘渐隐与真实 playPosition |
| `AC-SU-02` | Strong + Desktop/Visual Evidence | 真实目录进度、约 200ms 横向转场和 reduced-motion |
| `AC-SU-03` | Strong + Desktop Evidence | AI/随记真实会话切换 |
| `AC-SU-04` | Strong + Desktop Evidence | 布局拖拽、重启与同一 media session |
| `AC-SU-05` | Strong + Desktop/Visual Evidence | 真实媒体原文字幕/开关/无译文控件 |
| `AC-SU-06` | Strong + Desktop/Visual Evidence | 真实结构导图交互与视觉 |
| `AC-SU-07` | Strong | 生产页面逐键/焦点/副作用 Judge |
| `AC-UX-01` | Strong + Visual Evidence | 全 Launch 页面 dark-only visual/policy |
| `AC-UX-02` | Strong + Visual Evidence | 跨组件语义状态 fixture/截图 |
| `AC-UX-03` | Strong + Visual/Accessibility Evidence | 长文本、多 viewport 字体/行距复核 |
| `AC-UX-04` | Strong + Visual Evidence | token policy 与页面几何 measurement |
| `AC-UX-05` | Strong + Desktop/Accessibility Evidence | 三时长与 reduced-motion 生产 Judge |
| `AC-UX-06` | Strong + Desktop/Accessibility Evidence | axe/键盘/名称/焦点/对比度与独立复核 |
| `AC-PF-01` | Strong + Performance Evidence | 冻结机器 10 次冷启动 p95 |
| `AC-PF-02` | Strong + Performance Evidence | 500 视频 fixture 10 次首屏 p95 |
| `AC-PF-03` | Strong + Performance Evidence | ready fixture 10 次学习页打开 p95 |
| `AC-PF-04` | Strong + Performance Evidence | 至少 100 次进度端到端 p95 |
| `AC-PF-05` | Strong + Soak Evidence | 5 分钟基线 + 25 分钟资源计数/内存斜率与退出进程检查 |
| `AC-AR-02` | Strong | 生产 LLM 接口 + 负向 command/dependency policy |
| `AC-AR-03` | Strong + Desktop Evidence | capability policy 与真实允许/拒绝路径 |
| `AC-AR-04` | Strong | 重启事实 + Database/Store dependency policy |
| `AC-AR-05` | Strong | 生产 App 卸载/重挂任务生命周期 Judge |
| `AC-AR-06` | Strong | exhaustive type + 非法 mutation/event + 全阶段回归 |

## 5. 31 条 Launch decision traceability

既有 Confirmed AC 继续保护“Existing control”列的局部边界；本轮新 Confirmed AC 按“Target Confirmed AC”列接管完整 Launch 行为。

| Decision | Target Confirmed AC | Existing control retained | Owner | Required Judge / Evidence | Out-of-scope preserved |
| --- | --- | --- | --- | --- | --- |
| DEC-PRD-011 | AC-SU-01 | AC-ST-03/04 | Study catalog view | 生产长目录 + 真实 playPosition 行为 | 编辑/折叠/scrub |
| DEC-PRD-012 | AC-SU-02、AC-UX-05 | AC-ST-03 | Catalog + motion tokens | 约 200ms 横向滑动、播放/跳转状态与 reduced-motion Judge | 新时间事实、任意动画系统 |
| DEC-PRD-013 | AC-SU-01 | — | Study catalog view | 滚动/居中/渐隐/暂停手动控制 | 折叠缩略 |
| DEC-PRD-022 | AC-SU-03 | AC-ST-06/07/08 | Study Page Composition | AI/随记真实会话切换与副作用 | Vision、AI 自动笔记 |
| DEC-PRD-023 | AC-SU-04、AC-SU-05 | AC-ST-08 | Layout + VideoZone | 拖拽/重启/同 media；原文字幕独立 | 翻译/译文开关、自定义布局 |
| DEC-PRD-053 | AC-SU-07、AC-UX-06 | AC-ST-02/04/06 | Shortcut/focus policy | 生产页面全焦点矩阵与副作用；Core 禁用 `Del/Backspace` | 全局/自定义快捷键、节点删除/编辑 |
| DEC-PRD-057 | AC-VL-01、AC-VL-07 | AC-LV-10/19 | VideoCard/List | 多状态 DOM/视觉 + 公共数据 | 排序/搜索 |
| DEC-PRD-058 | AC-VL-02 | AC-ST-05（最近学习事实） | Database query/List controls | 双 adapter + 生产 UI 排序 | 标签/筛选 |
| DEC-PRD-059 | AC-VL-03 | — | Database query/List controls | 双 adapter + 生产 UI 搜索 | 正文/笔记/标签检索 |
| DEC-PRD-060 | AC-VL-05、AC-VL-06 | AC-LV-13/18 | Thumbnail lifecycle + deletion workflow | 真实 SQLite/文件系统、源视频不变 | 用户媒体删除、任意 app-data 清理 |
| DEC-PRD-062 | AC-VL-02、AC-VL-03、AC-VL-04 | AC-LV-02/10/19/20 | VideoListPage composition | 空库/无结果/失败/任务入口生产 Judge | 真实站点、标签/正文搜索 |
| DEC-PRD-063 | AC-UX-01 | — | Theme/tokens | 全生产页 dark-only visual/policy | 亮色/系统主题 |
| DEC-PRD-064 | AC-UX-01 | — | Neutral tokens | 四档使用与视觉 Judge | 自定义色阶 |
| DEC-PRD-065 | AC-UX-01 | — | Control tokens | 控件跨页状态 visual Judge | 品牌强调色 |
| DEC-PRD-066 | AC-UX-02 | AC-LV-05（四类型） | Semantic tokens | 目录/文本/导图同 fixture | 新类型/自定义色 |
| DEC-PRD-067 | AC-UX-02 | AC-ST-03/04 | Semantic tokens/components | 跨组件选中态 visual Judge | 纯装饰主题 |
| DEC-PRD-068 | AC-UX-02 | AC-ST-03/04 | Semantic tokens/components | 播放+选择组合 fixture | 第二播放状态 |
| DEC-PRD-069 | AC-UX-02 | AC-LV-06/10 | Semantic status tokens | queued/processing/failed 跨列表 Judge | 任意品牌色 |
| DEC-PRD-070 | AC-UX-02 | AC-ST-03/04 | Catalog/mind-map visuals | 类型进度、容器、文字组合 | 导图编辑 |
| DEC-PRD-071 | AC-UX-02 | AC-LV-05 | Text/type capsule | 四类型生产长文本 visual Judge | 类型编辑菜单 |
| DEC-PRD-073 | AC-UX-03 | — | Typography tokens | 全页面字体/数字/字重 policy + visual | 用户字体 |
| DEC-PRD-074 | AC-UX-03 | — | Typography tokens | 五档字号实际用途与 accessibility | 任意字号编辑 |
| DEC-PRD-075 | AC-UX-03 | — | Typography tokens | 长文本行距/多 viewport visual | 富文本排版系统 |
| DEC-PRD-076 | AC-UX-04 | — | Geometry tokens | 生产页面 token/pixel Judge | 用户密度主题 |
| DEC-PRD-077 | AC-VL-07 | AC-LV-18（真实缩略图路径） | VideoCard/List layout | 多 viewport 生产桌面截图/DOM | 移动端/亮色 |
| DEC-PRD-078 | AC-SU-05 | AC-ST-03 | VideoZone | 真实媒体逐句字幕 + visual | 翻译/外部字幕优先 |
| DEC-PRD-079 | AC-SU-06 | AC-ST-04 | Mind-map view/Navigation | 真实结构、视觉、缩放/平移/跳转 | 折叠/scrub/结构编辑 |
| DEC-PRD-081 | AC-UX-05、AC-UX-06 | — | Motion/accessibility policy | 三时长 + reduced-motion 生产 Judge | OS 窗口/视频动画 |
| DEC-PRD-092 | AC-AR-02 | AC-ST-07、M20 局部 policy | Frontend LLM adapter | 生产请求 + 负向 command/dependency Judge | Vision/代理架构 |
| DEC-PRD-096 | AC-AR-03 | AC-LV-18（局部媒体） | Tauri asset capability | 允许/拒绝真实路径 + policy | 任意文件系统 scope |
| DEC-PRD-099 | AC-AR-04 | AC-AR-01、AC-ST-01/05/06 | Database + Store/session | 重启事实 + dependency policy | Store 替换/云同步 |

## 6. 非 Decision 行的必需路由

| M1-S1 obligation | Confirmed AC | Why independent | Required Judge |
| --- | --- | --- | --- |
| risk 22a App-scope import Owner | AC-AR-05 | 生命周期 Owner 迁移与 progress 类型无同一 Judge | 页面真正卸载/重挂、后台继续、取消、single-flight、同记录更新 |
| risk 22b discriminated progress contract | AC-AR-06 | payload 合法性与 Controller 生命周期无同一 Judge | 非法 mutation/event 必须失败，全部 producer/consumer exhaustive |

两项不得合并成一次 Controller/Pipeline 大重写；先分别建立 RED/行为保持基线，再实施最小迁移。

## 7. Release queue completeness

| M1-S1 第 5.2 节缺口 | Confirmed AC coverage |
| --- | --- |
| 安装包身份、版本、渠道 | AC-RL-01 |
| 单一 GPU 增强通用安装包与披露 | AC-RL-02、AC-RL-18 |
| 干净安装、重装、升级、卸载 | AC-RL-03、AC-RL-04、AC-RL-05、AC-RL-06 |
| 无 NVIDIA/CUDA | AC-RL-07 |
| NVIDIA Auto/Forced CPU/GPU | AC-RL-08 |
| 签名、SHA、SBOM、notices、CUDA 许可与 artifact 卫生 | AC-RL-09、AC-RL-10、AC-RL-11、AC-RL-12 |
| schema 升级/回滚/备份 | AC-RL-13 |
| app-owned 缩略图删除/GC | AC-VL-05、AC-VL-06 |
| 31 条 Launch traceability 与跨领域可访问性/性能预算 | 第 5 节、AC-UX-06、AC-PF-01、AC-PF-02、AC-PF-03、AC-PF-04、AC-PF-05 |
| DEC-PRD-092/096/099 | AC-AR-02、AC-AR-03、AC-AR-04 |
| risk 22a App-scope Owner | AC-AR-05 |
| risk 22b discriminated progress | AC-AR-06 |
| Evidence freshness、阻断、回滚、发布后观察与 Release Notes | AC-RL-14、AC-RL-15、AC-RL-16、AC-RL-17、AC-RL-18、AC-RL-19、AC-RL-20 |

## 8. 用户确认与正式迁移记录

用户于 2026-08-02 明确回复“确认”，整体接受第 2 节六项首发细节、50 条 AC、31 条 Launch 映射以及 risk 22a/22b 分开实施。该回复只授权后续控制面迁移；不授权同时修改产品代码、锁定测试、外部 workflow 或签发 Evidence。

该确认同时形成一项明确的首发产品修订：`DEC-PRD-053` 在旧 `M14-keyboard-shortcuts.md` 中包含删除快捷键，但更具体的 `AC-SU-07` 将高级树删除保留到 Post-release，并要求 Core 禁用 `Del/Backspace`。因此 decision coverage 的当前意图必须记录这一 supersede，不能宣称旧删除快捷键已由首发 AC 覆盖。`DEC-PRD-012/013` 的约 200ms 横向滑动和边缘渐隐仍属于 Launch，并由 `AC-SU-02/01` 明文接管。

正式迁移记录：[`harness-migration-2026-08-02-release-ac-control.md`](harness-migration-2026-08-02-release-ac-control.md)。迁移完成后，`acceptance-standard.md` 是正式语义源，`harness-coverage.md` 是当前实现/证据强度源，本文件保留确认与 traceability。

## 9. M1-S2 迁移完成条件

- Confirmed AC ID 恰好为 20 `AC-RL` + 7 `AC-VL` + 7 `AC-SU` + 6 `AC-UX` + 5 `AC-PF` + 5 `AC-AR`，共 50 条，无重复；
- 50 条 AC 在第 4.5 节各有一个明确 Required Evidence tier，并在正式 acceptance/coverage 中各出现一次；
- 当前 31 条 Launch decision 在第 5 节和 decision coverage 中各出现一次，无 Post-release/Out-of-scope 泄漏；
- M1-S1 第 5.2 节 13 类缺口全部有 Confirmed AC 去向；
- 每条 Confirmed AC 指定 Owner、Judge/Evidence 和明确范围外，当前 `Partial`/`Gap` 不被伪装成完成；
- 不修改锁定 Harness、产品源码、workflow 或 Evidence；
- `npm run harness:control`、机械矩阵检查和 `git diff --check` 通过；
- 独立只读 reviewer 按 Spec 和 Standards 检查范围、原子性、可裁判性、越权和假完成；
- 审查发现与关闭方式写入 `PROJECT_STATE.md`；
- 正式迁移独立审查通过后 M1 才退出，下一动作才进入 M2 Hosted replay。
