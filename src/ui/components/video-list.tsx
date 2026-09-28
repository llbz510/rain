// src/ui/components/video-list.tsx
// ========================================
// M17 视频列表组件（决策54/57/58/59/60/62）
// ========================================

import React, { useRef, useState } from 'react'
import { getCardAction, buildCardDisplay, buildDeleteConfirmation, getEmptyStateMessage, getImportStatus } from '@/ui/video-list'
import type { Video } from '@/models/types'
import { localMediaUrl } from '@/ui/components/video'

/**
 * 状态徽章：白字只压「填充态」色（决策 69/70；视觉合同 §5.5.1 状态色，深底套）。
 * 白字对比度：失败 #a82e26 → 6.81、处理中 #7a5a00 → 6.38、排队 #5b6470 → 6.00（均 ≥4.5）。
 * 不得改用类型色或彩字态作白字承载：白字压 #10b981 / #f59e0b / #3ecf8e / #f0a13c 必然 <4.5
 * （上界 1.05/(L_bg+0.05)，这些背景 L 都 > 0.183333）——见 VCGAP-12/VCGAP-13。
 */
const STATUS_BADGE_FILL: Record<string, string> = {
  failed: '#a82e26',
  processing: '#7a5a00',
  pending: '#5b6470',
}

const statusBadgeChipStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 8px',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-xs)',
  color: '#ffffff',
}

interface VideoCardProps {
  video: Video
  onOpen?: (videoId: string) => void
  onOpenImport?: (videoId: string) => void
  onDelete?: (videoId: string) => Promise<void>
  loadDeleteInfo?: (videoId: string) => Promise<{ nodeCount: number; noteCount: number }>
  importProgressPercent?: number
  nodeCount?: number
  noteCount?: number
}

