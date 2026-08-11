import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const validateScript = join(repoRoot, 'scripts', 'validate-evidence.ps1')
const realE2eScript = join(repoRoot, 'scripts', 'run-real-e2e.ps1')
const externalEvidenceJudgeTimeoutMs = 30_000
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
    { at: '2026-07-18T23:59:57.000Z', event: 'capability_checks_complete' },
    { at: '2026-07-18T23:59:58.000Z', event: 'import_gate_rejected_missing_capabilities' },
    { at: '2026-07-18T23:59:59.000Z', event: 'assistant_gate_rejected_missing_capabilities' },
    { at: '2026-07-19T00:00:00.000Z', event: 'start_import' },
    { at: '2026-07-19T00:00:01.000Z', event: 'cancel_import' },
    { at: '2026-07-19T00:00:02.000Z', event: 'import_cancelled' },
    { at: '2026-07-19T00:00:03.000Z', event: 'retry_import' },
    { at: '2026-07-19T00:00:04.000Z', event: 'import_complete' },
    { at: '2026-07-19T00:00:05.000Z', event: 'assistant_stream_complete' },
    { at: '2026-07-19T00:00:06.000Z', event: 'study_ui_ready' },
  ]
  const checkedAt = 1_784_419_200_000
  const checks = [
    { modelId: 'asr', modelAlias: 'Whisper', role: 'asr', status: 'Compatible', message: 'ASR probe passed', checkedAt, fingerprint: 'cap-v1-asr' },
    { modelId: 'llm', modelAlias: 'Generic LLM', role: 'structuring', status: 'Compatible', message: 'Structuring probe passed', checkedAt, fingerprint: 'cap-v1-structuring' },
    { modelId: 'llm', modelAlias: 'Generic LLM', role: 'assistant', status: 'Compatible', message: 'Text assistant probe passed; no vision.', checkedAt, fingerprint: 'cap-v1-assistant' },
  ]
  const verifiedRecords = checks.map((record) => ({
    ...record,
    status: 'Verified',
    message: 'Full Rain E2E evidence passed.',
    evidenceId: 'rain-real-e2e-test',
  }))

  writeJson(join(dir, 'transcript.json'), {
    detectedLanguage: 'zh',
    sentences: [sentence],
  })
  writeJson(join(dir, 'structuring-blocks.json'), [
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
    structuringBlockCount: 1,
    evidenceSource: 'rain-app-query',
    queriedAt: '2026-07-19T00:00:00.000Z',
  })
  writeJson(join(dir, 'probe.json'), { format: { duration: '1.0' }, streams: [{ codec_type: 'video' }] })
  writeJson(join(dir, 'cancellation-proof.json'), { result: 'passed', source: 'rain-app-automation', events: ['start_import', 'cancel_import', 'import_cancelled'] })
  writeJson(join(dir, 'restart-proof.json'), { result: 'passed', source: 'rain-app-automation', events: ['start_import', 'import_cancelled', 'retry_import', 'import_complete'] })
  writeJson(join(dir, 'capabilities.json'), {
    source: 'rain-app-automation',
    checks,
    verifiedRecords,
  })
  writeJson(join(dir, 'runtime-gates.json'), {
    source: 'rain-app-automation',
    import: {
      result: 'passed',
      implementation: 'VideoImportController',
      requiredRoles: ['asr', 'structuring'],
      rejectedWithoutCapabilities: true,
    },
    assistant: {
      result: 'passed',
      implementation: 'decideModelRoleAssignment+streamAiChat',
      requiredRoles: ['assistant'],
      rejectedWithoutCapabilities: true,
      textOnly: true,
      responseContract: 'RAIN_ASSISTANT_OK',
    },
  })
  writeJson(join(dir, 'ui-state.json'), {
    source: 'rain-webdriver-dom',
    page: 'study',
    videoId: 'real-local-video',
    studyInterfaceVisible: true,
    videoPlayerVisible: true,
    paragraphCount: 1,
    capturedAt: '2026-07-19T00:00:06.000Z',
  })
  writeJson(join(dir, 'app-events.json'), events)
  writeFileSync(join(dir, 'screenshots', 'study-ready.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/eylmE8AAAAASUVORK5CYII=', 'base64'))
  writeFileSync(join(dir, 'logs', 'tauri-driver.err.log'), 'whisper_backend_init_gpu: using CUDA0 backend\nwhisper_init_from_file_with_params_no_state: use gpu = 1\n', 'utf8')

  const manifest = {
    schemaVersion: 2,
    evidenceId: 'rain-real-e2e-test',
    generatedAt: '2026-07-19T00:00:00.000Z',
    video: { path: videoPath, sha256: testVideoHash, probe: 'probe.json' },
    runtime: {
      whisperBackend: 'cpu',
      whisperModel: 'ggml-large-v3.bin',
      llmModel: 'generic-model-a',
      llmBaseUrl: 'https://models.example.test/v1',
    },
    timings: { asrSeconds: 1, structuringSeconds: 1 },
    asr: {
      detectedLanguage: 'zh',
      sentenceCount: 1,
      manualReviewSamples: [sentence],
    },
    structuring: { blockCount: 1 },
    validation: { sentenceCoverage: 'exactly-once', noDemoSentences: true, noDemoIds: true },
    cancellation: { result: 'passed', artifact: 'cancellation-proof.json' },
    restart: { result: 'passed', artifact: 'restart-proof.json' },
    secretsDetected: false,
    artifacts: {
      transcript: 'transcript.json',
      structuringBlocks: 'structuring-blocks.json',
      database: 'database-summary.json',
      probe: 'probe.json',
      screenshots: ['screenshots/study-ready.png'],
      appEvents: 'app-events.json',
      capabilities: 'capabilities.json',
      runtimeGates: 'runtime-gates.json',
      uiState: 'ui-state.json',
      cudaRuntimeLog: 'logs/tauri-driver.err.log',
    },
    ...overrides,
  }
  const manifestPath = join(dir, 'manifest.json')
  writeJson(manifestPath, manifest)
  return manifestPath
}

