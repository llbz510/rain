# Rain Harness Migration - Atomic Video Deletion - 2026-07-27

> 状态：Active
> 授权：用户于 2026-07-27 明确批准为视频删除建立 Active AC 并修改锁定 Harness。
> 对应合同：`AC-LV-13`

## 1. 旧合同与缺口

旧 M15 删除用例只验证内存 adapter 中一个 `ready` Video 的成功路径。它没有包含直接以 Video ID 为 `node_id` 的 ASR 占位句子、import checkpoint、其他 Video 的隔离或失败回滚，因此旧实现漏删占位句时仍可通过。

真实 SQLite 路径由前端连续发出六次 SQL-plugin 删除。即使成功路径结果正确，也不能证明六步使用同一连接和同一事务；中途失败会留下部分删除的数据。此前该行为没有独立 Active AC，不能仅凭旧 M15 宣称受控。

## 2. 替代裁判

| 裁判 | 负责证明 |
| --- | --- |
| `src/__tests__/database-video-deletion.test.ts` | 公共入口对 SQLite 只发送一次 `delete_video_atomically` command、错误不被吞掉；内存路径清理全部归属数据并保留其他 Video |
| `harness/m15-schema-crud.test.ts` | 锁定公共数据库入口的占位句和 checkpoint 成功清理行为 |
| `harness/m20-boundaries.test.ts` | `delete_video_atomically` 属于真实且精确的 Tauri command 集合 |
| `src-tauri/src/video_deletion.rs` tests | 真实 SQLite 成功删除、最后一步失败时全部回滚、缺失 Video 幂等 |

这些裁判共同负责 `AC-LV-13`。前端测试不能替代 SQLite 事务测试，Rust 事务测试也不能替代公共 command 协议和内存 adapter 行为。

## 3. 锁定文件变更

- `harness/m15-schema-crud.test.ts`
- `harness/m20-boundaries.test.ts`

本次没有降低或删除旧 AC。M15 在原成功路径上增加先前遗漏的数据类型；M20 在真实 command 精确集合中加入新批准边界。

## 4. 退役路径

- 退役前端 SQLite 路径中的六次独立 `db.exec` 删除。
- SQLite 删除统一进入 `src-tauri/src/video_deletion.rs` 的单连接事务。
- 内存 adapter 继续作为快速行为镜像，但不再被用来证明真实 SQLite 原子性。
- 本轮没有需要保留或退役的 Harness 影子模块。

## 5. 验证

定向红灯在修改实现前证明了旧缺口：

- SQLite command/错误传播失败。
- 内存和 M15 均留下 ASR 占位句。
- M20 发现 Rust command 未注册。

实现后的定向结果：

- Vitest：4 个文件 / 25 条测试通过。
- Rust `video_deletion`：3 条测试通过，包括末步失败回滚。

完整验证：

- Vitest：69 个文件 / 415 条测试通过，1 条 live-key 测试按显式环境门禁跳过。
- Rust：79 条测试通过，1 条真实 Whisper 模型测试按设计忽略。
- TypeScript 与 Vite 生产构建通过；保留既有动态/静态 import chunking 警告。
- 多小时真实视频 E2E 未重跑；本次变更由公共 command 协议和真实内存 SQLite 事务直接裁判，不改变 ASR、LLM 或学习页渲染。
