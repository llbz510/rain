import type { Sentence } from '@/models/types'

export type Stage2NodeKind = 'chapter' | 'section' | 'paragraph'
export type Stage2ParagraphType = 'concept' | 'example' | 'analogy' | 'transition'

export interface Stage2NodeRef {
  id: string
  parentId: string | null
  kind: Stage2NodeKind
  title: string
  type?: Stage2ParagraphType
  startSentenceId: string
  endSentenceId: string
}

export interface Stage2BlockOutput {
  blockId: string
  nodes: Stage2NodeRef[]
  coveredSentenceIds: string[]
}

export interface Stage2InputBlock {
  blockId: string
  videoId: string
  sentences: Sentence[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): string[] {
  const errors: string[] = []
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`unexpected field ${key}`)
  }
  for (const key of required) {
    if (!(key in value)) errors.push(`missing field ${key}`)
  }
  return errors
}

export function validateExactSentenceCoverage(
  expectedSentenceIds: readonly string[],
  output: Pick<Stage2BlockOutput, 'blockId' | 'nodes' | 'coveredSentenceIds'>,
): string[] {
  const errors: string[] = []
  const expectedIndex = new Map(expectedSentenceIds.map((id, index) => [id, index]))
  const counts = new Map<string, number>()
  let previousIndex = -1

  for (const id of output.coveredSentenceIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1)
    const index = expectedIndex.get(id)
    if (index === undefined) {
      errors.push(`foreign sentence ${id}`)
    } else {
      if (index < previousIndex) errors.push(`out-of-order sentence ${id}`)
      previousIndex = Math.max(previousIndex, index)
    }
  }
  for (const id of expectedSentenceIds) {
    const count = counts.get(id) ?? 0
    if (count === 0) errors.push(`missing sentence ${id}`)
    if (count > 1) errors.push(`duplicate sentence ${id}`)
  }
  return errors
}

export function parseStage2BlockOutput(value: unknown): Stage2BlockOutput | null {
  if (!isRecord(value)) return null
  const topErrors = exactKeys(value, ['blockId', 'nodes', 'coveredSentenceIds'], ['blockId', 'nodes', 'coveredSentenceIds'])
  if (topErrors.length > 0 || typeof value.blockId !== 'string' || !Array.isArray(value.nodes)
    || !Array.isArray(value.coveredSentenceIds) || value.coveredSentenceIds.some((id) => typeof id !== 'string')) {
    return null
  }
  return value as unknown as Stage2BlockOutput
}

