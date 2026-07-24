import type { ChatMessage } from '@/llm/types'
import type { Node, Sentence } from '@/models/types'

export interface AssistantSource {
  sentenceId: string
  nodeId: string
  startTime: number
  endTime: number
  text: string
}

export interface AssistantContextInput {
  nodes: Node[]
  sentences: Sentence[]
  playPosition: number
  question: string
  history: Array<Pick<ChatMessage, 'role' | 'content'>>
  scope?: 'nearby' | 'paragraph'
}

export interface AssistantContext {
  systemPrompt: string
  history: Array<Pick<ChatMessage, 'role' | 'content'>>
  sources: AssistantSource[]
}

const RECENT_HISTORY_LIMIT = 6
const NEARBY_SENTENCE_LIMIT = 2
const CROSS_CHAPTER_QUERY = /compare|across|previous|next|earlier|later|contrast|对比|比较|跨章节|前面|前文|之前|上节|上一节|后面|之后|下节|下一节/i
const HAN_TEXT = /[\u3400-\u9fff]/

function chapterIdFor(nodeId: string, nodesById: Map<string, Node>): string | null {
  let node = nodesById.get(nodeId)
  while (node) {
    if (node.kind === 'chapter') return node.id
    node = node.parentId ? nodesById.get(node.parentId) : undefined
  }
  return null
}

function currentSentence(sentences: Sentence[], position: number): Sentence | undefined {
  return sentences.find((sentence) => sentence.startTime <= position && position < sentence.endTime)
    ?? [...sentences].sort((left, right) => Math.abs(left.startTime - position) - Math.abs(right.startTime - position))[0]
}

function queryTerms(question: string): string[] {
  const lowerQuestion = question.toLocaleLowerCase()
  const latinTerms = lowerQuestion
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 4 && !HAN_TEXT.test(term))
  const hanTerms: string[] = []
  for (const match of lowerQuestion.matchAll(/[\u3400-\u9fff]+/g)) {
    const block = match[0]
    if (block.length === 1) {
      hanTerms.push(block)
      continue
    }
    for (let index = 0; index < block.length - 1; index += 1) {
      hanTerms.push(block.slice(index, index + 2))
    }
    if (block.length >= 3) hanTerms.push(block)
  }
  return [...new Set([...latinTerms, ...hanTerms])]
}

function sourceFor(sentence: Sentence): AssistantSource {
  return { sentenceId: sentence.id, nodeId: sentence.nodeId, startTime: sentence.startTime, endTime: sentence.endTime, text: sentence.text }
}

export function buildAssistantContext(input: AssistantContextInput): AssistantContext {
  const ordered = [...input.sentences].sort((left, right) => left.sortOrder - right.sortOrder)
  const active = currentSentence(ordered, input.playPosition)
  if (!active) {
    return {
      systemPrompt: 'You are a video learning assistant. There is no completed transcript for the current video yet. Do not invent citations.',
      history: input.history.slice(-RECENT_HISTORY_LIMIT),
      sources: [],
    }
  }

  const nodesById = new Map(input.nodes.map((node) => [node.id, node]))
  const activeChapterId = chapterIdFor(active.nodeId, nodesById)
  const activeIndex = ordered.findIndex((sentence) => sentence.id === active.id)
  const paragraphSentences = ordered.filter((sentence) => sentence.nodeId === active.nodeId)
  const nearby = ordered.slice(Math.max(0, activeIndex - NEARBY_SENTENCE_LIMIT), activeIndex + NEARBY_SENTENCE_LIMIT + 1)
    .filter((sentence) => sentence.nodeId === active.nodeId)
  const scopeLabel = input.scope === 'paragraph' ? 'Current paragraph transcript:' : 'Nearby transcript:'
  const sources = input.scope === 'paragraph'
    ? (paragraphSentences.length > 0 ? paragraphSentences : [active])
    : (nearby.length > 0 ? nearby : [active])

  if (CROSS_CHAPTER_QUERY.test(input.question)) {
    const terms = queryTerms(input.question)
    const crossChapterCandidates = ordered.filter((sentence) => chapterIdFor(sentence.nodeId, nodesById) !== activeChapterId)
    const matching = terms.length > 0
      ? crossChapterCandidates.filter((sentence) => {
        const text = sentence.text.toLocaleLowerCase()
        return terms.some((term) => text.includes(term))
      })
      : []
    sources.push(...(matching.length > 0 ? matching : crossChapterCandidates).slice(0, 3))
  }

  const uniqueSources = [...new Map(sources.map((sentence) => [sentence.id, sourceFor(sentence)])).values()]
  const currentParagraph = nodesById.get(active.nodeId)
  const sourceLines = uniqueSources.map((source) => `- sentence:${source.sentenceId} @ ${source.startTime.toFixed(3)}-${source.endTime.toFixed(3)} (node:${source.nodeId}): ${source.text}`)
  const crossChapterSources = uniqueSources.filter((source) => chapterIdFor(source.nodeId, nodesById) !== activeChapterId)
  const crossChapterSection = crossChapterSources.length > 0 ? `\nCross-chapter retrieval:\n${crossChapterSources.map((source) => `- sentence:${source.sentenceId} @ ${source.startTime.toFixed(3)}-${source.endTime.toFixed(3)}`).join('\n')}` : ''

  return {
    systemPrompt: [
      'You are a video learning assistant. Answer only from the supplied transcript context.',
      `Current sentence: sentence:${active.id} @ ${active.startTime.toFixed(3)}-${active.endTime.toFixed(3)}.`,
      `Current paragraph: ${currentParagraph?.title ?? active.nodeId} (node:${active.nodeId}).`,
      'Cite factual claims using the exact format [sentence:<id> @ <start>-<end>]. Do not invent source IDs or timestamps.',
      scopeLabel,
      ...sourceLines,
    ].join('\n') + crossChapterSection,
    history: input.history.slice(-RECENT_HISTORY_LIMIT),
    sources: uniqueSources,
  }
}
