// src/ui/components/video.tsx
// ========================================
// M06 视频区组件（决策56/78/91/96）
// ========================================

import React, { useRef, useEffect, useCallback } from 'react'
import { useRainStore } from '@/store/rain-store'

interface VideoZoneProps {
  filePath: string
  currentSubtitle?: string
  resumePosition?: number
}

export function VideoZone({ filePath, currentSubtitle, resumePosition }: VideoZoneProps) {
  const subtitleOn = useRainStore((s) => s.subtitleOn)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Convert local file path to asset:// URL for Tauri
  const videoSrc = filePath
    ? filePath.startsWith('http')
      ? filePath
      : `asset://localhost/${filePath.replace(/\\/g, '/')}`
    : ''

  useEffect(() => {
    if (videoRef.current && resumePosition !== undefined && resumePosition > 0) {
      videoRef.current.currentTime = resumePosition
    }
  }, [resumePosition])

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      useRainStore.setState({ playPosition: videoRef.current.currentTime })
    }
  }, [])

  return (
    <div data-testid="video-zone-wrapper" style={{ width: '100%', height: '100%', position: 'relative', background: '#000' }}>
      {videoSrc ? (
        <video
          data-testid="video-player"
          ref={videoRef}
          src={videoSrc}
          controls
          onTimeUpdate={handleTimeUpdate}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-muted)' }}>
          No video loaded
        </div>
      )}
      {subtitleOn && currentSubtitle && (
        <div data-testid="subtitle-overlay" style={{
          position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '4px 12px', borderRadius: '4px',
          fontSize: 'var(--font-size-sm)', maxWidth: '80%', textAlign: 'center',
        }}>
          {currentSubtitle}
        </div>
      )}
    </div>
  )
}

export function VideoControls() {
  const subtitleOn = useRainStore((s) => s.subtitleOn)
  const switchLayoutMode = useRainStore((s) => s.switchLayoutMode)

  return (
    <div data-testid="control-bar">
      <button>播放</button>
      <button
        onClick={() => useRainStore.setState({ subtitleOn: !subtitleOn })}
      >
        字幕{subtitleOn ? ' ON' : ' OFF'}
      </button>
      <button onClick={() => switchLayoutMode('textExpand')}>文本展开</button>
      <button onClick={() => switchLayoutMode('mapExpand')}>导图展开</button>
    </div>
  )
}
