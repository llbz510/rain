# 模型管理 + 视频导入 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Rain 设置页从静态占位改为可交互的模型管理页面（对齐 PRD 决策82 + prototype/m19-settings-mockup.html），并实现视频导入入口（本地文件 + 在线 URL）。

**Architecture:** Phase 1（Task 1-4）实现模型管理：store 扩展 → Tauri 环境检测 → SettingsPage 真实 UI → 数据持久化。Phase 2（Task 5-6）实现视频导入：导入菜单 → 本地文件/在线 URL 对话框 → 元信息写入 DB。所有功能在浏览器下降级可用（内存存储 + 提示）。

**Tech Stack:** React 18 + Zustand + TypeScript + Tauri 2 + SQLite（tauri-plugin-sql）

## Global Constraints

- **测试不回归**：每个 task 完成后 `npm test` 必须 281/281，`npx tsc --noEmit` 必须 0 错误。
- **harness 锁定**：`harness/` 与 `src-tauri/tests/` 目录禁止任何修改。
- **组件签名**：`ModelPoolList`/`AddModelForm`/`RoleSelector`/`SettingsPage` 的 data-testid 不能改，导出签名只能扩展不能破坏。
- **Store 兼容**：`rain-store` 新增字段/action 不能删改现有字段；`reset()` 必须覆盖新字段；`initialState` 的现有值不能变。
- **路径别名**：`@/*` → `./src/*`。
- **设计令牌**：样式用 CSS 变量（`--color-*`/`--spacing-*`/`--font-size-*`/`--radius-*`），与 `src/ui/design-tokens.ts` 一致。
- **浏览器降级**：非 Tauri 环境下 Tauri invoke 走 noop/降级提示。
- **LLM 前端直连**（决策92）：不经 Rust IPC。
- **SQLite 前端直连**（决策93）：用 `tauri-plugin-sql`。

---

## File Structure

| 文件 | 职责 | 动作 |
|------|------|------|
| `src/lib/tauri-env.ts` | Tauri 环境检测 + invoke 包装 | 新建 |
| `src/store/rain-store.ts` | 新增 currentPage/modelPool/roleAssignment + actions | 修改 |
| `src/store/test-provider.tsx` | 新增 currentPage prop | 修改 |
| `src/App.tsx` | 三路条件渲染 | 修改 |
| `src/ui/components/settings.tsx` | 完整设置页（对齐原型） | 重写 |
| `src/pages/VideoListPage.tsx` | 加设置齿轮 + 导入菜单 | 修改 |
| `src/lib/provider-presets.ts` | 预置供应商 baseURL 映射 | 新建 |

---

### Task 1: Store 扩展 + Tauri 环境检测

**Files:**
- Create: `src/lib/tauri-env.ts`
- Modify: `src/store/rain-store.ts`
- Modify: `src/store/test-provider.tsx`

**Interfaces:**
- Produces: `isTauri(): boolean`、`tauriInvoke<T>(cmd, args): Promise<T>`
- Produces: `useRainStore` 新字段 `currentPage`、`modelPool`、`roleAssignment` 及 actions `setPage`、`addModel`、`removeModel`、`setRoleModel`

- [ ] **Step 1: 创建 `src/lib/tauri-env.ts`**

```ts
// src/lib/tauri-env.ts
// ========================================
// Tauri 环境检测 + 安全 invoke 包装
// ========================================

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`Tauri not available: cannot invoke '${cmd}'`)
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}
```

- [ ] **Step 2: 扩展 `src/store/rain-store.ts`**

在 `RainState` interface 新增：

```ts
currentPage: 'list' | 'study' | 'settings'
modelPool: import('@/settings/model-pool').ModelPoolEntry[]
roleAssignment: { asr: string | null; structuring: string | null; assistant: string | null }

setPage: (page: 'list' | 'study' | 'settings') => void
addModel: (input: import('@/settings/model-pool').AddModelInput) => void
removeModel: (id: string) => void
setRoleModel: (role: 'asr' | 'structuring' | 'assistant', modelId: string | null) => void
```

在 `initialState` 新增（不改现有值）：