export function VideoCard({ video, onOpen, onOpenImport, onDelete, loadDeleteInfo, importProgressPercent, nodeCount, noteCount }: VideoCardProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [deleteInfo, setDeleteInfo] = useState<{ nodeCount: number; noteCount: number } | null>(null)
  const [preparingDelete, setPreparingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const preparingDeleteRef = useRef(false)
  const display = buildCardDisplay(video)
  const importStatus = getImportStatus(video, importProgressPercent)
  const thumbnailSrc = localMediaUrl(video.thumbnail)
  const cardAction = getCardAction(video)
  const primaryActionName = cardAction === 'openVideo'
    ? `打开视频：${video.title}`
    : `查看导入任务：${video.title}`
  const statusBadgeText = display.statusBadge?.type === 'processing' && importProgressPercent !== undefined
    ? `${display.statusBadge.label} ${importProgressPercent}%`
    : display.statusBadge?.label
  const handleClick = () => {
    if (deleting) return
    if (cardAction === 'openVideo') onOpen?.(video.id)
    else onOpenImport?.(video.id)
  }

  const handleDeleteRequest = async () => {
    if (preparingDeleteRef.current) return
    preparingDeleteRef.current = true
    setPreparingDelete(true)
    setDeleteError(null)
    setDeleteInfo(null)
    try {
      if (loadDeleteInfo) setDeleteInfo(await loadDeleteInfo(video.id))
      setShowConfirm(true)
    } catch (error) {
      setDeleteError(`无法准备删除：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      preparingDeleteRef.current = false
      setPreparingDelete(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!onDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await onDelete(video.id)
      setShowConfirm(false)
    } catch (error) {
      setDeleteError(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setDeleting(false)
    }
  }

  const progressWidth = display.isComplete ? '100%' : `${display.progressPercent}%`
  return (
    <div data-testid={`card-${video.id}`} style={{ cursor: 'pointer' }}>
      <button
        type="button"
        aria-label={primaryActionName}
        disabled={deleting}
        onClick={handleClick}
        style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer' }}
      >
        {/* 缩略图容器：16:9 + 圆角 + 右下语言·来源角标 + 非就绪蒙层与左上徽章（决策 77） */}
        <span data-testid={`thumb-${video.id}`} style={{ position: 'relative', display: 'block', aspectRatio: '16 / 9', borderRadius: 'var(--radius-2)', overflow: 'hidden', background: 'var(--color-surface-hover)' }}>
          {thumbnailSrc
            ? <img src={thumbnailSrc} alt={video.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-muted)' }}>暂无缩略图</span>}
          {display.statusBadge && <span data-testid={`thumb-overlay-${video.id}`} aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)' }} />}
          {!display.statusBadge && display.badges.length > 0 && (
            <span data-testid={`thumb-meta-${video.id}`} style={{ position: 'absolute', right: 4, bottom: 4, padding: '1px 8px', borderRadius: 'var(--radius-1)', fontSize: 'var(--font-size-xs)', color: '#ffffff', background: 'var(--color-surface)' }}>
              {display.badges.join(' · ')}
            </span>
          )}
          {display.statusBadge && (
            <span
              data-testid={`badge-${video.id}`}
              data-status={display.statusBadge.type}
              style={{ ...statusBadgeChipStyle, position: 'absolute', top: 4, left: 4, background: STATUS_BADGE_FILL[display.statusBadge.type] ?? STATUS_BADGE_FILL.pending }}
            >
              {statusBadgeText}
            </span>
          )}
        </span>
        <span data-testid={`title-${video.id}`} style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 'var(--font-size-xs)' }}>{video.title}</span>
      </button>
      {/* 进度条（4px、中性档；已看完=满） + 右侧时长 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, display: 'block', height: '4px', borderRadius: 'var(--radius-1)', background: 'var(--color-surface-hover)', overflow: 'hidden' }}>
          <span data-testid={`progress-fill-${video.id}`} style={{ display: 'block', width: progressWidth, height: '4px', background: 'var(--color-muted)' }} />
        </span>
        <span style={{ fontSize: 'var(--font-size-xs)' }}>{display.durationText}</span>
      </div>
      <div data-testid={`last-studied-${video.id}`} style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-muted)' }}>
        {display.isComplete ? `已看完·${display.lastStudiedText}` : display.lastStudiedText}
      </div>
      {importStatus && (
        <div data-testid={`import-status-${video.id}`}>
          <div>{importStatus.stageLabel} · {importStatus.percent}%</div>
          {importStatus.errorMessage && <div role="alert">{importStatus.errorMessage}</div>}
        </div>
      )}
      <button disabled={preparingDelete || deleting} onClick={() => void handleDeleteRequest()}>
        {preparingDelete ? '准备删除…' : '删除'}
      </button>
      {deleteError && !showConfirm && <div role="alert">{deleteError}</div>}
      {showConfirm && (
        <div data-testid="delete-confirm">
          {buildDeleteConfirmation(video, {
            nodeCount: deleteInfo?.nodeCount ?? nodeCount ?? 0,
            noteCount: deleteInfo?.noteCount ?? noteCount ?? 0,
          }).message}
          {deleteError && <div role="alert">{deleteError}</div>}
          <button disabled={deleting} onClick={() => setShowConfirm(false)}>取消</button>
          {onDelete && (
            <button disabled={deleting} onClick={() => void handleDeleteConfirm()}>
              {deleting ? '删除中…' : '确认删除'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
interface VideoListProps {
  videos: Video[]
}

export function VideoList({ videos }: VideoListProps) {
  const [search, setSearch] = useState('')

  const filtered = search
    ? videos.filter((v) => v.title.includes(search))
    : videos

  return (
    <div data-testid="video-list">
      <select aria-label="排序">
        <option value="lastStudied">最近学习</option>
        <option value="createdAt">创建时间</option>
        <option value="title">名称</option>
      </select>
      <input
        placeholder="搜索标题"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {filtered.length === 0 && !search ? (
        <div>{getEmptyStateMessage()}</div>
      ) : (
        filtered.map((v) => <VideoCard key={v.id} video={v} />)
      )}
    </div>
  )
}
