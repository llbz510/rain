import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const validateScript = join(repoRoot, 'scripts', 'validate-evidence.ps1')
const videoBytes = Buffer.from('rain evidence validator unit-test video fixture')
const testVideoHash = createHash('sha256').update(videoBytes).digest('hex').toUpperCase()

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function runValidator(manifestPath: string, expectedVideoHash = testVideoHash): void {
  execFileSync(
    'powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-File', validateScript, '-EvidenceManifest', manifestPath, '-ExpectedVideoSha256', expectedVideoHash],
    { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' },
  )
}

function createEvidence(overrides: Record<string, unknown> = {}, cleanTranscript = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'rain-evidence-validator-'))
  mkdirSync(join(dir, 'screenshots'))
  mkdirSync(join(dir, 'logs'))
  const videoPath = join(dir, 'video.mp4')
  writeFileSync(videoPath, videoBytes)
  const sentence = cleanTranscript
    ? { id: 'whisper-segment-1', startTime: 0, endTime: 1, text: 'signal gain increases after amplification.' }
    : { id: 'demo_s_1', startTime: 0, endTime: 1, text: 'This is sentence 1.' }
  const events = [
    { at: '2026-07-19T00:00:00.000Z', event: 'start_import' },
    { at: '2026-07-19T00:00:01.000Z', event: 'cancel_import' },
    { at: '2026-07-19T00:00:02.000Z', event: 'import_cancelled' },
    { at: '2026-07-19T00:00:03.000Z', event: 'retry_import' },
    { at: '2026-07-19T00:00:04.000Z', event: 'import_complete' },
  ]

  writeJson(join(dir, 'transcript.json'), {
    detectedLanguage: 'zh',
    sentences: [sentence],
  })
  writeJson(join(dir, 'qwen-blocks.json'), [
    {
      blockId: 'live:block:0',
      nodes: [
        { id: 'chapter-1', kind: 'chapter', title: 'Chapter', parentId: null, startSentenceId: sentence.id, endSentenceId: sentence.id },
        { id: 'section-1', kind: 'section', title: 'Section', parentId: 'chapter-1', startSentenceId: sentence.id, endSentenceId: sentence.id },
        { id: 'paragraph-1', kind: 'paragraph', title: 'Paragraph', type: 'concept', parentId: 'section-1', startSentenceId: sentence.id, endSentenceId: sentence.id },
      ],
      coveredSentenceIds: [sentence.id],
    },
  ])
  writeJson(join(dir, 'database-summary.json'), {
    videoId: 'real-local-video',
    status: 'ready',
    stage: 'ready',
    sentenceCount: 1,
    nodeCount: 3,
    qwenBlockCount: 1,
    evidenceSource: 'rain-app-query',
    queriedAt: '2026-07-19T00:00:00.000Z',
  })
  writeJson(join(dir, 'probe.json'), { format: { duration: '1.0' }, streams: [{ codec_type: 'video' }] })
  writeJson(join(dir, 'cancellation-proof.json'), { result: 'passed', source: 'rain-app-automation', events: ['start_import', 'cancel_import', 'import_cancelled'] })
  writeJson(join(dir, 'restart-proof.json'), { result: 'passed', source: 'rain-app-automation', events: ['start_import', 'import_cancelled', 'retry_import', 'import_complete'] })
  writeJson(join(dir, 'app-events.json'), events)
  writeFileSync(join(dir, 'screenshots', 'study-ready.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/eylmE8AAAAASUVORK5CYII=', 'base64'))
  writeFileSync(join(dir, 'logs', 'tauri-driver.err.log'), 'whisper_backend_init_gpu: using CUDA0 backend\nwhisper_init_from_file_with_params_no_state: use gpu = 1\n', 'utf8')

  const manifest = {
    generatedAt: '2026-07-19T00:00:00.000Z',
    video: { path: videoPath, sha256: testVideoHash, probe: 'probe.json' },
    runtime: {
      whisperBackend: 'cpu',
      whisperModel: 'ggml-large-v3.bin',
      qwenModel: 'qwen3.5-omni-flash',
      qwenBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
    timings: { asrSeconds: 1, qwenSeconds: 1 },
    asr: {
      detectedLanguage: 'zh',
      sentenceCount: 1,
      manualReviewSamples: [sentence],
    },
    qwen: { blockCount: 1 },
    validation: { sentenceCoverage: 'exactly-once', noDemoSentences: true, noDemoIds: true },
    cancellation: { result: 'passed', artifact: 'cancellation-proof.json' },
    restart: { result: 'passed', artifact: 'restart-proof.json' },
    secretsDetected: false,
    artifacts: {
      transcript: 'transcript.json',
      qwenBlocks: 'qwen-blocks.json',
      database: 'database-summary.json',
      probe: 'probe.json',
      screenshots: ['screenshots/study-ready.png'],
      appEvents: 'app-events.json',
    },
    ...overrides,
  }
  const manifestPath = join(dir, 'manifest.json')
  writeJson(manifestPath, manifest)
  return manifestPath
}

