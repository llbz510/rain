// src/pages/VideoListPage.tsx
// ========================================
// M17 视频列表页（Task 5 组装）
// 顶栏：标题 / 搜索框 / 排序 / 导入
// 主区：视频卡片网格，复用 VideoCard 组件
// 数据：createDatabase + listVideos + searchVideosByTitle
// jsdom 下 listVideos 返回空 → 显示空状态（getEmptyStateMessage）
// ========================================

import { useEffect, useState, useCallback } from 'react'
import {
  createDatabase,
  listVideos,
  searchVideosByTitle,
  insertVideo,
  type Database,
} from '@/models/database'
import { getDb } from '@/models/db-singleton'
import { VideoCard } from '@/ui/components/video-list'
import { getEmptyStateMessage } from '@/ui/video-list'
import { useRainStore } from '@/store/rain-store'
import type { Video } from '@/models/types'

type SortBy = 'lastStudied' | 'createdAt' | 'title'

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  background: 'var(--color-bg)',
  color: 'var(--color-fg)',
  overflow: 'hidden',
}

const topbarStyle: React.CSSProperties = {
  height: 'var(--height-topbar)',
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-3)',
  padding: '0 var(--spacing-4)',
  background: 'var(--color-surface)',
  borderBottom: '1px solid var(--color-border)',
}

const titleStyle: React.CSSProperties = {
  fontWeight: 'var(--font-weight-bold)',
  fontSize: 'var(--font-size-md)',
  flex: '0 0 auto',
}

const searchStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: '120px',
  maxWidth: '420px',
  height: '28px',
  padding: '0 var(--spacing-2)',
  background: 'var(--color-bg)',
  color: 'var(--color-fg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-sm)',
}

const sortStyle: React.CSSProperties = {
  flex: '0 0 auto',
  height: '28px',
  background: 'var(--color-bg)',
  color: 'var(--color-fg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-sm)',
}

const importButtonStyle: React.CSSProperties = {
  flex: '0 0 auto',
  height: '28px',
  padding: '0 var(--spacing-3)',
  background: 'var(--color-accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-sm)',
  cursor: 'pointer',
}

const settingsButtonStyle: React.CSSProperties = {
  flex: '0 0 auto',
  height: '28px',
  padding: '0 var(--spacing-2)',
  background: 'transparent',
  color: 'var(--color-fg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-sm)',
  cursor: 'pointer',
}

const importWrapperStyle: React.CSSProperties = {
  position: 'relative',
  flex: '0 0 auto',
}

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: '4px',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-1)',
  padding: '4px 0',
  zIndex: 10,
  minWidth: '120px',
  boxShadow: '0 4px 16px rgba(0,0,0,.4)',
}

const dropdownItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  background: 'transparent',
  color: 'var(--color-fg)',
  border: 'none',
  fontSize: 'var(--font-size-sm)',
  textAlign: 'left' as const,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const mainStyle: React.CSSProperties = {
  flex: '1 1 auto',
  overflowY: 'auto',
  padding: 'var(--spacing-4)',
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 'var(--spacing-4)',
}

const emptyStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--color-muted)',
  fontSize: 'var(--font-size-lg)',
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 80,
}

const modalStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-2)',
  width: '420px',
  maxWidth: '92vw',
  boxShadow: '0 4px 16px rgba(0,0,0,.4)',
}

const modalTitleStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-md)',
  fontWeight: 600,
  padding: '12px 16px',
  borderBottom: '1px solid var(--color-border)',
}

const modalBodyStyle: React.CSSProperties = {
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-muted)',
}

const modalInputStyle: React.CSSProperties = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-fg)',
  padding: '4px 8px',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-sm)',
  width: '100%',
  fontFamily: 'inherit',
}

const errorStyle: React.CSSProperties = {
  color: '#f85149',
  fontSize: 'var(--font-size-xs)',
}

const modalFootStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  padding: '12px 16px',
  borderTop: '1px solid var(--color-border)',
}

const modalBtnStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  background: 'transparent',
  color: 'var(--color-fg)',
  padding: '4px 12px',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-xs)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const modalBtnPrimaryStyle: React.CSSProperties = {
  border: '1px solid transparent',
  background: 'rgba(255,255,255,.12)',
  color: 'var(--color-fg)',
  padding: '4px 12px',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-xs)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

