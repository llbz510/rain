// src/pages/StudyInterface.tsx
// ========================================
// M16 三模式学习界面（Task 5 组装）
// 布局：CSS Grid 三列（左树 200px / 中间区 1fr / 右面板 320px）
//       三行（顶栏 40px / 中间区 1fr / 控制栏 80px 或 0）
// 区域显隐完全由 src/ui/layout.ts 的 getVisibility(layoutMode) 决定。
//   follow     → videoZone + textZone + catalogBar + sideTree + rightPanel
//   textExpand → controlBar + textZone + catalogBar + sideTree + rightPanel
//   mapExpand  → controlBar + diagramZone + textPreview + sideTree + rightPanel
// ========================================

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRainStore } from '@/store/rain-store'
import { getVisibility } from '@/ui/layout'
import { SideTree, CatalogBar, DiagramZone } from '@/ui/components/catalog'
import { VideoZone, VideoControls } from '@/ui/components/video'
import { TextPreview, TextZone, type TextScrollTarget } from '@/ui/components/text-zone'
import { NotesPanel } from '@/ui/components/notes'
import { AiAssistant, ChatInput, QuickActions } from '@/ui/components/ai-assistant'
import { redactSecret, streamAiChat } from '@/llm/client'
import { buildAssistantContext, type AssistantSource } from '@/ai/assistant-context'
import type { Node, ParagraphType, Sentence } from '@/models/types'
import { decideModelRoleAssignment } from '@/settings/model-capabilities'
import { runtimeModelFromPoolEntry } from '@/settings/model-pool'
import { resolveNodeNavigationTarget, resolveSentenceNavigationTarget } from '@/study/navigation'
import { recordPlaybackProgress } from '@/study/session'
import { createFreeNote, createParagraphExcerpt, saveNoteContent } from '@/study/notes'
import { useStudyShortcutController } from '@/study/shortcut-controller'
import { activeStudyMediaActions } from '@/study/media-session'

const rootStyle: React.CSSProperties = {
  display: 'grid',
  // 列：左树 / 中间 / 右面板（sideTree + rightPanel 在所有模式下恒显）
  gridTemplateColumns:
    'var(--side-tree-width, 200px) 1fr var(--right-panel-width, 320px)',
  background: 'var(--color-bg)',
  color: 'var(--color-fg)',
  height: '100vh',
  width: '100vw',
  overflow: 'hidden',
}

const topbarStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  gridRow: '1',
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-3)',
  padding: '0 var(--spacing-3)',
  background: 'var(--color-surface)',
  borderBottom: '1px solid var(--color-border)',
}

const backButtonStyle: React.CSSProperties = {
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

const titleStyle: React.CSSProperties = {
  flex: '1 1 auto',
  fontSize: 'var(--font-size-md)',
  fontWeight: 'var(--font-weight-semibold)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const sideTreeStyle: React.CSSProperties = {
  gridColumn: '1',
  gridRow: '2',
  overflow: 'auto',
  background: 'var(--color-surface)',
  borderRight: '1px solid var(--color-border)',
  padding: 'var(--spacing-2)',
}

// 中间区：纵向 flex，按可见性堆叠 videoZone / catalogBar / textZone / diagramZone / textPreview
const middleStyle: React.CSSProperties = {
  gridColumn: '2',
  gridRow: '2',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--color-bg)',
}

const flexFillStyle: React.CSSProperties = {
  flex: '1 1 0',
  minHeight: 0,
  overflow: 'auto',
}

const flexAutoStyle: React.CSSProperties = {
  flex: '0 0 auto',
}

const hiddenVideoStyle: React.CSSProperties = {
  display: 'none',
}

const rightPanelStyle: React.CSSProperties = {
  gridColumn: '3',
  gridRow: '2',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--color-surface)',
  borderLeft: '1px solid var(--color-border)',
}

const tabBarStyle: React.CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  borderBottom: '1px solid var(--color-border)',
}

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: '1 1 0',
    height: '36px',
    padding: 0,
    background: 'transparent',
    color: active ? 'var(--color-fg)' : 'var(--color-muted)',
    border: 'none',
    borderBottom: active
      ? '2px solid var(--color-accent)'
      : '2px solid transparent',
    fontSize: 'var(--font-size-sm)',
    fontWeight: active ? 'var(--font-weight-semibold)' : 'var(--font-weight-normal)',
    cursor: 'pointer',
  }
}

