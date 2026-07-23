# Harness 覆盖缺口补齐 Implementation Plan

> **历史计划/施工图（非当前项目状态）**
>
> 本文是早期实施计划，不是当前进度表。不要根据本文里的未勾选 checkbox、测试数量、代码片段、commit 建议来判断 Rain 当前状态。当前真相以 `docs/PROJECT_STATE.md`、当前代码、验证脚本和已提交 evidence 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 3 个 harness 文件 + 1 个源码桩，把 5 个无测覆盖区域补上契约测试，从 281 条升至约 304 条全绿。

**Architecture:** 纯增量——新建 harness 文件描述当前行为，新建一个空函数桩让 import 通过。不改已有代码逻辑。

**Tech Stack:** Vitest + @testing-library/react + Zustand + TypeScript

## Global Constraints

- **测试不回归**：每个 task 完成后 `npm test` 必须全绿（281 + 新增）。
- **harness 锁定**：`harness/` 已有文件与 `src-tauri/tests/` 禁止修改，只能新增。
- **路径别名**：`@/*` → `./src/*`，新文件沿用。
- **tsc 零错**：`npx tsc --noEmit` 必须 0 错误。

---

### Task 1: 创建源码桩 progress-listener.ts

**Files:**
- Create: `src/pipeline/progress-listener.ts`

**Interfaces:**
- Consumes: `ProgressPayload` 类型 from `@/architecture/events`
- Produces: `listenProgress(callback: ProgressCallback): void`, `unlistenProgress(): void`, `ProgressCallback` 类型（Task 2 的 harness 会 import 这些）

- [ ] **Step 1: 创建 progress-listener.ts 源码桩**

```ts
// src/pipeline/progress-listener.ts
import type { ProgressPayload } from '@/architecture/events'

export type ProgressCallback = (payload: ProgressPayload) => void

export function listenProgress(_callback: ProgressCallback): void {
  // 阶段二实现：Tauri event 订阅
}

export function unlistenProgress(): void {
  // 阶段二实现：取消订阅
}
```

- [ ] **Step 2: 验证类型检查通过**

Run: `npx tsc --noEmit`
Expected: 0 错误

- [ ] **Step 3: 验证现有测试不受影响**

Run: `npm test`
Expected: 281 passed

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/progress-listener.ts
git commit -m "feat: add progress-listener stub for harness coverage"
```

---

### Task 2: 创建 m21-start-import.test.ts

**Files:**
- Create: `harness/m21-start-import.test.ts`

**Interfaces:**
- Consumes: `TAURI_COMMANDS` from `@/architecture/commands`, `createImportJob` / `getImportQueue` / `cancelImport` from `@/pipeline/import-manager`
- Produces: 8 条测试（M21-T01 至 M21-T08）

- [ ] **Step 1: 创建 m21-start-import.test.ts**

```ts
// harness/m21-start-import.test.ts
// ========================================
// M21 Harness: start_import 命令行为 + generate_thumbnail 签名
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { TAURI_COMMANDS } from '@/architecture/commands'
import {
  createImportJob,
  getImportQueue,
  cancelImport,
} from '@/pipeline/import-manager'

describe('M21-T01: start_import 在命令列表中', () => {
  it('TAURI_COMMANDS 包含 start_import', () => {
    expect(TAURI_COMMANDS).toContain('start_import')
  })
})

describe('M21-T02: 创建本地导入任务后 status=pending', () => {
  it('本地文件导入 job 的 video.status 为 pending', () => {
    const job = createImportJob({
      source: 'local',
      filePath: '/test/video.mp4',
      title: '测试视频',
    })
    expect(job.video.status).toBe('pending')
  })
})

describe('M21-T03: 本地导入 requiresYtdlp=false', () => {
  it('source=local 时不需要 yt-dlp', () => {
    const job = createImportJob({
      source: 'local',
      filePath: '/test/video.mp4',
      title: '本地视频',
    })
    expect(job.requiresYtdlp).toBe(false)
  })
})

describe('M21-T04: URL 导入 requiresYtdlp=true', () => {
  it('source=url 时需要 yt-dlp', () => {
    const job = createImportJob({
      source: 'url',
      sourceUrl: 'https://example.com/video',
      title: '在线视频',
    })
    expect(job.requiresYtdlp).toBe(true)
  })
})

describe('M21-T05: generate_thumbnail 在命令列表中', () => {
  it('TAURI_COMMANDS 包含 generate_thumbnail', () => {
    expect(TAURI_COMMANDS).toContain('generate_thumbnail')
  })
})

