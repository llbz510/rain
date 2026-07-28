# Rain Runtime Settings Desktop E2E

> 状态：Active
> 更新日期：2026-07-28
> 作用：定义无需 live-key 的 Runtime Settings 短桌面 Judge，防止 Store、Tauri SQL plugin、SQLite 和进程重启之间出现假绿。

## 对应合同

- `AC-LV-14`：添加模型形成的完整 Runtime Settings 快照必须真实落库，重启后仍存在。
- `AC-LV-15`：删除模型后再次重启，条目不得复活。
- `AC-LV-16`：首次 hydration 完成前不得写入；桌面 Judge 必须等待生产设置页公开的 `ready` 状态。

Runtime Settings Owner 保持为生产 Store、Runtime Settings 规划、数据库 Settings interface 和 Rust `settings_persistence`；schema Owner 是 `createDatabase`/`TauriSqlDatabase`。`RealE2eRunner` 的短模式只通过公共 `Database.listTables/getTableColumns` interface 报告实际值，`scripts/run-runtime-settings-e2e.ps1` 拥有独立期望合同和验证编排；二者都不复制建表 SQL，也不绕过应用直接查询 SQLite。

## 公开命令

```powershell
npm run e2e:runtime-settings
```

脚本先设置 `RAIN_E2E_BUILD=1`，构建包含真实 `E2eAutomation` adapter 的当前前端与 Tauri debug 应用，然后：

1. 在系统临时目录创建唯一隔离 SQLite；
2. 启动真实 Tauri，进入生产设置页并等待 Runtime Settings `ready`；
3. 读取生产数据库公开的实际 metadata，以独立字面合同检查 7 张表及全部必需列；
4. 通过真实表单添加一个 API Key 为空的测试 LLM；
5. 关闭应用并重启，确认该条目仍可见；
6. 通过真实模型池 UI 删除条目；
7. 再次关闭并重启，确认条目不再出现；
8. 关闭 WebDriver 并清理隔离目录。

`-SkipBuild` 只供本地迭代已构建的同一工作树二进制使用，不是正式交付命令。

## 安全与边界

边界内：真实 Tauri、生产 Store 初始化与动作、Tauri SQL plugin、真实 SQLite 必需表/列形状、Runtime Settings 事务、两次进程重启和生产设置 UI。

边界外：schema 版本迁移和新增列兼容政策、其他业务 CRUD 语义、模型连接、能力探针、收费调用、API Key 持久化、Whisper 下载、角色分配、事务故障注入、完整视频导入和 `Verified` Evidence。脚本在启动 driver 前清空当前进程中的已知 LLM Key 环境变量，并确认表单 Key 为空；成功不代表任何模型 `Compatible` 或 `Verified`。

该 Judge 不进入默认 `harness:check`，因为它依赖 Windows WebView2、`tauri-driver` 和匹配的 `msedgedriver`。相关代码改动交付时仍必须显式运行它，并在 `PROJECT_STATE.md` 记录结果。带 `RAIN_E2E_BUILD=1` 的产物只用于自动化，不得作为普通发布包；默认 `npm run build` 会反向验证普通产物不包含自动化标记。
