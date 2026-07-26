import type { LlmSettings } from '@/llm/types'
import { callStage2, LlmHttpError, redactSecret } from '@/llm/client'
import {
  getImportCheckpoint, saveImportCheckpoint,
  type Database,
} from '@/models/database'
import type { Node, Sentence, Video } from '@/models/types'
import { estimateStage2SentenceTokens } from '@/pipeline/long-video'
import {
  normalizeStage2BlockOutputCandidate, parseStage2BlockOutput, validateStage2BlockOutput,
  type Stage2BlockOutput, type Stage2InputBlock,
} from '@/pipeline/stage2-contract'

const DEFAULT_MAX_BLOCK_TOKENS = 4_000
const MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 500
const RETRY_MAX_DELAY_MS = 5_000
const QWEN_MODEL = 'qwen3.5-omni-flash'
const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

export const STAGE2_BLOCK_SYSTEM_PROMPT = `Return JSON structure metadata only. Do not return transcript body text.
The exact object keys are blockId, nodes, coveredSentenceIds. Each node contains only id, parentId,
kind, title, optional paragraph type, startSentenceId and endSentenceId. Preserve immutable sentence IDs.
Every sentence must be covered exactly once. Node IDs must begin with the supplied blockId followed by :node:.`




export type Stage2ModelCaller = (
  prompt: string,
  input: string,
  settings: LlmSettings,
  signal?: AbortSignal,
) => Promise<unknown>

export interface RunStage2StageInput {
  video: Video
  sentences: Sentence[]
  settings: LlmSettings
  db: Database
  signal?: AbortSignal
  maxBlockTokens?: number
  callStage2?: Stage2ModelCaller
}

export interface RunStage2StageResult {
  nodes: Node[]
  sentences: Sentence[]
  blockOutputs: Stage2BlockOutput[]
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function sentenceIdentity(videoId: string, sentences: readonly Sentence[]): string {
  return [videoId, ...sentences.map((sentence) => (
    `${sentence.id}:${sentence.startTime}:${sentence.endTime}`
  ))].join('|')
}

export function buildStage2Blocks(
  videoId: string,
  sentences: readonly Sentence[],
  maxBlockTokens = DEFAULT_MAX_BLOCK_TOKENS,
): Stage2InputBlock[] {
  if (!Number.isFinite(maxBlockTokens) || maxBlockTokens <= 0) {
    throw new Error('Stage2 maxBlockTokens must be a positive finite number')
  }
  if (sentences.length === 0) throw new Error('Stage2 requires nonempty ASR sentences')
  const blocks: Stage2InputBlock[] = []
  let current: Sentence[] = []
  let currentTokens = 0
  const flush = (): void => {
    if (current.length === 0) return
    const first = current[0].id
    const last = current.at(-1)!.id
    const hash = stableHash(sentenceIdentity(videoId, current))
    blocks.push({
      blockId: `stage2:${encodeURIComponent(videoId)}:${first}:${last}:${hash}`,
      videoId,
      sentences: [...current],
    })
    current = []
    currentTokens = 0
  }
  for (const sentence of sentences) {
    const tokens = estimateStage2SentenceTokens(sentence)
    if (tokens > maxBlockTokens) {
      throw new Error(`Sentence "${sentence.id}" exceeds the Stage2 token budget (${tokens} > ${maxBlockTokens})`)
    }
    if (current.length > 0 && currentTokens + tokens > maxBlockTokens) flush()
    current.push(sentence)
    currentTokens += tokens
  }
  flush()
  return blocks
}

export function buildMergeBlockId(videoId: string, sentences: readonly Sentence[]): string {
  return `stage2-merge:${encodeURIComponent(videoId)}:${stableHash(sentenceIdentity(videoId, sentences))}`
}

function retryDelayMs(attempt: number): number {
  const base = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1))
  const jitter = Math.floor(base * 0.2 * Math.random())
  return base + jitter
}

async function waitBeforeRetry(attempt: number, signal?: AbortSignal): Promise<void> {
  const delayMs = retryDelayMs(attempt)
  if (delayMs <= 0) return
  if (signal?.aborted) throw new DOMException('Stage2 cancelled', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      if (timeout !== undefined) clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      cleanup()
      reject(new DOMException('Stage2 cancelled', 'AbortError'))
    }
    timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Stage2 cancelled', 'AbortError')
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted)
    || (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError')
}

