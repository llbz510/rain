# Rain Harness Alignment - Runtime Settings Store Commit - 2026-07-28

> 授权：用户于 2026-07-28 批准按顺序继续用 Harness 理念梳理模型下载到角色可选闭环。
> 对应合同：已 Confirmed 的 `AC-LV-14`；本次不新增删除模型后的角色语义，也不修改锁定 `harness/`。

## 发现的断层

Rust/SQLite 已能原子提交完整 Runtime Settings，但 Store 的添加、删除和角色动作会先修改内存，再 fire-and-forget 保存并吞掉错误。数据库失败时，UI 因此会显示只存在于本次内存会话的假成功。`SettingsPage` 还绕过 Store 直接读取数据库，形成第二套 hydration，并把持久化 `RuntimeModel.model` 当成表单 `modelName` 形状处理。

## 责任收敛

- `model-pool.ts` 用纯候选条目和指定 entries 组装完整 Runtime Settings 快照。
- Store 是唯一提交门禁：先等待 `saveRuntimeSettings`，成功后再发布 Zustand 和模块内模型池副本；失败返回可显示错误且不改变旧状态。
- `SettingsPage` 不再直接访问数据库。启动 hydration 只由 Store 的 `createRuntimeSettingsInitializer` 负责。
- 添加表单、删除动作和角色选择等待 Store 结果；失败保持原 UI 事实并显示错误。

## 裁判

| Seam | Judge | 证明内容 |
|---|---|---|
| Store 公开设置动作 | `runtime-settings-store.test.ts` | 添加、删除、角色分配的保存失败不会发布内存状态；模块内模型池副本也不漂移 |
| Settings UI | `runtime-settings-ui.test.tsx` | 添加失败不关表单，删除失败保留条目，角色失败保留旧选择，三者均显示错误 |
| 模块边界 | `settings-boundary.test.ts` | `src/ui/components/settings/` 不得导入数据库 interface |
| 持久化与事务 | 原 `model-pool`、database Settings、M20、Rust tests | 完整 mutation batch、command 协议和 SQLite 回滚继续成立 |

本切片完成时，删除模型是否应在同一快照中主动清空引用它的角色尚未明确，因此当时保留原行为。用户随后已确认清理语义；现行事实为 `AC-LV-15`，迁移和裁判见 `harness-alignment-2026-07-28-model-pool-integrity.md`。
