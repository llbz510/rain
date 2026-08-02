# M20 — 技术架构

> 状态：v5.2 已确认（第十一次会话，决策92-99）

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri |
| 前端 | React + TypeScript |
| 状态管理 | Zustand |
| 构建 | Vite |
| 数据库 | SQLite（tauri-plugin-sql） |
| 文件系统 | Tauri fs API |
| ASR | yt-dlp（字幕档）+ Whisper（本地，whisper-rs）+ API（云端） |
| LLM | OpenAI 兼容接口（前端直连，用户自选供应商） |

## 前后端职责分工（决策92-99）

### Rust 后端（Tauri）= 重活 + 系统 I/O

| 职责 | 说明 |
|------|------|
| 本地 Whisper 推理 | whisper-rs Rust binding（决策94），模型文件存 `whisper-models/`（决策84） |
| yt-dlp 子进程 | 解析在线 URL + 下载视频/字幕（决策95，用户自装加 PATH） |
| 文件 I/O | 缩略图生成、视频时长探测、在线视频下载到 `videos/<videoId>/` |
| SQLite 原子事务 | 只为跨记录/跨表不变量提供专用 SQLx transaction command，不建设通用 DAL（决策93） |
| 视频路径桥接 | convertFileSrc 转 asset://（决策96） |
| 长任务调度 | tokio async task 跑 ASR，Tauri event 推进度（决策97/98） |

### 前端（React）= UI + 数据 + LLM

| 职责 | 说明 |
|------|------|
| UI 渲染 | 三模式四区、所有交互 |
| 状态管理 | Zustand 存 UI 会话态 + 当前视频缓存（决策99） |
| SQLite 读写 | 业务只调用公共 Database interface；普通读写由内部 module 经 tauri-plugin-sql 执行（决策93） |
| LLM 调用 | Stage2/合并/AI 助手全部前端直连 OpenAI 兼容接口（决策92） |

## 已确认决策（第十一次会话）

### 决策92 LLM 调用 = 全部前端直连
- Stage2 结构化 / 合并 / AI 助手流式对话的 LLM 调用都在 React 侧（OpenAI 兼容 SDK）
- 前端从 `setting` 表读 API Key（决策84 明文存），直连供应商
- AI 助手流式：SSE 直达 UI，`AbortController` 原生取消（决策83 AI 停止）
- Rust 后端不代理 LLM，专注 ASR/yt-dlp/文件 I/O
- 理由：流式体验最好、Key 本就明文无额外泄露、职责干净

### 决策93 SQLite 访问 = 前端公共边界 + 专用 Rust 原子事务
- 2026-07-29 经用户确认收窄为 `AC-AR-01`：页面、Store、Pipeline 和设置流程只能调用 `@/models/database` 的业务 interface，不得直接访问 SQL plugin 或数据库内部 module
- 只有 `src/models/database.ts` 装载 `tauri-plugin-sql`；普通单记录读写由公共入口背后的数据库内部 module 执行参数化 SQL
- 跨记录或跨表原子不变量不能由前端发送 `BEGIN/COMMIT`；必须通过一次深 Tauri command 进入专用 Rust persistence module，在一个 SQLx 连接事务中完成
- Rust 只拥有这些明确的原子事务，不建设通用 DAL；`commands.rs` 保持路径、参数和错误适配职责
- 内存 adapter 只提供快速行为反馈，真实 SQLite 原子性由 Rust transaction tests 或真实桌面 Evidence 裁判

### 决策94 本地 Whisper = whisper-rs Rust binding
- 用 `whisper-rs` crate（whisper.cpp 的 Rust binding）；模型与 Sentence 契约保持统一
- 模型文件存 `whisper-models/`（决策84），大小可切（M19）
- 2026-07-31 的 `DEC-007 / AC-LV-21` 更新执行架构：CPU adapter 留在不链接 CUDA 的 Rain 主进程，NVIDIA CUDA 由独立 `rain-whisper-cuda` worker adapter 承担；两者位于同一个 `whisper_backend` seam 后
- 默认 `Auto` 先探针 CUDA worker，失败可见并回退 CPU；显式 GPU 失败关闭，显式 CPU 不启动 worker
- worker 不是 Python 或第三方 CLI，而是 Rain 自有、版本化 JSON 协议的推理进程；它隔离 CUDA DLL 装载、GPU 崩溃和取消，避免无 CUDA 机器无法启动主程序
- 词级时间戳+按标点分组为句级（决策32）保持不变