async function requestValidatedOutput(
  caller: Stage2ModelCaller,
  prompt: string,
  payload: string,
  settings: LlmSettings,
  signal: AbortSignal | undefined,
  block: Stage2InputBlock,
  existingNodeIds: ReadonlySet<string>,
): Promise<Stage2BlockOutput> {
  let lastValidationErrors: string[] = []
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal)
    try {
      const value = await caller(prompt, payload, settings, signal)
      throwIfAborted(signal)
      const normalized = normalizeStage2BlockOutputCandidate(value, block)
      const validationErrors = validateStage2BlockOutput(block, normalized, existingNodeIds)
      const parsed = parseStage2BlockOutput(normalized)
      if (parsed && validationErrors.length === 0) return parsed
      lastValidationErrors = validationErrors
      lastError = undefined
    } catch (error) {
      if (isCancellation(error, signal)) throw error
      if (error instanceof LlmHttpError && !error.retryable) throw error
      lastValidationErrors = []
      lastError = error
      if (error instanceof LlmHttpError && error.retryable && attempt < MAX_ATTEMPTS) {
        await waitBeforeRetry(attempt, signal)
      }
    }
  }
  if (lastValidationErrors.length > 0) {
    throw new Error(`Qwen returned invalid structured output after 3 attempts: ${lastValidationErrors.join('; ')}`)
  }
  if (lastError instanceof Error) {
    const redacted = redactSecret(lastError.message, [settings.apiKey])
    if (redacted === lastError.message) throw lastError
    const sanitized = new Error(redacted)
    sanitized.name = lastError.name
    throw sanitized
  }
  throw new Error(redactSecret(String(lastError), [settings.apiKey]))
}

function validateInputSettings(settings: LlmSettings): void {
  if (!settings.apiKey.trim()) throw new Error('Qwen API key is required')
  if (settings.model !== QWEN_MODEL) throw new Error(`Qwen model must be ${QWEN_MODEL}`)
  if (settings.baseUrl.replace(/\/+$/, '') !== DASHSCOPE_BASE_URL) {
    throw new Error(`Qwen base URL must be ${DASHSCOPE_BASE_URL}`)
  }
}

function checkpointOutputs(value: unknown): Stage2BlockOutput[] {
  return Array.isArray(value)
    ? value.filter((item): item is Stage2BlockOutput => parseStage2BlockOutput(item) !== null)
    : []
}

function deterministicMergeOutputs(
  videoId: string,
  originalSentences: readonly Sentence[],
  outputs: readonly Stage2BlockOutput[],
): Stage2BlockOutput {
  const blockId = buildMergeBlockId(videoId, originalSentences)
  const sentenceIndex = new Map(originalSentences.map((sentence, index) => [sentence.id, index]))
  const first = originalSentences[0].id
  const last = originalSentences.at(-1)!.id
  const nodes: Stage2BlockOutput['nodes'] = []
  const rootId = `${blockId}:node:chapter`
  nodes.push({
    id: rootId,
    parentId: null,
    kind: 'chapter',
    title: 'Imported lecture',
    startSentenceId: first,
    endSentenceId: last,
  })

  outputs.forEach((output, blockIndex) => {
    const orderedParagraphs = output.nodes
      .filter((node) => node.kind === 'paragraph')
      .sort((left, right) => (sentenceIndex.get(left.startSentenceId) ?? 0) - (sentenceIndex.get(right.startSentenceId) ?? 0))
    if (orderedParagraphs.length === 0) return
    const sourceHeading = output.nodes.find((node) => node.kind === 'section')
      ?? output.nodes.find((node) => node.kind === 'chapter')
      ?? orderedParagraphs[0]
    const sectionId = `${blockId}:node:block-${blockIndex + 1}-section`
    nodes.push({
      id: sectionId,
      parentId: rootId,
      kind: 'section',
      title: sourceHeading.title,
      startSentenceId: orderedParagraphs[0].startSentenceId,
      endSentenceId: orderedParagraphs.at(-1)!.endSentenceId,
    })
    orderedParagraphs.forEach((paragraph, paragraphIndex) => {
      nodes.push({
        id: `${blockId}:node:block-${blockIndex + 1}-paragraph-${paragraphIndex + 1}`,
        parentId: sectionId,
        kind: 'paragraph',
        title: paragraph.title,
        type: paragraph.type,
        startSentenceId: paragraph.startSentenceId,
        endSentenceId: paragraph.endSentenceId,
      })
    })
  })

  return {
    blockId,
    nodes,
    coveredSentenceIds: originalSentences.map((sentence) => sentence.id),
  }
}

