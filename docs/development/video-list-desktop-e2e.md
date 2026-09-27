# Video List 桌面 E2E（AC-VL-04 最小托管骨架）

> 状态：Active
> 更新日期：2026-09-27
> 作用：为 `AC-VL-04` 提供**真实桌面 DOM + 真实点击**的最小托管裁判骨架。它不是产品规格、不签发 `Visual Evidence`、不覆盖其他 AC。
> 位置：`scripts/run-video-list-e2e.ps1`（行为 Judge）、`.github/workflows/video-list-desktop-e2e.yml`（Hosted Windows 入口）、`src/e2e/real-e2e-runner.tsx` 的 `video-list` 短模式（受控夹具）、`src-tauri/src/e2e_config.rs`（E2E 门）。

## 1. 公开命令

```powershell
npm run e2e:video-list
```

脚本自持全部行为断言；`-SkipBuild` 只用于本机对已构建二进制的重放，Hosted workflow 一律不带该参数。

## 2. 裁判内容（AC-VL-04 的桌面条件）

判据是**真实 WebDriver 读到的生产桌面 DOM**与**真实点击**，不是截图：

| 条件 | 判据 |
| --- | --- |
| 视频列表页顶栏组合 | 标题 `Rain`、`input[aria-label="搜索视频标题"]`（`placeholder=搜索标题`）、`select[aria-label="排序"]` 的既有 3 个选项、`导入` 与 `设置` 两个原生按钮且可用 |
| 空库具名原生 CTA | 隔离空库上 `main` 内唯一按钮文本为 `导入你的第一个视频`、`type=button`、可用；**真实点击**后出现既有 `本地文件`、`在线视频` 两个菜单按钮，再真实点击 `导入` 关闭 |
| 过滤空状态 | 在真实卡片集合上（先确认卡片数 2）输入不匹配关键字后，`main` 出现具名 `没有找到匹配的视频` 状态，且卡片与空库 CTA 都不再存在 |
| 非 ready 卡进入任务详情 | `pending` 与 `failed` 两张卡的公开动作 `aria-label` 为 `查看导入任务：<标题>`；**真实点击**后出现既有 `role=dialog` 任务详情（标题 `<标题>导入任务`、`progress[max=100]`、`继续导入`/`重试导入` 显式动作），关闭后原卡片仍在 |
| 失败状态可见 | 失败卡的既有徽章 `data-status=failed`、文本 `失败`，且有既有导入状态面 |

脚本只用 W3C 元素端点（`POST /session/{id}/element(s)`、`/element/{id}/click`、`/text`、`/attribute/{name}`、`/enabled`、`/screenshot`）取得上述事实；`execute/sync` 只用于「等待页面就绪」与「请求建立受控夹具」两处编排，不用于判定 DOM 事实。

## 3. 隔离与受控夹具

- `RAIN_E2E_MODE=1` + `RAIN_E2E_RUN_MODE=video-list` 让生产数据库 singleton 经既有 `get_real_e2e_config` 路由到系统临时目录中的隔离 SQLite（`RAIN_E2E_DB_PATH`）；`video-list` 模式只需要该隔离库，不需要视频、Whisper 模型或任何 LLM Key。
- **首次启动必须是真实空库**：`video-list` 短模式不导航、不启动导入、不调用模型，也不主动写任何业务行。
- 受控夹具只经 `window.__RAIN_VIDEO_LIST_FIXTURE__.seed()` 由脚本显式请求，仍走生产 `getDb()` / `insertVideo` 公共 interface 写入两份受控视频行（`rain-e2e-video-list-pending` 标题 `E2E 待处理样本`；`rain-e2e-video-list-failed` 标题 `E2E 失败样本`，`stage=asr` 且带受控错误文案）。
- 夹具落库后脚本**关闭并重建 WebDriver session**（真实桌面进程重启）再裁判卡片，因此「非 ready 卡进入任务详情」同时证明夹具跨进程持久化。
- 受控夹具不含用户数据、真实用户路径、源视频、模型或密钥。

## 4. 失败诊断（脱敏、有界）

失败时在系统临时目录保留单份 `rain-video-list-e2e-latest-failure/`：

```text
%TEMP%\rain-video-list-e2e-latest-failure\
  summary.json          # status/phase/主错误/missingConditions/已观测 DOM 事实/命令/时间
  tauri-driver.log
  tauri-driver.err.log
```

