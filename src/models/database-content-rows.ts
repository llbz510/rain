import type { Node, Sentence } from './types'
import type { TableRow } from './database-adapter'

export function nodeToRow(node: Node): TableRow {
  return {
    id: node.id,
    video_id: node.videoId,
    parent_id: node.parentId,
    kind: node.kind,
    title: node.title,
    type: node.type,
    start_time: node.startTime,
    end_time: node.endTime,
    text: node.text,
    translation: node.translation ?? null,
    sort_order: node.sortOrder,
  }
}

export function rowToNode(row: TableRow): Node {
  return {
    id: row.id,
    videoId: row.video_id,
    parentId: row.parent_id,
    kind: row.kind,
    title: row.title,
    type: row.type,
    startTime: row.start_time,
    endTime: row.end_time,
    text: row.text,
    translation: row.translation ?? undefined,
    sortOrder: row.sort_order,
  }
}

export function sentenceToRow(sentence: Sentence): TableRow {
  return {
    id: sentence.id,
    node_id: sentence.nodeId,
    text: sentence.text,
    start_time: sentence.startTime,
    end_time: sentence.endTime,
    sort_order: sentence.sortOrder,
  }
}

export function rowToSentence(row: TableRow): Sentence {
  return {
    id: row.id,
    nodeId: row.node_id,
    text: row.text,
    startTime: row.start_time,
    endTime: row.end_time,
    sortOrder: row.sort_order,
  }
}

export function assertSentenceIdsAvailable(rows: TableRow[], sentences: Sentence[]): void {
  const ids = new Set(rows.map((row) => row.id))
  for (const sentence of sentences) {
    if (ids.has(sentence.id)) {
      throw new Error(`Sentence already exists: ${sentence.id}`)
    }
    ids.add(sentence.id)
  }
}
