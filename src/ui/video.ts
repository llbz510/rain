// src/ui/video.ts
// ========================================
// 视频区控制器
// ========================================

export interface VideoController {
  play(): void
  pause(): void
  seek(time: number): void
  getCurrentSubtitle(): string | null
  setSubtitleVisible(visible: boolean): void
  isSubtitleVisible(): boolean
  getResumePosition(position: number): number
}

export function createVideoController(): VideoController {
  let subtitleVisible = true
  let subtitleText: string | null = null
  let currentTime = 0

  return {
    play() {
      // 播放控制
    },
    pause() {
      // 暂停控制
    },
    seek(time: number) {
      currentTime = time
    },
    getCurrentSubtitle() {
      return subtitleText
    },
    setSubtitleVisible(visible: boolean) {
      subtitleVisible = visible
    },
    isSubtitleVisible() {
      return subtitleVisible
    },
    getResumePosition(position: number) {
      return position
    },
  }
}