describe('M21-T06: convert_file_src 在命令列表中', () => {
  it('TAURI_COMMANDS 包含 convert_file_src', () => {
    expect(TAURI_COMMANDS).toContain('convert_file_src')
  })
})

describe('M21-T07: 并发=1，第二个任务排队', () => {
  it('第二个导入任务进入等待队列', () => {
    createImportJob({ source: 'local', filePath: '/v1.mp4', title: '视频1' })
    createImportJob({ source: 'local', filePath: '/v2.mp4', title: '视频2' })
    const queue = getImportQueue()
    expect(queue.current).toBeDefined()
    expect(queue.pending.length).toBeGreaterThanOrEqual(1)
  })
})

describe('M21-T08: 取消设置 status=cancelled', () => {
  it('cancelImport 把 video.status 改为 cancelled', () => {
    const job = createImportJob({ source: 'local', filePath: '/v.mp4', title: '视频' })
    cancelImport(job)
    expect(job.video.status).toBe('cancelled')
  })
})
```

- [ ] **Step 2: 运行测试验证新增 8 条全通过**

Run: `npx vitest run harness/m21-start-import.test.ts`
Expected: 8 passed

- [ ] **Step 3: 运行全量测试确认无回归**

Run: `npm test`
Expected: 289 passed (281 + 8)

- [ ] **Step 4: Commit**

```bash
git add harness/m21-start-import.test.ts
git commit -m "test: add m21-start-import harness (8 tests)"
```

---

### Task 3: 创建 m21-progress-listener.test.ts

**Files:**
- Create: `harness/m21-progress-listener.test.ts`

**Interfaces:**
- Consumes: `listenProgress` / `unlistenProgress` from `@/pipeline/progress-listener`, `PROGRESS_EVENT_NAME` / `IMPORT_COMPLETE_EVENT` / `IMPORT_FAILED_EVENT` / `IMPORT_CANCELLED_EVENT` / `ProgressPayload` from `@/architecture/events`
- Produces: 7 条测试（M21-T09 至 M21-T15）

- [ ] **Step 1: 创建 m21-progress-listener.test.ts**

```ts
// harness/m21-progress-listener.test.ts
// ========================================
// M21 Harness: 进度事件前端监听契约
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { listenProgress, unlistenProgress } from '@/pipeline/progress-listener'
import type { ProgressCallback } from '@/pipeline/progress-listener'
import {
  PROGRESS_EVENT_NAME,
  IMPORT_COMPLETE_EVENT,
  IMPORT_FAILED_EVENT,
  IMPORT_CANCELLED_EVENT,
  type ProgressPayload,
} from '@/architecture/events'

describe('M21-T09: listenProgress 函数存在', () => {
  it('listenProgress 是一个函数', () => {
    expect(typeof listenProgress).toBe('function')
  })
})

describe('M21-T10: unlistenProgress 函数存在', () => {
  it('unlistenProgress 是一个函数', () => {
    expect(typeof unlistenProgress).toBe('function')
  })
})

describe('M21-T11: ProgressCallback 接受 ProgressPayload', () => {
  it('构造合法 payload 对象可作为回调参数', () => {
    const payload: ProgressPayload = {
      videoId: 'v1',
      stage: 'asr',
      blockCurrent: 1,
      blockTotal: 3,
      percent: 50,
      retrying: false,
    }
    const callback: ProgressCallback = (p) => {
      expect(p.videoId).toBe('v1')
    }
    callback(payload)
  })
})

describe('M21-T12: 进度事件名 = progress', () => {
  it('PROGRESS_EVENT_NAME 值为 progress', () => {
    expect(PROGRESS_EVENT_NAME).toBe('progress')
  })
})

describe('M21-T13: IMPORT_COMPLETE_EVENT 存在', () => {
  it('值为 import_complete', () => {
    expect(IMPORT_COMPLETE_EVENT).toBe('import_complete')
  })
})

describe('M21-T14: IMPORT_FAILED_EVENT 存在', () => {
  it('值为 import_failed', () => {
    expect(IMPORT_FAILED_EVENT).toBe('import_failed')
  })
})

