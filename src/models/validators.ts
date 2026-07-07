// src/models/validators.ts
// ========================================
// 树形结构验证器
// ========================================

import type { Node, Stage2Output, ParagraphType, Note, Sentence } from './types'
import { PARAGRAPH_TYPES } from './types'

export function validateTree(nodes: Node[]): string[] {
  const errors: string[] = []
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  for (const node of nodes) {
    // 检查段落恒为叶子
    if (node.kind === 'paragraph') {
      const hasChildren = nodes.some(n => n.parentId === node.id)
      if (hasChildren) {
        errors.push(`Node ${node.id}: paragraph must be leaf node (cannot have children)`)
      }
    }

    // 检查子节点时间范围在父节点内
    if (node.parentId) {
      const parent = nodeMap.get(node.parentId)
      if (parent) {
        if (node.startTime < parent.startTime || node.endTime > parent.endTime) {
          errors.push(`Node ${node.id}: time range [${node.startTime}, ${node.endTime}] exceeds parent ${parent.id} range [${parent.startTime}, ${parent.endTime}]`)
        }
      }
    }
  }

  // 按父节点分组检查同级兄弟时间排序和重叠（每组只检查一次）
  const parentGroups = new Map<string | null, Node[]>()
  for (const node of nodes) {
    const key = node.parentId ?? '__root__'
    if (!parentGroups.has(key as any)) {
      parentGroups.set(key as any, [])
    }
    parentGroups.get(key as any)!.push(node)
  }

  for (const [, siblings] of parentGroups) {
    // 过滤掉空容器（没有子节点也没有句子的容器不参与时间排序检查）
    const nonEmptySiblings = siblings.filter(s => {
      if (s.kind === 'paragraph') return true
      // 容器：检查是否有子节点
      return nodes.some(n => n.parentId === s.id)
    })

    const sortedSiblings = [...nonEmptySiblings].sort((a, b) => a.sortOrder - b.sortOrder)
    
    for (let i = 0; i < sortedSiblings.length - 1; i++) {
      const curr = sortedSiblings[i]
      const next = sortedSiblings[i + 1]
      
      // 时间必须严格递增
      if (curr.startTime >= next.startTime) {
        errors.push(`Nodes ${curr.id} and ${next.id}: sibling time order violation (${curr.startTime} >= ${next.startTime})`)
      }
      
      // 不能重叠
      if (curr.endTime > next.startTime) {
        errors.push(`Nodes ${curr.id} and ${next.id}: sibling time overlap (${curr.endTime} > ${next.startTime})`)
      }
    }
  }

  return errors
}

export function validateStage2Output(output: Stage2Output, language?: string): string[] {
  const errors: string[] = []

  for (const chapter of output.chapters) {
    // 检查章节结构
    if (!chapter.title || chapter.title.trim() === '') {
      errors.push('Chapter must have non-empty title')
    }
    if (chapter.start < 0 || chapter.end <= chapter.start) {
      errors.push(`Chapter "${chapter.title}": invalid time range [${chapter.start}, ${chapter.end}]`)
    }

    for (const section of chapter.sections) {
      // 检查小节结构
      if (!section.title || section.title.trim() === '') {
        errors.push('Section must have non-empty title')
      }
      if (section.start < chapter.start || section.end > chapter.end) {
        errors.push(`Section "${section.title}": time range exceeds chapter range`)
      }

      for (const paragraph of section.paragraphs) {
        // 检查段落类型
        if (!paragraph.type || !PARAGRAPH_TYPES.includes(paragraph.type as ParagraphType)) {
          errors.push(`Paragraph "${paragraph.title}": invalid or missing type "${paragraph.type}"`)
        }

        // 检查段落时间范围
        if (paragraph.start < section.start || paragraph.end > section.end) {
          errors.push(`Paragraph "${paragraph.title}": time range exceeds section range`)
        }

        // 检查句子
        if (!paragraph.sentences || paragraph.sentences.length === 0) {
          errors.push(`Paragraph "${paragraph.title}": must have at least one sentence`)
        }

        for (const sentence of paragraph.sentences) {
          if (!sentence.id || !sentence.text) {
            errors.push(`Paragraph "${paragraph.title}": sentence missing id or text`)
          }
          if (sentence.start < paragraph.start || sentence.end > paragraph.end) {
            errors.push(`Paragraph "${paragraph.title}": sentence time range exceeds paragraph range`)
          }
        }
      }

      // 检查同级段落时间排序和重叠
      for (let i = 0; i < section.paragraphs.length - 1; i++) {
        const curr = section.paragraphs[i]
        const next = section.paragraphs[i + 1]
        if (curr.end > next.start) {
          errors.push(`Paragraphs "${curr.title}" and "${next.title}": time overlap detected`)
        }
      }
    }

    // 检查同级小节时间排序和重叠
    for (let i = 0; i < chapter.sections.length - 1; i++) {
      const curr = chapter.sections[i]
      const next = chapter.sections[i + 1]
      if (curr.end > next.start) {
        errors.push(`Sections "${curr.title}" and "${next.title}": time overlap detected`)
      }
    }
  }

  // 检查翻译字段（英文视频必须有，中文视频不应该有）
  if (language === 'en') {
    for (const chapter of output.chapters) {
      for (const section of chapter.sections) {
        for (const paragraph of section.paragraphs) {
          // 英文视频可以有 translation（不强制要求，因为可能没有翻译）
        }
      }
    }
  }

  return errors
}


export function validateNoteReferences(notes: Note[], sentences: Sentence[]): string[] {
  const errors: string[] = []
  const sentenceIds = new Set(sentences.map(s => s.id))

  for (const note of notes) {
    for (const sentenceId of note.sentenceIds) {
      if (!sentenceIds.has(sentenceId)) {
        errors.push(`Note ${note.id}: references non-existent sentence ${sentenceId}`)
      }
    }
  }

  return errors
}
