# Rain 数据库模块控制图

> 状态：Active
> 更新日期：2026-07-28
> 作用：规定数据库模块的公开 seam、职责分组、裁判和受控拆分顺序。

## 1. 稳定公开 seam

生产代码和测试继续从 `@/models/database` 导入。这个文件是稳定公共入口，即使内部实现拆到其他文件，也不得要求页面、Pipeline 或设置模块了解 SQLite、内存表或行映射。

当前真正供业务使用的 interface 是有业务含义的导出函数，例如：

- `transitionVideoImportState`
- `saveAsrAtomically`
- `mergeImportAtomically`
- `updateVideoPosition`
- `insertNote`
- `deleteVideoWithCascade`
- `setSetting`

外部生产调用者目前没有直接调用 `Database.exec` 或 `Database.query`。锁定 M15 Harness 只使用 `listTables` 和 `getTableColumns` 验证 schema 形状。新增业务代码不得绕过公共函数直接拼 SQL。

## 2. 职责与裁判

| 职责 | 主要行为 | 关联 AC / 规则 | 当前裁判 |
| --- | --- | --- | --- |
| Schema 与 adapter 选择 | 创建内存数据库或 Tauri SQLite，保持表/字段一致 | 数据库边界规则 | M15 schema Harness、M20 SQL importer Harness |
| Video 记录与进度 | Video 创建、查询、列表、搜索、状态和学习进度 | AC-LV-02/09、AC-ST-01/05 | `database-videos.test.ts`、M15、视频列表、学习加载/进度测试 |
| 视频级联删除 | 原子删除 Video 及其 Node/Sentence/Note/reference/checkpoint | AC-LV-13 | 公共接口测试、M15/M20、Rust SQLite 成功/晚失败回滚/幂等测试（Strong） |
| 学习内容读写 | Node/Sentence 普通写入和按 Node/Video 查询 | AC-LV-04/05/09、AC-ST-01 | `database-content.test.ts`、M15、Pipeline/Stage2、学习加载测试 |
| 设置持久化 | 模型池、角色和能力记录使用的参数化 key-value CRUD | AC-LV-01/12、AC-ST-07 | `database-settings.test.ts`、M15 settings/recovery、模型池/能力/预检测试（Strong） |
| Runtime Settings 快照保存 | Store 提交成功后发布；原子保存模型列表、独立 Key、角色、能力记录和旧格式迁移 | AC-LV-14 | Runtime Settings Store/UI/boundary 测试、`database-settings.test.ts`、`model-pool.test.ts`、M20、Rust 成功/晚失败回滚测试（Strong） |
| 导入状态与恢复 | 批准状态转换、检查点、恢复判断 | AC-LV-03/06/07/08 | Pipeline 恢复测试、M03/M21、真实 Evidence |
| 原子导入写入 | ASR 保存、句子归属、最终节点/句子合并 | AC-LV-04/05/09 | Pipeline/Stage2 测试、Rust Harness、真实 Evidence |
| 笔记持久化 | Note 读取/编辑，Note 与 sentence 引用原子创建 | AC-ST-06 | M08/M15、学习页测试、前端 command 协议测试、Rust 事务测试 |

内存 adapter 是快速行为裁判，不是 Tauri SQLite 与 Rust command 的完整替身。涉及真实事务、command 参数或 SQLite 执行的结论，必须由 Rust Harness 或真实 Evidence 补足。

## 3. 当前审计结论