describe('evidence validator', { timeout: externalEvidenceJudgeTimeoutMs }, () => {
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

  it('rejects schema v2 evidence without a capability artifact', () => {
    const manifestPath = createEvidence({}, true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    delete manifest.artifacts.capabilities
    writeJson(manifestPath, manifest)

    expect(() => runValidator(manifestPath)).toThrow(/capabilit/i)
  })

  it('rejects schema v2 evidence when one model role is missing', () => {
    const manifestPath = createEvidence({}, true)
    const capabilityPath = join(dirname(manifestPath), 'capabilities.json')
    const capabilityEvidence = JSON.parse(readFileSync(capabilityPath, 'utf8'))
    capabilityEvidence.checks = capabilityEvidence.checks.filter((record: { role: string }) => record.role !== 'assistant')
    capabilityEvidence.verifiedRecords = capabilityEvidence.verifiedRecords.filter((record: { role: string }) => record.role !== 'assistant')
    writeJson(capabilityPath, capabilityEvidence)

    expect(() => runValidator(manifestPath)).toThrow(/assistant|role/i)
  })

  it('rejects schema v2 evidence without WebDriver study-page proof', () => {
    const manifestPath = createEvidence({}, true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    delete manifest.artifacts.uiState
    writeJson(manifestPath, manifest)

    expect(() => runValidator(manifestPath)).toThrow(/UI|study/i)
  })

  it('rejects a screenshot captured while the app is still on the video list', () => {
    const manifestPath = createEvidence({}, true)
    writeJson(join(dirname(manifestPath), 'ui-state.json'), {
      source: 'rain-webdriver-dom',
      page: 'list',
      videoId: 'real-local-video',
      studyInterfaceVisible: false,
      videoPlayerVisible: false,
      paragraphCount: 0,
      capturedAt: '2026-07-19T00:00:06.000Z',
    })

    expect(() => runValidator(manifestPath)).toThrow(/study|UI/i)
  })

  it('accepts a schema v2 generic OpenAI-compatible runtime instead of requiring Qwen', () => {
    const manifestPath = createEvidence({
      runtime: {
        whisperBackend: 'cpu',
        whisperModel: 'ggml-large-v3.bin',
        llmModel: 'generic-model-a',
        llmBaseUrl: 'https://models.example.test/v1',
      },
    }, true)

    expect(() => runValidator(manifestPath)).not.toThrow()
  })

  it('accepts strict JSON evidence with a Chinese Windows-style video path segment', () => {
    const manifestPath = createEvidence({}, true)
    const dir = dirname(manifestPath)
    const videoPath = join(dir, '【华中科技大学】电子技术基础', '1.2.1 信号及其放大.mp4')
    mkdirSync(dirname(videoPath), { recursive: true })
    writeFileSync(videoPath, videoBytes)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.video.path = videoPath
    writeJson(manifestPath, manifest)

    expect(JSON.parse(readFileSync(manifestPath, 'utf8')).video.path).toContain('信号及其放大')
    expect(() => runValidator(manifestPath)).not.toThrow()
  })

  it('rejects mojibake video paths even when the referenced file exists', () => {
    const manifestPath = createEvidence({}, true)
    const dir = dirname(manifestPath)
    const videoPath = join(dir, '銆愬崕涓鎶€澶у銆戠數瀛愭妧鏈熀纭€', '1.2.1 淇″彿鍙婂叾鏀惧ぇ.mp4')
    mkdirSync(dirname(videoPath), { recursive: true })
    writeFileSync(videoPath, videoBytes)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.video.path = videoPath
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
      structuringBlockCount: 1,
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
        llmModel: 'generic-model-a',
        llmBaseUrl: 'https://models.example.test/v1',
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
  it('defaults to CUDA and resolves the configured CUDA build plan through its CLI', () => {
    const toolingRoot = join(tmpdir(), 'rain-real-e2e-tooling-interface')
    const cudaToolkitRoot = join(tmpdir(), 'rain-real-e2e-cuda-interface')
    const cargoTargetDir = join(tmpdir(), 'rain-real-e2e-target-interface')
    const whisperModelPath = join(tmpdir(), 'rain-real-e2e-model-interface.bin')
    const invocationCwd = mkdtempSync(join(tmpdir(), 'rain-real-e2e-plan-only-cwd-'))
    const filesBefore = readdirSync(invocationCwd)
    const parentPathBefore = process.env.PATH
    const parentCargoTargetBefore = process.env.CARGO_TARGET_DIR
    const relativeEvidenceRoot = 'evidence-plan-only-relative'
    const nativeDriverPath = 'C:\\Program Files\\Rain Tools\\msedgedriver.exe'
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        realE2eScript,
        '-PlanOnly',
        '-RepoRoot',
        repoRoot,
        '-ToolingRoot',
        toolingRoot,
        '-CudaToolkitRoot',
        cudaToolkitRoot,
        '-CargoTargetDir',
        cargoTargetDir,
        '-WhisperModelPath',
        whisperModelPath,
        '-EvidenceRoot',
        relativeEvidenceRoot,
        '-NativeDriverPath',
        nativeDriverPath,
      ],
      {
        cwd: invocationCwd,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, RAIN_WHISPER_BACKEND: '' },
      },
    )
    const plan = JSON.parse(output)

    expect(plan).toMatchObject({
      whisperBackend: 'cuda',
      repoRoot,
      toolingRoot,
      cudaToolkitRoot,
      cargoTargetDir,
      whisperModelPath,
      cmakeGenerator: 'Ninja',
      expectedWhisperBackend: 'cuda',
    })
    expect(plan.cudaNvccCandidate).toBe(join(cudaToolkitRoot, 'bin', 'nvcc.exe'))
    expect(plan.cudaWorkerBuildScript).toBe(join(repoRoot, 'scripts', 'build-whisper-cuda-worker.ps1'))
    expect(plan.workingDirectory).toBe(repoRoot)
    expect(plan.evidenceRoot).toBe(join(repoRoot, relativeEvidenceRoot))
    expect(plan.nativeDriverPath).toBe(nativeDriverPath)
    expect(plan.nativeDriverArguments).toBe(`--native-driver "${nativeDriverPath}"`)
    expect(readdirSync(invocationCwd)).toEqual(filesBefore)
    expect(process.env.PATH).toBe(parentPathBefore)
    expect(process.env.CARGO_TARGET_DIR).toBe(parentCargoTargetBefore)
  })

  it('routes schema v2 evidence through capability probes and the production import controller', () => {
    const desktopRunner = readFileSync(join(repoRoot, 'scripts', 'run-real-e2e.ps1'), 'utf8')
    const appRunner = readFileSync(join(repoRoot, 'src', 'e2e', 'real-e2e-runner.tsx'), 'utf8')

    expect(desktopRunner).toContain('RAIN_E2E_LLM_BASE_URL')
    expect(desktopRunner).toContain('RAIN_E2E_LLM_MODEL')
    expect(appRunner).toContain('checkAsrModelCapability')
    expect(appRunner).toContain('checkStructuringModelCapability')
    expect(appRunner).toContain('checkAssistantModelCapability')
    expect(appRunner).toContain('createVideoImportController')
    expect(appRunner).toContain('loadVideo')
    expect(appRunner).not.toMatch(/\brunPipeline\s*\(/)
  })

  it('routes the production database singleton to the isolated E2E database', () => {
    const singleton = readFileSync(join(repoRoot, 'src', 'models', 'db-singleton.ts'), 'utf8')

    expect(singleton).toContain('get_real_e2e_config')
    expect(singleton).toContain('databasePath')
  })
})
