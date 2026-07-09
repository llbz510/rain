# Rain 模型管理 + 视频导入 设计规格

> 日期：2026-07-09
> 范围：Phase 1 模型管理 + Phase 2 视频导入
> 方案：B（Tauri + 浏览器降级）
> 对齐：PRD 决策82/84/85/92/94/95/96/98 + prototype/m19-settings-mockup.html

## Global Constraints

- **测试不回归**：`npm test` 281/281，`npx tsc --noEmit` 0 错误，`cargo test` 29/29。
- **harness 锁定**：`harness/` 与 `src-tauri/tests/` 禁止修改。
- **组件签名不变**：`ModelPoolList`/`AddModelForm`/`RoleSelector`/`SettingsPage` 的 data-testid 和导出签名不能破坏，只能扩展 props。
- **Store 兼容**：`rain-store` 新增字段/action 不能删改现有字段，`reset()` 必须覆盖新字段。
- **浏览器降级**：非 Tauri 环境下，Tauri invoke 调用走 noop/降级提示，模型池在内存可用。
- **设计令牌**：样式必须用 CSS 变量（`--color-*`/`--spacing-*`/`--font-size-*`/`--radius-*`），与 `design-tokens.ts` 一致。
- **原型对齐**：UI 布局/配色/交互严格按 `prototype/m19-settings-mockup.html` 实现。

---

## Phase 1: 模型管理

### 1.1 页面导航

**改动文件**：`rain-store.ts`、`App.tsx`、`VideoListPage.tsx`

- `rain-store` 新增 `currentPage: 'list' | 'study' | 'settings'`，初始值 `'list'`。
- 新增 action `setPage(page)`。
- `loadVideo()` 内部同时 set `currentPage: 'study'`。
- `unloadVideo()` 内部同时 set `currentPage: 'list'`。
- `reset()` 将 `currentPage` 重置为 `'list'`。
- `App.tsx` 三路条件渲染：`settings` → SettingsPage / `study` → StudyInterface / 默认 → VideoListPage。
- `VideoListPage` 顶栏加齿轮按钮 → `store.setPage('settings')`。
- **不删 `currentVideoId`**，harness 依赖它。

### 1.2 SettingsPage 布局（对齐原型）

**改动文件**：`src/ui/components/settings.tsx`

按原型三栏布局：
- 顶栏：`← 返回` 按钮 + `Rain / 设置 · 模型管理`
- 左侧导航：模型管理（默认选中）、外观、高级、关于（v1 只实现"模型管理"tab，其余占位）
- 主内容区：角色选择卡片（上）+ 模型池卡片（下）

返回按钮 → `store.setPage('list')`。

### 1.3 模型池状态

**改动文件**：`rain-store.ts`、`model-pool.ts`

Store 新增：
```
modelPool: ModelPoolEntry[]
roleAssignment: { asr: string | null, structuring: string | null, assistant: string | null }
```

新增 actions：
- `addModel(input: AddModelInput)` → 调 `addModelToPool()`，更新 `modelPool`，Tauri 下同步写 SQLite。
- `removeModel(id)` → 调 `removeModelFromPool()`，更新 `modelPool`。
- `setRoleModel(role, modelId)` → 更新 `roleAssignment`，Tauri 下写 SQLite。
- `refreshModelPool()` → Tauri 下从 SQLite 读 `model_pool` setting，更新 store。

**SQLite 键名**（决策84）：
- `model_pool` → JSON 数组（所有 ModelPoolEntry）
- `role_asr` / `role_structuring` / `role_assistant` → 模型 ID
- `api_key.<别名>` → 明文 API Key

浏览器下：所有操作走内存 `model-pool.ts` 的 Map，不持久化。

### 1.4 AddModelForm 改造

**改动文件**：`src/ui/components/settings.tsx`

弹窗（Modal）形式，对齐原型：

**类型单选**：LLM / ASR-API / 本地 Whisper
- 切换时联动显隐（`syncType` 逻辑）

**API 类字段**（LLM + ASR-API）：
- 供应商下拉：阿里（预置）/ 腾讯（预置）/ 讯飞（预置）/ OpenAI 兼容（预置）/ 自定义
- baseURL：仅"自定义"时显示（`syncProvider` 逻辑）；预置供应商自动填入对应 baseURL
- API Key：password 输入
- 模型名：text 输入

**本地 Whisper 字段**：
- 模型大小下拉：tiny（39MB）/ base（74MB）/ small（244MB）/ medium（769MB）/ large-v3（1.5GB）
- 下载按钮：Tauri 下 → `invoke('download_whisper_model', { modelSize, outputDir })`；浏览器下 → disabled + 提示
- 下载进度提示