const tabContentStyle: React.CSSProperties = {
  flex: '1 1 0',
  minHeight: 0,
  overflow: 'auto',
  padding: 'var(--spacing-3)',
  display: 'flex',
  flexDirection: 'column',
}

const quickActionsStyle: React.CSSProperties = {
  flex: '0 0 auto',
  marginBottom: 'var(--spacing-3)',
}

const activeAiPanelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
}

const controlBarStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  gridRow: '3',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--spacing-3)',
  padding: '0 var(--spacing-3)',
  background: 'var(--color-surface)',
  borderTop: '1px solid var(--color-border)',
  overflow: 'hidden',
}

function currentSentence(sentences: Sentence[], position: number): Sentence | undefined {
  return sentences.find((sentence) => sentence.startTime <= position && position < sentence.endTime)
    ?? [...sentences].sort((left, right) => Math.abs(left.startTime - position) - Math.abs(right.startTime - position))[0]
}

function currentParagraphType(nodes: Node[], sentences: Sentence[], playPosition: number, selectedNodeId: string | null): ParagraphType | null {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const selected = selectedNodeId ? nodesById.get(selectedNodeId) : null
  if (selected?.kind === 'paragraph') return selected.type
  const active = currentSentence([...sentences].sort((left, right) => left.sortOrder - right.sortOrder), playPosition)
  const activeNode = active ? nodesById.get(active.nodeId) : null
  return activeNode?.kind === 'paragraph' ? activeNode.type : null
}

