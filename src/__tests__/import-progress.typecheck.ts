import type { ImportProgress } from '@/pipeline/import-progress'

// Compiled by tsc --noEmit; unused @ts-expect-error directives are failures.
function illegalProgressTypes() {
  // @ts-expect-error ASR must name its actual substage.
  const missingSubstage: ImportProgress = { videoId: 'v1', stage: 'asr', percent: 0 }
  // @ts-expect-error Blocks belong to Stage2, not ASR.
  const asrBlock: ImportProgress = { videoId: 'v1', stage: 'asr', substage: 'transcription', percent: 10, blockCurrent: 1 }
  // @ts-expect-error Stage2 must carry both block counters and retry state.
  const incompleteStage2: ImportProgress = { videoId: 'v1', stage: 'stage2', percent: 0 }
  // @ts-expect-error Backend belongs to ASR, not Stage2.
  const stage2Backend: ImportProgress = { videoId: 'v1', stage: 'stage2', percent: 0, blockCurrent: 1, blockTotal: 1, retrying: false, backend: 'cpu' }
  // @ts-expect-error Only failed terminal carries an error.
  const readyError: ImportProgress = { videoId: 'v1', stage: 'terminal', status: 'ready', error: 'wrong' }
  // @ts-expect-error Failed terminal requires an error.
  const failedWithoutError: ImportProgress = { videoId: 'v1', stage: 'terminal', status: 'failed' }
  // @ts-expect-error Terminal has status, not percent.
  const terminalPercent: ImportProgress = { videoId: 'v1', stage: 'terminal', status: 'cancelled', percent: 100 }
  // @ts-expect-error Download cannot carry retry state.
  const downloadRetry: ImportProgress = { videoId: 'v1', stage: 'download', percent: 0, retrying: false }
  return [missingSubstage, asrBlock, incompleteStage2, stage2Backend, readyError, failedWithoutError, terminalPercent, downloadRetry]
}
void illegalProgressTypes
