# AGENTS.md — Rain 项目环境与构建指南

> 新会话/新 AI 开发者读本文件即可了解环境与构建命令。

## 新会话必读：项目控制面

任何新 AI / 开发者进入本项目后，必须按以下顺序阅读：

1. `docs/development/control-map.md`：不同问题应相信哪份事实源；
2. `CONTEXT.md`：项目统一领域语言；
3. `docs/PROJECT_STATE.md`：当前可验证状态和已知风险；
4. 与任务有关的 `acceptance-standard.md`、`harness-coverage.md` 和 `module-map.md`；
5. 与任务有关的 PRD/spec、代码、测试和证据。

不要直接根据 PRD、旧计划、旧截图或旧 evidence 判断当前实现已经完成。

`docs/PROJECT_STATE.md` 是当前项目事实来源，记录：

- 当前可验证状态；
- 文件/目录作用；
- 已知缺陷；
- 最近会话改动；
- 每轮会话结束前必须同步更新的维护清单。

如果本轮会话修改了项目文件，交付前必须同步更新 `docs/PROJECT_STATE.md`。

每个代码改动必须指出对应 AC、实现模块和验证方式。没有 AC 的新产品行为先标记为 `Proposed`，不得由 AI 静默决定。

## 环境前置依赖

本项目是 Tauri + React + TypeScript 桌面应用。Rust 后端依赖 whisper-rs（whisper.cpp 的 Rust binding），需要以下本机工具链：

| 工具 | 用途 | 安装方式 | 验证命令 |
|------|------|---------|---------|
| Rust 1.96+ | Rust 编译器 | https://rustup.rs | `rustc --version` |
| Node.js 18+ | 前端构建 | https://nodejs.org | `node --version` |
| MSVC C++ Build Tools | whisper.cpp 编译 | VS 2022 BuildTools (C++ workload) | `cl 2>&1` (在 Developer PowerShell 里) |
| Windows SDK | Windows API | VS 2022 BuildTools 自带 | — |
| LLVM/libclang 22+ | whisper-rs bindgen | `winget install LLVM.LLVM` | `clang --version` |
| cmake 4+ | whisper.cpp 构建 | `winget install Kitware.CMake` | `cmake --version` |
| yt-dlp | 在线视频导入（运行时依赖，非编译依赖） | 用户自装加 PATH | `yt-dlp --version` |

## 必须设置的环境变量（用户级，永久）

以下环境变量必须设置，否则 whisper-rs 编译失败：

```
LIBCLANG_PATH = C:\Program Files\LLVM\bin
CMAKE_CXX_FLAGS = /utf-8
CMAKE_C_FLAGS = /utf-8
PATH 追加: C:\Program Files\LLVM\bin;C:\Program Files\CMake\bin
```

**`/utf-8` 的原因**：whisper.cpp 源码含 UTF-8 字符，MSVC 在中文系统默认用 GBK 解码会报 "error C3688: 文本后缀无效"。`/utf-8` 告诉 MSVC 源码是 UTF-8。

**PowerShell 设置命令**（一次性，永久生效）：
```powershell
[Environment]::SetEnvironmentVariable('LIBCLANG_PATH', 'C:\Program Files\LLVM\bin', 'User')
[Environment]::SetEnvironmentVariable('CMAKE_CXX_FLAGS', '/utf-8', 'User')
[Environment]::SetEnvironmentVariable('CMAKE_C_FLAGS', '/utf-8', 'User')
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
[Environment]::SetEnvironmentVariable('PATH', "$userPath;C:\Program Files\LLVM\bin;C:\Program Files\CMake\bin", 'User')
```

设置后**必须重新打开终端**才生效。

## 构建命令

| 命令 | 用途 |
|------|------|
| `npm install` | 安装前端依赖 |
| `npm test` | 跑全部前端测试（Vitest） |
| `npm run test:watch` | 测试监听模式 |
| `npm run test:rust` | 跑 Rust 测试（cargo test） |
| `npm run harness:control` | 快速检查 Confirmed AC、Owner、Judge、覆盖行、裁判文件和当前事实冲突 |
| `npm run harness:check` | 一键运行控制面校验、全部前端测试、生产构建和 Rust 测试 |
| `npm run tauri dev` | 开发模式启动 Tauri 应用 |
| `npm run tauri build` | 打包发布版 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 仅检查 Rust 编译 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 跑 Rust 测试 |

## 第一次跑 cargo check 会发生什么

首次 `cargo check` / `cargo build` 会：
1. 下载并编译 Tauri 2 + 全部依赖（约 400+ crate）
2. 通过 cmake 编译 whisper.cpp（约 2-3 分钟）
3. 通过 bindgen 生成 Rust binding

首次总耗时约 5-10 分钟。后续增量编译很快。

## Harness 系统

本项目采用 **harness-gated development**：
- 产品 Harness 在 `harness/`（前端）和 `src-tauri/tests/`（Rust）；实现级回归测试还包括 `src/__tests__/`
- Harness 默认锁定，功能实现者不得为了让代码通过而静默降低或删除 AC
- 只有用户明确批准 **Harness Migration** 后才能修改锁定文件；迁移必须记录旧合同、替代裁判、对应 AC、退役影子模块和验证结果
- 修改 Harness 时优先让测试调用真实公开接口并断言结果、状态或副作用；函数/常量存在、对象自我赋值和恒真表达式不算验收
- AI 开发者在 feature 分支实现代码，必须让 harness 全绿才能合并
- 开始修改前先运行 `npm run harness:control`；交付代码改动前运行 `npm run harness:check`。昂贵的 live-key 和真实 E2E 仍按对应 AC/Evidence 规则单独决定并明确报告
- 当前迁移记录见 `docs/development/harness-migration-*.md`；按任务对应的 AC 选择迁移记录
- 详细设计见 `docs/superpowers/specs/2026-07-07-harness-gated-development-design.md`

## 已知坑

1. **whisper-rs 版本**：必须用 0.16+，0.13 有 API 不匹配 bug（whisper-rs 0.13 引用了 whisper-rs-sys 0.11.1 里不存在的字段）
2. **MSVC 中文系统编码**：不设 `CMAKE_CXX_FLAGS=/utf-8` 会报 C3688 错误
3. **winget 不自动加 PATH**：装完 LLVM 和 CMake 后需要手动加 PATH
