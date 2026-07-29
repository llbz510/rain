# Rain Harness Migration - 2026-07-29 Database Architecture

> 状态：Active
> 授权：用户于 2026-07-29 明确批准本次锁定 Harness 修改。
> 对应 AC：`AC-LV-04`、`AC-AR-01`
> 目的：让 ASR 原子持久化由生产公开 interface 和真实 Rust SQLite 事务裁判，并退役仅供测试调用的前端事务影子接口。

## 1. 旧合同与缺口

锁定 `harness/m15-settings-recovery.test.ts` 的 M15-T18 调用 `atomicInsertSentences`，只在内存 adapter 上检查句子插入成功。测试名称声称“全部成功或全部失败”，但没有制造迟失败，也没有观察 Video 阶段与句子共同提交。

`atomicInsertSentences` 没有生产调用者。它的 SQLite 分支直接从前端依次发送 `BEGIN`、多条 `INSERT`、`COMMIT`/`ROLLBACK`；相邻非锁定测试只对 fake adapter 断言 SQL 调用顺序。这条路径既不贯通生产 `saveAsrAtomically`，也不能替代 `src-tauri/src/asr_persistence.rs` 在单连接上的真实事务，因此是测试专用影子接口，并与 `AC-AR-01` 冲突。

## 2. 替代裁判

| 层级 | 新裁判 | 负责发现的问题 |
| --- | --- | --- |
| 架构 policy | `scripts/database-architecture-policy.test.ts` | 独立 fixture 与真实生产树共同拒绝 SQL plugin 扩散、内部数据库 module 逃逸和前端事务控制 SQL |
| 锁定公共接口 | M15-T18 | 通过生产 `saveAsrAtomically` 证明全部 ASR 句子和 Video `language/stage` 一起提交；第二条重复 ID 的迟失败会回滚全部句子并保留 `processing/asr` |
| 前端 SQLite adapter | `src/__tests__/database-import-atomic.test.ts` | `saveAsrAtomically` 归一化句子归属并只调用一次 `save_asr_atomically`；缺失 Video 时不调用 Rust |
| SQLite 行为 | `src-tauri/src/asr_persistence.rs` | 第二条插入失败与 stale Video commit 都在真实内存 SQLite 连接上回滚句子和 Video 事实 |

以上裁判共同负责 `AC-LV-04` 和 `AC-AR-01`。内存 adapter、静态边界或 Rust 单测中的任意一层都不能单独签发完整生产行为。

## 3. 锁定文件变更

- `harness/m15-settings-recovery.test.ts`：M15-T18 从 `atomicInsertSentences` 迁移到生产 `saveAsrAtomically`，并把旧的单一成功断言替换为成功共同提交和迟失败回滚两条行为 Judge。

没有修改 `harness/m20-boundaries.test.ts` 或 `src-tauri/tests/`，没有新增 Tauri command，也没有放宽现有 command allowlist。

## 4. 退役路径

- 删除 `src/models/database-import-atomic.ts` 的 `atomicInsertSentences`。
- 删除 `src/models/database.ts` 对该影子接口的公开导出。
- 删除相邻测试中对 fake SQLite `BEGIN/COMMIT/ROLLBACK` 调用顺序的两条断言。
- Pipeline recovery 测试改用普通 `insertSentences` 建立既有句子 fixture；它不再借用一个名为原子事务的影子生产接口准备测试数据。

生产 ASR SQLite 原子写现在只有 `saveAsrAtomically` → `save_asr_atomically` → Rust `asr_persistence` 一条路径。

## 5. 风险与边界

- 风险：M15 fixture 必须具备真实 `processing/asr` 前置状态；迁移后的测试已显式建立并裁判该状态。
- 风险：删除公开导出可能暴露未知调用者；全仓搜索和 TypeScript 完整构建负责发现残留引用。
- 边界内不改变 ASR 产品语义、不增加 command、不重写数据库层。
- DEC-PRD-092、DEC-PRD-099、schema migration、Key 加密和通用 Rust DAL 均在边界外。

## 6. TDD 与验证

迁移采用逐条 RED → GREEN：

1. SQL plugin 越界 fixture 因 policy interface 不存在而 RED；最小唯一 owner 规则后 GREEN。
2. Store 导入数据库内部 module 的 fixture 未被发现而 RED；增加公共入口规则后 GREEN。
3. 前端 `BEGIN/COMMIT/ROLLBACK` fixture 未被发现而 RED；增加事务控制规则后 GREEN。
4. 同一 policy 扫描真实生产树，准确报告 `database-import-atomic.ts` 的影子事务 RED；完成本迁移后真实树 GREEN。

当前聚焦验证：policy 6/6；M15、前端原子导入与 Pipeline recovery 19/19；M20、数据库边界与 policy 17/17；Rust `asr_persistence` 2/2。

完整 `npm run harness:check` 通过：控制面通过；Vitest 80 files / 468 tests 通过，1 个 live-key file / test 按既有合同跳过；E2E 与普通构建的互补隔离校验通过；Rust library 83/83、各 executable Harness 通过，既有真实模型 Whisper test 1 个 ignored。最终 `dist` 为普通生产前端产物。