```ts
currentPage: 'list' as const,
modelPool: [] as import('@/settings/model-pool').ModelPoolEntry[],
roleAssignment: { asr: null, structuring: null, assistant: null },
```

新增 actions（在 create 回调内）：

```ts
setPage: (page) => set({ currentPage: page }),

addModel: (input) => {
  const entry = addModelToPool(input)
  set({ modelPool: listModels() })
},

removeModel: (id) => {
  removeModelFromPool(id)
  set({ modelPool: listModels() })
},

setRoleModel: (role, modelId) =>
  set((state) => ({
    roleAssignment: { ...state.roleAssignment, [role]: modelId },
  })),
```

顶部 import 新增：

```ts
import { addModelToPool, removeModelFromPool, listModels, type ModelPoolEntry, type AddModelInput } from '@/settings/model-pool'
```

修改 `loadVideo`：在 `set({...})` 中加 `currentPage: 'study'`。

修改 `unloadVideo`：在 `set({...})` 中加 `currentPage: 'list'`。

- [ ] **Step 3: 扩展 `src/store/test-provider.tsx`**

在 `TestStoreProviderProps` 新增可选 prop：

```ts
currentPage?: 'list' | 'study' | 'settings'
```

在 `partial` 构造中新增：

```ts
if (currentPage !== undefined) partial.currentPage = currentPage
```

- [ ] **Step 4: 运行测试验证**

Run: `npm test`
Expected: 281/281 通过（store 新增字段不破坏现有测试）

Run: `npx tsc --noEmit`
Expected: 0 错误

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri-env.ts src/store/rain-store.ts src/store/test-provider.tsx
git commit -m "feat: extend store with currentPage/modelPool/roleAssignment + tauri-env helper"
```

---

### Task 2: App.tsx 三路渲染 + VideoListPage 设置入口

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/pages/VideoListPage.tsx`

**Interfaces:**
- Consumes: `useRainStore` 的 `currentPage`、`setPage`（Task 1）
- Produces: App 支持 settings 页面路由；VideoListPage 有设置齿轮按钮

- [ ] **Step 1: 修改 `src/App.tsx`**

```ts
// src/App.tsx
import { useRainStore } from '@/store/rain-store'
import { VideoListPage } from '@/pages/VideoListPage'
import { StudyInterface } from '@/pages/StudyInterface'
import { SettingsPage } from '@/ui/components/settings'
import { ShortcutManager } from '@/ui/components/shortcut-manager'

export default function App() {
  const currentPage = useRainStore((s) => s.currentPage)

  let page: React.ReactNode
  switch (currentPage) {
    case 'settings':
      page = <SettingsPage />
      break
    case 'study':
      page = <StudyInterface />
      break
    default:
      page = <VideoListPage />
  }

  return (
    <>
      <ShortcutManager />
      {page}
    </>
  )
}
```

- [ ] **Step 2: VideoListPage 加齿轮按钮**

在 `VideoListPage` 的 `<header>` 内，导入按钮之后加齿轮按钮：

```tsx
const handleSettingsClick = () => {
  useRainStore.getState().setPage('settings')
}

// 在 JSX 中，importButtonStyle 之后：
<button onClick={handleSettingsClick} style={settingsButtonStyle}>
  设置
</button>
```

`settingsButtonStyle`（新增，在 styles 区域）：

```ts
const settingsButtonStyle: React.CSSProperties = {
  flex: '0 0 auto',
  height: '28px',
  padding: '0 var(--spacing-2)',
  background: 'transparent',
  color: 'var(--color-fg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-sm)',
  cursor: 'pointer',
}
```

- [ ] **Step 3: 运行测试验证**

Run: `npm test`
Expected: 281/281

Run: `npx tsc --noEmit`
Expected: 0 错误

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/pages/VideoListPage.tsx
git commit -m "feat: three-page routing via currentPage + settings gear button"
```

---

### Task 3: SettingsPage 完整实现（对齐原型）

**Files:**
- Modify: `src/ui/components/settings.tsx`
- Create: `src/lib/provider-presets.ts`

**Interfaces:**
- Consumes: `useRainStore` 的 `modelPool`、`roleAssignment`、`addModel`、`removeModel`、`setRoleModel`、`setPage`（Task 1）
- Consumes: `getModelsForRole` 从 `@/settings/model-pool`
- Consumes: `isTauri`、`tauriInvoke` 从 `@/lib/tauri-env`（Task 1）
- Produces: 完整可交互的设置页（角色选择 + 模型池 + 添加弹窗）

- [ ] **Step 1: 创建 `src/lib/provider-presets.ts`**

```ts
// src/lib/provider-presets.ts
// ========================================
// 预置供应商 baseURL 映射（决策82）
// ========================================

