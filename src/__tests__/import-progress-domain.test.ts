import { describe, expect, it } from 'vitest'
import { adaptProgressEvent, createImportProgressSession, isImportProgress, type ImportProgress } from '@/pipeline/import-progress'

const asr: ImportProgress = { videoId: 'v1', stage: 'asr', substage: 'transcription', percent: 47, backend: 'cpu', fallbackReason: 'GPU unavailable' }
const stage2: ImportProgress = { videoId: 'v1', stage: 'stage2', percent: 0, blockCurrent: 1, blockTotal: 2, retrying: false }

describe('AC-AR-06 unified progress domain', () => {
  it.each([
    { ...asr, stage: 'unknown' },
    { ...asr, percent: -1 }, { ...asr, percent: 101 }, { ...asr, percent: NaN }, { ...asr, percent: Infinity },
    { ...asr, substage: 'unknown' }, { ...asr, substage: { toString: () => 'extraction' } },
    { ...asr, backend: 'metal' }, { ...asr, fallbackReason: 42 },
    { ...asr, blockCurrent: 1 }, { ...asr, retrying: true }, { ...asr, bytes: 10 },
    { ...stage2, backend: 'cpu' }, { ...stage2, blockCurrent: 0 }, { ...stage2, blockCurrent: 3 },
    { ...stage2, blockTotal: 0 }, { ...stage2, blockCurrent: 1.5 }, { ...stage2, blockTotal: 2.5 },
    { ...stage2, retrying: undefined },
    { videoId: 'v1', stage: 'merging', percent: 10, retrying: false },
    { videoId: 'v1', stage: 'download', percent: 10, backend: 'cpu' },
    { videoId: 'v1', stage: 'download', percent: 10, bytes: -1 },
    { videoId: 'v1', stage: 'terminal', status: 'ready', error: 'wrong' },
    { videoId: 'v1', stage: 'terminal', status: 'cancelled', error: 'wrong' },
    { videoId: 'v1', stage: 'terminal', status: 'ready', percent: 100 },
    { videoId: 'v1', stage: 'terminal', status: 'failed' },
    { videoId: 'v1', stage: 'terminal', status: 'failed', error: 42 },
    { videoId: 'v1', stage: 'terminal', status: 'pending' },
    { ...asr, videoId: '' },
  ])('rejects an illegal payload without publishing it: %j', (invalid) => {
    expect(isImportProgress(invalid)).toBe(false)
    expect(createImportProgressSession('v1', 'asr').accept(invalid)).toBeNull()
  })

  it('closes a complete five-class run and rejects every later mutation', () => {
    const session = createImportProgressSession('v1', 'download')
    const download: ImportProgress = { videoId: 'v1', stage: 'download', percent: 100, bytes: 2048 }
    const merging: ImportProgress = { videoId: 'v1', stage: 'merging', percent: 100 }
    const ready: ImportProgress = { videoId: 'v1', stage: 'terminal', status: 'ready' }
    for (const progress of [download, asr, stage2, merging, ready]) expect(session.accept(progress)).toEqual(progress)
    for (const progress of [download, asr, stage2, merging, ready]) expect(session.accept(progress)).toBeNull()
  })

  it.each(['failed', 'cancelled'] as const)('allows %s to close an active run but only a new checkpoint session resumes it', (status) => {
    const session = createImportProgressSession('v1', 'asr')
    expect(session.accept(asr)).toEqual(asr)
    expect(session.accept(stage2)).toEqual(stage2)
    const terminal: ImportProgress = status === 'failed'
      ? { videoId: 'v1', stage: 'terminal', status, error: 'Model unavailable' }
      : { videoId: 'v1', stage: 'terminal', status }
    expect(session.accept(terminal)).toEqual(terminal)
    expect(session.accept(stage2)).toBeNull()
    const retry = createImportProgressSession('v1', 'stage2')
    expect(retry.accept(asr)).toBeNull()
    expect(retry.accept(stage2)).toEqual(stage2)
  })

  it('rejects earlier or skipped stages and a different video', () => {
    const session = createImportProgressSession('v1', 'asr')
    expect(session.accept({ ...asr, videoId: 'v2' })).toBeNull()
    expect(session.accept({ videoId: 'v1', stage: 'download', percent: 20 })).toBeNull()
    expect(session.accept({ videoId: 'v1', stage: 'merging', percent: 20 })).toBeNull()
    expect(session.accept(stage2)).toBeNull()
    expect(session.accept(asr)).toEqual(asr)
    expect(session.accept(stage2)).toEqual(stage2)
    expect(session.accept(asr)).toBeNull()
    expect(session.accept({ ...stage2, percent: 60, blockCurrent: 2 })).toMatchObject({ percent: 60 })
    expect(session.accept({ ...stage2, percent: 59, blockCurrent: 2 })).toBeNull()
  })

  it('adapts actual desktop ASR events without leaking the legacy block tuple', () => {
    expect(adaptProgressEvent({ videoId: 'v1', stage: 'asr_finalization', percent: 90, blockCurrent: 0, blockTotal: 0, retrying: false })).toEqual({
      videoId: 'v1', stage: 'asr', substage: 'finalization', percent: 90,
    })
  })
})
