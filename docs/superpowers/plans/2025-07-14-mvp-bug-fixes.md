# Rain MVP Bug Fixes Implementation Plan

> **历史计划/施工图（非当前项目状态）**
>
> 本文是早期实施计划，不是当前进度表。不要根据本文里的未勾选 checkbox、测试数量、代码片段、commit 建议来判断 Rain 当前状态。当前真相以 `docs/PROJECT_STATE.md`、当前代码、验证脚本和已提交 evidence 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Rain MVP 阶段发现的三类 UI bug：本地文件导入 alert 提示、设置页侧边栏导航无响应、Whisper 模型下载按钮无动作。

**Architecture:** 所有修改集中在前端 React 组件层。Bug 1 修改 `VideoListPage.tsx` 中的 `handleLocalImport`，将 `alert()` 替换为组件内状态提示。Bug 2 和 Bug 3 均修改 `settings.tsx`：补充侧边栏导航切换逻辑，并为"外观"/"高级"/"关于"添加对应内容面板，同时为 Whisper 下载按钮添加 `onClick` 处理器。

**Tech Stack:** React 18, TypeScript, Tauri 2, Zustand, Vitest + @testing-library/react

## Global Constraints

- **禁止修改** `harness/` 目录下的任何测试文件
- 所有 281 个现有测试必须继续通过（`npm test`）
- 不引入新的 npm 依赖
- 遵循已有配色常量 `COLORS`（`settings.tsx` 内定义）和 CSS 变量（`VideoListPage.tsx` 使用 `var(--...)`）
- 版本号取自 `tauri.conf.json`：`0.1.0`
- 应用名称：`Rain`

---

## Task 1：修复本地文件导入的 alert 提示

**Files:**
- Modify: `src/pages/VideoListPage.tsx`

**Interfaces:**
- Consumes: 现有 `importMenuOpen` / `setImportMenuOpen` state，现有 `isTauri()` from `@/lib/tauri-env`
- Produces: 新 state `localImportError: string`，显示在导入下拉菜单下方的内联提示

**背景：** `handleLocalImport` 中当 `!isTauri()` 时调用 `alert()`，浏览器弹出带有 `http://localhost:1420/` 标题的系统对话框，体验差。修复：用组件内内联错误提示代替 `alert()`。

- [ ] **Step 1: 在 `VideoListPage` state 中添加 `localImportError`**

在 `VideoListPage.tsx` 找到现有 state 声明区域（约第 241-244 行），在其后新增一行：

```typescript
const [localImportError, setLocalImportError] = useState('')
```

- [ ] **Step 2: 修改 `handleLocalImport` 中的 alert 调用**

将：
```typescript
  const handleLocalImport = async () => {
    setImportMenuOpen(false)
    try {
      const { isTauri, tauriInvoke } = await import('@/lib/tauri-env')
      if (!isTauri()) {
        alert('请在桌面应用中使用本地文件导入')
        return
      }
```

替换为：
```typescript
  const handleLocalImport = async () => {
    setImportMenuOpen(false)
    setLocalImportError('')
    try {
      const { isTauri, tauriInvoke } = await import('@/lib/tauri-env')
      if (!isTauri()) {
        setLocalImportError('请在桌面应用中使用本地文件导入')
        return
      }
```

- [ ] **Step 3: 在导入按钮下方渲染内联错误提示**

在 `VideoListPage.tsx` 找到 `</header>` 标签（约第 446 行），在其正上方（即 `</div>` 结束 `importWrapperStyle` 的 `</div>` 之后、`</header>` 之前）插入：

```tsx
        {localImportError && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              background: 'var(--color-surface)',
              border: '1px solid #f85149',
              borderRadius: 'var(--radius-1)',
              padding: '6px 10px',
              fontSize: 'var(--font-size-xs)',
              color: '#f85149',
              whiteSpace: 'nowrap',
              zIndex: 20,
            }}
          >
            {localImportError}
          </div>
        )}
```

注意：该 `div` 需要放在已有 `importWrapperStyle` 的 `<div style={importWrapperStyle}>` 内部，成为它的子元素（与导入按钮和下拉菜单并列）。最终结构：

```tsx
<div style={importWrapperStyle}>
  <button onClick={handleImportClick} style={importButtonStyle}>导入</button>
  {importMenuOpen && (
    <div style={dropdownStyle}>
      <button onClick={handleLocalImport} style={dropdownItemStyle}>本地文件</button>
      <button onClick={handleUrlImport} style={dropdownItemStyle}>在线视频</button>
    </div>
  )}
  {localImportError && (
    <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px',
      background: 'var(--color-surface)', border: '1px solid #f85149',
      borderRadius: 'var(--radius-1)', padding: '6px 10px',
      fontSize: 'var(--font-size-xs)', color: '#f85149',
      whiteSpace: 'nowrap', zIndex: 20 }}>
      {localImportError}
    </div>
  )}
</div>
```