export interface ProviderPreset {
  label: string
  value: string
  baseUrl: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: '阿里（预置）', value: 'ali', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { label: '腾讯（预置）', value: 'tencent', baseUrl: 'https://api.lkeap.cloud.tencent.com/v1' },
  { label: '讯飞（预置）', value: 'xunfei', baseUrl: 'https://spark-api-open.xf-yun.com/v1' },
  { label: 'OpenAI 兼容（预置）', value: 'openai', baseUrl: 'https://api.openai.com/v1' },
]

export const WHISPER_SIZES = [
  { value: 'tiny', label: 'tiny（39MB，最快最差）' },
  { value: 'base', label: 'base（74MB）' },
  { value: 'small', label: 'small（244MB）' },
  { value: 'medium', label: 'medium（769MB）' },
  { value: 'large-v3', label: 'large-v3（1.5GB，最慢最好）' },
]
```

- [ ] **Step 2: 重写 `src/ui/components/settings.tsx`**

保留所有 data-testid 和导出名。完整实现：

**SettingsPage**（对齐原型布局）：
- 顶栏：`← 返回` + `Rain / 设置 · 模型管理`
- 左侧导航：模型管理（选中）/ 外观（占位）/ 高级（占位）/ 关于（占位）
- 主内容：角色选择卡片 + 模型池卡片
- 返回 → `store.setPage('list')`

**RoleSelector**（角色选择卡片）：
- 保留 `data-testid="role-selector"` 和三个 `aria-label`
- 从 `store.modelPool` 筛选，通过 `getModelsForRole()` 获取选项列表
- ASR 下拉额外加"用视频字幕（无需模型）"固定选项
- 选中变更 → `store.setRoleModel(role, id)`
- 每行右侧描述文字对齐原型

**ModelPoolList**（模型池卡片）：
- 保留 `data-testid="model-pool-list"` 和 `data-testid={model-${m.id}}`
- 表格：别名 / 类型标签（彩色）/ 供应商·模型名 / 操作（测试/编辑/删除）
- 类型标签 CSS class：LLM=蓝、ASR-API=橙、本地 Whisper=绿、vision=绿
- 保留"测试"按钮
- 删除 → `store.removeModel(id)`
- 右上角"+ 添加模型"按钮 → 打开 AddModelForm modal

**AddModelForm**（添加模型弹窗）：
- 保留 `data-testid="add-model-form"` 和所有 `aria-label`
- 类型单选：LLM / ASR-API / 本地 Whisper
- API 类字段：供应商下拉（预置 + 自定义）→ baseURL（自定义时显示）→ API Key → 模型名
- 本地 Whisper：模型大小下拉 + 下载按钮
- 别名 + Vision 勾选（仅 LLM）
- 底部：测试 / 取消 / 保存
- 保存 → `store.addModel(input)` → 关闭弹窗
- 下载 Whisper → `tauriInvoke('download_whisper_model', { modelSize, outputDir })`
- 非 Tauri 下下载按钮 disabled

**测试按钮逻辑**：
- API 类：`fetch(baseUrl + '/models', { headers: { Authorization: 'Bearer ' + apiKey } })` → 成功绿/失败红
- Whisper：`tauriInvoke('list_whisper_models')` 检查是否已下载

完整代码见下方（组件内联样式对齐原型 CSS 变量）。

关键样式常量（对齐原型 `m19-settings-mockup.html` 的 CSS）：

```ts
const TAG_STYLES: Record<string, React.CSSProperties> = {
  llm: { color: 'var(--color-concept)', borderColor: 'rgba(83,155,245,.3)', background: 'rgba(83,155,245,.1)' },
  'asr-api': { color: 'var(--color-analogy)', borderColor: 'rgba(219,109,40,.3)', background: 'rgba(219,109,40,.1)' },
  'whisper-local': { color: 'var(--color-example)', borderColor: 'rgba(63,185,80,.3)', background: 'rgba(63,185,80,.1)' },
  vision: { color: 'var(--color-example)', borderColor: 'rgba(63,185,80,.3)', background: 'rgba(63,185,80,.1)' },
}
```

- [ ] **Step 3: 运行测试验证**

Run: `npm test`
Expected: 281/281（特别关注 m19-settings-component 的 5 个测试全绿）

Run: `npx tsc --noEmit`
Expected: 0 错误

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/settings.tsx src/lib/provider-presets.ts
git commit -m "feat: implement full SettingsPage with model pool, role selector, and add-model modal"
```

