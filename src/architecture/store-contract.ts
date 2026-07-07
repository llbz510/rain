// src/architecture/store-contract.ts
// ========================================
// 状态边界契约（决策99）
// ========================================

// UI 会话态字段
export const STORE_UI_SESSION_FIELDS = [
  'currentVideoId',
  'selectedNodeId',
  'selectionOrigin',
  'playPosition',
  'layoutMode',
  'undoStack',
  'subtitleOn',
  'translationOn',
  'aiPanelState',
  'noteEditState',
  'importQueue',
  'importDialogOpen',
] as const

// 当前视频缓存字段
export const STORE_VIDEO_CACHE_FIELDS = [
  'nodeTree',
  'sentences',
  'notes',
] as const

export interface StoreState {
  // UI 会话态
  currentVideoId: string | null
  selectedNodeId: string | null
  selectionOrigin: 'tree' | 'diagram' | null
  playPosition: number
  layoutMode: 'follow' | 'textExpand' | 'mapExpand'
  undoStack: any[]
  subtitleOn: boolean
  translationOn: boolean
  aiPanelState: 'ai' | 'notes'
  noteEditState: any
  importQueue: any[]
  importDialogOpen: boolean

  // 当前视频缓存
  nodeTree: any[]
  sentences: any[]
  notes: any[]
}

export function getInitialStoreState(): StoreState {
  return {
    currentVideoId: null,
    selectedNodeId: null,
    selectionOrigin: null,
    playPosition: 0,
    layoutMode: 'follow',
    undoStack: [],
    subtitleOn: true,
    translationOn: true,
    aiPanelState: 'ai',
    noteEditState: null,
    importQueue: [],
    importDialogOpen: false,
    nodeTree: [],
    sentences: [],
    notes: [],
  }
}
