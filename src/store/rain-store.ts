// src/store/rain-store.ts
// ========================================
// Rain Zustand Store（决策9）
// ========================================

import { create } from 'zustand'
import type { Node, Sentence, Note } from '@/models/types'
import { addModelToPool, removeModelFromPool, listModels, type ModelPoolEntry, type AddModelInput } from '@/settings/model-pool'

export type LayoutMode = 'follow' | 'textExpand' | 'mapExpand'
export type SelectionOrigin = 'tree' | 'diagram'

export interface UndoAction {
  type: string
  nodeId?: string
  oldTitle?: string
  newTitle?: string
  oldType?: string
  newType?: string
  [key: string]: any
}

interface RainState {
  // UI 会话态
  currentVideoId: string | null
  selectedNodeId: string | null
  selectionOrigin: SelectionOrigin | null
  playPosition: number
  layoutMode: LayoutMode
  undoStack: UndoAction[]
  subtitleOn: boolean
  translationOn: boolean
  aiPanelState: 'ai' | 'notes'
  noteEditState: any
  importQueue: any[]
  importDialogOpen: boolean
  isInputFocused: boolean
  currentPage: 'list' | 'study' | 'settings'
  modelPool: ModelPoolEntry[]
  roleAssignment: { asr: string | null; structuring: string | null; assistant: string | null }

  // 当前视频缓存
  nodeTree: Node[]
  sentences: Sentence[]
  notes: Note[]
  currentVideoFilePath: string
  currentVideoTitle: string

  // Actions
  reset: () => void
  selectNode: (nodeId: string, origin: SelectionOrigin) => void
  pushUndo: (action: UndoAction) => void
  popUndo: () => UndoAction | undefined
  switchLayoutMode: (mode: LayoutMode) => void
  loadVideo: (videoId: string) => void
  unloadVideo: () => void
  setPage: (page: 'list' | 'study' | 'settings') => void
  addModel: (input: AddModelInput) => void
  removeModel: (id: string) => void
  setRoleModel: (role: 'asr' | 'structuring' | 'assistant', modelId: string | null) => void
}

const initialState = {
  currentVideoId: null as string | null,
  selectedNodeId: null as string | null,
  selectionOrigin: null as SelectionOrigin | null,
  playPosition: 0,
  layoutMode: 'follow' as LayoutMode,
  undoStack: [] as UndoAction[],
  subtitleOn: true,
  translationOn: true,
  aiPanelState: 'ai' as const,
  noteEditState: null as any,
  importQueue: [] as any[],
  importDialogOpen: false,
  isInputFocused: false,
  currentPage: 'list' as const,
  modelPool: [] as ModelPoolEntry[],
  roleAssignment: { asr: null, structuring: null, assistant: null } as { asr: string | null; structuring: string | null; assistant: string | null },
  nodeTree: [] as Node[],
  sentences: [] as Sentence[],
  notes: [] as Note[],
  currentVideoFilePath: '',
  currentVideoTitle: '',
}

export const useRainStore = create<RainState>((set, get) => ({
  ...initialState,

  reset: () => set({ ...initialState }),

  selectNode: (nodeId, origin) =>
    set({ selectedNodeId: nodeId, selectionOrigin: origin }),

  pushUndo: (action) =>
    set((state) => ({
      undoStack: [...state.undoStack, action].slice(-20),
    })),

  popUndo: () => {
    const stack = get().undoStack
    if (stack.length === 0) return undefined
    const action = stack[stack.length - 1]
    set({ undoStack: stack.slice(0, -1) })
    return action
  },

  switchLayoutMode: (mode) => {
    const current = get().layoutMode
    if (current === mode) {
      set({ layoutMode: 'follow' })
    } else {
      set({ layoutMode: mode })
    }
  },

  loadVideo: async (videoId: string) => {
    try {
      const { getDb } = await import('@/models/db-singleton')
      const { getNodesByVideoId, getNotesByVideoId, getSentencesByNodeId, getVideoById } =
        await import('@/models/database')
      const db = await getDb()

      const video = await getVideoById(db, videoId)
      const nodes = await getNodesByVideoId(db, videoId)
      const notes = await getNotesByVideoId(db, videoId)

      const paragraphIds = nodes.filter((n) => n.kind === 'paragraph').map((n) => n.id)
      const sentencePromises = paragraphIds.map((pid) => getSentencesByNodeId(db, pid))
      const sentenceArrays = await Promise.all(sentencePromises)
      const sentences = sentenceArrays.flat()

      set({
        currentVideoId: videoId,
        currentPage: 'study',
        nodeTree: nodes,
        sentences,
        notes,
        playPosition: video?.position ?? 0,
        currentVideoFilePath: video?.filePath ?? '',
        currentVideoTitle: video?.title ?? '',
      })
    } catch {
      set({ currentVideoId: videoId, currentPage: 'study' })
    }
  },

  unloadVideo: () => {
    set({
      currentVideoId: null,
      currentPage: 'list',
      nodeTree: [],
      sentences: [],
      notes: [],
      selectedNodeId: null,
      selectionOrigin: null,
      playPosition: 0,
      currentVideoFilePath: '',
      currentVideoTitle: '',
    })
  },

  setPage: (page) => set({ currentPage: page }),

  addModel: (input) => {
    addModelToPool(input)
    const pool = listModels()
    set({ modelPool: pool })
    void (async () => {
      try {
        const { isTauri } = await import('@/lib/tauri-env')
        if (!isTauri()) return
        const { getDb } = await import('@/models/db-singleton')
        const { setSetting } = await import('@/models/database')
        const db = await getDb()
        await setSetting(db, 'model_pool', JSON.stringify(pool))
        if (input.apiKey) {
          await setSetting(db, `api_key.${input.alias}`, input.apiKey)
        }
      } catch { /* browser fallback — ignore */ }
    })()
  },

  removeModel: (id) => {
    removeModelFromPool(id)
    const pool = listModels()
    set({ modelPool: pool })
    void (async () => {
      try {
        const { isTauri } = await import('@/lib/tauri-env')
        if (!isTauri()) return
        const { getDb } = await import('@/models/db-singleton')
        const { setSetting } = await import('@/models/database')
        const db = await getDb()
        await setSetting(db, 'model_pool', JSON.stringify(pool))
      } catch { /* browser fallback — ignore */ }
    })()
  },

  setRoleModel: (role, modelId) => {
    set((state) => ({
      roleAssignment: { ...state.roleAssignment, [role]: modelId },
    }))
    void (async () => {
      try {
        const { isTauri } = await import('@/lib/tauri-env')
        if (!isTauri()) return
        const { getDb } = await import('@/models/db-singleton')
        const { setSetting } = await import('@/models/database')
        const db = await getDb()
        await setSetting(db, `role_${role}`, modelId ?? '')
      } catch { /* browser fallback — ignore */ }
    })()
  },
}))
