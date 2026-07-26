import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDatabase, getImportCheckpoint, getNodesByVideoId, getSentencesByVideoId,
  getVideoById, insertSentences, insertVideo, mergeImportAtomically, saveImportCheckpoint,
} from '@/models/database'
import type { Database } from '@/models/database'
import type { Node, Sentence, Video } from '@/models/types'
import {
  validateExactSentenceCoverage, validateStage2BlockOutput,
  type Stage2BlockOutput, type Stage2InputBlock,
} from '@/pipeline/stage2-contract'
import { buildMergeBlockId, buildStage2Blocks, runStage2Stage } from '@/pipeline/stage2-runner'
import { callStage2, LlmHttpError, redactSecret } from '@/llm/client'

const video: Video = {
  id: 'video-stage2', title: 'Lecture', source: 'local', filePath: 'C:\\lecture.mp4',
  thumbnail: '', duration: 8, language: 'en', status: 'processing', stage: 'stage2',
  createdAt: 1, position: 0, lastStudiedAt: 1,
}
const sentences: Sentence[] = [
  { id: 's1', nodeId: video.id, text: 'Original one.', startTime: 0, endTime: 2, sortOrder: 0 },
  { id: 's2', nodeId: video.id, text: 'Original two.', startTime: 2, endTime: 4, sortOrder: 1 },
  { id: 's3', nodeId: video.id, text: 'Original three.', startTime: 4, endTime: 6, sortOrder: 2 },
  { id: 's4', nodeId: video.id, text: 'Original four.', startTime: 6, endTime: 8, sortOrder: 3 },
]
const settings = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'configured-secret-value',
  model: 'qwen3.5-omni-flash',
}
function validOutput(block: Stage2InputBlock): Stage2BlockOutput {
  const first = block.sentences[0].id
  const last = block.sentences.at(-1)!.id
  const chapterId = `${block.blockId}:node:chapter`
  const sectionId = `${block.blockId}:node:section`
  return {
    blockId: block.blockId,
    nodes: [
      { id: chapterId, parentId: null, kind: 'chapter', title: 'Chapter', startSentenceId: first, endSentenceId: last },
      { id: sectionId, parentId: chapterId, kind: 'section', title: 'Section', startSentenceId: first, endSentenceId: last },
      { id: `${block.blockId}:node:paragraph`, parentId: sectionId, kind: 'paragraph', title: 'Paragraph', type: 'concept', startSentenceId: first, endSentenceId: last },
    ],
    coveredSentenceIds: block.sentences.map((sentence) => sentence.id),
  }
}

async function stage2Db(): Promise<Database> {
  const db = await createDatabase(':memory:')
  await insertVideo(db, video)
  await insertSentences(db, sentences)
  return db
}

