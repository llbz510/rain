import { useEffect, useRef } from 'react'
import type { Node } from '@/models/types'
import { useRainStore } from '@/store/rain-store'
import type { StudyMediaActions } from '@/study/media-session'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.matches('input, textarea, select')) return true
  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    const contentEditable = element.getAttribute('contenteditable')
    if (contentEditable !== null) return contentEditable.trim().toLowerCase() !== 'false'
  }
  return target.isContentEditable
}

function currentParagraph(paragraphs: Node[], playPosition: number): Node | null {
  return paragraphs.find((paragraph) => (
    paragraph.startTime <= playPosition && playPosition < paragraph.endTime
  )) ?? null
}

export function useStudyShortcutController({
  nodes,
  onExcerpt,
  onNavigateParagraph,
  onTogglePanel,
  media,
}: {
  nodes: Node[]
  onExcerpt: (paragraphId: string) => void
  onNavigateParagraph: (paragraphId: string) => void
  onTogglePanel: (panel: 'ai' | 'notes') => void
  media: StudyMediaActions
}) {
  const hasEnteredPanelByShortcut = useRef(false)

  useEffect(() => {
    const paragraphs = nodes
      .filter((node) => node.kind === 'paragraph')
      .sort((left, right) => left.startTime - right.startTime || left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return

      const store = useRainStore.getState()
      const key = event.key.toLowerCase()
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.shiftKey && key !== 'arrowleft' && key !== 'arrowright') return
      const setLayout = (layoutMode: 'follow' | 'textExpand' | 'mapExpand') => {
        useRainStore.setState({ layoutMode })
      }
      const moveParagraph = (offset: -1 | 1) => {
        const current = currentParagraph(paragraphs, store.playPosition)
        if (!current) return
        const index = paragraphs.findIndex((paragraph) => paragraph.id === current.id)
        const target = paragraphs[index + offset]
        if (!target) return
        useRainStore.getState().selectNode(target.id, 'tree')
        onNavigateParagraph(target.id)
      }

      switch (key) {
        case '1':
          event.preventDefault()
          setLayout('follow')
          return
        case '2':
          event.preventDefault()
          setLayout('textExpand')
          return
        case '3':
          event.preventDefault()
          setLayout('mapExpand')
          return
        case '`': {
          event.preventDefault()
          const paragraph = currentParagraph(paragraphs, store.playPosition)
          if (paragraph) onExcerpt(paragraph.id)
          return
        }
        case ' ':
        case 'spacebar':
          event.preventDefault()
          media.togglePlayback()
          return
        case 'arrowleft':
          event.preventDefault()
          media.seekBy(event.shiftKey ? -10 : -5)
          return
        case 'arrowright':
          event.preventDefault()
          media.seekBy(event.shiftKey ? 10 : 5)
          return
        case 'arrowup':
          event.preventDefault()
          media.adjustVolume(0.1)
          return
        case 'arrowdown':
          event.preventDefault()
          media.adjustVolume(-0.1)
          return
        case 'n':
          event.preventDefault()
          moveParagraph(1)
          return
        case 'p':
          event.preventDefault()
          moveParagraph(-1)
          return
        case 'tab':
          event.preventDefault()
          if (!hasEnteredPanelByShortcut.current) {
            hasEnteredPanelByShortcut.current = true
            onTogglePanel('ai')
          } else {
            onTogglePanel(store.aiPanelState === 'ai' ? 'notes' : 'ai')
          }
          return
        case 'delete':
        case 'backspace':
          event.preventDefault()
          return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [nodes, onExcerpt, onNavigateParagraph, onTogglePanel, media])
}