function toEntities(
  videoId: string,
  originalSentences: readonly Sentence[],
  output: Stage2BlockOutput,
): { nodes: Node[]; sentences: Sentence[] } {
  const sentenceIndex = new Map(originalSentences.map((sentence, index) => [sentence.id, index]))
  const assigned = new Map<string, string>()
  for (const node of output.nodes) {
    if (node.kind !== 'paragraph') continue
    const start = sentenceIndex.get(node.startSentenceId)!
    const end = sentenceIndex.get(node.endSentenceId)!
    for (let index = start; index <= end; index += 1) {
      const sentenceId = originalSentences[index].id
      if (assigned.has(sentenceId)) throw new Error(`Stage2 sentence ${sentenceId} was assigned more than once`)
      assigned.set(sentenceId, node.id)
    }
  }
  if (assigned.size !== originalSentences.length) {
    throw new Error('Stage2 final paragraph assignments do not exhaust ASR sentences')
  }
  const nodes: Node[] = output.nodes.map((node, sortOrder) => {
    const start = originalSentences[sentenceIndex.get(node.startSentenceId)!]
    const end = originalSentences[sentenceIndex.get(node.endSentenceId)!]
    return {
      id: node.id,
      videoId,
      parentId: node.parentId,
      kind: node.kind,
      title: node.title,
      type: node.kind === 'paragraph' ? node.type! : null,
      startTime: start.startTime,
      endTime: end.endTime,
      text: null,
      sortOrder,
    }
  })
  const sentences = originalSentences.map((sentence, sortOrder) => ({
    ...sentence,
    nodeId: assigned.get(sentence.id)!,
    sortOrder,
  }))
  return { nodes, sentences }
}

export async function runStage2Stage(input: RunStage2StageInput): Promise<RunStage2StageResult> {
  validateInputSettings(input.settings)
  throwIfAborted(input.signal)
  const blocks = buildStage2Blocks(input.video.id, input.sentences, input.maxBlockTokens)
  const checkpoint = await getImportCheckpoint(input.db, input.video.id)
  const savedById = new Map(
    checkpointOutputs(checkpoint?.completedBlockOutputs).map((output) => [output.blockId, output]),
  )
  const outputs: Stage2BlockOutput[] = []
  const seenNodeIds = new Set<string>()
  const blockCaller = input.callStage2 ?? callStage2

  for (const block of blocks) {
    throwIfAborted(input.signal)
    const saved = savedById.get(block.blockId)
    const savedErrors = saved ? validateStage2BlockOutput(block, saved, seenNodeIds) : ['missing']
    const output = saved && savedErrors.length === 0
      ? saved
      : await requestValidatedOutput(
        blockCaller,
        STAGE2_BLOCK_SYSTEM_PROMPT,
        JSON.stringify({
          blockId: block.blockId,
          videoId: block.videoId,
          sentences: block.sentences.map(({ id, startTime, endTime, text }) => ({ id, startTime, endTime, text })),
        }),
        input.settings,
        input.signal,
        block,
        seenNodeIds,
      )
    outputs.push(output)
    output.nodes.forEach((node) => seenNodeIds.add(node.id))
    await saveImportCheckpoint(input.db, {
      videoId: input.video.id,
      stage: 'stage2',
      completedBlocks: outputs.map((completed) => completed.blockId),
      completedBlockOutputs: outputs,
      updatedAt: Date.now(),
    })
  }

  const finalOutput = outputs.length > 1
    ? deterministicMergeOutputs(input.video.id, input.sentences, outputs)
    : outputs[0]
  const finalBlock: Stage2InputBlock = {
    blockId: finalOutput.blockId,
    videoId: input.video.id,
    sentences: input.sentences,
  }
  const finalErrors = validateStage2BlockOutput(finalBlock, finalOutput)
  if (finalErrors.length > 0) throw new Error(`Stage2 final validation failed: ${finalErrors.join('; ')}`)
  const entities = toEntities(input.video.id, input.sentences, finalOutput)
  return { ...entities, blockOutputs: outputs }
}