describe('Stage2 contract RED', () => {
  it('reports missing and duplicate sentence IDs', () => {
    const errors = validateExactSentenceCoverage(['s1', 's2'], {
      blockId: 'b1', nodes: [], coveredSentenceIds: ['s1', 's1'],
    })
    expect(errors).toEqual(expect.arrayContaining(['missing sentence s2', 'duplicate sentence s1']))
  })

  it('fails after three malformed model responses', async () => {
    const clientMock = vi.fn().mockResolvedValue('bad')
    await expect(runStage2Stage({
      video, sentences, settings, db: await createDatabase(':memory:'), callStage2: clientMock,
    })).rejects.toThrow('Stage2 model returned invalid structured output after 3 attempts')
    expect(clientMock).toHaveBeenCalledTimes(3)
  })

  it('runs a generic OpenAI-compatible configuration through the production Stage2 path', async () => {
    const genericSettings = {
      baseUrl: 'https://models.example.test/v1',
      apiKey: 'generic-secret',
      model: 'generic-structuring-model',
    }
    const clientMock = vi.fn(async (_prompt, payload) =>
      validOutput(JSON.parse(payload) as Stage2InputBlock))

    await runStage2Stage({
      video,
      sentences,
      settings: genericSettings,
      db: await stage2Db(),
      callStage2: clientMock,
    })

    expect(clientMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      genericSettings,
      undefined,
    )
  })

  it.each([
    ['base URL', { ...settings, baseUrl: '' }],
    ['API key', { ...settings, apiKey: '' }],
    ['name', { ...settings, model: '' }],
  ])('rejects a blank Stage2 model %s before making a request', async (_field, invalidSettings) => {
    const clientMock = vi.fn()

    await expect(runStage2Stage({
      video,
      sentences,
      settings: invalidSettings,
      db: await createDatabase(':memory:'),
      callStage2: clientMock,
    })).rejects.toThrow(/Stage2 model/)

    expect(clientMock).not.toHaveBeenCalled()
  })

  it('rejects a single sentence that exceeds the deterministic token budget before any request', async () => {
    const clientMock = vi.fn()
    await expect(runStage2Stage({
      video, sentences, settings, db: await stage2Db(), maxBlockTokens: 15, callStage2: clientMock,
    })).rejects.toThrow(/s1.*token budget/i)
    expect(clientMock).not.toHaveBeenCalled()
  })
})
describe('Stage2 strict validation', () => {
  it('reports foreign and out-of-order sentence IDs', () => {
    const errors = validateExactSentenceCoverage(['s1', 's2', 's3'], {
      blockId: 'b1', nodes: [], coveredSentenceIds: ['s2', 'foreign', 's1', 's3'],
    })
    expect(errors).toEqual(expect.arrayContaining(['foreign sentence foreign', 'out-of-order sentence s1']))
  })

  it('rejects malformed trees and sentence-boundary ranges', () => {
    const block = buildStage2Blocks(video.id, sentences, 10_000)[0]
    const output = validOutput(block)
    output.nodes[1].parentId = output.nodes[2].id
    output.nodes[2].startSentenceId = 's4'
    output.nodes[2].endSentenceId = 's1'
    const errors = validateStage2BlockOutput(block, output)
    expect(errors.join('\n')).toMatch(/parent|tree/i)
    expect(errors.join('\n')).toMatch(/range|chronological/i)
  })

  it.each(['overlap', 'out-of-order'] as const)('rejects %s sibling chapter ranges', (caseName) => {
    const block = buildStage2Blocks(video.id, sentences, 10_000)[0]
    const output = validOutput(block)
    const chapter = output.nodes[0]
    const section = output.nodes[1]
    const paragraph = output.nodes[2]
    const secondChapterId = `${block.blockId}:node:chapter-2`
    const secondSectionId = `${block.blockId}:node:section-2`
    const secondParagraphId = `${block.blockId}:node:paragraph-2`
    if (caseName === 'overlap') {
      chapter.endSentenceId = 's3'
      section.endSentenceId = 's3'
      paragraph.endSentenceId = 's2'
      output.nodes.push(
        { id: secondChapterId, parentId: null, kind: 'chapter', title: 'Chapter two', startSentenceId: 's2', endSentenceId: 's4' },
        { id: secondSectionId, parentId: secondChapterId, kind: 'section', title: 'Section two', startSentenceId: 's2', endSentenceId: 's4' },
        { id: secondParagraphId, parentId: secondSectionId, kind: 'paragraph', title: 'Paragraph two', type: 'concept', startSentenceId: 's3', endSentenceId: 's4' },
      )
    } else {
      chapter.startSentenceId = 's3'
      section.startSentenceId = 's3'
      paragraph.startSentenceId = 's3'
      output.nodes.push(
        { id: secondChapterId, parentId: null, kind: 'chapter', title: 'Chapter two', startSentenceId: 's1', endSentenceId: 's2' },
        { id: secondSectionId, parentId: secondChapterId, kind: 'section', title: 'Section two', startSentenceId: 's1', endSentenceId: 's2' },
        { id: secondParagraphId, parentId: secondSectionId, kind: 'paragraph', title: 'Paragraph two', type: 'concept', startSentenceId: 's1', endSentenceId: 's2' },
      )
    }
    expect(validateStage2BlockOutput(block, output).join('\n')).toMatch(/sibling.*(overlap|order)/i)
  })
  it('normalizes common Qwen paragraph aliases before strict validation', async () => {
    const block = buildStage2Blocks(video.id, sentences, 10_000)[0]
    const output = validOutput(block) as any
    const section = output.nodes.find((node: any) => node.kind === 'section')
    section.parentId = null
    section.type = 'concept'
    const paragraph = output.nodes.find((node: any) => node.kind === 'paragraph')
    paragraph.parentId = null
    paragraph.kind = 'knowledge_point'
    paragraph.paragraphType = 'concept'
    paragraph.type = 'concept'
    const clientMock = vi.fn().mockResolvedValue(output)

    const result = await runStage2Stage({
      video, sentences, settings, db: await stage2Db(), maxBlockTokens: 10_000, callStage2: clientMock,
    })

    expect(result.nodes.some((node) => node.kind === 'paragraph' && node.type === 'concept')).toBe(true)
    expect(clientMock).toHaveBeenCalledTimes(1)
  })
  it('repairs overlapping Qwen outline nodes into exact paragraph coverage', async () => {
    const block = buildStage2Blocks(video.id, sentences, 10_000)[0]
    const clientMock = vi.fn().mockResolvedValue({
      blockId: block.blockId,
      coveredSentenceIds: ['s1', 's2', 's3', 's4'],
      nodes: [
        {
          id: `${block.blockId}:node:topic`,
          parentId: null,
          kind: 'topic',
          title: 'Signal amplification',
          startSentenceId: 's1',
          endSentenceId: 's4',
        },
        {
          id: `${block.blockId}:node:point-a`,
          parentId: `${block.blockId}:node:topic`,
          kind: 'knowledge_point',
          title: 'Input signal',
          paragraphType: 'concept',
          startSentenceId: 's1',
          endSentenceId: 's3',
        },
        {
          id: `${block.blockId}:node:point-b`,
          parentId: `${block.blockId}:node:topic`,
          kind: 'knowledge_point',
          title: 'Amplifier output',
          type: 'example',
          startSentenceId: 's3',
          endSentenceId: 's4',
        },
      ],
    })

    const result = await runStage2Stage({
      video, sentences, settings, db: await stage2Db(), maxBlockTokens: 10_000, callStage2: clientMock,
    })

    expect(result.sentences.map((sentence) => sentence.nodeId)).toHaveLength(4)
    expect(new Set(result.sentences.map((sentence) => sentence.id))).toEqual(new Set(['s1', 's2', 's3', 's4']))
    expect(result.nodes.filter((node) => node.kind === 'paragraph').map((node) => node.title)).toEqual([
      'Input signal',
      'Amplifier output',
    ])
    expect(clientMock).toHaveBeenCalledTimes(1)
  })
  it('rejects generated transcript body fields as malformed output', async () => {
    const block = buildStage2Blocks(video.id, sentences, 10_000)[0]
    const clientMock = vi.fn().mockResolvedValue({ ...validOutput(block), bodyText: 'generated text' })
    await expect(runStage2Stage({
      video, sentences, settings, db: await stage2Db(), maxBlockTokens: 10_000, callStage2: clientMock,
    })).rejects.toThrow('Stage2 model returned invalid structured output after 3 attempts')
    expect(clientMock).toHaveBeenCalledTimes(3)
  })
})

