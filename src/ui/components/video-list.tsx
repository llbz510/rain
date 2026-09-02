// src/ui/components/video-list.tsx
// ========================================
// M17 视频列表组件（决策54/57/58/59/60/62）
// ========================================

import React, { useRef, useState } from 'react'
import { getCardAction, buildCardDisplay, buildDeleteConfirmation, getEmptyStateMessage, getImportStatus } from '@/ui/video-list'
import type { Video } from '@/models/types'
import { localMediaUrl } from '@/ui/components/video'

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

  return (
    <div data-testid={`card-${video.id}`} style={{ cursor: 'pointer' }}>
      <button type="button" aria-label={primaryActionName} disabled={deleting} onClick={handleClick}>
        {thumbnailSrc
          ? <img src={thumbnailSrc} alt={video.title} />
          : <span>暂无缩略图</span>}
        <span>{video.title}</span>
      </button>
      <div>{display.durationText}</div>
      <div>{display.progressPercent}%</div>
      {display.isComplete && <span>✓</span>}
      {display.statusBadge && <span data-testid={`badge-${video.id}`} data-status={display.statusBadge.type}>{statusBadgeText}</span>}
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
