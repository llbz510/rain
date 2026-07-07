// src/models/tree-ops.ts
// ========================================
// 树形结构编辑操作
// ========================================

import type { Node, Sentence, Note, ParagraphType } from './types'
import { PARAGRAPH_TYPES } from './types'
import { buildTextFromSentences } from './text-utils'

// 生成唯一 ID
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// 计算节点时间范围（根据子节点或句子）
function computeTimeRange(nodeId: string, allNodes: Node[], allSentences: Sentence[]): { startTime: number; endTime: number } {
  const children = allNodes.filter(n => n.parentId === nodeId)
  
  if (children.length > 0) {
    // 容器节点：根据子节点计算
    const times = children.flatMap(c => [c.startTime, c.endTime])
    return {
      startTime: Math.min(...times),
      endTime: Math.max(...times)
    }
  } else {
    // 段落节点：根据句子计算
    const sentences = allSentences.filter(s => s.nodeId === nodeId)
    if (sentences.length === 0) {
      return { startTime: 0, endTime: 0 }
    }
    const times = sentences.flatMap(s => [s.startTime, s.endTime])
    return {
      startTime: Math.min(...times),
      endTime: Math.max(...times)
    }
  }
}

// 拆分段落
export function splitParagraph(
  nodes: Node[],
  sentences: Sentence[],
  paragraphId: string,
  extractSentenceIds: string[]
): { nodes: Node[]; sentences: Sentence[] } {
  const paragraph = nodes.find(n => n.id === paragraphId)
  if (!paragraph || paragraph.kind !== 'paragraph') {
    throw new Error('Invalid paragraph id')
  }

  const paragraphSentences = sentences.filter(s => s.nodeId === paragraphId)
  const extractSet = new Set(extractSentenceIds)
  
  const remainingSentences = paragraphSentences.filter(s => !extractSet.has(s.id))
  const extractedSentences = paragraphSentences.filter(s => extractSet.has(s.id))

  if (remainingSentences.length === 0 || extractedSentences.length === 0) {
    throw new Error('Cannot split: both parts must have at least one sentence')
  }

  // 创建新段落
  const newParagraph: Node = {
    ...paragraph,
    id: generateId('p'),
    title: paragraph.title,
    sortOrder: paragraph.sortOrder + 1,
    startTime: Math.min(...extractedSentences.map(s => s.startTime)),
    endTime: Math.max(...extractedSentences.map(s => s.endTime)),
    text: buildTextFromSentences(extractedSentences, 'zh'), // 假设中文
  }

  // 更新原段落
  const updatedParagraph: Node = {
    ...paragraph,
    startTime: Math.min(...remainingSentences.map(s => s.startTime)),
    endTime: Math.max(...remainingSentences.map(s => s.endTime)),
    text: buildTextFromSentences(remainingSentences, 'zh'),
  }

  // 更新句子的 nodeId
  const updatedSentences = sentences.map(s => {
    if (extractSet.has(s.id)) {
      return { ...s, nodeId: newParagraph.id }
    }
    return s
  })

  // 更新后续兄弟节点的 sortOrder
  const updatedNodes = nodes.map(n => {
    if (n.id === paragraphId) {
      return updatedParagraph
    }
    if (n.parentId === paragraph.parentId && n.sortOrder > paragraph.sortOrder) {
      return { ...n, sortOrder: n.sortOrder + 1 }
    }
    return n
  })

  return {
    nodes: [...updatedNodes, newParagraph],
    sentences: updatedSentences,
  }
}

