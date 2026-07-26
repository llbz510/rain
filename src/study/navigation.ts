import type { Node, Sentence } from '@/models/types'

export interface NodeNavigationTarget {
  nodeId: string
  paragraphId: string
  sentenceId: string
  time: number
}

export interface SentenceNavigationTarget {
  sentenceId: string
  paragraphId: string
  time: number
}

export function resolveSentenceNavigationTarget(
  sentences: Sentence[],
  sentenceId: string,
): SentenceNavigationTarget | null {
  const sentence = sentences.find((item) => item.id === sentenceId)
  if (!sentence) return null
  return {
    sentenceId: sentence.id,
    paragraphId: sentence.nodeId,
    time: sentence.startTime,
  }
}

export function resolveNodeNavigationTarget(
  nodes: Node[],
  sentences: Sentence[],
  nodeId: string,
): NodeNavigationTarget | null {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  if (!nodesById.has(nodeId)) return null

  const subtreeIds = new Set([nodeId])
  let foundDescendant = true
  while (foundDescendant) {
    foundDescendant = false
    for (const node of nodes) {
      if (!subtreeIds.has(node.id) && node.parentId && subtreeIds.has(node.parentId)) {
        subtreeIds.add(node.id)
        foundDescendant = true
      }
    }
  }

  const earliestSentence = sentences
    .filter((sentence) => {
      const owner = nodesById.get(sentence.nodeId)
      return subtreeIds.has(sentence.nodeId) && owner?.kind === 'paragraph'
    })
    .sort((left, right) => (
      left.startTime - right.startTime
      || left.sortOrder - right.sortOrder
      || left.id.localeCompare(right.id)
    ))[0]

  if (!earliestSentence) return null

  return {
    nodeId,
    paragraphId: earliestSentence.nodeId,
    sentenceId: earliestSentence.id,
    time: earliestSentence.startTime,
  }
}