### 决策95 yt-dlp = 用户自装加 PATH
- 应用不打包 yt-dlp，用户自行安装并加入 PATH
- 在线 URL 导入前检测 yt-dlp 是否可调用，缺失则提示用户安装 + 给出官方链接
- Rust 子进程调用 `yt-dlp`（解析元信息/下载视频/抓字幕轨）
- 首次用在线 URL 导入会卡在检测提示，但避免打包体积膨胀

### 决策96 视频播放 = convertFileSrc + assetProtocol scope 全放行
- 用 Tauri `convertFileSrc(filePath)` 把本地路径转 `asset://localhost/...` 给 `<video src>`
- Tauri 配置 `assetProtocol.scope: ["**"]` 全放行（个人不联网，省白名单配置）
- 本地视频引用原路径（决策84）、在线视频下载后也是本地文件，统一走这套
- 缩略图同理（convertFileSrc）
- 理由：不是为安全，是 `<video>` 标签物理上读不了 `file://`，必须走协议桥接

### 决策97 进度推送 = Tauri event
- Rust 跑 ASR/Stage2/合并时用 `app_handle.emit("progress", payload)` 推进度到前端
- 前端 `listen("progress", ...)` 监听，更新 Zustand + M17 卡片/导入框
- payload = 决策30 的 progress 对象（stage/blockCurrent/blockTotal/percent/retrying）
- 任务完成/失败/取消也走 event（不轮询）

### 决策98 长任务调度 = tokio async task
- ASR/合并等长任务用 tokio async task 跑，不阻塞 Tauri 主线程
- 前端 `invoke("start_import", {...})` 启动任务后立即返回（不 await 完成），进度走 event
- 并发 = 1（决策55 一次只导一个，其余排队），前端维护队列
- 取消 = 给 Rust task 发 `CancellationToken` 信号（决策83 导入取消）
- UI 永远流畅

### 决策99 Zustand 状态边界 = 只存 UI 会话态 + 当前视频缓存
- **UI 会话态**：当前打开视频 id、选中节点、`selectionOrigin`（tree/diagram，决策53）、播放位置/进度、三模式开关、撤销栈（决策83）、字幕/译文开关（决策91）、AI 对话面板状态、随记编辑态、导入队列、导入框开关
- **当前视频缓存**：当前打开视频的 node 树 + sentences + notes，查库一次缓存，结构编辑直接改缓存+写库
- **不缓存**：其他视频的数据、视频列表（列表每次从库查，轻量）
- **不持久业务数据到 Zustand**：video/node/sentence/note 一律在 SQLite，重开视频从库重读
- 撤销栈会话内不持久（决策83），重启清空

## 数据流总览

```
导入视频
  前端 invoke("start_import", {videoId, source, url/path})
    → Rust: yt-dlp 解析 URL（在线）/ 探测时长+生成缩略图（本地）
    → Rust: ASR（tokio task，event 推进度）
      ├─ 字幕档：yt-dlp 抓字幕轨
      ├─ API 档：调云端 ASR
      └─ 本地档：whisper-rs 推理
    → ASR 完成，通过专用 Rust transaction command 原子写 sentence 与 Video 阶段（决策84/93）
    → 前端直连 LLM 跑 Stage2（短）/ M18 分块多次（长）
    → 前端直连 LLM 跑合并（长视频）
    → 通过专用 Rust transaction command 写 node、句子归属与 video.status=ready
  全程 event 推进度，前端 live 更新卡片+导入框

学习界面
  打开视频 → 前端公共 Database interface 查 video + node 树 + sentences + notes → 缓存进 Zustand
  播放 → <video src=convertFileSrc(path)>，播放位置写 Zustand（定期同步 position 到 video 表）
  结构编辑 → 未来 AC 必须通过公共 Database interface；跨记录原子写进入专用 Rust transaction
  AI 助手 → 前端直连 LLM，SSE 流式，AbortController 取消
  摘注/随记 → 公共 Database interface 通过单个 Rust transaction 写 note + note_sentence 表
```

## 实现细节（已隐含，非决策）

- **缩略图生成**：Rust 侧用 ffmpeg 抽首帧/指定帧 → 写 `thumbnails/<videoId>.jpg`（ffmpeg 随 Tauri 或系统调用，实现时定）
- **视频时长**：Rust 侧 ffprobe 探测，写 `video.duration`
- **在线视频下载**：yt-dlp 下载到 `videos/<videoId>/`（决策84）
- **ASR 标准化**：Rust 侧把三档输出统一为 `Sentence[]`（决策32），再由 `save_asr_atomically` 事务写入
- **撤销栈实现**：Zustand 存逆操作队列，~20 步上限（决策83/88）
