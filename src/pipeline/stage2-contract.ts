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

function normalizedToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return token.length > 0 ? token : null
}

function normalizeParagraphType(value: unknown): Stage2ParagraphType | null {
  const token = normalizedToken(value)
  if (!token) return null
  if (token === 'concept' || token === 'knowledge' || token === 'knowledge_point' || token === 'point') return 'concept'
  if (token === 'example' || token === 'case' || token === 'demo') return 'example'
  if (token === 'analogy' || token === 'metaphor') return 'analogy'
  if (token === 'transition' || token === 'summary' || token === 'bridge') return 'transition'
  return null
}

function normalizeKind(value: unknown, paragraphType: Stage2ParagraphType | null): Stage2NodeKind | null {
  const token = normalizedToken(value)
  if (!token) return paragraphType ? 'paragraph' : null
  if (token === 'chapter' || token === 'unit' || token === 'module' || token === 'part' || token === 'root') return 'chapter'
  if (token === 'section' || token === 'subsection' || token === 'topic' || token === 'subtopic') return 'section'
  if (
    token === 'paragraph' || token === 'para' || token === 'content' || token === 'detail'
    || token === 'knowledge_point' || token === 'knowledgepoint' || token === 'point'
    || normalizeParagraphType(token) !== null
  ) return 'paragraph'
  return paragraphType ? 'paragraph' : null
}

function sentenceBoundaryIndex(block: Stage2InputBlock): Map<string, number> {
  return new Map(block.sentences.map((sentence, index) => [sentence.id, index]))
}

function makeScopedNodeId(blockId: string, preferred: unknown, suffix: string, used: Set<string>): string {
  if (typeof preferred === 'string' && preferred.startsWith(`${blockId}:node:`) && !used.has(preferred)) {
    used.add(preferred)
    return preferred
  }
  let candidate = `${blockId}:node:${suffix}`
  let counter = 1
  while (used.has(candidate)) {
    candidate = `${blockId}:node:${suffix}-${counter}`
    counter += 1
  }
  used.add(candidate)
  return candidate
}

function titleFrom(node: Record<string, unknown> | undefined, fallback: string): string {
  return typeof node?.title === 'string' && node.title.trim().length > 0 ? node.title.trim() : fallback
}

function repairStage2BlockOutputCandidate(
  value: Record<string, unknown>,
  nodes: Array<Record<string, unknown>>,
  block: Stage2InputBlock,
): Stage2BlockOutput {
  const sentenceIndex = sentenceBoundaryIndex(block)
  const firstSentenceId = block.sentences[0].id
  const lastSentenceId = block.sentences.at(-1)!.id
  const usedIds = new Set<string>()
  const chapterSource = nodes.find((node) => node.kind === 'chapter')
    ?? nodes.find((node) => node.parentId === null)
    ?? nodes[0]
  const paragraphSources = nodes
    .filter((node) => node !== chapterSource && node.kind === 'paragraph')
    .map((node, order) => {
      const rawStart = sentenceIndex.get(node.startSentenceId as string)
      const rawEnd = sentenceIndex.get(node.endSentenceId as string)
      if (rawStart === undefined || rawEnd === undefined) return null
      return {
        node,
        order,
        start: Math.min(rawStart, rawEnd),
        end: Math.max(rawStart, rawEnd),
      }
    })
    .filter((item): item is { node: Record<string, unknown>; order: number; start: number; end: number } => item !== null)
    .sort((left, right) => left.start - right.start || left.end - right.end || left.order - right.order)

  const chapterId = makeScopedNodeId(block.blockId, chapterSource?.id, 'chapter', usedIds)
  const sectionSource = nodes.find((node) => node.kind === 'section' && node !== chapterSource)
    ?? nodes.find((node) => node !== chapterSource && node.kind !== 'paragraph')
  const sectionId = makeScopedNodeId(block.blockId, sectionSource?.id, 'section', usedIds)
  const repairedNodes: Stage2NodeRef[] = [
    {
      id: chapterId,
      parentId: null,
      kind: 'chapter',
      title: titleFrom(chapterSource, '章节'),
      startSentenceId: firstSentenceId,
      endSentenceId: lastSentenceId,
    },
    {
      id: sectionId,
      parentId: chapterId,
      kind: 'section',
      title: titleFrom(sectionSource, titleFrom(chapterSource, '小节')),
      startSentenceId: firstSentenceId,
      endSentenceId: lastSentenceId,
    },
  ]

  const addParagraph = (source: Record<string, unknown> | undefined, start: number, end: number, suffix: string): void => {
    repairedNodes.push({
      id: makeScopedNodeId(block.blockId, source?.id, suffix, usedIds),
      parentId: sectionId,
      kind: 'paragraph',
      title: titleFrom(source, '内容段落'),
      type: normalizeParagraphType(source?.type) ?? normalizeParagraphType(source?.paragraphType) ?? 'concept',
      startSentenceId: block.sentences[start].id,
      endSentenceId: block.sentences[end].id,
    })
  }

  if (paragraphSources.length === 0) {
    addParagraph(sectionSource ?? chapterSource, 0, block.sentences.length - 1, 'paragraph-1')
  } else {
    let cursor = 0
    let paragraphIndex = 1
    for (const source of paragraphSources) {
      if (source.start > cursor) {
        addParagraph(undefined, cursor, source.start - 1, `paragraph-gap-${paragraphIndex}`)
        paragraphIndex += 1
      }
      const start = Math.max(source.start, cursor)
      const end = Math.max(start, source.end)
      if (start < block.sentences.length && end >= cursor) {
        addParagraph(source.node, start, Math.min(end, block.sentences.length - 1), `paragraph-${paragraphIndex}`)
        paragraphIndex += 1
        cursor = Math.min(end, block.sentences.length - 1) + 1
      }
      if (cursor >= block.sentences.length) break
    }
    if (cursor < block.sentences.length) {
      addParagraph(undefined, cursor, block.sentences.length - 1, `paragraph-gap-${paragraphIndex}`)
    }
  }

  return {
    blockId: typeof value.blockId === 'string' ? value.blockId : block.blockId,
    nodes: repairedNodes,
    coveredSentenceIds: block.sentences.map((sentence) => sentence.id),
  }
}