- [ ] **Step 4: 运行测试确认无回归**

```bash
cd D:\gongju\shengcan\rain
npm test
```

期望：33 个测试文件，281 个测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/pages/VideoListPage.tsx
git commit -m "fix: replace alert() with inline error in local file import"
```

---

## Task 2：修复设置页侧边栏导航无响应 + 添加三个面板内容

**Files:**
- Modify: `src/ui/components/settings.tsx`

**Interfaces:**
- Consumes: 已有 `COLORS`, `s.*` 样式常量，`getChunkThreshold`/`setChunkThreshold` from `@/settings/advanced`
- Produces: `activeNav` 支持切换，新增三个面板：外观（占位）、高级（分块阈值滑块）、关于（版本信息）

**背景：** `SettingsPage` 中 `const [activeNav] = useState<string>('模型管理')` 解构时丢弃了 setter，侧边栏没有 `onClick`，内容区也不依据 `activeNav` 切换，导致点击无响应。

- [ ] **Step 1: 修复 `activeNav` state，添加 setter**

在 `settings.tsx` 找到（约第 551 行）：
```typescript
  const [activeNav] = useState<string>('模型管理')
```
替换为：
```typescript
  const [activeNav, setActiveNav] = useState<string>('模型管理')
```

- [ ] **Step 2: 给侧边栏每个导航项添加 `onClick`**

在 `settings.tsx` 找到侧边栏渲染（约第 638-653 行）：
```tsx
          {NAV_ITEMS.map((item) => (
            <div
              key={item}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 13,
                color: item === activeNav ? COLORS.selText : COLORS.muted,
                background: item === activeNav ? COLORS.selBg : 'transparent',
                cursor: 'pointer',
                marginBottom: 2,
              }}
            >
              {item}
            </div>
          ))}
```
替换为：
```tsx
          {NAV_ITEMS.map((item) => (
            <div
              key={item}
              onClick={() => setActiveNav(item)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 13,
                color: item === activeNav ? COLORS.selText : COLORS.muted,
                background: item === activeNav ? COLORS.selBg : 'transparent',
                cursor: 'pointer',
                marginBottom: 2,
              }}
            >
              {item}
            </div>
          ))}
```

- [ ] **Step 3: 在 `SettingsPage` 中添加分块阈值 state**

在 `SettingsPage` 函数体顶部已有的 state 声明之后（约第 549-551 行），添加：

```typescript
  const [chunkThreshold, setChunkThresholdState] = useState<number>(() => {
    const { getChunkThreshold } = require('@/settings/advanced')
    return getChunkThreshold()
  })
```

注意：由于 `getChunkThreshold` 来自同模块，用静态 import 更干净。在文件顶部 import 区域（约第 7-11 行）添加：

```typescript
import { getChunkThreshold, setChunkThreshold } from '@/settings/advanced'
```

然后 state 声明改为：
```typescript
  const [chunkThreshold, setChunkThresholdState] = useState<number>(getChunkThreshold)