---

### Task 4: 模型池持久化（SQLite setting 表）

**Files:**
- Modify: `src/store/rain-store.ts`（addModel/removeModel/setRoleModel 加持久化）
- Modify: `src/ui/components/settings.tsx`（页面加载时从 DB 读取）

**Interfaces:**
- Consumes: `setSetting`/`getSetting` 从 `@/models/database`
- Consumes: `isTauri` 从 `@/lib/tauri-env`（Task 1）

- [ ] **Step 1: 修改 store actions 加持久化**

修改 `addModel` action：

```ts
addModel: (input) => {
  const entry = addModelToPool(input)
  const pool = listModels()
  set({ modelPool: pool })
  // 异步持久化（不阻塞 UI）
  void (async () => {
    try {
      const { isTauri } = await import('@/lib/tauri-env')
      if (!isTauri()) return
      const { createDatabase, setSetting } = await import('@/models/database')
      const db = await createDatabase('rain.db')
      await setSetting(db, 'model_pool', JSON.stringify(pool))
      if (input.apiKey) {
        await setSetting(db, `api_key.${entry.alias}`, input.apiKey)
      }
    } catch { /* 浏览器环境下忽略 */ }
  })()
},
```

同理修改 `removeModel` 和 `setRoleModel`。

- [ ] **Step 2: SettingsPage 加载时从 DB 读取**

在 `SettingsPage` 组件内加 `useEffect`：

```ts
useEffect(() => {
  void (async () => {
    try {
      const { isTauri } = await import('@/lib/tauri-env')
      if (!isTauri()) return
      const { createDatabase, getSetting } = await import('@/models/database')
      const db = await createDatabase('rain.db')
      const poolJson = await getSetting(db, 'model_pool')
      if (poolJson) {
        const pool = JSON.parse(poolJson) as ModelPoolEntry[]
        // 同步到内存 model-pool 单例
        for (const entry of pool) {
          addModelToPool({ ...entry })
        }
        useRainStore.setState({ modelPool: listModels() })
      }
      // 读角色分配
      const asr = await getSetting(db, 'role_asr')
      const structuring = await getSetting(db, 'role_structuring')
      const assistant = await getSetting(db, 'role_assistant')
      useRainStore.setState({
        roleAssignment: { asr, structuring, assistant },
      })
    } catch { /* 浏览器环境下忽略 */ }
  })()
}, [])
```

- [ ] **Step 3: 运行测试验证**

Run: `npm test`
Expected: 281/281

Run: `npx tsc --noEmit`
Expected: 0 错误

- [ ] **Step 4: Commit**

```bash
git add src/store/rain-store.ts src/ui/components/settings.tsx
git commit -m "feat: persist model pool and role assignment to SQLite setting table"
```

---

### Task 5: 视频导入菜单 + 本地文件导入

**Files:**
- Modify: `src/pages/VideoListPage.tsx`

**Interfaces:**
- Consumes: `isTauri`、`tauriInvoke` 从 `@/lib/tauri-env`（Task 1）
- Consumes: `insertVideo`、`createDatabase`、`listVideos` 从 `@/models/database`
- Consumes: Tauri commands `probe_video_info`

- [ ] **Step 1: 实现导入菜单 dropdown**

替换 `handleImportClick` 占位。点击"导入"按钮 → 显示下拉菜单：

