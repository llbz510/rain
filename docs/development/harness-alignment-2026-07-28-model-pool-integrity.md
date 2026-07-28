# Rain Harness Alignment - Model Pool Integrity - 2026-07-28

> 授权：用户于 2026-07-28 明确同意“本地 Whisper 下载完成后才能入池”和“删除模型同时清空对应角色”。
> 对应合同：`AC-MM-04`、`AC-LV-15`。
> 锁定 Harness：本次不修改 `harness/` 或 `src-tauri/tests/`。

## 事实源与边界

- Rust `list_whisper_models` 是最终模型文件是否可发现的事实源；下载表单状态不是。
- Store `addModel` 是不可绕过的入池门禁，通过共享 `requireInstalledWhisperModel` 复核所选 size。
- Runtime Settings 快照是模型删除结果的事实源；删除候选快照同时清理模型、能力记录和全部角色引用。
- 进入模型池只表示“已配置”，ASR `Compatible` 仍只能由独立 capability probe 签发。

## 裁判映射

| AC | Owner | Judge |
|---|---|---|
| `AC-MM-04` | installed-list adapter、Store 添加动作、AddModelForm | `runtime-settings-store.test.ts` 拒绝未安装直调；`whisper-model-download.test.tsx` 锁定验证前禁用、验证后解锁；M20/Rust 继续锁定列表协议与最终文件 |
| `AC-LV-15` | Store 删除候选快照、Runtime Settings 原子持久化 | `runtime-settings-store.test.ts` 检查所有角色和能力引用进入同一保存快照；UI 失败测试与现有 SQLite 事务测试检查失败保留 |

红灯阶段分别证明旧实现会允许未安装 Whisper 直接入池、保留被删模型的两个角色引用，并在下载前启用保存。实现只在这些公开 seam 上收敛，没有引入第二套安装状态或分步删除。
