# Rain Harness-Gated Development 设计文档

> 日期：2026-07-07
> 状态：已确认

## 目标

建立自动化测试 harness 体系，确保 AI 开发者在实现代码时不偏离 PRD 文档的 99 个已确认决策。核心原则：

1. **Harness 先于代码** — 每个模块先有 harness（测试），再写实现
2. **Harness 锁定不可改** — harness 提交到 main 分支，AI 开发在 feature 分支，不允许修改 harness
3. **通过 harness = 符合文档** — harness 是 PRD 的可执行版本
4. **逐层推进** — 按依赖关系分层实现，下层通过后才做上层

## 技术选型

| 维度 | 选择 |
|------|------|
| 前端测试框架 | Vitest |
| 后端测试框架 | Rust #[test]（后续 Tauri 初始化时添加） |
| Harness 粒度 | 模块级（每模块 1-3 个 harness 文件） |
| 测试深度 | 行为级（验证输入/输出/边界，不锁内部实现） |
| 保护机制 | Git 分支保护（harness 在 main，开发在 feature） |

## 分层架构

### Layer 0: 基础层（Ground Truth）
数据定义与存储的基石。

| 模块 | Harness 文件 | 测试点数 |
|------|-------------|---------|
| M02 数据模型 | m02-types / m02-tree / m02-tree-ops / m02-text / m02-notes | 44 |
| M15 数据持久化 | m15-schema-crud / m15-settings-recovery / m15-queries | 28 |
| M20 技术架构 | m20-boundaries / m20-store-ytdlp | 12 |
| **小计** | **10 文件** | **84** |

### Layer 1: 管线层（Data Pipeline）
视频进入 → 数据产出的链路。

| 模块 | Harness 文件 | 测试点数 |
|------|-------------|---------|
| M03 视频导入 | m03-video-import | 8 |
| M04 AI处理管线 | m04-ai-pipeline | 13 |
| M18 长视频分块 | m18-long-video | 11 |
| M19 设置与模型 | m19-settings | 9 |
| **小计** | **4 文件** | **41** |

### Layer 2: UI 交互层（Interaction）
学习界面的各个区域。

| 模块 | Harness 文件 | 测试点数 |
|------|-------------|---------|
| M16 界面布局 | m16-layout | 7 |
| M05 目录区 | m05-catalog | 8 |
| M06 视频区 | m06-video | 4 |
| M07 文本区 | m07-text | 6 |
| M08 摘注与随记 | m08-notes | 5 |
| M13 视觉设计 | m13-visual | 5 |
| **小计** | **6 文件** | **35** |

### Layer 3: 集成层（Orchestration）
跨模块协调与全局行为。

| 模块 | Harness 文件 | 测试点数 |
|------|-------------|---------|
| M10 AI助手 | m10-ai-assistant | 8 |
| M14 快捷键 | m14-shortcuts | 8 |
| M17 视频列表 | m17-video-list | 7 |
| **小计** | **3 文件** | **23** |

### 总计

| 层 | 文件数 | 测试点数 |
|----|--------|---------|
| Layer 0 | 10 | 84 |
| Layer 1 | 4 | 41 |
| Layer 2 | 6 | 35 |
| Layer 3 | 3 | 23 |
| **总计** | **23** | **183** |

## 不含 Harness 的模块

| 模块 | 原因 |
|------|------|
| M01 产品定位 | 纯文档约束，无可测代码 |
| M11 派生系统 | v2 实现，v1 仅预留字段 |
| M12 统计封面 | 已删除 |

## AI 开发流程

```
1. AI 领取一个层的任务
2. 在 feature 分支开发
3. 运行 npm test — 必须通过该层所有 harness
4. 提交 PR，人工审查 diff（确认没有修改 harness/）
5. 合并后进入下一层
```

## Harness 文件约定

- 所有 harness 文件位于 `harness/` 目录
- 文件名格式：`m{模块号}-{描述}.test.ts`
- 每个文件顶部注释标记"锁定后禁止 AI 修改"
- Harness 只验证行为（黑盒），不锁定内部实现细节
- 测试编号格式：`M{模块号}-T{序号}`

## 源码目录规划

```
src/
  models/         # M02 类型定义、工厂、校验器、树操作、文本工具
                  # M15 数据库操作
  architecture/   # M20 命令列表、事件协议、store 契约
  pipeline/       # M03 导入管理、M04 ASR标准化/Stage2校验、M18 长视频分块
  settings/       # M19 模型池、高级设置
  ai/             # M10 AI 助手
  ui/             # M05/M06/M07/M08/M13/M14/M16/M17 所有 UI 逻辑
```