1. `database.ts` 变大的原因是六类职责混在一起，不是单纯行数过多。
2. 24 个生产调用位置依赖稳定公共入口，但没有生产调用者直接执行 SQL，因此可以内部渐进拆分。
3. 旧实现分别手写内存字段列表和 SQLite 建表 SQL，存在 schema 漂移风险。
4. `database-schema.ts` 现在是表、字段、约束和建表 SQL的唯一事实源；内存 adapter 和 Tauri adapter 从同一定义初始化。
5. M20 当前锁定“只有 `database.ts` 导入 Tauri SQL 插件”。未来内部拆分必须保留这个入口，或先经过明确的 Harness Migration，不能为了移动文件偷偷改裁判。
6. `Database` 现在只暴露两种 adapter 都真实支持的元数据 interface。内部通过 `adapterKind` 区分 `MemoryDatabaseAdapter` 与 `SqlDatabaseAdapter`；只有 SQLite adapter 拥有 `exec/query`，内存 adapter 不再提供空实现。
7. `database-boundary.test.ts` 禁止生产模块直接导入 `database-adapter`、`database-checkpoints`、`database-content`、`database-content-rows`、`database-import-atomic`、`database-import-state`、`database-notes`、`database-settings`、`database-video-deletion` 或 `database-schema`，并证明内存 adapter 不伪装支持 SQL。内部实现可以继续拆分，调用者仍只能看到稳定公共入口。
8. `database-import-state.ts` 统一负责受保护的导入状态转换和基于持久句子的恢复决策；SQLite command/查询和内存表细节不再留在公共入口。
9. `database-import-atomic.ts` 统一负责 ASR 保存、句子归属、最终合并和直接原子句子插入；`database-content-rows.ts` 是普通 CRUD 与原子写入共享的 Node/Sentence 行格式事实源。
10. `database-notes.ts` 统一负责 Note 与 sentence 引用持久化；内存 adapter 镜像主键/关联唯一约束和失败回滚。SQLite 创建通过单次 `insert_note_atomically` command 进入 `note_persistence.rs`，由一个连接上的真实事务提交 Note 与全部引用。
11. `database-content.ts` 统一负责 Node/Sentence 的普通写入和查询；它通过 adapter seam 访问 SQLite 或内存表，并与原子导入模块共享 `database-content-rows.ts` 行格式。业务调用方仍从 `@/models/database` 导入。
12. `database-videos.ts` 统一负责 Video 行映射、普通读写、列表/搜索和 `AC-ST-05` 进度更新。SQLite characterization 直接锁定 `position < $1`，防止真实数据库进度回退；级联删除不属于这个 module。
13. `database-video-deletion.ts` 统一负责 `AC-LV-13` 的公共删除行为。SQLite 路径只发送一次 `delete_video_atomically` command，由 `video_deletion.rs` 在单连接事务中清理六类归属数据；内存路径同时清理普通 Sentence 与 `node_id = videoId` 的 ASR 占位句，并保留其他 Video。
14. `database-settings.ts` 统一负责参数化 key-value CRUD。SQLite characterization 锁定 upsert/read/delete SQL、空字符串与缺失值语义及错误传播；M15 继续锁定内存 adapter。模型 JSON 与 Key 分离、迁移和能力失效属于更高层 `src/settings/` module，由其行为测试负责。
15. `saveRuntimeSettings` 和旧格式迁移把模型列表、Key、角色和能力记录组装为一个有序 `SettingMutation[]`，再调用 `applySettingMutationsAtomically`。SQLite 只发送一次 `apply_settings_atomically` command，由 `settings_persistence.rs` 在单连接事务中提交；内存 adapter 先计算完整结果再替换表。
16. Store 是 Runtime Settings 的发布门禁：添加模型、删除模型和角色分配先从当前 Store 状态构造候选快照，保存成功后才替换 Zustand 和模块内模型池副本。Settings UI 只消费这些公开动作，不得直接访问数据库进行影子 hydration。
17. 删除模型的候选快照必须同时清理该模型的能力记录和全部角色引用；`saveRuntimeSettings` 根据同一模型集合删除独立 API Key。该组合由 `AC-LV-15` 管理，不能退回 UI 删除后再分步修补角色。
18. Store 通过 `AC-LV-16` 的单提交队列排序所有 Runtime Settings 写动作，并用提交版本拒绝 stale hydration。数据库不承担前端动作排队，但队列中的每个候选快照仍必须通过同一个原子 Settings interface 提交。

## 4. 受控拆分顺序

每次只移动一个因不同原因变化、且有独立裁判的职责：

1. `Completed`：提取 schema 唯一事实源，公共 interface 不变。
2. `Completed`：导入状态、检查点和原子合并。adapter interface、检查点、状态转换、恢复判断、ASR 保存、句子归属和最终合并均已移出公共入口，由 AC-LV-03 至 AC-LV-09 的测试和 Rust/Evidence 裁判。
3. `Completed`：学习内容与 Video 普通持久化。Note/reference、Node/Sentence、Video 行映射、列表/搜索和 `AC-ST-05` 进度均有独立 module 与裁判。
4. `Completed`：设置持久化。公共 CRUD 由 SQLite characterization 与 M15 双 adapter 裁判；模型池、能力记录和预检继续裁判上层配置行为。
5. `Completed`：视频级联删除。`AC-LV-13`、公共接口、锁定 M15/M20 和 Rust 真实事务测试共同裁判；迁移记录见 `harness-migration-2026-07-27-video-deletion.md`。

禁止一次性重写整个数据库层。每一步都必须保持 `@/models/database` 导出兼容、运行对应裁判、更新本文件和 `PROJECT_STATE.md`。
