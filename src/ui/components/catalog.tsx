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
}

function getChildren(nodes: Node[], parentId: string | null): Node[] {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export function SideTree({ onSeek, playPosition: propPosition }: CatalogProps & { playPosition?: number }) {
  const nodes = useRainStore((s) => s.nodeTree)
  const selectedNodeId = useRainStore((s) => s.selectedNodeId)
  const selectNode = useRainStore((s) => s.selectNode)
  const storePosition = useRainStore((s) => s.playPosition)
  const playPosition = propPosition ?? storePosition

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
          data-selected={isSelected ? 'true' : 'false'}
          data-testid={`progress-indicator-${node.id}`}
          style={{ marginLeft: depth * 16, cursor: 'pointer' }}
          onClick={() => selectNode(node.id, 'tree')}
          onDoubleClick={() => onSeek?.(node.startTime)}
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

  return (
    <div data-testid="catalog-bar">
      {nodes.map((node) => (
        <span
          key={node.id}
          style={{ cursor: 'pointer' }}
          onClick={() => onSeek?.(node.startTime)}
        >
          {node.title}
        </span>
      ))}
    </div>
  )
}

export function DiagramZone({ onSeek }: CatalogProps) {
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
          onDoubleClick={() => onSeek?.(node.startTime)}
        >
          {node.title}
        </div>
      ))}
    </div>
  )
}
