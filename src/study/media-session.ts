import { useRainStore } from '@/store/rain-store'

let activeStudyVideo: HTMLVideoElement | null = null

function setPlaybackState(playing: boolean) {
  useRainStore.setState({ isPlaying: playing })
}

export function registerStudyVideo(video: HTMLVideoElement | null): () => void {
  activeStudyVideo = video
  return () => {
    if (activeStudyVideo === video) {
      activeStudyVideo = null
      setPlaybackState(false)
    }
  }
}

export interface StudyMediaActions {
  togglePlayback: () => void
  seekBy: (delta: number) => void
  adjustVolume: (delta: number) => void
}

export const activeStudyMediaActions: StudyMediaActions = {
  togglePlayback: () => {
    if (!activeStudyVideo) return
    if (activeStudyVideo.paused) {
      void activeStudyVideo.play().then(() => setPlaybackState(true)).catch(() => setPlaybackState(false))
    } else {
      activeStudyVideo.pause()
      setPlaybackState(false)
    }
  },
  seekBy: (delta) => {
    if (!activeStudyVideo) return
    const duration = activeStudyVideo.duration
    const upperBound = Number.isFinite(duration) && duration >= 0 ? duration : Infinity
    const target = Math.min(upperBound, Math.max(0, activeStudyVideo.currentTime + delta))
    activeStudyVideo.currentTime = target
    useRainStore.setState({ playPosition: target })
  },
  adjustVolume: (delta) => {
    if (!activeStudyVideo) return
    activeStudyVideo.volume = Math.min(1, Math.max(0, activeStudyVideo.volume + delta))
  },
}
