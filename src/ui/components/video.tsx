import React, { useCallback, useEffect, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/tauri-env'
import { useRainStore } from '@/store/rain-store'

interface VideoZoneProps {
  filePath: string
  currentSubtitle?: string
  resumePosition?: number
}

let activeVideo: HTMLVideoElement | null = null

function setPlaybackState(playing: boolean) {
  useRainStore.setState({ isPlaying: playing })
}

export function localMediaUrl(filePath: string): string {
  if (!filePath) return ''
  if (/^https?:\/\//i.test(filePath)) return filePath
  return isTauri() ? convertFileSrc(filePath) : filePath
}

export function VideoZone({ filePath, currentSubtitle, resumePosition }: VideoZoneProps) {
  const subtitleOn = useRainStore((s) => s.subtitleOn)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const videoSrc = localMediaUrl(filePath)

  useEffect(() => {
    setMediaError(null)
    activeVideo = videoRef.current
    return () => {
      if (activeVideo === videoRef.current) {
        activeVideo = null
        setPlaybackState(false)
      }
    }
  }, [videoSrc])

  useEffect(() => {
    if (videoRef.current && resumePosition !== undefined && Number.isFinite(resumePosition) && resumePosition >= 0) {
      videoRef.current.currentTime = resumePosition
    }
  }, [resumePosition])

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) useRainStore.setState({ playPosition: videoRef.current.currentTime })
  }, [])

  return (
    <div data-testid="video-zone-wrapper" style={{ width: '100%', height: '100%', position: 'relative', background: '#000' }}>
      {videoSrc ? <video data-testid="video-player" ref={videoRef} src={videoSrc} controls onTimeUpdate={handleTimeUpdate} onPlay={() => setPlaybackState(true)} onPause={() => setPlaybackState(false)} onEnded={() => setPlaybackState(false)} onError={() => setMediaError('Unable to load the local video. Check that the file still exists and is supported.')} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-muted)' }}>No video loaded</div>}
      {mediaError && <div role="alert" style={{ position: 'absolute', left: 12, right: 12, bottom: 12, color: '#fff', background: 'rgba(160,0,0,.85)', padding: 8 }}>{mediaError}</div>}
      {subtitleOn && currentSubtitle && <div data-testid="subtitle-overlay" style={{ position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '4px 12px', borderRadius: '4px', fontSize: 'var(--font-size-sm)', maxWidth: '80%', textAlign: 'center' }}>{currentSubtitle}</div>}
    </div>
  )
}

export function VideoControls() {
  const subtitleOn = useRainStore((s) => s.subtitleOn)
  const switchLayoutMode = useRainStore((s) => s.switchLayoutMode)
  const isPlaying = useRainStore((s) => s.isPlaying)

  const togglePlayback = () => {
    if (!activeVideo) return
    if (activeVideo.paused) {
      void activeVideo.play().then(() => setPlaybackState(true)).catch(() => setPlaybackState(false))
    } else {
      activeVideo.pause()
      setPlaybackState(false)
    }
  }

  return <div data-testid="control-bar">
    <button onClick={togglePlayback}>{isPlaying ? '暂停' : '播放'}</button>
    <button onClick={() => useRainStore.setState({ subtitleOn: !subtitleOn })}>字幕{subtitleOn ? ' ON' : ' OFF'}</button>
    <button onClick={() => switchLayoutMode('textExpand')}>文本展开</button>
    <button onClick={() => switchLayoutMode('mapExpand')}>导图展开</button>
  </div>
}