export function validateStage2BlockOutput(
  block: Stage2InputBlock,
  value: unknown,
  existingNodeIds: ReadonlySet<string> = new Set(),
): string[] {
  const output = parseStage2BlockOutput(value)
  if (!output) return ['output does not match exact Stage2BlockOutput schema']
  const errors: string[] = []
  if (output.blockId !== block.blockId) errors.push(`block ID mismatch: expected ${block.blockId}`)
  errors.push(...validateExactSentenceCoverage(block.sentences.map((sentence) => sentence.id), output))

  const expectedIndex = new Map(block.sentences.map((sentence, index) => [sentence.id, index]))
  const nodeById = new Map<string, Stage2NodeRef>()
  const nodeIndex = new Map<string, number>()
  const paragraphCoverage = new Map<string, number>()
  const kinds: readonly Stage2NodeKind[] = ['chapter', 'section', 'paragraph']
  const paragraphTypes: readonly Stage2ParagraphType[] = ['concept', 'example', 'analogy', 'transition']

  output.nodes.forEach((rawNode, index) => {
    if (!isRecord(rawNode)) {
      errors.push(`node ${index} must be an object`)
      return
    }
    const schemaErrors = exactKeys(
      rawNode,
      ['id', 'parentId', 'kind', 'title', 'type', 'startSentenceId', 'endSentenceId'],
      ['id', 'parentId', 'kind', 'title', 'startSentenceId', 'endSentenceId'],
    )
    errors.push(...schemaErrors.map((error) => `node ${index}: ${error}`))
    const node = rawNode as unknown as Stage2NodeRef
    if (typeof node.id !== 'string' || !node.id.startsWith(`${block.blockId}:node:`)) {
      errors.push(`node ${index}: ID must be scoped to block ${block.blockId}`)
    } else if (nodeById.has(node.id) || existingNodeIds.has(node.id)) {
      errors.push(`duplicate node ID ${node.id}`)
    } else {
      nodeById.set(node.id, node)
      nodeIndex.set(node.id, index)
    }
    if (!kinds.includes(node.kind)) errors.push(`node ${node.id}: invalid kind`)
    if (typeof node.title !== 'string' || node.title.trim() === '') errors.push(`node ${node.id}: nonempty title required`)
    if (node.kind === 'paragraph') {
      if (!paragraphTypes.includes(node.type as Stage2ParagraphType)) errors.push(`node ${node.id}: paragraph type required`)
    } else if (node.type !== undefined) {
      errors.push(`node ${node.id}: type is only allowed for paragraphs`)
    }
    const start = expectedIndex.get(node.startSentenceId)
    const end = expectedIndex.get(node.endSentenceId)
    if (start === undefined || end === undefined) {
      errors.push(`node ${node.id}: range must use sentence boundaries`)
    } else if (start > end) {
      errors.push(`node ${node.id}: chronological range is reversed`)
    } else if (node.kind === 'paragraph') {
      for (let sentenceIndex = start; sentenceIndex <= end; sentenceIndex += 1) {
        const sentenceId = block.sentences[sentenceIndex].id
        paragraphCoverage.set(sentenceId, (paragraphCoverage.get(sentenceId) ?? 0) + 1)
      }
    }
  })

  output.nodes.forEach((node) => {
    if (!isRecord(node)) return
    const typed = node as unknown as Stage2NodeRef
    if (typed.kind === 'chapter') {
      if (typed.parentId !== null) errors.push(`node ${typed.id}: chapter parent must be null`)
      return
    }
    if (typeof typed.parentId !== 'string') {
      errors.push(`node ${typed.id}: parent is required`)
      return
    }
    const parent = nodeById.get(typed.parentId)
    if (!parent) {
      errors.push(`node ${typed.id}: parent ${typed.parentId} is missing from tree`)
      return
    }
    const expectedParentKind = typed.kind === 'section' ? 'chapter' : 'section'
    if (parent.kind !== expectedParentKind) errors.push(`node ${typed.id}: invalid parent kind`)
    if ((nodeIndex.get(parent.id) ?? Number.MAX_SAFE_INTEGER) >= (nodeIndex.get(typed.id) ?? -1)) {
      errors.push(`node ${typed.id}: parent must appear before child`)
    }
    const childStart = expectedIndex.get(typed.startSentenceId)
    const childEnd = expectedIndex.get(typed.endSentenceId)
    const parentStart = expectedIndex.get(parent.startSentenceId)
    const parentEnd = expectedIndex.get(parent.endSentenceId)
    if (childStart !== undefined && childEnd !== undefined && parentStart !== undefined && parentEnd !== undefined
      && (childStart < parentStart || childEnd > parentEnd)) {
      errors.push(`node ${typed.id}: chronological range exceeds parent`)
    }
  })

  const siblingRanges = new Map<string, Array<{ id: string; start: number; end: number }>>()
  for (const rawNode of output.nodes) {
    if (!isRecord(rawNode)) continue
    const node = rawNode as unknown as Stage2NodeRef
    const start = expectedIndex.get(node.startSentenceId)
    const end = expectedIndex.get(node.endSentenceId)
    if (start === undefined || end === undefined || start > end) continue
    const parentKey = node.parentId ?? '__root__'
    const siblings = siblingRanges.get(parentKey) ?? []
    siblings.push({ id: node.id, start, end })
    siblingRanges.set(parentKey, siblings)
  }
  for (const [parentKey, siblings] of siblingRanges) {
    for (let index = 1; index < siblings.length; index += 1) {
      const previous = siblings[index - 1]
      const current = siblings[index]
      if (current.start < previous.start) {
        errors.push(`siblings under ${parentKey} are out of order`)
      } else if (current.start <= previous.end) {
        errors.push(`siblings under ${parentKey} overlap`)
      }
    }
  }
  for (const sentence of block.sentences) {
    const count = paragraphCoverage.get(sentence.id) ?? 0
    if (count === 0) errors.push(`sentence ${sentence.id} is not assigned to a paragraph`)
    if (count > 1) errors.push(`sentence ${sentence.id} is assigned to multiple paragraphs`)
  }
  return errors
}