// 合并节点
export function mergeNodes(
  nodes: Node[],
  sentences: Sentence[],
  nodeIds: string[],
  survivorId: string
): { nodes: Node[]; sentences: Sentence[] } {
  if (nodeIds.length < 2) {
    throw new Error('Must merge at least 2 nodes')
  }

  if (!nodeIds.includes(survivorId)) {
    throw new Error('Survivor must be one of the merged nodes')
  }

  const nodesToMerge = nodeIds.map(id => nodes.find(n => n.id === id)).filter(Boolean) as Node[]
  
  // 检查：必须同级
  const parentIds = new Set(nodesToMerge.map(n => n.parentId))
  if (parentIds.size > 1) {
    throw new Error('Cannot merge nodes with different parents')
  }

  // 检查：必须同kind
  const kinds = new Set(nodesToMerge.map(n => n.kind))
  if (kinds.size > 1) {
    throw new Error('Cannot merge nodes of different kinds')
  }

  // 检查：必须相邻
  const sortedNodes = [...nodesToMerge].sort((a, b) => a.sortOrder - b.sortOrder)
  for (let i = 0; i < sortedNodes.length - 1; i++) {
    if (sortedNodes[i + 1].sortOrder !== sortedNodes[i].sortOrder + 1) {
      throw new Error('Can only merge adjacent nodes')
    }
  }

  const survivor = nodesToMerge.find(n => n.id === survivorId)!
  const victims = nodesToMerge.filter(n => n.id !== survivorId)

  // 合并句子（如果是段落）
  let updatedSentences = sentences
  if (survivor.kind === 'paragraph') {
    updatedSentences = sentences.map(s => {
      if (victims.some(v => v.id === s.nodeId)) {
        return { ...s, nodeId: survivorId }
      }
      return s
    })

    // 重新排序句子
    const mergedSentences = updatedSentences.filter(s => s.nodeId === survivorId)
    mergedSentences.sort((a, b) => a.startTime - b.startTime)
    updatedSentences = updatedSentences.map(s => {
      if (s.nodeId === survivorId) {
        const index = mergedSentences.findIndex(ms => ms.id === s.id)
        return { ...s, sortOrder: index }
      }
      return s
    })
  }

  // 合并子节点（如果是容器）
  let updatedNodes = nodes
  if (survivor.kind !== 'paragraph') {
    updatedNodes = nodes.map(n => {
      if (victims.some(v => v.id === n.parentId)) {
        return { ...n, parentId: survivorId }
      }
      return n
    })
  }

  // 计算时间范围
  const timeRange = computeTimeRange(survivorId, updatedNodes, updatedSentences)
  
  // 更新 survivor
  const finalNodes = updatedNodes
    .filter(n => !victims.some(v => v.id === n.id))
    .map(n => {
      if (n.id === survivorId) {
        return {
          ...n,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
          text: n.kind === 'paragraph' 
            ? buildTextFromSentences(updatedSentences.filter(s => s.nodeId === survivorId), 'zh')
            : n.text,
        }
      }
      return n
    })

  return {
    nodes: finalNodes,
    sentences: updatedSentences,
  }
}