```tsx
const [importMenuOpen, setImportMenuOpen] = useState(false)

const handleImportClick = () => {
  setImportMenuOpen((prev) => !prev)
}
```

菜单 JSX（在导入按钮下方）：

```tsx
{importMenuOpen && (
  <div style={dropdownStyle}>
    <button onClick={handleLocalImport} style={dropdownItemStyle}>
      本地文件
    </button>
    <button onClick={handleUrlImport} style={dropdownItemStyle}>
      在线视频
    </button>
  </div>
)}
```

样式（绝对定位在导入按钮下方）：

```ts
const importWrapperStyle: React.CSSProperties = {
  position: 'relative',
  flex: '0 0 auto',
}

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 'var(--spacing-1)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-1)',
  padding: 'var(--spacing-1) 0',
  zIndex: 10,
  minWidth: '120px',
  boxShadow: '0 4px 16px rgba(0,0,0,.4)',
}

const dropdownItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: 'var(--spacing-2) var(--spacing-3)',
  background: 'transparent',
  color: 'var(--color-fg)',
  border: 'none',
  fontSize: 'var(--font-size-sm)',
  textAlign: 'left',
  cursor: 'pointer',
}
```

- [ ] **Step 2: 实现本地文件导入**

```tsx
const handleLocalImport = async () => {
  setImportMenuOpen(false)
  try {
    const { isTauri, tauriInvoke } = await import('@/lib/tauri-env')
    if (!isTauri()) {
      alert('请在桌面应用中使用本地文件导入')
      return
    }
    // Tauri 文件对话框
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'] }],
      multiple: false,
    })
    if (!selected) return // 用户取消

    const filePath = typeof selected === 'string' ? selected : selected.path
    // 探测视频信息
    const info = await tauriInvoke<{ title: string; duration: number; thumbnail: string }>(
      'probe_video_info',
      { filePath, sourceUrl: null },
    )

    // 写入数据库
    if (!db) return
    const video: Video = {
      id: `v_${Date.now()}`,
      title: info.title,
      source: 'local',
      filePath,
      thumbnail: info.thumbnail,
      duration: info.duration,
      language: '',
      status: 'pending',
      createdAt: Date.now(),
      position: 0,
      lastStudiedAt: Date.now(),
    }
    await insertVideo(db, video)
    // 刷新列表
    const list = await listVideos(db, sortBy)
    setVideos(list)
  } catch (err) {
    console.error('[VideoListPage] 本地文件导入失败', err)
  }
}
```

- [ ] **Step 3: 运行测试验证**

Run: `npm test`
Expected: 281/281

Run: `npx tsc --noEmit`
Expected: 0 错误

- [ ] **Step 4: Commit**

```bash
git add src/pages/VideoListPage.tsx
git commit -m "feat: import menu dropdown + local file import via Tauri dialog"
```

---

### Task 6: 在线视频导入 + 最终验证

**Files:**
- Modify: `src/pages/VideoListPage.tsx`

**Interfaces:**
- Consumes: `tauriInvoke` 的 `check_ytdlp_command`、`probe_video_info`（Task 1）
- Consumes: `insertVideo`、`listVideos` 从 `@/models/database`

- [ ] **Step 1: 实现在线视频导入**

新增 URL 输入弹窗状态：

```tsx
const [urlDialogOpen, setUrlDialogOpen] = useState(false)
const [importUrl, setImportUrl] = useState('')
const [urlError, setUrlError] = useState('')
```

`handleUrlImport`：

```tsx
const handleUrlImport = async () => {
  setImportMenuOpen(false)
  try {
    const { isTauri, tauriInvoke } = await import('@/lib/tauri-env')
    if (!isTauri()) {
      alert('请在桌面应用中使用在线视频导入')
      return
    }
    // 检查 yt-dlp
    const ytdlpResult = await tauriInvoke<{ available: boolean; version: string | null }>(
      'check_ytdlp_command', {},
    )
    if (!ytdlpResult.available) {
      alert('请先安装 yt-dlp 并加入 PATH（决策95）')
      return
    }
    setUrlDialogOpen(true)
    setImportUrl('')
    setUrlError('')
  } catch (err) {
    console.error('[VideoListPage] yt-dlp 检查失败', err)
  }
}
```

