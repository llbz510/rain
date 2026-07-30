# Rain Harness Migration - 2026-07-30 Thumbnail Ownership

> 状态：Completed
> 授权：用户于 2026-07-30 明确批准本次锁定 Harness 修改。
> 对应 AC：`AC-LV-18`
> 目的：把本地缩略图的文件位置从前端和用户源目录迁移到 Rust app-data Owner，并让生产卡片通过真实媒体桥接渲染该路径。

## 1. 旧合同与缺口

锁定 `harness/m21-import-controller.test.ts` 当前要求 `VideoImportController.importLocal` 调用：

```text
generate_thumbnail({
  filePath: "D:\courses\course.mp4",
  outputPath: "D:\courses\course_thumb.jpg",
  timestamp: 1
})
```

该合同把缩略图存储位置交给前端，并要求写入用户源视频目录。生产 Rust command 同时接受任意 `outputPath` 并交给 ffmpeg 覆盖写入；只读目录会使缩略图静默缺失，可写目录会被 Rain 增加 sibling 文件。生产 `VideoCard` 又把数据库中的 Windows 路径原样交给 `<img>`，没有使用播放器已经采用的 `convertFileSrc` 媒体桥接。

旧合同因此保护了错误的文件 Owner，不能继续作为完成证据。

## 2. 替代裁判

| 层级 | 新裁判 | 负责发现的问题 |
| --- | --- | --- |
| 生产卡片 | `src/__tests__/video-thumbnail-ownership.test.tsx` | 本地路径必须经 `localMediaUrl` 转为 asset URL；HTTP(S) 保持原值；空图使用稳定占位 |
| 锁定 Controller seam | M21 `AC-LV-18` 用例 | `importLocal` 只传 `filePath/videoId/timestamp`，不再传输出路径，并把 Rust 返回的 app-owned 路径保存到 Video |
| 未锁定 Controller seam | `src/__tests__/video-import-local-id.test.ts` | 两个 Controller 共享数据库并发导入时仍必须在任何缩略图副作用前取得不同 Video ID；该 Judge 不扩大锁定 M21 |
| Rust 文件 Owner | `src-tauri/src/thumbnail_storage_tests.rs` | 真实媒体写入隔离 app-data、最终文件非空、源目录不变、非法 ID 拒绝、失败清理和既有最终文件保护 |
| 现有生产纵切 | `src/__tests__/video-list-local-import.test.tsx` | 用户选择文件后仍形成可追踪 `pending` 记录并进入现有 Pipeline；缩略图失败及底层清理诊断通过非致命页面状态可见 |

这些 Judge 共同签发 `AC-LV-18`。字符串、函数存在或只检查 command 名都不能代替真实文件结果和生产渲染。

## 3. 锁定文件变更

- `harness/m21-import-controller.test.ts`：把旧 `{ filePath, outputPath, timestamp }` 参数断言替换为 `{ filePath, videoId, timestamp }`，继续通过公共 Controller 和真实内存数据库断言 Rust 返回路径被持久化。

不修改其他 `harness/` 文件，不修改 `src-tauri/tests/`，不新增或重命名 Tauri command，也不放宽 M20 command allowlist。

## 4. 退役合同和影子路径

- 退役前端用正则把源视频扩展名替换为 `_thumb.jpg` 的路径拼接。
- 退役 `generate_thumbnail` command 的 `outputPath` 参数。
- 没有测试专用生产 module 需要退役；M21 保留并迁移到同一个生产 `VideoImportController` seam。

## 5. 风险与边界

- 风险：Video ID 进入文件名前必须拒绝路径分隔符、`.`/`..` 和空值。
- 风险：ffmpeg 失败、空输出或最终替换失败不得破坏已有缩略图，也不得留下临时文件。
- 风险：旧数据库中的本地缩略图可能仍指向源目录；渲染 adapter 必须兼容任何已有本地绝对路径。
- 边界内仅处理本地导入的缩略图创建、持久化和卡片渲染。
- 在线 URL 缩略图本地化、应用缩略图删除/GC、卡片 16:9 精确视觉、真实站点 Evidence 和桌面 E2E 均在边界外。
- `DEC-PRD-060` 因缩略图删除尚无 AC 暂时回到 Proposed；本迁移不得把创建/渲染冒充删除生命周期已完成。

## 6. TDD 与验证

本迁移按生产卡片、Controller、Rust 文件 Owner 三个已确认 seam 逐条执行 RED → GREEN。生产卡片先证明原始 Windows 路径与空 `<img>`，M21 再证明旧 `outputPath` 合同，Rust Judge 依次证明缺失 Owner、路径逃逸、既有最终文件损坏风险和清理失败不可见；独立审查随后把同毫秒 ID 冲突、真实页面警告、锁定 M21 超范围以及跨 Controller ID 竞争分别转成未锁定 RED。M21 最终只保留本文件第 3 节批准的精确迁移，`src-tauri/tests/` 未修改。

最终聚焦验证通过生产导入/渲染和 M03/M21 相邻合同；Rust `thumbnail_storage_tests` 4/4 通过，新增 Rust 文件通过 file-scoped `rustfmt --check`。最终 `npm run harness:check` 通过：控制面校验、83 个前端测试文件 / 484 个测试、E2E/普通生产互补构建和 110 个 Rust 测试全部通过；一项 live-key 前端测试跳过，一项真实 Whisper 模型测试 ignored，最终 `dist` 为普通生产产物。真实桌面缩略图 E2E、在线缩略图本地化和删除/GC 未签发。

最终独立只读审查复核跨 Controller 分配、生产页面警告、M21 精确 diff、普通失败合同和控制面统计后，报告无 P0/P1/P2 阻塞。
