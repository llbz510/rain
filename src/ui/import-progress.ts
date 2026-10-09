import type { Video } from '@/models/types'
import type { ImportProgress } from '@/pipeline/import-progress'

interface ImportProgressView {
  video: Video
  percent?: number
  asr?: Extract<ImportProgress, { stage: 'asr' }>
  stage2?: Extract<ImportProgress, { stage: 'stage2' }>
}

export function getImportProgressView(video: Video, progress?: ImportProgress): ImportProgressView {
  if (!progress) return { video }
  switch (progress.stage) {
    case 'download':
    case 'merging':
      return { video: { ...video, status: 'processing', stage: progress.stage, errorMessage: undefined }, percent: progress.percent }
    case 'asr':
      return { video: { ...video, status: 'processing', stage: 'asr', errorMessage: undefined }, percent: progress.percent, asr: progress }
    case 'stage2':
      return { video: { ...video, status: 'processing', stage: 'stage2', errorMessage: undefined }, percent: progress.percent, stage2: progress }
    case 'terminal':
      return {
        video: { ...video, status: progress.status, errorMessage: progress.status === 'failed' ? progress.error : undefined },
        percent: progress.status === 'ready' ? 100 : undefined,
      }
    default: {
      const exhaustive: never = progress
      return exhaustive
    }
  }
}