export function StudyInterface() {
  const layoutMode = useRainStore((s) => s.layoutMode)
  const aiPanelState = useRainStore((s) => s.aiPanelState)
  const playPosition = useRainStore((s) => s.playPosition)
  const unloadVideo = useRainStore((s) => s.unloadVideo)
  const currentVideoId = useRainStore((s) => s.currentVideoId)
  const filePath = useRainStore((s) => s.currentVideoFilePath)
  const videoTitle = useRainStore((s) => s.currentVideoTitle)
  const selectedNodeId = useRainStore((s) => s.selectedNodeId)
  const nodeTree = useRainStore((s) => s.nodeTree)
  const sentences = useRainStore((s) => s.sentences)
  const currentSubtitle = sentences.find(
    (sentence) => sentence.startTime <= playPosition && playPosition < sentence.endTime,
  )?.text

  // AI chat state
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string; sources?: AssistantSource[] }>>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [textScrollTarget, setTextScrollTarget] = useState<TextScrollTarget | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const requestIdRef = useRef(0)
  const navigationRequestIdRef = useRef(0)
  const aiInputRef = useRef<HTMLTextAreaElement>(null)
  const notesFocusRef = useRef<HTMLTextAreaElement>(null)
  const [panelFocusTarget, setPanelFocusTarget] = useState<'ai' | 'notes' | null>(null)
  useEffect(() => () => {
    requestIdRef.current += 1
    cleanupRef.current?.()
  }, [])

  const handleStopMessage = useCallback(() => {
    requestIdRef.current += 1
    cleanupRef.current?.()
    cleanupRef.current = null
    setIsStreaming(false)
  }, [])

  const handleSendMessage = useCallback((text: string, scope: 'nearby' | 'paragraph' = 'nearby') => {
    const store = useRainStore.getState()
    const selected = store.modelPool.find((model) => model.id === store.roleAssignment.assistant)
    const assistantModel = selected ? { ...selected } : null
    const capabilities = store.capabilityRecords.map((record) => ({ ...record }))
    if (
      !assistantModel
      || assistantModel.type !== 'llm'
      || !assistantModel.baseUrl?.trim()
      || !assistantModel.modelName.trim()
      || !assistantModel.apiKey?.trim()
    ) {
      setChatMessages((previous) => [...previous, { role: 'user', content: text }, { role: 'assistant', content: '请先在设置中配置可用的文本助手模型。' }])
      return
    }
    const decision = decideModelRoleAssignment(
      runtimeModelFromPoolEntry(assistantModel),
      'assistant',
      capabilities,
    )
    if (!decision.allowed) {
      const reason = redactSecret(decision.capability.message, [assistantModel.apiKey])
      setChatMessages((previous) => [...previous, { role: 'user', content: text }, { role: 'assistant', content: `助手模型“${assistantModel.alias}”不可用：${reason}` }])
      return
    }
    cleanupRef.current?.()
    cleanupRef.current = null
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const context = buildAssistantContext({ nodes: store.nodeTree, sentences: store.sentences, playPosition: store.playPosition, question: text, history: chatMessages, scope })
    const settings = {
      baseUrl: assistantModel.baseUrl,
      apiKey: assistantModel.apiKey,
      model: assistantModel.modelName,
    }
    let active = true
    let currentContent = ''
    setChatMessages((previous) => [...previous, { role: 'user', content: text }, { role: 'assistant', content: '', sources: context.sources }])
    setIsStreaming(true)
    const cleanup = streamAiChat([{ role: 'system', content: context.systemPrompt }, ...context.history, { role: 'user', content: text }], settings, {
      onToken: (token) => {
        if (!active || requestIdRef.current !== requestId) return
        currentContent += token
        setChatMessages((previous) => {
          const updated = [...previous]
          updated[updated.length - 1] = { role: 'assistant', content: currentContent, sources: context.sources }
          return updated
        })
      },
      onDone: () => { if (active && requestIdRef.current === requestId) { setIsStreaming(false); cleanupRef.current = null } },
      onError: (error) => {
        if (!active || requestIdRef.current !== requestId) return
        setIsStreaming(false); cleanupRef.current = null
        const safeMessage = redactSecret(error.message, [settings.apiKey])
        setChatMessages((previous) => {
          const updated = [...previous]
          updated[updated.length - 1] = { role: 'assistant', content: `请求失败：${safeMessage}`, sources: context.sources }
          return updated
        })
      },
    })
    cleanupRef.current = () => { active = false; cleanup() }
  }, [chatMessages])
  // 显隐完全交给布局状态机，不在此处重新实现逻辑（决策19）
  const visibility = getVisibility(layoutMode)

  // 拖动横条/导图节点 → 跳转播放位置
  const handleSeek = (time: number) => {
    useRainStore.setState({ playPosition: time })
  }

  const handlePlaybackProgress = useCallback((position: number) => {
    if (!currentVideoId) return
    void recordPlaybackProgress(currentVideoId, position).catch((error) => {
      console.error('Unable to persist study progress', error)
    })
  }, [currentVideoId])

  const handleNodeNavigate = useCallback((nodeId: string) => {
    const target = resolveNodeNavigationTarget(nodeTree, sentences, nodeId)
    if (!target) return

    navigationRequestIdRef.current += 1
    useRainStore.setState({ playPosition: target.time })
    setTextScrollTarget({
      paragraphId: target.paragraphId,
      requestId: navigationRequestIdRef.current,
    })
  }, [nodeTree, sentences])

  const handleSentenceNavigate = useCallback((sentenceId: string) => {
    const target = resolveSentenceNavigationTarget(sentences, sentenceId)
    if (!target) return

    navigationRequestIdRef.current += 1
    useRainStore.setState({ playPosition: target.time })
    setTextScrollTarget({
      paragraphId: target.paragraphId,
      requestId: navigationRequestIdRef.current,
    })
  }, [sentences])

  const handleExcerpt = useCallback((paragraphId: string) => {
    void createParagraphExcerpt(paragraphId).catch((error) => {
      console.error('Unable to create excerpt note', error)
    })
  }, [])

  const handleCreateFreeNote = useCallback(async (content: string = '') => {
    try {
      await createFreeNote(content)
      return true
    } catch (error) {
      console.error('Unable to create free note', error)
      return false
    }
  }, [])

  const handleSaveNote = useCallback((noteId: string, content: string) => {
    void saveNoteContent(noteId, content).catch((error) => {
      console.error('Unable to save note', error)
    })
  }, [])

  const setAiPanel = (panel: 'ai' | 'notes') => {
    useRainStore.setState({ aiPanelState: panel })
  }

  useEffect(() => {
    if (!panelFocusTarget) return
    const input = panelFocusTarget === 'ai' ? aiInputRef.current : notesFocusRef.current
    input?.focus()
    setPanelFocusTarget(null)
  }, [aiPanelState, panelFocusTarget])

  const handleShortcutPanelToggle = useCallback((panel: 'ai' | 'notes') => {
    setAiPanel(panel)
    setPanelFocusTarget(panel)
  }, [])

  useStudyShortcutController({
    nodes: nodeTree,
    onExcerpt: handleExcerpt,
    onNavigateParagraph: handleNodeNavigate,
    onTogglePanel: handleShortcutPanelToggle,
    media: activeStudyMediaActions,
  })

  const quickParagraphType = currentParagraphType(nodeTree, sentences, playPosition, selectedNodeId)

  // 控制栏隐藏时第 3 行塌缩为 0，避免浪费垂直空间
  const gridTemplateRows = `var(--height-topbar) 1fr ${
    visibility.controlBar ? 'var(--height-controlbar)' : '0px'
  }`

  return (
    <div
      data-testid="study-interface"
      style={{ ...rootStyle, gridTemplateRows }}
    >
      {/* 顶栏：返回 + 标题 */}
      <header style={topbarStyle}>
        <button onClick={() => unloadVideo()} style={backButtonStyle}>
          ← 返回
        </button>
        <span style={titleStyle}>{videoTitle || '视频'}</span>
      </header>

      {/* 左树：所有模式恒显 */}
      {visibility.sideTree && (
        <aside style={sideTreeStyle}>
          <SideTree onNavigateNode={handleNodeNavigate} playPosition={playPosition} />
        </aside>
      )}

      {/* 中间区：随模式变化 */}
      <section style={middleStyle}>
        <div
          data-testid="video-zone-shell"
          aria-hidden={!visibility.videoZone}
          style={visibility.videoZone ? flexFillStyle : hiddenVideoStyle}
        >
          <VideoZone
            filePath={filePath}
            currentSubtitle={currentSubtitle}
            resumePosition={playPosition}
            onProgress={handlePlaybackProgress}
          />
        </div>
        {visibility.catalogBar && (
          <div style={flexAutoStyle}>
            <CatalogBar onSeek={handleSeek} />
          </div>
        )}
        {visibility.textZone && (
          <div style={flexFillStyle}>
            <TextZone
              onSeek={handleSeek}
              onExcerpt={handleExcerpt}
              scrollTarget={textScrollTarget}
            />
          </div>
        )}
        {visibility.diagramZone && (
          <div style={flexFillStyle}>
            <DiagramZone onNavigateNode={handleNodeNavigate} />
          </div>
        )}
        {visibility.textPreview && (
          <div style={flexFillStyle}>
            <TextPreview selectedNodeId={selectedNodeId} onSeek={handleSeek} />
          </div>
        )}
      </section>

      {/* 右侧面板：Tab 切换 AI / 随记 */}
      {visibility.rightPanel && (
        <aside style={rightPanelStyle}>
          <div style={tabBarStyle}>
            <button
              onClick={() => setAiPanel('ai')}
              style={tabButtonStyle(aiPanelState === 'ai')}
            >
              AI
            </button>
            <button
              onClick={() => setAiPanel('notes')}
              style={tabButtonStyle(aiPanelState === 'notes')}
            >
              随记
            </button>
          </div>
          <div style={tabContentStyle}>
            <div
              hidden={aiPanelState !== 'ai'}
              style={aiPanelState === 'ai' ? activeAiPanelStyle : undefined}
            >
              {quickParagraphType && <div style={quickActionsStyle}><QuickActions paragraphType={quickParagraphType} onAction={(action) => handleSendMessage(action.label, 'paragraph')} /></div>}
              <AiAssistant messages={chatMessages} isStreaming={isStreaming} onStop={handleStopMessage} onSeekSource={handleSeek} />
              <ChatInput ref={aiInputRef} onSend={handleSendMessage} />
            </div>
            <div hidden={aiPanelState !== 'notes'}>
              <NotesPanel
                onCreateNote={handleCreateFreeNote}
                onSaveNote={handleSaveNote}
                onSeekSentence={handleSentenceNavigate}
                focusRef={notesFocusRef}
              />
            </div>
          </div>
        </aside>
      )}

      {/* 控制栏：textExpand / mapExpand 模式显示 */}
      {visibility.controlBar && (
        <footer style={controlBarStyle}>
          <VideoControls />
        </footer>
      )}
    </div>
  )
}
