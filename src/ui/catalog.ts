// src/ui/catalog.ts
// ========================================
// 目录区交互语义
// ========================================

export interface CatalogState {
  currentVideoId: string | null
  playPosition: number
  selectedNodeId: string | null
  selectionOrigin: 'tree' | 'diagram' | null
}

export interface InteractionResult {
  selectedNodeId?: string
  selectionOrigin?: 'tree' | 'diagram'
  seekTo?: number
  scrollTextTo?: string
}

interface NodeLike {
  id?: string
  startTime: number
  endTime?: number
  title?: string
}

// 左树单击：仅选中
export function handleTreeClick(nodeId: string, state: CatalogState): InteractionResult {
  return {
    selectedNodeId: nodeId,
    selectionOrigin: 'tree',
  }
}

// 左树双击：三区跳转
export function handleTreeDoubleClick(
  nodeId: string,
  state: CatalogState,
  node: NodeLike
): InteractionResult {
  return {
    selectedNodeId: nodeId,
    selectionOrigin: 'tree',
    seekTo: node.startTime,
    scrollTextTo: nodeId,
  }
}

// 横条单击：跳转
export function handleBarClick(nodeId: string, node: NodeLike): InteractionResult {
  return {
    seekTo: node.startTime,
  }
}

// 导图单击：仅选中
export function handleDiagramClick(nodeId: string, state: CatalogState): InteractionResult {
  return {
    selectedNodeId: nodeId,
    selectionOrigin: 'diagram',
  }
}

// 导图双击：三区跳转
export function handleDiagramDoubleClick(
  nodeId: string,
  state: CatalogState,
  node: NodeLike
): InteractionResult {
  return {
    selectedNodeId: nodeId,
    selectionOrigin: 'diagram',
    seekTo: node.startTime,
    scrollTextTo: nodeId,
  }
}

// 计算 ■/□ 进度指示
export function computeProgressIndicators(
  nodes: NodeLike[],
  playPosition: number
): Record<string, 'filled' | 'current' | 'empty'> {
  const result: Record<string, 'filled' | 'current' | 'empty'> = {}

  for (const node of nodes) {
    if (!node.id) continue
    
    const endTime = node.endTime ?? node.startTime
    if (playPosition < node.startTime) {
      result[node.id] = 'empty'
    } else if (playPosition >= node.startTime && playPosition < endTime) {
      result[node.id] = 'current'
    } else {
      // playPosition >= endTime
      result[node.id] = 'filled'
    }
  }

  return result
}