URL 弹窗 JSX：

```tsx
{urlDialogOpen && (
  <div style={overlayStyle}>
    <div style={modalStyle}>
      <div style={modalTitleStyle}>导入在线视频</div>
      <div style={modalBodyStyle}>
        <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-muted)' }}>
          视频 URL（YouTube/Bilibili 等）
        </label>
        <input
          type="text"
          value={importUrl}
          onChange={(e) => setImportUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          style={inputStyle}
        />
        {urlError && <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-xs)' }}>{urlError}</div>}
      </div>
      <div style={modalFootStyle}>
        <button onClick={() => setUrlDialogOpen(false)} style={btnStyle}>取消</button>
        <button onClick={handleUrlSubmit} style={btnPrimaryStyle}>导入</button>
      </div>
    </div>
  </div>
)}
```

`handleUrlSubmit`：

```tsx
const handleUrlSubmit = async () => {
  if (!importUrl.trim()) {
    setUrlError('请输入 URL')
    return
  }
  try {
    const { tauriInvoke } = await import('@/lib/tauri-env')
    const info = await tauriInvoke<{ title: string; duration: number; thumbnail: string }>(
      'probe_video_info',
      { filePath: '', sourceUrl: importUrl.trim() },
    )

    if (!db) return
    const video: Video = {
      id: `v_${Date.now()}`,
      title: info.title,
      source: 'url',
      sourceUrl: importUrl.trim(),
      thumbnail: info.thumbnail,
      duration: info.duration,
      language: '',
      status: 'pending',
      createdAt: Date.now(),
      position: 0,
      lastStudiedAt: Date.now(),
    }
    await insertVideo(db, video)
    const list = await listVideos(db, sortBy)
    setVideos(list)
    setUrlDialogOpen(false)
  } catch (err) {
    setUrlError(`导入失败: ${err}`)
  }
}
```

弹窗样式（对齐原型的 modal 风格）：

```ts
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80,
}
const modalStyle: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-2)', width: '420px', maxWidth: '92vw',
  boxShadow: '0 4px 16px rgba(0,0,0,.4)',
}
const modalTitleStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-semibold)',
  padding: 'var(--spacing-3) var(--spacing-4)',
  borderBottom: '1px solid var(--color-border)',
}
const modalBodyStyle: React.CSSProperties = {
  padding: 'var(--spacing-4)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)',
}
const modalFootStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-2)',
  padding: 'var(--spacing-3) var(--spacing-4)',
  borderTop: '1px solid var(--color-border)',
}
const inputStyle: React.CSSProperties = {
  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
  color: 'var(--color-fg)', padding: 'var(--spacing-1) var(--spacing-2)',
  borderRadius: 'var(--radius-1)', fontSize: 'var(--font-size-sm)', width: '100%',
}
const btnStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', background: 'transparent',
  color: 'var(--color-fg)', padding: 'var(--spacing-1) var(--spacing-3)',
  borderRadius: 'var(--radius-1)', fontSize: 'var(--font-size-xs)', cursor: 'pointer',
}
const btnPrimaryStyle: React.CSSProperties = {
  ...btnStyle, background: 'rgba(255,255,255,.12)', borderColor: 'transparent',
}
```

- [ ] **Step 2: 运行全量测试验证**

Run: `npm test`
Expected: 281/281

Run: `npx tsc --noEmit`
Expected: 0 错误

Run: `git diff --name-only HEAD -- harness/ src-tauri/tests/`
Expected: 空（harness 零改动）

- [ ] **Step 3: Commit**

```bash
git add src/pages/VideoListPage.tsx
git commit -m "feat: online video import via URL dialog + yt-dlp check"
```

---

### Task 7: 最终全分支审查

- [ ] **Step 1: 全量验证**

```bash
npm test
npx tsc --noEmit
git diff --name-only HEAD -- harness/ src-tauri/tests/
```

All must pass, harness must be zero changes.

- [ ] **Step 2: 全分支代码审查**

用 requesting-code-review 技能审查全分支 diff。

- [ ] **Step 3: 修复 Critical/Important 问题**

- [ ] **Step 4: 最终 commit（如有修复）**