describe('evidence validator', () => {
  it('accepts clean evidence shaped like real Stage2BlockOutput artifacts', () => {
    const manifestPath = createEvidence({}, true)

    expect(() => runValidator(manifestPath)).not.toThrow()
  })

  it('rejects demo transcript text and ids even when the manifest claims they are clean', () => {
    const manifestPath = createEvidence()

    expect(() => runValidator(manifestPath)).toThrow(/demo/i)
  })

  it('rejects mojibake transcript text', () => {
    const manifestPath = createEvidence({}, true)
    const dir = dirname(manifestPath)
    const sentence = { id: 'whisper-segment-1', startTime: 0, endTime: 1, text: '\u951f\u65a4\u62f7 text' }
    writeJson(join(dir, 'transcript.json'), { detectedLanguage: 'zh', sentences: [sentence] })
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.asr.manualReviewSamples = [sentence]
    writeJson(manifestPath, manifest)

    expect(() => runValidator(manifestPath)).toThrow(/mojibake/i)
  })

  it('rejects cancellation and restart claims that do not point to proof artifacts', () => {
    const manifestPath = createEvidence({
      cancellation: { result: 'passed', evidence: 'covered by unit tests' },
      restart: { result: 'passed', evidence: 'covered by unit tests' },
    }, true)

    expect(() => runValidator(manifestPath)).toThrow(/proof|artifact|cancellation|restart/i)
  })

  it('rejects database summaries without persisted nodes', () => {
    const manifestPath = createEvidence({}, true)
    const dir = dirname(manifestPath)
    writeJson(join(dir, 'database-summary.json'), {
      videoId: 'real-local-video',
      status: 'ready',
      stage: 'ready',
      sentenceCount: 1,
      nodeCount: 0,
      qwenBlockCount: 1,
      evidenceSource: 'rain-app-query',
      queriedAt: '2026-07-19T00:00:00.000Z',
    })

    expect(() => runValidator(manifestPath)).toThrow(/node count/i)
  })

  it('rejects proof events that are absent from app-events', () => {
    const manifestPath = createEvidence({}, true)
    const dir = dirname(manifestPath)
    writeJson(join(dir, 'app-events.json'), [{ at: '2026-07-19T00:00:00.000Z', event: 'start_import' }])

    expect(() => runValidator(manifestPath)).toThrow(/app-events/i)
  })

  it('rejects CPU Whisper evidence when CUDA was explicitly required', () => {
    const manifestPath = createEvidence({}, true)

    expect(() => {
      execFileSync(
        'powershell.exe',
        [
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          validateScript,
          '-EvidenceManifest',
          manifestPath,
          '-ExpectedVideoSha256',
          testVideoHash,
          '-ExpectedWhisperBackend',
          'cuda',
        ],
        { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' },
      )
    }).toThrow(/whisper backend/i)
  })
  it('rejects CUDA manifest claims without CUDA runtime log evidence', () => {
    const manifestPath = createEvidence({
      runtime: {
        whisperBackend: 'cuda',
        whisperModel: 'ggml-large-v3.bin',
        qwenModel: 'qwen3.5-omni-flash',
        qwenBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
    }, true)
    writeFileSync(join(dirname(manifestPath), 'logs', 'tauri-driver.err.log'), 'cpu-only whisper log\n', 'utf8')

    expect(() => {
      execFileSync(
        'powershell.exe',
        [
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          validateScript,
          '-EvidenceManifest',
          manifestPath,
          '-ExpectedVideoSha256',
          testVideoHash,
          '-ExpectedWhisperBackend',
          'cuda',
        ],
        { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' },
      )
    }).toThrow(/CUDA runtime evidence/i)
  })
})
describe('real E2E runner GPU preference', () => {
  it('defaults to CUDA and requires CUDA evidence validation', () => {
    const runner = readFileSync(join(repoRoot, 'scripts', 'run-real-e2e.ps1'), 'utf8')

    expect(runner).toMatch(/\$WhisperBackend\s*=.*'cuda'/s)
    expect(runner).toContain('cuda-12.9-redist-root\\bin\\nvcc.exe')
    expect(runner).toContain("$env:CMAKE_GENERATOR = 'Ninja'")
    expect(runner).toContain('$env:CMAKE_MAKE_PROGRAM = $ninja')
    expect(runner).toContain("$npmCmd = (Get-Command 'npm.cmd'")
    expect(runner).toContain('Invoke-BuildCommand $npmCmd $tauriBuildArgs')
    expect(runner).not.toContain('$buildExitCode = Invoke-BuildCommand')
    expect(runner).toMatch(/--features['\"]?,?\s*['\"]cuda-whisper/s)
    expect(runner).toContain('-ExpectedWhisperBackend $selectedWhisperBackend')
  })
})