describe('M21-T15: IMPORT_CANCELLED_EVENT 存在', () => {
  it('值为 import_cancelled', () => {
    expect(IMPORT_CANCELLED_EVENT).toBe('import_cancelled')
  })
})
```

- [ ] **Step 2: 运行测试验证新增 7 条全通过**

Run: `npx vitest run harness/m21-progress-listener.test.ts`
Expected: 7 passed

- [ ] **Step 3: 运行全量测试确认无回归**

Run: `npm test`
Expected: 296 passed (289 + 7)

- [ ] **Step 4: Commit**

```bash
git add harness/m21-progress-listener.test.ts
git commit -m "test: add m21-progress-listener harness (7 tests)"
```

---

### Task 4: 创建 store-zustand-phase2.test.tsx

**Files:**
- Create: `harness/store-zustand-phase2.test.tsx`

**Interfaces:**
- Consumes: `useRainStore` from `@/store/rain-store`
- Produces: 8 条测试（U09 至 U16）

- [ ] **Step 1: 创建 store-zustand-phase2.test.tsx**

```tsx
// harness/store-zustand-phase2.test.tsx
// ========================================
// Store Harness Phase 2: loadVideo / unloadVideo 真值断言
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect, beforeEach } from 'vitest'
import { useRainStore } from '@/store/rain-store'

beforeEach(() => {
  useRainStore.getState().reset()
})

describe('U09: loadVideo 后 currentVideoId 更新', () => {
  it('loadVideo 设置 currentVideoId 为传入值', async () => {
    await useRainStore.getState().loadVideo('video-123')
    expect(useRainStore.getState().currentVideoId).toBe('video-123')
  })
})

describe('U10: loadVideo 后 currentPage = study', () => {
  it('loadVideo 切换页面到 study', async () => {
    await useRainStore.getState().loadVideo('video-123')
    expect(useRainStore.getState().currentPage).toBe('study')
  })
})

describe('U11: loadVideo 后 playPosition = 0', () => {
  it('loadVideo 重置播放进度', async () => {
    await useRainStore.getState().loadVideo('video-123')
    expect(useRainStore.getState().playPosition).toBe(0)
  })
})

describe('U12: unloadVideo 后 currentVideoId = null', () => {
  it('unloadVideo 清空当前视频', async () => {
    await useRainStore.getState().loadVideo('video-123')
    useRainStore.getState().unloadVideo()
    expect(useRainStore.getState().currentVideoId).toBeNull()
  })
})

describe('U13: unloadVideo 后 currentPage = list', () => {
  it('unloadVideo 回到列表页', async () => {
    await useRainStore.getState().loadVideo('video-123')
    useRainStore.getState().unloadVideo()
    expect(useRainStore.getState().currentPage).toBe('list')
  })
})

describe('U14: unloadVideo 后数据缓存清空', () => {
  it('nodeTree / sentences / notes 长度为 0', async () => {
    await useRainStore.getState().loadVideo('video-123')
    useRainStore.getState().unloadVideo()
    const state = useRainStore.getState()
    expect(state.nodeTree).toHaveLength(0)
    expect(state.sentences).toHaveLength(0)
    expect(state.notes).toHaveLength(0)
  })
})

describe('U15: setPage 设置 currentPage', () => {
  it('setPage 切换到 settings', () => {
    useRainStore.getState().setPage('settings')
    expect(useRainStore.getState().currentPage).toBe('settings')
  })
})

describe('U16: loadVideo 接受字符串参数不抛错', () => {
  it('传入任意字符串不抛异常', async () => {
    await expect(
      useRainStore.getState().loadVideo('video-abc')
    ).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: 运行测试验证新增 8 条全通过**

Run: `npx vitest run harness/store-zustand-phase2.test.tsx`
Expected: 8 passed

- [ ] **Step 3: 运行全量测试确认无回归**

Run: `npm test`
Expected: 304 passed (296 + 8)

- [ ] **Step 4: Commit**

```bash
git add harness/store-zustand-phase2.test.tsx
git commit -m "test: add store-zustand-phase2 harness (8 tests)"
```

---

### Task 5: 全量验证 + 最终 commit

**Files:**
- No new files

**Interfaces:**
- Consumes: Task 1-4 的所有产出
- Produces: 最终验证报告

- [ ] **Step 1: 运行全量前端测试**

Run: `npm test`
Expected: 304 passed (33 + 3 = 36 files)

- [ ] **Step 2: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 运行 Rust 测试确认无回归**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 29 passed

- [ ] **Step 4: 确认 harness 已有文件未被修改**

Run: `git diff --name-only harness/`
Expected: 只显示 3 个新增文件（m21-start-import.test.ts、m21-progress-listener.test.ts、store-zustand-phase2.test.tsx），无修改

- [ ] **Step 5: 确认新增文件清单正确**

Run: `git status --short`
Expected: 4 个新文件已 committed（3 harness + 1 source stub）
