# Whisper GPU 优先与 CPU 安全回退设计

> 状态：Active
> 用户确认：2026-07-31
> 对应验收：`AC-LV-21`
> 发布支持修订：2026-08-03 用户确认 Core Release 最低要求为受支持 NVIDIA GPU + 兼容驱动；本设计的 CPU adapter/回退行为保留，但无 NVIDIA 发布支持与 Evidence 要求退役。

## 目标

Rain 的本地 Whisper 默认使用 `Auto`：

- 受支持的 NVIDIA CUDA 后端可用时优先使用 GPU；
- CUDA 后端不存在、驱动不兼容、显存明显不足或工作进程失败时，`Auto` 必须给出可见原因并安全回退 CPU；
- 用户可显式选择 `Auto`、`NVIDIA GPU` 或 `CPU`；
- 显式 `NVIDIA GPU` 不得静默回退；
- CPU-safe 主程序和 CPU adapter 必须保留；无 NVIDIA 驱动的 Windows 主机不再属于 Core Release 支持矩阵。

本决定只涉及本地 Whisper 执行后端，不改变模型池、模型文件格式、ASR 结果契约、Stage2、LLM 或在线导入合同。

## 深模块与 seam

新建 `whisper_backend` module。它的外部 interface 只暴露：

1. 读取给定偏好下的运行能力；
2. 使用给定偏好执行一次已经转换为 WAV 的 Whisper 转写；
3. 返回实际后端和可选回退原因。

选择、CUDA 工作进程定位、协议校验、显存下限、错误分类、取消和 CPU 回退全部隐藏在 module 内。调用者不得自行探测 DLL、显卡或拼装工作进程命令。

该 seam 有两个真实 adapter：

- CPU adapter：留在不链接 CUDA 的 Rain 主进程中，继续复用 `whisper-rs`；
- CUDA worker adapter：独立 `rain-whisper-cuda.exe`，只有该进程链接 CUDA runtime。

主程序不得链接 `cublas64_12.dll`、`cudart64_12.dll` 或 `nvcuda.dll`。因此 CUDA DLL 缺失只能使 worker 探针失败，不能阻止 Rain 启动。

## CUDA worker 协议

协议使用版本化 JSON，不把模型、视频内容或秘密写入日志。

- `probe`：返回协议版本、CUDA 可用性、设备名称和显存信息；
- `transcribe`：stdin 接收模型路径、WAV 路径和语言，stdout 返回 Whisper 结果或分类错误；
- stdout 只承载协议 JSON，底层运行日志留在 stderr；
- Rain 必须限制 stdout/stderr 读取大小；
- 用户取消时 Rain 必须终止 worker，并按既有 `AC-LV-07` 收口为 `cancelled`。

## 选择与回退

| 偏好 | CUDA 可用 | 行为 |
| --- | --- | --- |
| `auto` | 是 | 使用 CUDA |
| `auto` | 否 | 使用 CPU，并公开回退原因 |
| `cuda` | 是 | 使用 CUDA |
| `cuda` | 否 | 失败关闭，提示如何切回 Auto/CPU |
| `cpu` | 任意 | 直接使用 CPU，不启动 CUDA worker |

`Auto` 只对 CUDA 后端不可用、资源不足、worker 启动/协议/崩溃错误回退。用户取消不得触发 CPU 重跑；确定的模型文件错误也不得用 CPU 重跑掩盖。

## 设置与能力

`whisper_backend_preference` 属于 Runtime Settings：

- 缺失或非法旧值迁移为 `auto`；
- 与模型、角色和能力记录通过现有单队列、原子快照保存；
- 每次导入在启动时取得偏好快照；
- 偏好变化使旧 ASR capability fingerprint 失效，必须重新运行短样本能力检查。

设置页必须显示：

- 当前偏好；
- 实际将使用的后端；
- CUDA 设备或不可用原因；
- `Auto` 回退 CPU 时的原因。

## 发布

默认开发/Harness 构建保持 CPU 安全，不要求 hosted Harness 安装 CUDA Toolkit。正式 GPU 产品构建必须：

- 单独构建 CUDA worker；
- 将 worker 与所需的 NVIDIA 可再分发 runtime 放入安装资源；
- 不捆绑 `nvcuda.dll`，由受支持的 NVIDIA 驱动提供；
- 验证 Rain 主程序本身没有 CUDA DLL 导入；
- 记录 worker、runtime、安装包和源码 commit 的哈希。

CUDA runtime 体积和许可必须在正式发布前单独复核。构建成功不等于最终安装包已获准分发。

## 当前实现与发布证据边界

实现已由 PR #23 合并到 `master@83670e7`（产品提交 `d8f2292`，源分支 `codex/whisper-gpu-auto-fallback`）。普通 Rain 主程序继续用无 CUDA feature 的 CPU `whisper-rs`；`rain-whisper-cuda.exe` 由 `npm run build:whisper-gpu-worker` 单独构建，`npm run bundle:gpu` 通过 `src-tauri/tauri.gpu.conf.json` 将 worker、`cublas64_12.dll`、`cublasLt64_12.dll` 和 `cudart64_12.dll` 放入 `whisper-backends/`。`nvcuda.dll` 不打包。

本机 2026-07-31/2026-08-02 验证事实：

- worker protocol v1 探针识别 `NVIDIA GeForce RTX 5060 Ti`，显存约 16 GB；
- worker 使用 `ggml-large-v3.bin` 完成 `test-fixtures/asr-capability.mp4` 的真实英文短样本转写，stderr 明确记录 `using CUDA0 backend`；
- 普通 `rain.exe` 的 PE import table 不含 `cublas64_12.dll`、`cudart64_12.dll` 或 `nvcuda.dll`；
- 当前暂存 GPU payload 约 804 MB，其中 `cublasLt64_12.dll` 约 668.7 MB、`cublas64_12.dll` 约 102.5 MB、worker 约 32.7 MB；每次构建生成大小和 SHA-256 manifest；
- Tauri GPU overlay 的 debug/no-bundle 构建通过。

`RAIN_WHISPER_CUDA_WORKER` 只允许 debug 构建使用（真实 E2E 也构建 debug 主程序）；release 产品始终忽略该变量并定位安装资源中的 worker，避免普通环境变量替换发布 worker。

以上只签发本机实现和 NVIDIA smoke，不签发最终 Release Evidence。正式发布前仍必须在目标提交和受支持 NVIDIA Windows 上完成 Auto/Forced CUDA、Forced CPU、取消与错误分类；还须完成正式安装包的安装/卸载/升级、代码签名、CUDA runtime 可再分发许可复核以及安装体积和下载体验决策。没有这些证据时不得把本 AC 写成 `Strong + Evidence`。

## Judge

非锁定 Judge 必须覆盖：

- Auto 在 CUDA 可用时选 GPU；
- Auto 在 worker 缺失、驱动失败、显存不足或 worker 崩溃时回退 CPU并保留原因；
- 强制 CUDA 不静默回退；
- 强制 CPU 不启动 worker；
- 取消终止 worker且不触发回退；
- Runtime Settings 默认、持久化、并发顺序和 capability 失效；
- 设置页和预检展示实际后端/原因；
- CPU 主程序二进制无 CUDA DLL 依赖；
- CUDA worker 有精确协议和所需 DLL 清单。

最终 `Strong + Evidence` 要求目标发布 commit 在受支持 Windows/NVIDIA 主机上的真实 Auto/Forced CUDA、Forced CPU、取消与失败分类证明；不再要求无 NVIDIA/CUDA 环境的发布证明。
