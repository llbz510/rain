# Rain Harness Migration - Whisper Model Download - 2026-07-27

> 状态：Active
> 授权：用户于 2026-07-27 确认 `AC-MM-01`、`AC-MM-02`、`AC-MM-03`，并明确批准为独立取消命令修改锁定 M20 Harness。
> 对应合同：`AC-MM-01`、`AC-MM-02`、`AC-MM-03`

## 1. 旧合同与缺口

原 M20 精确集合只有 `download_whisper_model` 和 `list_whisper_models`。旧下载命令追随可变 `/main/`，把完整响应收进内存并直接写最终文件；设置页只有局部 `downloading/done/error`，没有真实进度、取消或安装复核。

AC-MM-02 要求取消指定型号的真实下载任务。视频导入的 `cancel_import` 不拥有该任务，不能复用，因此必须新增 `cancel_whisper_model_download` 并迁移 M20。

## 2. 替代与新增裁判

| 裁判 | 负责证明 |
| --- | --- |
| Rust `whisper_model_download` tests | 固定 manifest、流式增量写入/哈希、验证后原子提交、失败清理、旧文件保留、幂等复用、单 writer、单调进度、取消与干净重试 |
| `whisper-model-download.test.tsx` | 真实表单通过生产 adapter/event seam 显示进度、取消、区分终态、重试、释放 listener，并在安装列表复核后成功 |
| M19 | 设置表单的既有公共组件合同仍成立 |
| M20 | 下载、取消、列举属于真实且精确的 Tauri command 集合，且前端监听事件名与 Rust 生产事件名一致；其他边界不变 |

## 3. 锁定文件变更

- `harness/m20-boundaries.test.ts`

本次只把经批准的 `cancel_whisper_model_download` 加入 command 精确集合，并锁定新增模型下载事件名的跨语言一致性；不改变 M20 的 LLM、SQL 或既有导入进度事件合同。

## 4. 退役路径

- 退役 `commands.rs` 中整包 `response.bytes()` 和直接最终路径写入。
- 退役 Hugging Face `/main/` 浮动来源，改用固定 revision 与完整 manifest。
- 退役表单直接调用单个下载 command 后立即显示成功的局部流程。
- 模型下载不并入视频导入 Scheduler，也不把“文件被列出”当成 ASR capability 通过。

## 5. 红绿记录

- Manifest 红测先因缺少 `manifest_for` 编译失败，随后固定五种模型清单并通过。
- M20 红测只因缺少批准的新取消 command 失败，注册真实 command 后通过。
- 设置页三条红测均因缺少真实下载控件/工作流失败，生产会话接入后通过。
- 停滞网络取消测试在同步到首块进度后按预期超时失败；取消令牌加入 `Notify` 并用 `tokio::select!` 竞争网络读取后通过。

定向验证通过：Rust 下载模块 11 条测试；设置页/M19/M20 共 4 个文件 18 条测试；TypeScript 编译通过。

完整验证：

- Vitest：71 个文件 / 423 条测试通过，1 条 live-key 测试按显式环境门禁跳过。
- Rust：95 条测试通过，1 条真实 Whisper 模型测试按设计忽略。
- TypeScript 与 Vite 生产构建通过；仅保留既有动态/静态 import chunking 警告。
- 没有下载真实 GB 级模型或重跑多小时真实视频 E2E；本次由固定生产 manifest、本地流式 HTTP、真实文件系统、生产 Tauri 边界和真实表单工作流直接裁判。模型能力仍由既有 probe/Evidence 独立负责。
