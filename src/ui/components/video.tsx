// src/ui/components/video.tsx
// ========================================
// M06 视频区组件（决策56/78/91/96）
// ========================================

import React from 'react'
import { useRainStore } from '@/store/rain-store'

interface VideoZoneProps {
  filePath: string
  currentSubtitle?: string
  resumePosition?: number
}

export function VideoZone({ filePath, currentSubtitle, resumePosition }: VideoZoneProps) {
  const subtitleOn = useRainStore((s) => s.subtitleOn)

  return (
    <div data-testid="video-zone-wrapper">
      <video
        data-testid="video-player"
        src={filePath}
        ref={(el) => {
          if (el && resumePosition !== undefined) {
            el.currentTime = resumePosition
          }
        }}
      />
      {subtitleOn && currentSubtitle && (
        <div data-testid="subtitle-overlay">{currentSubtitle}</div>
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
