# Rain Control Plane Harness

> 状态：Active
> 更新日期：2026-07-28
> 作用：让仓库机械检查自己的事实源和裁判映射，避免 AI 依赖已经过时但看起来可信的文档。

## 快速入口

```powershell
npm run harness:control
```

该命令只检查控制面，适合开始任务和修改文档后快速运行。代码交付前使用：

```powershell
npm run harness:check
```

完整命令依次运行控制面 validator、全部前端测试、普通生产构建和 Rust 测试。生产构建还会按 `AC-HE-02` 扫描真实 `dist`，拒绝 E2E 自动化标记。live-key 和多小时真实 E2E 仍按对应 AC 与 Evidence 规则单独决定，不能伪装成默认已运行。

## 当前机械规则

1. `acceptance-standard.md` 中每条 `Confirmed` AC 必须恰有一条 coverage 行。
2. 每条 `Confirmed` AC 必须声明非空的“实现归属”和“裁判”。
3. coverage 中反引号标记的 `.test.ts`、`.test.tsx`、`.ps1` 和 `.rs` 裁判文件必须存在；带通配符的裁判集合由其上层 Harness 负责。
4. coverage 不得引用验收标准中不存在的 AC。
5. 同一 AC 不得在验收标准中重复定义或同时具有不同状态。
6. `PROJECT_STATE.md` 的当前事实区不得把已经 Confirmed 的 AC 重新称为 Proposed；按日期记录的历史区允许保留当时状态。

## 责任边界

validator 只裁判“事实与裁判映射是否自洽”，不裁判产品行为是否正确。产品行为仍由 coverage 指向的公开接口测试、Rust 事务测试、真实桌面 Evidence 和必要的人工产品判断负责。

规则实现与 fixture 测试分开：`control-plane-validator.mjs` 是 Node 可执行入口，`control-plane-validator.test.ts` 用独立小文档证明每类错误能被抓住。新增规则必须先有失败 fixture，不能只为当前仓库写恒真检查。
