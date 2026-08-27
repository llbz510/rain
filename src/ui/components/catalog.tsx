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
  const structureNodes = nodes.filter((node) => node.kind === 'chapter' || node.kind === 'section')
  const paragraphNodes = nodes.filter((node) => node.kind === 'paragraph')

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

  const renderNode = (node: Node) => (
    <span
      key={node.id}
      style={nodeStyle}
      onClick={() => onSeek?.(node.startTime)}
    >
      {node.title}
    </span>
  )

  return (
    <div data-testid="catalog-bar">
      <div data-catalog-row="structure" style={rowStyle}>{structureNodes.map(renderNode)}</div>
      <div data-catalog-row="paragraph" style={rowStyle}>{paragraphNodes.map(renderNode)}</div>
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
