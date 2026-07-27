# Rain Harness Migration - Atomic Runtime Settings - 2026-07-27

> 状态：Active
> 授权：用户于 2026-07-27 明确批准建立 Runtime Settings 原子保存 AC 并修改锁定 Harness。
> 对应合同：`AC-LV-14`

## 1. 旧合同与缺口

M15-T14 至 T17 只负责单个 key-value 的内存 CRUD，不能证明模型列表、多个 API Key、角色和能力记录作为一个快照保存。当前 `saveRuntimeSettings` 连续执行多次独立写入/删除，中途失败会留下新旧混合配置；旧格式迁移也有相同风险。

M20 精确锁定真实 Tauri command 集合，因此新增事务 command 必须经过本次明确迁移。M15 的单 key 合同仍然有效，不需要降低或修改。

## 2. 替代与新增裁判

| 裁判 | 负责证明 |
| --- | --- |
| `database-settings.test.ts` | SQLite 只发送一次批量 command、payload 正确、错误传播；内存 adapter 按顺序应用并保留无关 key |
| `model-pool.test.ts` | 正常保存和旧格式迁移都构造一个完整 mutation batch；模型 JSON/能力记录不含 Key |
| `harness/m20-boundaries.test.ts` | `apply_settings_atomically` 属于真实且精确的 Tauri command 集合 |
| Rust Settings persistence tests | 真实 SQLite 成功提交、最后动作失败时全部回滚、无关 key 保留 |

## 3. 锁定文件变更

- `harness/m20-boundaries.test.ts`

本次只加入经批准的真实 command，不修改 M15 的单 key CRUD 语义。

## 4. 退役路径

- `saveRuntimeSettings` 和旧配置迁移不再直接组合多次独立 `setSetting/deleteSetting`。
- SQLite 批量变更统一进入一个 Rust SQLx 事务。
- 内存 adapter 先计算完整结果，再一次替换 setting 表。

## 5. 验证

实现前定向红灯准确发现：批量 Settings interface 不存在、内存批次行为不存在、真实 Rust command 未注册。

实现后定向结果：

- Settings/model-pool/M15/M20/设置 UI：7 个文件 / 47 条测试通过。
- Rust `settings_persistence`：2 条测试通过，包括最后动作失败时全回滚。

完整验证：

- Vitest：70 个文件 / 419 条测试通过，1 条 live-key 测试按环境门禁跳过。
- Rust：81 条测试通过，1 条真实 Whisper 模型测试按设计忽略。
- TypeScript 与 Vite 生产构建通过；保留既有动态/静态 import chunking 警告。
- 多小时真实视频 E2E 未重跑；本次由业务 mutation batch、公开 command 协议和真实 SQLite 事务直接裁判，不改变 ASR、LLM 请求或学习页渲染。