`summary.json` 除 `phase` 与主错误外，必须给出 **`missingConditions`**（本次未满足的具体裁判条件）与 **`observed`**（已经由驱动观测到的 DOM 事实，例如卡片数、顶栏按钮文本、夹具接口状态）。已知 LLM Key、`sk-*` 凭据与 Bearer token 都会被 `[REDACTED]`；诊断不包含隔离 SQLite 或运行目录，新失败替换旧失败，成功 run 清理 stale 诊断。诊断写入自身失败只告警，不覆盖主错误。

## 5. 截图附件（仅附件）

- 成功 run 最多写 **1 张**截图 `rain-video-list-e2e-attachment/video-list-desktop-dom.png`（`GET /session/{id}/screenshot`，best-effort），并附 `ATTACHMENT-NOTICE.txt`。
- artifact 名称与说明都标注 **「仅附件，不构成 Visual Evidence」**，保留期 7 天（≤ 14 天）。
- 截图**不得**作为唯一或主要裁判：AC-VL-04 的判据仍是第 2 节的真实桌面 DOM 与真实点击。截图端点不可用时只告警，不影响裁判。
- 该目录每次运行前重建，因此不会把上一次的截图冒充为本次事实。

## 6. Hosted 触发与边界

- `.github/workflows/video-list-desktop-e2e.yml` 在 `pull_request`（paths 过滤到本 Judge 相关文件）上运行，使被审 head 上就有真实 run；`workflow_dispatch` 只是**合并后**的重放入口（新 workflow 文件在功能分支上无法 dispatch）。
- 该 workflow **不是** master 必需状态检查，不改分支保护，不修改受保护分支，不 dispatch 任何 Release/GPU workflow，不使用任何 Rain secret、模型、Whisper 或视频导入。
- 它镜像既有固定桌面工具链（rustup `1.96.1`、LLVM `22.1.7`、`tauri-driver 2.0.6`）与「按 runner 已装 WebView2 Runtime 版本下载同版 `msedgedriver` 并精确相等校验」的方式，CPU-only。
- 不参与 `harness:check`：默认 Harness 不运行任何桌面 Judge。
- 与 AC-HE-05 的 owner 完全独立：`.github/workflows/runtime-settings-desktop-e2e.yml` 与 `scripts/run-runtime-settings-e2e.ps1` 不被本 Slice 修改。
- 实测同族 Hosted 桌面 run 耗时 6m36s–8m37s；本 workflow 预期 8–12 分钟（job timeout 60 分钟）。
- **证据对应规则（STD-67-4）**：桌面证据对应被测 head 的**代码树**；若仅文档改动使 head 前移，必须先用 `git diff <旧 head> <新 head> -- <代码路径>` 证明代码树未变，否则需在合并后以 `workflow_dispatch` 在合并提交上重放，才可引用该证据。本 workflow 的 `paths` 有意不含 `docs/**`，故此规则是本 Judge 的常规引用前提。

## 7. 未覆盖边界（诚实声明）

- 只覆盖第 2 节列出的条件；不签发完整页面组合的 `Strong Judge`、其他桌面条件、`Visual`/`Accessibility` 或任何 `Evidence`。
- 不覆盖真实导入、yt-dlp、Whisper、GPU、模型调用、并发/性能/soak。
- 本 Judge 的存在与通过都不等于 `AC-VL-04` 已闭合；闭合需要独立 Spec 与 Standards 复审以及受保护合并。

## 8. 编码注记

`scripts/run-video-list-e2e.ps1` 以 **UTF-8 BOM + CRLF** 保存：`package.json` 在 Windows 上通过 `powershell.exe`（Windows PowerShell 5.1）执行该文件，无 BOM 的 UTF-8 中文断言字面量会被按 ANSI 解码并导致断言失配。

同一原因还有两条硬性约束，二者都由托管 run 的真实失败证实（head `57b96fb` 的 run `36306426495` 在 `phase=top-bar` 以 404 失败）：

- 发往 WebDriver 的请求 body 一律按 UTF-8 字节发送并声明 `application/json; charset=utf-8`：PowerShell 5.1 会把字符串 body 按 ANSI 编码发出，中文选择器会变成 `?` 并 404。
- 选择器只用 ASCII：用 `header input[type="text"]`、`header select`、`header select option` 定位，再用驱动读回的 `aria-label` 断言「搜索视频标题」「排序」（因此可访问名断言反而比把中文写进选择器更强）。