// 删除节点（内容迁移）
export function deleteNode(
  nodes: Node[],
  sentences: Sentence[],
  notes: Note[],
  nodeId: string
): { nodes: Node[]; sentences: Sentence[]; notes: Note[] } {
  const node = nodes.find(n => n.id === nodeId)
  if (!node) {
    throw new Error('Node not found')
  }

  // 检查是否是空容器
  const children = nodes.filter(n => n.parentId === nodeId)
  const nodeSentences = sentences.filter(s => s.nodeId === nodeId)
  const isEmpty = children.length === 0 && nodeSentences.length === 0

  if (isEmpty) {
    // 空容器直接删除
    return {
      nodes: nodes.filter(n => n.id !== nodeId),
      sentences,
      notes,
    }
  }

  // 检查是否是首个非空子节点
  const siblings = nodes.filter(n => n.parentId === node.parentId)
  const sortedSiblings = [...siblings].sort((a, b) => a.sortOrder - b.sortOrder)
  const isFirst = sortedSiblings[0]?.id === nodeId

  if (isFirst && !isEmpty) {
    throw new Error('Cannot delete first non-empty child node')
  }

  // 找到上一个兄弟节点
  const prevSibling = sortedSiblings[sortedSiblings.findIndex(s => s.id === nodeId) - 1]
  if (!prevSibling) {
    throw new Error('Cannot delete: no previous sibling to merge into')
  }

  // 迁移内容
  let updatedNodes = nodes
  let updatedSentences = sentences

  if (node.kind === 'paragraph') {
    // 段落：句子并入上一个兄弟段落
    updatedSentences = sentences.map(s => {
      if (s.nodeId === nodeId) {
        return { ...s, nodeId: prevSibling.id }
      }
      return s
    })

    // 重新排序句子
    const mergedSentences = updatedSentences.filter(s => s.nodeId === prevSibling.id)
    mergedSentences.sort((a, b) => a.startTime - b.startTime)
    updatedSentences = updatedSentences.map(s => {
      if (s.nodeId === prevSibling.id) {
        const index = mergedSentences.findIndex(ms => ms.id === s.id)
        return { ...s, sortOrder: index }
      }
      return s
    })
  } else {
    // 容器：子节点并入上一个兄弟容器
    updatedNodes = nodes.map(n => {
      if (n.parentId === nodeId) {
        return { ...n, parentId: prevSibling.id }
      }
      return n
    })
  }

  // 删除节点
  const finalNodes = updatedNodes
    .filter(n => n.id !== nodeId)
    .map(n => {
      if (n.id === prevSibling.id) {
        const timeRange = computeTimeRange(prevSibling.id, updatedNodes.filter(x => x.id !== nodeId), updatedSentences)
        return {
          ...n,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
          text: n.kind === 'paragraph'
            ? buildTextFromSentences(updatedSentences.filter(s => s.nodeId === prevSibling.id), 'zh')
            : n.text,
        }
      }
      return n
    })

  return {
    nodes: finalNodes,
    sentences: updatedSentences,
    notes,
  }
}

// Reparent（拖拽移动）
export function reparentNode(
  nodes: Node[],
  sentences: Sentence[],
  nodeId: string,
  newParentId: string
): { nodes: Node[]; sentences: Sentence[] } {
  const node = nodes.find(n => n.id === nodeId)
  const newParent = nodes.find(n => n.id === newParentId)

  if (!node || !newParent) {
    throw new Error('Node or parent not found')
  }

  // 检查时间线约束：节点的时间范围必须在新父节点的时间范围内
  if (node.startTime < newParent.startTime || node.endTime > newParent.endTime) {
    throw new Error('Cannot reparent: time range does not fit in new parent')
  }

  // Move node to new parent and re-sort siblings by time
  let updatedNodes = nodes.map(n => {
    if (n.id === nodeId) {
      return { ...n, parentId: newParentId }
    }
    return n
  })

  // Re-sort all siblings under new parent by startTime
  const newSiblings = updatedNodes.filter(n => n.parentId === newParentId)
  newSiblings.sort((a, b) => a.startTime - b.startTime)
  updatedNodes = updatedNodes.map(n => {
    if (n.parentId === newParentId) {
      const index = newSiblings.findIndex(s => s.id === n.id)
      return { ...n, sortOrder: index }
    }
    return n
  })

  return {
    nodes: updatedNodes,
    sentences,
  }
}

// 改变节点类型
export function changeNodeType(nodes: Node[], nodeId: string, newType: ParagraphType): Node[] {
  const node = nodes.find(n => n.id === nodeId)
  if (!node) {
    throw new Error('Node not found')
  }

  if (node.kind !== 'paragraph') {
    throw new Error('Only paragraph nodes can have types')
  }

  if (!PARAGRAPH_TYPES.includes(newType)) {
    throw new Error(`Invalid type: ${newType}`)
  }

  return nodes.map(n => {
    if (n.id === nodeId) {
      return { ...n, type: newType }
    }
    return n
  })
}

// 重命名节点
export function renameNode(nodes: Node[], nodeId: string, newTitle: string): Node[] {
  if (!newTitle || newTitle.trim() === '') {
    throw new Error('Title cannot be empty')
  }

  return nodes.map(n => {
    if (n.id === nodeId) {
      return { ...n, title: newTitle.trim() }
    }
    return n
  })
}
