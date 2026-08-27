// src/ui/components/catalog.tsx
// ========================================
// M05 目录区组件（决策20/38/40/48/56）
// ========================================

import React from 'react'
import { useRainStore } from '@/store/rain-store'
import { computeProgressIndicators } from '@/ui/catalog'
import type { Node } from '@/models/types'

interface CatalogProps {
  onSeek?: (time: number) => void
  onNavigateNode?: (nodeId: string) => void
}

function getChildren(nodes: Node[], parentId: string | null): Node[] {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

function nodeDepth(node: Node, nodesById: Map<string, Node>): number {
  let depth = 0
  let parentId = node.parentId
  const visited = new Set([node.id])
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = nodesById.get(parentId)
    if (!parent) break
    depth += 1
    parentId = parent.parentId
  }
  return depth
}

function currentNode(nodes: Node[], allNodes: Node[], position: number): Node | undefined {
  const nodesById = new Map(allNodes.map((node) => [node.id, node]))
  let current: Node | undefined
  for (const candidate of nodes) {
    if (candidate.startTime > position || position >= candidate.endTime) continue
    if (!current) {
      current = candidate
      continue
    }
    if (candidate.startTime !== current.startTime) {
      if (candidate.startTime > current.startTime) current = candidate
      continue
    }
    const candidateDepth = nodeDepth(candidate, nodesById)
    const currentDepth = nodeDepth(current, nodesById)
    if (candidateDepth !== currentDepth) {
      if (candidateDepth > currentDepth) current = candidate
      continue
    }
    const candidateKindSpecificity = candidate.kind === 'section' ? 1 : 0
    const currentKindSpecificity = current.kind === 'section' ? 1 : 0
    if (candidateKindSpecificity !== currentKindSpecificity) {
      if (candidateKindSpecificity > currentKindSpecificity) current = candidate
      continue
    }
    const candidateDuration = candidate.endTime - candidate.startTime
    const currentDuration = current.endTime - current.startTime
    if (candidateDuration !== currentDuration) {
      if (candidateDuration < currentDuration) current = candidate
      continue
    }
    if (candidate.sortOrder !== current.sortOrder) {
      if (candidate.sortOrder < current.sortOrder) current = candidate
      continue
    }
    if (candidate.id.localeCompare(current.id) < 0) current = candidate
  }
  return current
}

export function SideTree({ onSeek, onNavigateNode, playPosition: propPosition }: CatalogProps & { playPosition?: number }) {
  const nodes = useRainStore((s) => s.nodeTree)
  const selectedNodeId = useRainStore((s) => s.selectedNodeId)
  const selectNode = useRainStore((s) => s.selectNode)
  const storePosition = useRainStore((s) => s.playPosition)
  const playPosition = propPosition ?? storePosition
  const selectedNodeRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (selectedNodeId) {
      selectedNodeRef.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [selectedNodeId])

  const indicators = computeProgressIndicators(
    nodes.map((n) => ({ id: n.id, startTime: n.startTime, endTime: n.endTime })),
    playPosition
  )

  const topLevel = getChildren(nodes, null)

  const renderNode = (node: Node, depth: number = 0): React.ReactNode => {
    const children = getChildren(nodes, node.id)
    const isSelected = selectedNodeId === node.id
    const indicator = indicators[node.id] ?? 'empty'

    return (
      <div key={node.id}>
        <div
          ref={isSelected ? selectedNodeRef : undefined}
          data-selected={isSelected ? 'true' : 'false'}
          data-testid={`progress-indicator-${node.id}`}
          style={{ marginLeft: depth * 16, cursor: 'pointer' }}
          onClick={() => selectNode(node.id, 'tree')}
          onDoubleClick={() => {
            selectNode(node.id, 'tree')
            if (onNavigateNode) onNavigateNode(node.id)
            else onSeek?.(node.startTime)
          }}
        >
          <span>{indicator === 'filled' ? '■' : indicator === 'current' ? '▶' : '□'}</span>
          <span>{node.title}</span>
        </div>
        {children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return <div data-testid="side-tree">{topLevel.map((node) => renderNode(node))}</div>
}

export function CatalogBar({ onSeek }: CatalogProps) {
  const nodes = useRainStore((s) => s.nodeTree)
  const playPosition = useRainStore((s) => s.playPosition)
  const isPlaying = useRainStore((s) => s.isPlaying)
  const structureNodes = nodes.filter((node) => node.kind === 'chapter' || node.kind === 'section')
  const paragraphNodes = nodes.filter((node) => node.kind === 'paragraph')
  const currentStructureNode = currentNode(structureNodes, nodes, playPosition)
  const currentParagraphNode = currentNode(paragraphNodes, nodes, playPosition)
  const currentStructureRef = React.useRef<HTMLSpanElement>(null)
  const currentParagraphRef = React.useRef<HTMLSpanElement>(null)
  const previousStructureNodeId = React.useRef<string | null>(null)
  const previousParagraphNodeId = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!isPlaying) {
      previousStructureNodeId.current = null
      return
    }
    const currentNodeId = currentStructureNode?.id ?? null
    if (currentNodeId && previousStructureNodeId.current !== currentNodeId) {
      currentStructureRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
    }
    previousStructureNodeId.current = currentNodeId
  }, [currentStructureNode?.id, isPlaying])

  React.useEffect(() => {
    if (!isPlaying) {
      previousParagraphNodeId.current = null
      return
    }
    const currentNodeId = currentParagraphNode?.id ?? null
    if (currentNodeId && previousParagraphNodeId.current !== currentNodeId) {
      currentParagraphRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
    }
    previousParagraphNodeId.current = currentNodeId
  }, [currentParagraphNode?.id, isPlaying])

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'nowrap',
    gap: 'var(--spacing-2)',
    overflowX: 'auto',
  }

  const nodeStyle: React.CSSProperties = {
    cursor: 'pointer',
    flex: '0 0 auto',
    whiteSpace: 'nowrap',
  }

  const renderNode = (node: Node, currentNodeId: string | null, currentNodeRef: React.Ref<HTMLSpanElement>) => (
    <span
      key={node.id}
      ref={node.id === currentNodeId ? currentNodeRef : undefined}
      style={nodeStyle}
      onClick={() => onSeek?.(node.startTime)}
    >
      {node.title}
    </span>
  )

  return (
    <div data-testid="catalog-bar">
      <div data-catalog-row="structure" style={rowStyle}>{structureNodes.map((node) => renderNode(node, currentStructureNode?.id ?? null, currentStructureRef))}</div>
      <div data-catalog-row="paragraph" style={rowStyle}>{paragraphNodes.map((node) => renderNode(node, currentParagraphNode?.id ?? null, currentParagraphRef))}</div>
    </div>
  )
}

export function DiagramZone({ onSeek, onNavigateNode }: CatalogProps) {
  const nodes = useRainStore((s) => s.nodeTree)
  const selectedNodeId = useRainStore((s) => s.selectedNodeId)
  const selectNode = useRainStore((s) => s.selectNode)

  return (
    <div data-testid="diagram-zone">
      {nodes.map((node) => (
        <div
          key={node.id}
          data-selected={selectedNodeId === node.id ? 'true' : 'false'}
          style={{ cursor: 'pointer' }}
          onClick={() => selectNode(node.id, 'diagram')}
          onDoubleClick={() => {
            selectNode(node.id, 'diagram')
            if (onNavigateNode) onNavigateNode(node.id)
            else onSeek?.(node.startTime)
          }}
        >
          {node.title}
        </div>
      ))}
    </div>
  )
}