export function VideoListPage() {
  const [db, setDb] = useState<Database | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [sortBy, setSortBy] = useState<SortBy>('lastStudied')
  const [keyword, setKeyword] = useState('')
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [localImportError, setLocalImportError] = useState('')
  const [processingVideoId, setProcessingVideoId] = useState<string | null>(null)

  // 初始化数据库（Tauri 走 SQLite，jsdom/浏览器走内存 fallback）
  useEffect(() => {
    let cancelled = false
    getDb()
      .then((d) => {
        if (!cancelled) setDb(d)
      })
      .catch((err) => {
        console.error('[VideoListPage] 数据库初始化失败', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 加载 / 搜索 / 排序
  useEffect(() => {
    if (!db) return
    let cancelled = false
    const trimmed = keyword.trim()
    const promise = trimmed
      ? searchVideosByTitle(db, trimmed)
      : listVideos(db, sortBy)
    promise
      .then((list) => {
        if (!cancelled) setVideos(list)
      })
      .catch((err) => {
        console.error('[VideoListPage] 查询视频列表失败', err)
        if (!cancelled) setVideos([])
      })
    return () => {
      cancelled = true
    }
  }, [db, sortBy, keyword])

  // 点 ready 卡 → 进入学习界面（store 接管 currentVideoId 切页）
  const handleOpen = (videoId: string) => {
    void useRainStore.getState().loadVideo(videoId)
  }

  // 点非 ready 卡 → 触发处理管线
  const handleOpenImport = useCallback(async (videoId: string) => {
    if (!db || processingVideoId) return
    setProcessingVideoId(videoId)

    try {
      const { runPipeline } = await import('@/pipeline/pipeline-orchestrator')
      const { getVideoById } = await import('@/models/database')
      const video = await getVideoById(db, videoId)
      if (!video) return

      const store = useRainStore.getState()
      await store.loadRuntimeSettings()
      const configuredStore = useRainStore.getState()
      if (!configuredStore.settingsReady) {
        throw new Error(configuredStore.settingsError ?? 'Runtime settings are unavailable')
      }
      const structuringModelId = configuredStore.roleAssignment.structuring
      const model = configuredStore.modelPool.find((m) => m.id === structuringModelId)

      const llmSettings = model
        ? { baseUrl: model.baseUrl ?? '', apiKey: model.apiKey ?? '', model: model.modelName }
        : { baseUrl: '', apiKey: '', model: '' }

      await runPipeline(video, llmSettings, {
        onProgress: (stage, percent) => {
          console.log(`[Pipeline] ${stage}: ${percent}%`)
        },
        onComplete: async () => {
          setProcessingVideoId(null)
          const list = keyword.trim()
            ? await searchVideosByTitle(db, keyword.trim())
            : await listVideos(db, sortBy)
          setVideos(list)
        },
        onError: (err) => {
          setProcessingVideoId(null)
          console.error('[Pipeline] Error:', err)
        },
      }, db)
    } catch (err) {
      setProcessingVideoId(null)
      console.error('[VideoListPage] pipeline error', err)
    }
  }, [db, processingVideoId, keyword, sortBy])

  const handleImportClick = () => {
    setImportMenuOpen((prev) => !prev)
  }

  const handleLocalImport = async () => {
    setImportMenuOpen(false)
    setLocalImportError('')
    try {
      const { isTauri, tauriInvoke } = await import('@/lib/tauri-env')
      if (!isTauri()) {
        setLocalImportError('请在桌面应用中使用本地文件导入')
        return
      }
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'] }],
        multiple: false,
      })
      if (!selected) return

      const filePath = selected
      const info = await tauriInvoke<{ title: string; duration: number; thumbnail: string }>(
        'probe_video_info',
        { filePath, sourceUrl: null },
      )

      const videoId = `v_${Date.now()}`
      let thumbnailPath = ''
      try {
        const thumbOutput = filePath.replace(/\.[^.]+$/, '_thumb.jpg')
        thumbnailPath = await tauriInvoke<string>(
          'generate_thumbnail',
          { filePath, outputPath: thumbOutput, timestamp: 1.0 },
        )
      } catch (err) {
        console.warn('[VideoListPage] 缩略图生成失败，继续导入', err)
      }

      if (!db) return
      const video: Video = {
        id: videoId,
        title: info.title,
        source: 'local',
        filePath,
        thumbnail: thumbnailPath || info.thumbnail,
        duration: info.duration,
        language: '',
        status: 'pending',
        createdAt: Date.now(),
        position: 0,
        lastStudiedAt: Date.now(),
      }
      await insertVideo(db, video)
      const list = keyword.trim()
        ? await searchVideosByTitle(db, keyword.trim())
        : await listVideos(db, sortBy)
      setVideos(list)

      // Trigger pipeline processing
      void handleOpenImport(videoId)
    } catch (err) {
      console.error('[VideoListPage] 本地文件导入失败', err)
    }
  }

  const handleUrlImport = async () => {
    setImportMenuOpen(false)
    try {
      const { isTauri, tauriInvoke } = await import('@/lib/tauri-env')
      if (!isTauri()) {
        alert('请在桌面应用中使用在线视频导入')
        return
      }
      const ytdlpResult = await tauriInvoke<{ available: boolean; version: string | null }>(
        'check_ytdlp_command', {},
      )
      if (!ytdlpResult.available) {
        alert('请先安装 yt-dlp 并加入 PATH')
        return
      }
      setUrlDialogOpen(true)
      setImportUrl('')
      setUrlError('')
    } catch (err) {
      console.error('[VideoListPage] yt-dlp 检查失败', err)
    }
  }

  const handleUrlSubmit = async () => {
    if (!importUrl.trim()) {
      setUrlError('请输入 URL')
      return
    }
    try {
      const { tauriInvoke } = await import('@/lib/tauri-env')
      const info = await tauriInvoke<{ title: string; duration: number; thumbnail: string }>(
        'probe_video_info',
        { filePath: '', sourceUrl: importUrl.trim() },
      )

      if (!db) return
      const video: Video = {
        id: `v_${Date.now()}`,
        title: info.title,
        source: 'url',
        sourceUrl: importUrl.trim(),
        thumbnail: info.thumbnail,
        duration: info.duration,
        language: '',
        status: 'pending',
        createdAt: Date.now(),
        position: 0,
        lastStudiedAt: Date.now(),
      }
      await insertVideo(db, video)
      const list = keyword.trim()
        ? await searchVideosByTitle(db, keyword.trim())
        : await listVideos(db, sortBy)
      setVideos(list)
      setUrlDialogOpen(false)

      // Trigger pipeline processing
      void handleOpenImport(video.id)
    } catch (err) {
      setUrlError(`导入失败: ${err}`)
    }
  }

  const handleSettingsClick = () => {
    useRainStore.getState().setPage('settings')
  }

  const isEmpty = videos.length === 0

  return (
    <div data-testid="video-list-page" style={rootStyle}>
      <header style={topbarStyle}>
        <span style={titleStyle}>Rain</span>
        <input
          type="text"
          placeholder="搜索标题"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={searchStyle}
        />
        <select
          aria-label="排序"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          style={sortStyle}
        >
          <option value="lastStudied">最近学习</option>
          <option value="createdAt">创建时间</option>
          <option value="title">名称</option>
        </select>
        <div style={importWrapperStyle}>
          <button onClick={handleImportClick} style={importButtonStyle}>
            导入
          </button>
          {importMenuOpen && (
            <div style={dropdownStyle}>
              <button onClick={handleLocalImport} style={dropdownItemStyle}>
                本地文件
              </button>
              <button onClick={handleUrlImport} style={dropdownItemStyle}>
                在线视频
              </button>
            </div>
          )}
          {localImportError && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '4px',
                background: 'var(--color-surface)',
                border: '1px solid #f85149',
                borderRadius: 'var(--radius-1)',
                padding: '6px 10px',
                fontSize: 'var(--font-size-xs)',
                color: '#f85149',
                whiteSpace: 'nowrap',
                zIndex: 20,
              }}
            >
              {localImportError}
            </div>
          )}
        </div>
        <button onClick={handleSettingsClick} style={settingsButtonStyle}>
          设置
        </button>
      </header>

      <main style={mainStyle}>
        {isEmpty ? (
          <div style={emptyStyle}>{getEmptyStateMessage()}</div>
        ) : (
          <div style={gridStyle}>
            {videos.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                onOpen={handleOpen}
                onOpenImport={handleOpenImport}
              />
            ))}
          </div>
        )}
      </main>

      {urlDialogOpen && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <div style={modalTitleStyle}>导入在线视频</div>
            <div style={modalBodyStyle}>
              <label style={fieldLabelStyle}>
                视频 URL（YouTube/Bilibili 等）
              </label>
              <input
                type="text"
                value={importUrl}
                onChange={(e) => { setImportUrl(e.target.value); setUrlError('') }}
                placeholder="https://www.youtube.com/watch?v=..."
                style={modalInputStyle}
              />
              {urlError && <div style={errorStyle}>{urlError}</div>}
            </div>
            <div style={modalFootStyle}>
              <button onClick={() => setUrlDialogOpen(false)} style={modalBtnStyle}>取消</button>
              <button onClick={handleUrlSubmit} style={modalBtnPrimaryStyle}>导入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