**通用字段**：
- 别名输入
- Vision 勾选（仅 LLM 类型显示）："支持画面（vision）—— 助手 LLM 角色只列勾选此项的"

**底部操作**：测试 / 取消 / 保存

**预置供应商 baseURL 映射**：
- 阿里 → `https://dashscope.aliyuncs.com/compatible-mode/v1`
- 腾讯 → `https://api.lkeap.cloud.tencent.com/v1`
- 讯飞 → `https://spark-api-open.xf-yun.com/v1`
- OpenAI 兼容 → `https://api.openai.com/v1`

### 1.5 ModelPoolList 改造

**改动文件**：`src/ui/components/settings.tsx`

表格布局，对齐原型：
- 列：别名 / 类型（彩色标签）/ 供应商·模型名 / 操作
- 类型标签：LLM=蓝、ASR-API=橙、本地 Whisper=绿、vision=绿
- Whisper 已下载 → 灰色 `已下载` 标签
- 操作按钮：测试 / 编辑 / 删除（红色）

### 1.6 RoleSelector 改造

**改动文件**：`src/ui/components/settings.tsx`

卡片形式，三行，对齐原型：
- ASR 语音转文字 → 下拉从 `getModelsForRole('asr')` + 字幕选项
- 结构化 LLM → 下拉从 `getModelsForRole('structuring')`
- 助手 LLM → 下拉从 `getModelsForRole('assistant')`（只列 vision）
- 每行右侧描述文字
- 选中变更 → `store.setRoleModel(role, id)`

### 1.7 测试按钮

- API 类（LLM/ASR-API）：`fetch(baseUrl + '/models', { headers: { Authorization: 'Bearer ' + apiKey } })` → 成功绿色提示 / 失败红色提示
- 本地 Whisper：检查模型文件是否存在（Tauri 下 `invoke('list_whisper_models')`）

### 1.8 Whisper 模型管理

- 设置页加载时：Tauri 下 `invoke('list_whisper_models', { modelDir })` → 标记已下载大小
- 添加 Whisper 模型 → 如果未下载，保存按钮变为"下载并保存"
- 下载完成 → 入池，角色选择可选
- `modelDir` = Tauri `appDataDir()` + `/whisper-models/`（决策84）

### 1.9 Tauri 环境检测

**新建文件**：`src/lib/tauri-env.ts`

```ts
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window
}
```

所有 `invoke` 调用前检查 `isTauri()`，非 Tauri 走降级路径。

---

## Phase 2: 视频导入

### 2.1 导入入口

**改动文件**：`VideoListPage.tsx`

点击"导入"按钮 → 弹出小菜单（popover/dropdown）：
- 「本地文件」
- 「在线视频」

### 2.2 本地文件导入

流程：
1. 点"本地文件" → Tauri `dialog.open({ filters: [{ name: 'Video', extensions: ['mp4','mkv','avi','mov','webm'] }] })`
2. 获取文件路径 → `invoke('probe_video_info', { filePath })`（ffprobe 时长 + 文件名作标题）
3. `insertVideo(db, { title, filePath, duration, status: 'importing' })`
4. 刷新视频列表
5. 后续 ASR 流程（start_asr）由用户在学习界面触发

浏览器下：点"本地文件" → 提示"请在桌面应用中使用"

### 2.3 在线视频导入

流程：
1. 点"在线视频" → 弹出 URL 输入弹窗
2. 先 `invoke('check_ytdlp_command')` → 不可用提示"请安装 yt-dlp"（决策95）
3. 输入 URL → `invoke('probe_video_info', { sourceUrl })` → 获取标题/时长/缩略图
4. `insertVideo(db, { title, sourceUrl, duration, thumbnailUrl, status: 'importing' })`
5. 刷新视频列表

浏览器下：点"在线视频" → 提示"请在桌面应用中使用"

### 2.4 导入状态

- 视频卡片显示状态：importing / ready / error
- importing 状态卡片不可点击进入学习界面
- 导入完成后自动更新状态为 ready

### 2.5 进度事件

- 监听 Tauri event `import-progress`（`events.ts` 已定义）
- 更新 store `importQueue` 中对应视频的进度

---

## 不做的事

- 左侧导航的"外观"/"高级"/"关于" tab 只渲染占位文字，不实现功能
- 不加路由库
- 不改 harness
- 不改 design-tokens.ts
- 不做 ASR 全流程（本次只做到文件导入 + 元信息写入，ASR 推理是后续工作）
