import type { CSSProperties } from 'react'
import type { Video } from '@/models/types'
import type { ImportProgress } from '@/pipeline/video-import-controller'
import { getImportStatus } from '@/ui/video-list'

interface ImportTaskDialogProps {
  video: Video
  progress?: ImportProgress
  onClose: () => void
  onRetry: (videoId: string) => void
  onCancel: (videoId: string) => void
}

const liveSubstageLabels: Partial<Record<NonNullable<ImportProgress['detailStage']>, string>> = {
  asr_extraction: '提取音频',
  asr_transcription: 'Whisper 转写',
  asr_finalization: '整理转写结果',
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--spacing-4)',
  background: 'rgba(0, 0, 0, 0.55)',
}

const dialogStyle: CSSProperties = {
  width: 'min(460px, calc(100vw - 32px))',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  padding: 'var(--spacing-5)',
  display: 'grid',
  gap: 'var(--spacing-4)',
  color: 'var(--color-fg)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-2)',
  boxShadow: '0 18px 60px rgba(0, 0, 0, 0.35)',
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--font-size-lg)',
}

const statusStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--spacing-2)',
  padding: 'var(--spacing-3)',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-1)',
}

const actionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 'var(--spacing-2)',
}

const buttonStyle: CSSProperties = {
  minHeight: 32,
  padding: '0 var(--spacing-3)',
  color: 'var(--color-fg)',
  background: 'transparent',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-1)',
  cursor: 'pointer',
}

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  color: '#fff',
  background: 'var(--color-accent)',
  borderColor: 'var(--color-accent)',
}

export function ImportTaskDialog({
  video,
  progress,
  onClose,
  onRetry,
  onCancel,
}: ImportTaskDialogProps) {
  const titleId = `import-task-title-${video.id}`
  const visibleVideo: Video = progress
    ? { ...video, status: 'processing', stage: progress.stage, errorMessage: undefined }
    : video
  const status = getImportStatus(visibleVideo, progress?.percent)
  const stageLabel = progress?.detailStage
    ? liveSubstageLabels[progress.detailStage] ?? status?.stageLabel
    : status?.stageLabel
  const percent = status?.percent ?? (visibleVideo.status === 'ready' ? 100 : 0)

  return (
    <div style={overlayStyle}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} style={dialogStyle}>
        <h2 id={titleId} style={titleStyle}>{video.title}导入任务</h2>
        <div style={statusStyle}>
          {status && <div>{stageLabel} · {status.percent}%</div>}
          {!status && visibleVideo.status === 'ready' && <div>处理完成 · 100%</div>}
          <progress aria-label="导入进度" max={100} value={percent} style={{ width: '100%' }} />
          {progress && (progress.blockTotal ?? 0) > 0 && (
            <div>分块 {progress.blockCurrent ?? 0} / {progress.blockTotal}</div>
          )}
          {progress?.retrying && <div>正在重试</div>}
          {visibleVideo.errorMessage && <div role="alert">{visibleVideo.errorMessage}</div>}
        </div>
        <div style={actionsStyle}>
          {status?.action === 'retry' && (
            <button style={primaryButtonStyle} onClick={() => onRetry(video.id)}>重试导入</button>
          )}
          {status?.action === 'cancel' && (
            <button style={primaryButtonStyle} onClick={() => onCancel(video.id)}>取消导入</button>
          )}
          <button style={buttonStyle} onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