```

- [ ] **Step 4: 将主内容区替换为根据 `activeNav` 条件渲染**

找到 `<main>` 内容区（约第 657-695 行），将其中的内容从原来的"永远显示模型管理"改为按 `activeNav` 切换。

完整替换 `<main ...>` 内的内容如下：

```tsx
        <main style={{ overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {activeNav === '模型管理' && (
            <>
              {/* 角色选择卡片 */}
              <section
                style={{
                  background: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>角色选择</div>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: COLORS.dimmer }}>
                    每个角色从下方"模型池"里选一个当前使用
                  </span>
                </div>
                <RoleSelector models={models} />
              </section>

              {/* 模型池卡片 */}
              <section
                style={{
                  background: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>模型池</div>
                  <div style={{ flex: 1 }} />
                  <button style={s.primaryBtn} onClick={() => setModalOpen(true)}>
                    ＋ 添加模型
                  </button>
                </div>
                <ModelPoolList models={models} />
              </section>
            </>
          )}

          {activeNav === '外观' && (
            <section
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 200,
              }}
            >
              <div style={{ textAlign: 'center', color: COLORS.dimmer }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🎨</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.muted, marginBottom: 6 }}>外观设置</div>
                <div style={{ fontSize: 12 }}>敬请期待</div>
              </div>
            </section>
          )}

          {activeNav === '高级' && (
            <section
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>高级设置</div>

              {/* 分块阈值 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ fontSize: 13, flex: 1 }}>
                    分块阈值
                    <span style={{ fontSize: 12, color: COLORS.dimmer, marginLeft: 6 }}>
                      （长视频上下文占比触发分块，默认 33%）
                    </span>
                  </label>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 40, textAlign: 'right' }}>
                    {Math.round(chunkThreshold * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={80}
                  step={1}
                  value={Math.round(chunkThreshold * 100)}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 100
                    setChunkThresholdState(val)
                    setChunkThreshold(val)
                  }}
                  style={{ width: '100%', accentColor: COLORS.concept }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: COLORS.dimmer }}>
                  <span>10%（频繁分块）</span>
                  <span>80%（少分块）</span>
                </div>
              </div>
            </section>
          )}

          {activeNav === '关于' && (
            <section
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: 32,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                minHeight: 200,
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 2 }}>Rain</div>
              <div style={{ fontSize: 13, color: COLORS.muted }}>版本 0.1.0</div>
              <div style={{ fontSize: 12, color: COLORS.dimmer, marginTop: 8, textAlign: 'center', lineHeight: 1.6 }}>
                个人学习视频精读工具
              </div>
            </section>
          )}
        </main>
```

- [ ] **Step 5: 运行测试确认无回归**

```bash
cd D:\gongju\shengcan\rain
npm test
```

期望：33 个测试文件，281 个测试全部通过。

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/settings.tsx
git commit -m "fix: enable settings sidebar navigation and add appearance/advanced/about panels"
```

---

## Task 3：修复 Whisper 模型下载按钮无响应

**Files:**
- Modify: `src/ui/components/settings.tsx`

**Interfaces:**
- Consumes: `tauriInvoke` from `@/lib/tauri-env`（已在 Task 2 修改的文件中）；Tauri command `download_whisper_model(model_size: string, output_dir: string) -> string`
- Produces: Whisper 下载按钮有 `onClick`，在 Tauri 环境中调用下载命令并显示进度状态；非 Tauri 环境提示不可用

**背景：** `AddModelForm` 中 Whisper 下载按钮只有 `disabled={!isTauri()}`，没有 `onClick`，即使在桌面应用中点击也毫无反应。需要：
1. 在 Tauri 环境中调用 `download_whisper_model`
2. 显示下载中/完成/失败状态
3. 非 Tauri 环境按钮保持 disabled（现有行为）

- [ ] **Step 1: 在 `AddModelForm` 中添加下载状态 state**

找到 `AddModelForm` 函数体（约第 218 行），在现有 state 声明之后（`whisperSize` state 之后）添加：

```typescript
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle')
  const [downloadError, setDownloadError] = useState('')
```

- [ ] **Step 2: 添加 `handleDownload` 函数**

在 `handleSave` 函数之前（约第 243 行），添加：

```typescript
  async function handleDownload() {
    setDownloadStatus('downloading')
    setDownloadError('')
    try {
      const { tauriInvoke } = await import('@/lib/tauri-env')
      const { appDataDir } = await import('@tauri-apps/api/path')
      const dataDir = await appDataDir()
      const outputDir = `${dataDir}whisper-models`
      await tauriInvoke<string>('download_whisper_model', {
        modelSize: whisperSize,
        outputDir,
      })
      setDownloadStatus('done')
    } catch (err) {
      setDownloadStatus('error')
      setDownloadError(String(err))
    }
  }
```

- [ ] **Step 3: 替换 Whisper 下载按钮为带状态的版本**

找到（约第 372-374 行）：
```tsx
            <button style={s.btn} disabled={!isTauri()}>
              下载模型
            </button>
```

替换为：
```tsx
            <button
              style={s.btn}
              disabled={!isTauri() || downloadStatus === 'downloading'}
              onClick={isTauri() ? handleDownload : undefined}
            >
              {downloadStatus === 'downloading' ? '下载中…' : downloadStatus === 'done' ? '✓ 已下载' : '下载模型'}
            </button>
            {downloadStatus === 'error' && (
              <div style={{ fontSize: 12, color: COLORS.fail, marginTop: 4 }}>
                下载失败：{downloadError}
              </div>
            )}
            {downloadStatus === 'done' && (
              <div style={{ fontSize: 12, color: COLORS.example, marginTop: 4 }}>
                模型已下载，可保存添加到模型池
              </div>
            )}
```

- [ ] **Step 4: 运行测试确认无回归**

```bash
cd D:\gongju\shengcan\rain
npm test
```

期望：33 个测试文件，281 个测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/settings.tsx
git commit -m "fix: implement whisper model download button with status feedback"
```

---

## 自检

**Spec coverage：**
- Bug 1 本地文件导入 alert → Task 1 ✓
- Bug 2 侧边栏无响应 → Task 2 ✓（setter + onClick）
- Bug 2 外观/高级/关于面板 → Task 2 ✓（三个条件渲染面板）
- Bug 3 Whisper 下载无响应 → Task 3 ✓

**Placeholder scan：** 无 TBD/TODO，所有 step 含完整代码。

**Type consistency：**
- `downloadStatus` 类型 `'idle' | 'downloading' | 'done' | 'error'` 在 Step 1 定义，Step 3 按钮渲染时使用相同字符串字面量 ✓
- `chunkThreshold` 为 `number`（0-1 小数），Step 3 中 `Math.round(chunkThreshold * 100)` 转换百分比显示 ✓
- `setChunkThreshold` import 来自 `@/settings/advanced`，与 Task 2 Step 3 中的 import 声明一致 ✓
