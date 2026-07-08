// src/store/rain-store.ts
// ========================================
// Rain Zustand Store（决策99）
// ========================================

import { create } from 'zustand'
import type { Node, Sentence, Note } from '@/models/types'

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

  // 当前视频缓存
  nodeTree: Node[]
  sentences: Sentence[]
  notes: Note[]

  // Actions
  reset: () => void
  selectNode: (nodeId: string, origin: SelectionOrigin) => void
  pushUndo: (action: UndoAction) => void
  popUndo: () => UndoAction | undefined
  switchLayoutMode: (mode: LayoutMode) => void
  loadVideo: (videoId: string) => void
  unloadVideo: () => void
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
  nodeTree: [] as Node[],
  sentences: [] as Sentence[],
  notes: [] as Note[],
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
    // 生产环境：从数据库加载节点树、句子、笔记
    try {
      // 动态导入 database 模块（避免测试环境初始化开销）
      const { createDatabase, getNodesByVideoId, getNotesByVideoId, getSentencesByNodeId } =
        await import('@/models/database')
      const db = await createDatabase(':memory:')

      const nodes = await getNodesByVideoId(db, videoId)
      const notes = await getNotesByVideoId(db, videoId)

      // 收集所有段落 ID，查询句子
      const paragraphIds = nodes.filter((n) => n.kind === 'paragraph').map((n) => n.id)
      const sentencePromises = paragraphIds.map((pid) => getSentencesByNodeId(db, pid))
      const sentenceArrays = await Promise.all(sentencePromises)
      const sentences = sentenceArrays.flat()

      set({
        currentVideoId: videoId,
        nodeTree: nodes,
        sentences,
        notes,
        playPosition: 0,
      })
    } catch {
      // 数据库不可用时设置当前视频 ID，数据由 UI 组件单独加载
      set({ currentVideoId: videoId })
    }
  },

  unloadVideo: () => {
    set({
      currentVideoId: null,
      nodeTree: [],
      sentences: [],
      notes: [],
      selectedNodeId: null,
      selectionOrigin: null,
      playPosition: 0,
    })
  },
}))
