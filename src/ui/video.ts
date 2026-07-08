// src/ui/video.ts
// ========================================
// 视频区控制器（决策56/78/91/96）
// ========================================

export interface VideoController {
  play(): void
  pause(): void
  seek(time: number): void
  getCurrentSubtitle(): string | null
  setSubtitleText(text: string | null): void
  setSubtitleVisible(visible: boolean): void
  isSubtitleVisible(): boolean
  getCurrentTime(): number
  getDuration(): number
  getResumePosition(position: number): number
}

/// 创建视频控制器
/// 传入 HTMLVideoElement 在真实环境中控制播放
/// 不传 element 时用内存状态（测试环境）
export function createVideoController(videoElement?: HTMLVideoElement): VideoController {
  let subtitleVisible = true
  let subtitleText: string | null = null
  let currentTime = 0
  let duration = 0

  return {
    play() {
      if (videoElement) {
        videoElement.play().catch(() => {})
      }
    },
    pause() {
      if (videoElement) {
        videoElement.pause()
      }
    },
    seek(time: number) {
      currentTime = time
      if (videoElement) {
        videoElement.currentTime = time
      }
    },
    getCurrentSubtitle() {
      return subtitleText
    },
    setSubtitleText(text: string | null) {
      subtitleText = text
    },
    setSubtitleVisible(visible: boolean) {
      subtitleVisible = visible
    },
    isSubtitleVisible() {
      return subtitleVisible
    },
    getCurrentTime() {
      if (videoElement) {
        return videoElement.currentTime
      }
      return currentTime
    },
    getDuration() {
      if (videoElement) {
        return videoElement.duration || 0
      }
      return duration
    },
    getResumePosition(position: number) {
      // 重开视频自动续播到 position（决策56）
      // position=0 表示从头播
      return position
    },
  }
}