describe('Stage2 retry, cancellation and HTTP safety', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('does not retry authentication errors', async () => {
    const clientMock = vi.fn().mockRejectedValue(new LlmHttpError(401, 'unauthorized', false))
    await expect(runStage2Stage({
      video, sentences, settings, db: await stage2Db(), maxBlockTokens: 10_000, callStage2: clientMock,
    })).rejects.toThrow(/401|unauthorized/i)
    expect(clientMock).toHaveBeenCalledTimes(1)
  })

  it('redacts a configured key when exhausting a transient caller error', async () => {
    const original = new Error(`transport failed for ${settings.apiKey}`)
    const clientMock = vi.fn().mockRejectedValue(original)
    let received: unknown
    try {
      await runStage2Stage({
        video, sentences, settings, db: await stage2Db(), maxBlockTokens: 10_000, callStage2: clientMock,
      })
    } catch (error) {
      received = error
    }
    expect(clientMock).toHaveBeenCalledTimes(3)
    expect(received).not.toBe(original)
    expect(String(received)).not.toContain(settings.apiKey)
    expect(String(received)).toContain('[REDACTED]')
  })
  it('surfaces the final retryable transport error after an earlier malformed response', async () => {
    const finalError = new LlmHttpError(503, 'last transport failure', true)
    const clientMock = vi.fn()
      .mockResolvedValueOnce('bad')
      .mockRejectedValueOnce(new LlmHttpError(503, 'middle transport failure', true))
      .mockRejectedValueOnce(finalError)
    await expect(runStage2Stage({
      video, sentences, settings, db: await stage2Db(), maxBlockTokens: 10_000, callStage2: clientMock,
    })).rejects.toBe(finalError)
    expect(clientMock).toHaveBeenCalledTimes(3)
  })

  it('retries 429 and 5xx responses before succeeding', async () => {
    const block = buildStage2Blocks(video.id, sentences, 10_000)[0]
    const clientMock = vi.fn()
      .mockRejectedValueOnce(new LlmHttpError(429, 'busy', true))
      .mockRejectedValueOnce(new LlmHttpError(503, 'unavailable', true))
      .mockResolvedValueOnce(validOutput(block))
    const result = await runStage2Stage({
      video, sentences, settings, db: await stage2Db(), maxBlockTokens: 10_000, callStage2: clientMock,
    })
    expect(clientMock).toHaveBeenCalledTimes(3)
    expect(result.sentences.map((sentence) => sentence.id)).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('stops retrying when the active request aborts', async () => {
    const controller = new AbortController()
    const clientMock = vi.fn().mockImplementation(async () => {
      controller.abort()
      throw new DOMException('cancelled', 'AbortError')
    })
    await expect(runStage2Stage({
      video, sentences, settings, db: await stage2Db(), signal: controller.signal,
      maxBlockTokens: 10_000, callStage2: clientMock,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(clientMock).toHaveBeenCalledTimes(1)
  })

  it('uses the configured endpoint/model, JSON mode, immutable rows and AbortSignal', async () => {
    const block = buildStage2Blocks(video.id, sentences, 10_000)[0]
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validOutput(block)) } }],
    }), { status: 200 }))
    const controller = new AbortController()
    await callStage2('Return structure metadata as JSON only.', JSON.stringify(block), settings, controller.signal)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(init?.signal).toBe(controller.signal)
    const body = JSON.parse(String(init?.body))
    expect(body.model).toBe('qwen3.5-omni-flash')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain('JSON')
    expect(body.messages[1].content).toContain('Original one.')
    expect(body.messages[1].content).toContain('"id":"s1"')
    expect(body.messages[1].content).toContain('"startTime":0')
  })

  it('parses fenced JSON returned by compatible providers', async () => {
    const block = buildStage2Blocks(video.id, sentences, 10_000)[0]
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: `Here is the JSON:\n\n\`\`\`json\n${JSON.stringify(validOutput(block))}\n\`\`\`` } }],
    }), { status: 200 }))

    const result = await callStage2('Return structure metadata as JSON only.', JSON.stringify(block), settings)

    expect(result).toMatchObject(validOutput(block))
  })
  it('redacts non-2xx body secrets and the configured key', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      'Authorization: Bearer bearer-secret; sk-live-leak; configured-secret-value',
      { status: 500, statusText: 'Internal Server Error' },
    ))
    let message = ''
    try { await callStage2('JSON only', '{}', settings) } catch (error) { message = String(error) }
    expect(message).toContain('[REDACTED]')
    expect(message).not.toContain('bearer-secret')
    expect(message).not.toContain('sk-live-leak')
    expect(message).not.toContain('configured-secret-value')
    expect(redactSecret('Bearer abc sk-test configured-secret-value', [settings.apiKey]))
      .toBe('Bearer [REDACTED] [REDACTED] [REDACTED]')
  })

  it('deterministically merges multi-block outputs without a final Qwen request', async () => {
    const blocks = buildStage2Blocks(video.id, sentences, 32)
    expect(blocks).toHaveLength(2)
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validOutput(blocks[0])) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validOutput(blocks[1])) } }] }), { status: 200 }))

    const result = await runStage2Stage({ video, sentences, settings, db: await stage2Db(), maxBlockTokens: 32 })

    expect(fetch).toHaveBeenCalledTimes(2)
    const mergeBlockId = buildMergeBlockId(video.id, sentences)
    expect(result.nodes.every((node) => node.id.startsWith(`${mergeBlockId}:node:`))).toBe(true)
    expect(result.sentences.map(({ id, text }) => ({ id, text }))).toEqual(
      sentences.map(({ id, text }) => ({ id, text })),
    )
  })
})
describe('Stage2 checkpoint recovery and global coverage', () => {
  it('skips a valid output, requests missing blocks, and ignores ID-only checkpoints', async () => {
    const db = await stage2Db()
    const blocks = buildStage2Blocks(video.id, sentences, 20)
    expect(blocks.length).toBeGreaterThan(1)
    await saveImportCheckpoint(db, {
      videoId: video.id, stage: 'stage2', completedBlocks: [blocks[0].blockId],
      completedBlockOutputs: [validOutput(blocks[0])], updatedAt: 1,
    })
    const callBlock = vi.fn(async (_prompt, input) => validOutput(JSON.parse(input)))
    const result = await runStage2Stage({
      video, sentences, settings, db, maxBlockTokens: 20, callStage2: callBlock,
    })
    expect(callBlock).toHaveBeenCalledTimes(blocks.length - 1)
    expect(callBlock.mock.calls.map((call) => JSON.parse(call[1]).blockId)).not.toContain(blocks[0].blockId)
    expect(result.sentences.map((sentence) => sentence.id)).toEqual(['s1', 's2', 's3', 's4'])
    expect((await getImportCheckpoint(db, video.id))?.completedBlockOutputs).toHaveLength(blocks.length)

    const oldDb = await stage2Db()
    await saveImportCheckpoint(oldDb, {
      videoId: video.id, stage: 'stage2', completedBlocks: blocks.map((block) => block.blockId), updatedAt: 1,
    })
    const oldCalls = vi.fn(async (_prompt, input) => validOutput(JSON.parse(input)))
    await runStage2Stage({
      video, sentences, settings, db: oldDb, maxBlockTokens: 20, callStage2: oldCalls,
    })
    expect(oldCalls).toHaveBeenCalledTimes(blocks.length)
  })

  it('reprocesses an invalid checkpoint output', async () => {
    const db = await stage2Db()
    const block = buildStage2Blocks(video.id, sentences, 10_000)[0]
    const invalid = validOutput(block)
    invalid.coveredSentenceIds = ['s1']
    await saveImportCheckpoint(db, {
      videoId: video.id, stage: 'stage2', completedBlocks: [block.blockId],
      completedBlockOutputs: [invalid], updatedAt: 1,
    })
    const callBlock = vi.fn().mockResolvedValue(validOutput(block))
    await runStage2Stage({ video, sentences, settings, db, maxBlockTokens: 10_000, callStage2: callBlock })
    expect(callBlock).toHaveBeenCalledTimes(1)
  })

  it('deterministically merges compact outlines and preserves original ASR text exactly once', async () => {
    const blocks = buildStage2Blocks(video.id, sentences, 20)
    const result = await runStage2Stage({
      video, sentences, settings, db: await stage2Db(), maxBlockTokens: 20,
      callStage2: vi.fn(async (_prompt, input) => validOutput(JSON.parse(input))),
    })
    expect(result.sentences.map(({ id, text }) => ({ id, text }))).toEqual(
      sentences.map(({ id, text }) => ({ id, text })),
    )
    expect(new Set(result.sentences.map((sentence) => sentence.id)).size).toBe(sentences.length)
  })

  it('preserves validated outputs when cancellation stops a later block', async () => {
    const db = await stage2Db()
    const blocks = buildStage2Blocks(video.id, sentences, 20)
    const controller = new AbortController()
    const callBlock = vi.fn(async (_prompt, input) => {
      const block = JSON.parse(input) as Stage2InputBlock
      if (block.blockId === blocks[1].blockId) {
        controller.abort()
        throw new DOMException('cancelled', 'AbortError')
      }
      return validOutput(block)
    })
    await expect(runStage2Stage({
      video, sentences, settings, db, signal: controller.signal, maxBlockTokens: 20, callStage2: callBlock,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect((await getImportCheckpoint(db, video.id))?.completedBlockOutputs).toEqual([validOutput(blocks[0])])
  })
})

describe('atomic merge defense in depth (MemoryDatabase parity)', () => {
  async function mergingDb(): Promise<Database> {
    const db = await createDatabase(':memory:')
    await insertVideo(db, { ...video, stage: 'merging' })
    await insertSentences(db, sentences.slice(0, 2))
    return db
  }
  const validNodes: Node[] = [
    { id: 'chapter', videoId: video.id, parentId: null, kind: 'chapter', title: 'C', type: null, startTime: 0, endTime: 4, text: null, sortOrder: 0 },
    { id: 'section', videoId: video.id, parentId: 'chapter', kind: 'section', title: 'S', type: null, startTime: 0, endTime: 4, text: null, sortOrder: 1 },
    { id: 'paragraph', videoId: video.id, parentId: 'section', kind: 'paragraph', title: 'P', type: 'concept', startTime: 0, endTime: 4, text: null, sortOrder: 2 },
  ]

  it('rolls back nodes when a submitted parent is missing', async () => {
    const db = await mergingDb()
    const invalidNodes = validNodes.map((node) => ({ ...node }))
    invalidNodes[2].parentId = 'foreign-parent'
    await expect(mergeImportAtomically(db, video.id, invalidNodes, sentences.slice(0, 2).map(
      (sentence, index) => ({ ...sentence, nodeId: 'paragraph', sortOrder: index }),
    ))).rejects.toThrow(/parent/i)
    expect(await getNodesByVideoId(db, video.id)).toEqual([])
    expect(await getVideoById(db, video.id)).toMatchObject({ status: 'processing', stage: 'merging' })
  })

  it.each([['missing', [sentences[0]]], ['duplicate', [sentences[0], sentences[0]]]])(
    'rolls back nodes when assignments are %s', async (_case, assigned) => {
      const db = await mergingDb()
      await expect(mergeImportAtomically(db, video.id, validNodes, assigned.map(
        (sentence, index) => ({ ...sentence, nodeId: 'paragraph', sortOrder: index }),
      ))).rejects.toThrow(/assignment|sentence/i)
      expect(await getNodesByVideoId(db, video.id)).toEqual([])
      expect(await getSentencesByVideoId(db, video.id)).toEqual(sentences.slice(0, 2))
      expect(await getVideoById(db, video.id)).toMatchObject({ status: 'processing', stage: 'merging' })
    },
  )
})
