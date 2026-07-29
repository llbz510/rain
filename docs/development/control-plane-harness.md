# Rain Control Plane Harness

> 状态：Active
> 更新日期：2026-07-29
> 作用：让仓库机械检查自己的事实源和裁判映射，避免 AI 依赖已经过时但看起来可信的文档。

## 快速入口

```powershell
npm run harness:control
```

该命令只检查控制面，适合开始任务和修改文档后快速运行。代码交付前使用：

```powershell
npm run harness:check
```

完整命令依次运行控制面 validator、全部前端测试、显式 E2E 前端构建、普通生产构建和 Rust 测试。两种构建都按 `AC-HE-02` 扫描真实 `dist` 中的 JavaScript 与 JavaScript source map：E2E 构建必须包含全部自动化标记，普通构建必须全部排除；独立 fixture 还证明裁判不能漏过只存在于 source map 的标记。普通构建排在 E2E 构建之后，因此成功结束时 `dist` 是普通可发布产物。该 E2E 前端构建不启动 Tauri、不读取 live-key、不生成 Evidence；live-key、短桌面 E2E 和多小时真实 E2E 仍按对应 AC 与 Evidence 规则单独决定，不能伪装成默认已运行。

GitHub Actions workflow `Harness` 中的 `Clean Windows Harness` check 是 `AC-HE-04` 的独立环境 Judge：pull request 和 `master` push 都从干净的 `windows-2025` checkout 安装锁定的 npm 依赖，并运行同一个 `harness:check`。workflow 只有 `contents: read` 权限，不持久化 checkout 凭据，不接收项目 secrets；远端通过不能替代本机 Tauri、live-key 或真实 Evidence，远端失败也不得通过降低本地 AC/Harness 来修复。

GitHub Actions workflow `Runtime Settings Desktop E2E` 是 `AC-HE-05` 的手动 Hosted Windows Owner。它只在 workflow_dispatch 时准备桌面工具链，并调用现有 `npm run e2e:runtime-settings`；产品断言、SQLite 隔离、两次重启和脱敏仍由仓库脚本拥有。该 workflow 不响应 pull request/push，不是默认必需检查。只有目标提交上的真实远端 run 能签发 AC；workflow 文件存在和默认 Harness 通过都不能替代它。

## 当前机械规则

1. `acceptance-standard.md` 中每条 `Confirmed` AC 必须恰有一条 coverage 行。
2. 每条 `Confirmed` AC 必须声明非空的“实现归属”和“裁判”。
3. coverage 中反引号标记的 `.test.ts`、`.test.tsx`、`.ps1` 和 `.rs` 裁判文件必须存在；带通配符的裁判集合由其上层 Harness 负责。
4. coverage 不得引用验收标准中不存在的 AC。
5. 同一 AC 不得在验收标准中重复定义或同时具有不同状态。
6. `PROJECT_STATE.md` 的当前事实区不得把已经 Confirmed 的 AC 重新称为 Proposed；按日期记录的历史区允许保留当时状态。
7. `product-decision-coverage.md` 必须恰好包含 `DEC-PRD-001` 至 `DEC-PRD-099`，不得缺失、重复或引入范围外编号。
8. 每条产品决策必须具有当前 PRD/M 事实源、非空意图，以及 `Confirmed AC`、`Proposed`、`Out-of-scope` 三种处置之一。
9. `Confirmed AC` 行只能引用现存且为 Confirmed 的 AC；另外两种处置必须写明当前边界。历史 `HANDOFF.md`、旧计划和 Evidence 不能充当产品事实源。

## 责任边界

validator 只裁判“事实与裁判映射是否自洽”，不裁判产品行为是否正确。产品行为仍由 coverage 指向的公开接口测试、Rust 事务测试、真实桌面 Evidence 和必要的人工产品判断负责。决策覆盖数量也不是项目完成百分比；`Proposed` 行可能已有局部代码，而 `Confirmed AC` 行也只能继承所列 AC 的明确范围。

规则实现与 fixture 测试分开：`control-plane-validator.mjs` 是 Node 可执行入口，`control-plane-validator.test.ts` 用独立小文档证明每类错误能被抓住。新增规则必须先有失败 fixture，不能只为当前仓库写恒真检查。
