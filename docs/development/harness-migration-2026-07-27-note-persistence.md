# Rain Harness Migration - 2026-07-27 Note Persistence

> 状态：Active
> 授权：用户于 2026-07-27 明确批准本次锁定 Harness 修改。
> 对应 AC：`AC-ST-06`
> 目的：让 SQLite Note 与 sentence 引用由一个真实事务提交，不再用前端多次 SQL-plugin 调用代表原子性。

## 1. 旧合同与缺口

原合同允许 `insertNote` 先写 `note`，再逐条写 `note_sentence`。前端测试只检查 SQL 调用顺序和错误传播，内存 adapter 测试虽然能证明期望的回滚语义，却不能证明 Tauri SQLite 路径真的回滚。

已检查的 `tauri-plugin-sql` 2.4.0 会让每次前端 `execute` 通过 SQLx pool 执行。多次前端调用不能保证落在同一连接，因此在前端补 `BEGIN/COMMIT` 仍不是可靠裁判。

## 2. 替代裁判

| 层级 | 新裁判 | 负责发现的问题 |
| --- | --- | --- |
| 前端公开入口 | `src/__tests__/database-notes.test.ts` | SQLite `insertNote` 必须只调用一次 `insert_note_atomically`，携带完整 Note；Rust 错误必须向上传播 |
| Rust 协议 | `src-tauri/tests/commands_harness.rs` | Note payload 必须保持前端使用的 camelCase 字段 |
| Rust 注册边界 | `harness/m20-boundaries.test.ts` | 真实 `generate_handler!` 必须包含且只包含批准的 command 集合，包括 `insert_note_atomically` |
| SQLite 行为 | `src-tauri/src/note_persistence.rs` 单元测试 | 成功时 Note 和全部引用一起落库；任一引用失败时两张表一起回滚 |

以上裁判共同负责 `AC-ST-06`。只通过其中一个测试不能单独宣称 Note 多表写入具有原子性。

## 3. 锁定文件变更

- `harness/m20-boundaries.test.ts`：批准并锁定 `insert_note_atomically`。
- `src-tauri/tests/commands_harness.rs`：锁定 Note command payload 的 camelCase 协议。

本次修改没有降低或删除 AC；它把原先无法证明的 SQLite 失败原子性补成真实行为裁判。

## 4. 退役路径

已退役 `src/models/database-notes.ts` 中“前端先插入 Note、再循环插入引用”的 SQLite 路径。SQLite 写入现在只通过 Rust command；内存 adapter 继续作为快速行为裁判。

没有新增或保留测试专用影子模块。

## 5. 验证

迁移采用先红后绿：

- 修改裁判但未改实现时，定向测试出现 3 个预期失败：缺少 command 注册、前端未 invoke、Rust 错误未传播。
- 实现后，前端定向测试 4 个文件 / 19 条测试通过。
- Rust Note 行为与协议定向测试 3 条通过，其中回滚测试直接查询真实内存 SQLite 的 `note` 和 `note_sentence` 表。

完整验证通过：

- 前端默认套件：66 个文件 / 408 条测试通过，1 条 opt-in live 测试按设计跳过。
- Rust：53 条库测试和 23 条可执行 Harness 测试通过；现有真实 Whisper 模型测试保持忽略。
- 强制 live-key smoke：`qwen3-omni-flash` 真实请求 1/1 通过，Key 只注入测试进程。
- TypeScript + Vite 生产构建、`git diff --check` 和 supplied-key tracked-file 扫描通过。

完整结果同时记录在 `docs/PROJECT_STATE.md`。
