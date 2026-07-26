# Rain Harness 覆盖矩阵

> 状态：Active
> 更新日期：2026-07-26
> 作用：说明每条 AC 由谁检查，以及现有检查能证明到什么程度。

## 1. 覆盖等级

| 等级 | 含义 |
| --- | --- |
| `Strong` | 通过公开接口执行真实行为，并断言结果、状态或副作用 |
| `Partial` | 只覆盖 AC 的一部分，或使用替身而未贯通关键模块 |
| `Evidence` | 真实应用、真实输入和真实外部依赖生成的可校验证据 |
| `Weak` | 只验证函数、常量、字段或文件存在，无法证明行为 |
| `Gap` | 没有可信检查 |

“有测试文件”不代表已经覆盖。判断标准是：把实现改坏以后，这个检查能不能可靠失败。

## 2. 本地视频主链路

| AC | 当前裁判 | 等级 | 当前结论与缺口 |
| --- | --- | --- | --- |
| AC-LV-01 | `preflight.test.ts`、`settings-preflight.test.tsx` | Strong | 覆盖阻塞项、警告项和秘密隐藏；真实桌面环境由 E2E/人工运行补充 |
| AC-LV-02 | `video-list-local-import.test.tsx`、M03/M21 Harness、M17 卡片测试 | Strong | M03/M21 已迁移到真实 `VideoImportController`、内存数据库和桌面命令适配器；覆盖“用户选文件 -> 探测 -> pending -> 启动 Pipeline”，并证明本地导入不调用 `yt-dlp` |
| AC-LV-03 | `pipeline-asr.test.ts`、真实证据 | Strong + Evidence | 已覆盖无模型、坏路径、无 demo fallback、ASR 失败不进 Stage2 |
| AC-LV-04 | `database-recovery.test.ts`、`pipeline-asr.test.ts` | Strong | 覆盖回滚和过期写入防护；Rust 与 SQLite 的真实事务由 E2E 补充 |
| AC-LV-05 | `stage2-runner.test.ts`、M04/M18 Harness、证据校验器 | Strong + Evidence | M04/M18 已迁移到当前 `stage2-contract` / `stage2-runner`，覆盖缺失、重复、外来、树错误、分块、重试、确定性合并和精确覆盖 |
| AC-LV-06 | `pipeline-asr.test.ts`、M03 Harness | Strong | M03 通过真实数据库状态转换和控制器检查批准路径，不再直接给对象赋值 |
| AC-LV-07 | `asr-abort.test.ts`、Pipeline 测试、取消证据 | Strong + Evidence | 真实证据包含取消事件链；UI 到 Rust 的时序风险仍需 E2E 保持 |
| AC-LV-08 | `pipeline-recovery.test.ts`、Stage2 检查点测试、重试证据 | Strong + Evidence | 已覆盖复用 ASR 和重跑坏检查点 |
| AC-LV-09 | `validate-evidence.ps1`、数据库摘要、学习页截图 | Evidence | 这是“真实可用”声明的主要裁判；普通单元测试不能替代 |
| AC-LV-10 | `video-list-page-recovery.test.tsx`、`video-list-import.test.tsx` | Strong | 覆盖事件驱动 UI 和持久化终态；真实事件链由 E2E 补充 |
| AC-LV-11 | `validate-evidence.test.ts`、`validate-evidence.ps1` | Strong + Evidence | 覆盖哈希、乱码、demo、CUDA、结构、取消、重启、截图和秘密 |
| AC-LV-12 | 上述能力/运行时测试、`validate-evidence.test.ts`、`validate-evidence.ps1`、真实 E2E Runner | Partial（待 Evidence） | 三角色探针、角色门禁、导入门禁和文本助手门禁均复用生产接口。证据 schema v2 要求三角色 `Compatible` 检查、同配置 `Verified` 记录、缺少能力时的负向门禁事件，以及通过 `VideoImportController` 的真实取消/重试/落库流程；通用 OpenAI-compatible endpoint/model 不再被固定 Qwen 名称限制。旧 schema v1 证据继续按原固定运行时规则验证。当前唯一验收缺口是尚未实际运行一次新的 schema v2 外部模型 + 完整视频 E2E，因此不能把任何新配置宣称为 `Verified` |

## 3. 架构 Harness 审计

| 规则 | 当前裁判 | 等级 | 问题 |
| --- | --- | --- | --- |
| LLM 只在前端调用 | `harness/m20-boundaries.test.ts` | Strong | 扫描真实 `src/llm/` 源码，禁止 `invoke` / `tauriInvoke` |
| Tauri command “包含且仅包含”规定命令 | `harness/m20-boundaries.test.ts` | Strong | 解析真实 `src-tauri/src/lib.rs` 的 `generate_handler!`，检查精确集合和重复项 |
| 数据库由前端边界模块访问 | `harness/m20-boundaries.test.ts` | Strong | 扫描真实前端源码，确保只有 `src/models/database.ts` 导入 Tauri SQL 插件 |
| progress 事件名称和字段 | M20/M21 前端 Harness、Rust `events`/`commands` Harness | Strong | 覆盖事件订阅转发、重复监听释放、Rust camelCase 序列化和 ASR 子阶段 |
| Rust Harness 系统行为 | `src-tauri/tests/*_harness.rs` | Strong | 覆盖调度串行化、按视频取消、取消令牌、ffmpeg/Whisper/yt-dlp 非法输入、错误上下文和真实媒体 fixture |
| 视觉令牌 | `harness/m13-visual.test.ts` | Strong | 读取并装载应用实际使用的 `src/index.css`，通过 CSSOM 检查变量；不再维护 TS 复制品 |
| 学习页视频语言 | M07 Harness、`study-playback.test.tsx` | Strong | `loadVideo` 将数据库语言写入生产 store，英文译文显示不依赖测试 Context |
| 测试状态注入 | `harness/support/test-store-provider.tsx` | Test support | 只供测试使用；生产源码禁止导入 `harness/support` |

2026-07-26 经用户批准完成两轮 Harness Migration。旧的影子注册表、假导入队列、未接入树编辑、视觉令牌复制品、旧 ASR 标准化和恒真 Rust 测试已被真实接口行为测试替代或明确退役；详见 `harness-migration-2026-07-26.md`。

## 4. 当前不设“已完成”门禁的能力

| 能力 | 状态 | 处理规则 |
| --- | --- | --- |
| 高级树编辑（拆分、合并、重挂、改类型） | Proposed | 没有 Active AC 和真实 UI/数据库闭环；不得恢复只供 Harness 调用的 `tree-ops` |
| 在线 URL 完整导入 | Gap | 进入验收范围前，不得用空 `start_import` command 或字幕/API 标准化函数表示已实现 |
| Vision 解释当前画面 | Gap | 必须有截图、图像请求和模型能力验证后才能加入完成门禁 |

## 5. 变更时如何查表

例如修改取消逻辑：

1. 查到对应 `AC-LV-07`。
2. 实现应集中在取消接口、Pipeline signal 和 Rust task。
3. 至少运行取消/ASR/Pipeline 相关测试。
4. 如果修改了跨前后端取消协议，必须重跑真实取消证据，不能只看单元测试。
5. 更新本表的等级或缺口。

这就是“每条 AC 被谁管”：实现模块负责让它成立，裁判负责在它失效时报警。