export function normalizeStage2BlockOutputCandidate(value: unknown, block?: Stage2InputBlock): unknown {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return value
  const topLevelKeys = Object.keys(value)
  const hasUnexpectedTopLevelKeys = topLevelKeys.some((key) => !['blockId', 'nodes', 'coveredSentenceIds'].includes(key))
  const nodes = value.nodes.map((rawNode) => {
    if (!isRecord(rawNode)) return rawNode
    const normalized: Record<string, unknown> = { ...rawNode }
    if (normalized.parentId === undefined && typeof normalized.parent === 'string') normalized.parentId = normalized.parent
    delete normalized.parent
    if (normalized.kind === undefined && typeof normalized.nodeType === 'string') normalized.kind = normalized.nodeType
    delete normalized.nodeType
    if (normalized.startSentenceId === undefined && typeof normalized.start_sentence_id === 'string') {
      normalized.startSentenceId = normalized.start_sentence_id
    }
    if (normalized.endSentenceId === undefined && typeof normalized.end_sentence_id === 'string') {
      normalized.endSentenceId = normalized.end_sentence_id
    }
    delete normalized.start_sentence_id
    delete normalized.end_sentence_id
    const paragraphType = normalizeParagraphType(normalized.type) ?? normalizeParagraphType(normalized.paragraphType)
    delete normalized.paragraphType
    const kind = normalizeKind(normalized.kind, paragraphType)
    if (kind) normalized.kind = kind
    if (kind === 'paragraph') {
      normalized.type = paragraphType ?? 'concept'
    } else {
      delete normalized.type
    }
    return normalized
  })

  let currentChapterId: string | null = null
  let currentSectionId: string | null = null
  for (const node of nodes) {
    if (!isRecord(node) || typeof node.id !== 'string') continue
    if (node.kind === 'chapter') {
      node.parentId = null
      currentChapterId = node.id
      currentSectionId = null
    } else if (node.kind === 'section') {
      if (typeof node.parentId !== 'string' && currentChapterId) node.parentId = currentChapterId
      currentSectionId = node.id
    } else if (node.kind === 'paragraph') {
      if (typeof node.parentId !== 'string' && currentSectionId) node.parentId = currentSectionId
    }
  }

  const normalized = { ...value, nodes }
  if (!block) return normalized
  expandParentRanges(nodes, block)
  if (!hasUnexpectedTopLevelKeys && validateStage2BlockOutput(block, normalized).length > 0) {
    return repairStage2BlockOutputCandidate(value, nodes.filter(isRecord), block)
  }
  return normalized
}
function expandParentRanges(nodes: unknown[], block: Stage2InputBlock): void {
  const sentenceIndex = new Map(block.sentences.map((sentence, index) => [sentence.id, index]))
  const nodeById = new Map<string, Record<string, unknown>>()
  for (const node of nodes) {
    if (isRecord(node) && typeof node.id === 'string') nodeById.set(node.id, node)
  }
  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const child = nodes[index]
      if (!isRecord(child) || typeof child.parentId !== 'string') continue
      const parent = nodeById.get(child.parentId)
      if (!parent) continue
      const childStart = sentenceIndex.get(child.startSentenceId as string)
      const childEnd = sentenceIndex.get(child.endSentenceId as string)
      const parentStart = sentenceIndex.get(parent.startSentenceId as string)
      const parentEnd = sentenceIndex.get(parent.endSentenceId as string)
      if (childStart !== undefined && (parentStart === undefined || childStart < parentStart)) {
        parent.startSentenceId = child.startSentenceId
      }
      if (childEnd !== undefined && (parentEnd === undefined || childEnd > parentEnd)) {
        parent.endSentenceId = child.endSentenceId
      }
    }
  }
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