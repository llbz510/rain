# Rain 数据库模块控制图

> 状态：Active
> 更新日期：2026-07-27
> 作用：规定数据库模块的公开 seam、职责分组、裁判和受控拆分顺序。

## 1. 稳定公开 seam

生产代码和测试继续从 `@/models/database` 导入。这个文件是稳定公共入口，即使内部实现拆到其他文件，也不得要求页面、Pipeline 或设置模块了解 SQLite、内存表或行映射。

当前真正供业务使用的 interface 是有业务含义的导出函数，例如：

- `transitionVideoImportState`
- `saveAsrAtomically`
- `mergeImportAtomically`
- `updateVideoPosition`
- `insertNote`
- `setSetting`

外部生产调用者目前没有直接调用 `Database.exec` 或 `Database.query`。锁定 M15 Harness 只使用 `listTables` 和 `getTableColumns` 验证 schema 形状。新增业务代码不得绕过公共函数直接拼 SQL。

## 2. 职责与裁判

| 职责 | 主要行为 | 关联 AC / 规则 | 当前裁判 |
| --- | --- | --- | --- |
| Schema 与 adapter 选择 | 创建内存数据库或 Tauri SQLite，保持表/字段一致 | 数据库边界规则 | M15 schema Harness、M20 SQL importer Harness |
| 视频与学习内容 CRUD | Video、Node、Sentence、Note 的读写和级联删除 | AC-LV-02/04/09、AC-ST-01/05/06 | M08、M15、学习页生产测试 |
| 设置持久化 | 模型池、角色和能力记录使用的 key-value 设置 | AC-LV-01/12、AC-ST-07 | M15 settings/recovery、模型能力测试 |
| 导入状态与恢复 | 批准状态转换、检查点、恢复判断 | AC-LV-03/06/07/08 | Pipeline 恢复测试、M03/M21、真实 Evidence |
| 原子导入写入 | ASR 保存、句子归属、最终节点/句子合并 | AC-LV-04/05/09 | Pipeline/Stage2 测试、Rust Harness、真实 Evidence |

内存 adapter 是快速行为裁判，不是 Tauri SQLite 与 Rust command 的完整替身。涉及真实事务、command 参数或 SQLite 执行的结论，必须由 Rust Harness 或真实 Evidence 补足。

## 3. 当前审计结论

1. `database.ts` 变大的原因是六类职责混在一起，不是单纯行数过多。
2. 24 个生产调用位置依赖稳定公共入口，但没有生产调用者直接执行 SQL，因此可以内部渐进拆分。
3. 旧实现分别手写内存字段列表和 SQLite 建表 SQL，存在 schema 漂移风险。
4. `database-schema.ts` 现在是表、字段、约束和建表 SQL的唯一事实源；内存 adapter 和 Tauri adapter 从同一定义初始化。
5. M20 当前锁定“只有 `database.ts` 导入 Tauri SQL 插件”。未来内部拆分必须保留这个入口，或先经过明确的 Harness Migration，不能为了移动文件偷偷改裁判。
6. `Database` 现在只暴露两种 adapter 都真实支持的元数据 interface。内部通过 `adapterKind` 区分 `MemoryDatabaseAdapter` 与 `SqlDatabaseAdapter`；只有 SQLite adapter 拥有 `exec/query`，内存 adapter 不再提供空实现。
7. `database-boundary.test.ts` 禁止生产模块直接导入 `database-adapter`、`database-checkpoints` 或 `database-schema`，并证明内存 adapter 不伪装支持 SQL。内部实现可以继续拆分，调用者仍只能看到稳定公共入口。

## 4. 受控拆分顺序

每次只移动一个因不同原因变化、且有独立裁判的职责：

1. `Completed`：提取 schema 唯一事实源，公共 interface 不变。
2. `In progress`：导入状态、检查点和原子合并。可判别的内部 adapter interface 与独立检查点模块已完成；状态转换、恢复判断、ASR 保存和最终合并仍在 `database.ts`，后续继续由 AC-LV-03 至 AC-LV-09 的测试和 Rust/Evidence 裁判。
3. 学习内容与笔记持久化。由 AC-ST-01、AC-ST-05、AC-ST-06 的数据库往返测试裁判。
4. 设置持久化。由模型能力、设置恢复和预检测试裁判。

禁止一次性重写整个数据库层。每一步都必须保持 `@/models/database` 导出兼容、运行对应裁判、更新本文件和 `PROJECT_STATE.md`。
