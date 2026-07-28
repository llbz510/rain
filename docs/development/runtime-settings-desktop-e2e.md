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

## Hosted Windows 手动重放

GitHub Actions workflow `Runtime Settings Desktop E2E` 提供 `AC-HE-05` 的独立环境 Owner。它只允许 workflow_dispatch，在目标提交的干净 `windows-2025` checkout 中安装固定 Node/Rust/LLVM/`tauri-driver`、机械要求 CMake 4+，读取 runner 的 Edge WebView2 Runtime 精确版本并从微软下载同版 `msedgedriver`。Hosted job 还在自己的子进程范围内为 Edge WebView2 150+ 显式启用远程调试并禁用不可用的 GPU/sandbox 依赖，然后执行未带 `-SkipBuild` 的同一公开命令。workflow 不持有写入凭据，不接收 Rain secrets，也不复制本页前述产品断言。

远端失败时只上传脚本已生成的 `rain-runtime-settings-e2e-latest-failure` 脱敏目录，保留 7 天；隔离 SQLite 和整个临时目录都不上传。该 workflow 不自动响应 pull request/push，不成为默认合并门禁，不生成 Evidence。纯 workflow_dispatch 文件必须先存在于默认分支才可首次触发，因此首次合并前只能记录为 Gap，不能以 YAML 存在冒充远端 GREEN。

## 失败诊断

失败时脚本保留单份诊断：

```text
%TEMP%\rain-runtime-settings-e2e-latest-failure\
  summary.json
  tauri-driver.log
  tauri-driver.err.log
```

`summary.json` 包含失败阶段、主错误、时间和公开命令。脚本在任何构建/启动动作前捕获并清空当前进程中的已知 LLM Key，写文件时再次替换这些值、`sk-*` 凭据和 Bearer token。日志文件只在 driver 已产生对应输出时存在，不保留隔离 SQLite。

新失败替换旧诊断，避免无限积累；完整成功会删除 stale `latest-failure`。诊断写入或清理异常不得掩盖原始失败。开发者可对已构建的 E2E 二进制使用 `-SkipBuild -MaxSeconds 0` 制造非零退出，机械复核失败诊断；该命令是负向 Judge，不应被报告为正常 E2E 通过。
