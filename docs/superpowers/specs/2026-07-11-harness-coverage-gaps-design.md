# Rain Harness 覆盖缺口补齐 设计规格

> 日期：2026-07-11
> 范围：阶段一（仅补 harness，描述当前行为，不改源码逻辑）
> 方案：A（新建 M21 编号 + store-phase2）

## 决策记录

| 维度 | 决策 |
|------|------|
| 源码态度 | 分两阶段：阶段一补 harness 描述当前行为，阶段二单开一轮做实现 |
| 外观/关于 tab | 跳过，不加测试（spec 明确列在"不做的事"里） |
| 端到端管道编排 | 阶段一完全不写 E2E，留给阶段二 |
| E2E 粒度（阶段二） | 真实级：起真 Rust 后端跑一段小 mp4 |
| E2E 固件（阶段二） | 仓库内小 mp4 + 按需下载 whisper |

## 约束

- `harness/` 已锁定文件**不修改**，只**新增**文件
- `npm test` 必须保持全绿（281 + 新增 ≈ 304）
- 新 harness 只断言**当前实际行为**，不断言未实现的功能
- 需要新建的源码仅限让 import 通过的签名桩，不含业务逻辑

---

## 新增文件清单

### Harness 文件（3 个）

| 文件 | 编号 | 描述 | 测试点 |
|------|------|------|--------|
| `harness/m21-start-import.test.ts` | M21 | start_import 命令行为 + generate_thumbnail 签名 | 8 |
| `harness/m21-progress-listener.test.ts` | M21 | 进度事件前端监听契约 | 7 |
| `harness/store-zustand-phase2.test.tsx` | Store | loadVideo / unloadVideo 真值断言 | 8 |

### 源码桩文件（1 个）

| 文件 | 作用 |
|------|------|
| `src/pipeline/progress-listener.ts` | 导出 listenProgress / unlistenProgress 空函数 + ProgressCallback 类型 |

---

## 测试点明细

### m21-start-import.test.ts（8 条）

| 编号 | 测试名 | 断言 |
|------|--------|------|
| M21-T01 | start_import 在命令列表中 | TAURI_COMMANDS 含 'start_import' |
| M21-T02 | 创建本地导入任务后 status=pending | createImportJob({ source: 'local' }) → video.status === 'pending' |
| M21-T03 | 本地导入 requiresYtdlp=false | source='local' → requiresYtdlp === false |
| M21-T04 | URL 导入 requiresYtdlp=true | source='url' → requiresYtdlp === true |
| M21-T05 | generate_thumbnail 在命令列表中 | TAURI_COMMANDS 含 'generate_thumbnail' |
| M21-T06 | convert_file_src 在命令列表中 | TAURI_COMMANDS 含 'convert_file_src' |
| M21-T07 | 并发=1，第二个任务排队 | 两次 createImportJob → getImportQueue().pending.length ≥ 1 |
| M21-T08 | 取消设置 status=cancelled | cancelImport(job) → job.video.status === 'cancelled' |

### m21-progress-listener.test.ts（7 条）

| 编号 | 测试名 | 断言 |
|------|--------|------|
| M21-T09 | listenProgress 函数存在 | typeof === 'function' |
| M21-T10 | unlistenProgress 函数存在 | typeof === 'function' |
| M21-T11 | ProgressCallback 接受 ProgressPayload | 构造合法 payload 对象，类型检查通过 |
| M21-T12 | 进度事件名 = 'progress' | PROGRESS_EVENT_NAME === 'progress' |
| M21-T13 | IMPORT_COMPLETE_EVENT 存在 | 值 === 'import_complete' |
| M21-T14 | IMPORT_FAILED_EVENT 存在 | 值 === 'import_failed' |
| M21-T15 | IMPORT_CANCELLED_EVENT 存在 | 值 === 'import_cancelled' |

### store-zustand-phase2.test.tsx（8 条）

| 编号 | 测试名 | 断言 |
|------|--------|------|
| U09 | loadVideo 后 currentVideoId 更新 | getState().currentVideoId === 传入值 |
| U10 | loadVideo 后 currentPage = 'study' | getState().currentPage === 'study' |
| U11 | loadVideo 后 playPosition = 0 | getState().playPosition === 0 |
| U12 | unloadVideo 后 currentVideoId = null | getState().currentVideoId === null |
| U13 | unloadVideo 后 currentPage = 'list' | getState().currentPage === 'list' |
| U14 | unloadVideo 后数据缓存清空 | nodeTree/sentences/notes 长度为 0 |
| U15 | setPage 设置 currentPage | setPage('settings') → currentPage === 'settings' |
| U16 | loadVideo 接受字符串参数不抛错 | 传入 'video-abc' 不抛异常 |

---

## 源码桩设计

### src/pipeline/progress-listener.ts

导出内容：

- `ProgressCallback` 类型：接受 ProgressPayload 参数的回调函数类型
- `listenProgress(callback: ProgressCallback): void`：空函数（阶段二实现真正的 Tauri event 订阅）
- `unlistenProgress(): void`：空函数（阶段二实现取消订阅）

这三个导出仅满足 harness import 需要，不含任何业务逻辑。

---

## 不做的事

- 不修改已锁定的 harness 文件
- 不修改 start_import / generate_thumbnail 的实现（空壳保持原样）
- 不写端到端管道编排测试（留阶段二）
- 不测外观 / 关于 tab（纯占位，spec 明确排除）
- 不改 design-tokens.ts
- 不改现有 281 条测试的行为

---

## 预期结果

| 指标 | 当前 | 完成后 |
|------|------|--------|
| Harness 文件数 | 33 | 36 |
| 测试点数 | 281 | ≈304 |
| npm test | 全绿 | 全绿 |
| tsc --noEmit | 0 错误 | 0 错误 |
