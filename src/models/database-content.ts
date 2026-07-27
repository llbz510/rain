import type { Node, Sentence } from './types'
import {
  asMemoryDatabase,
  isSqlDatabase,
  type Database,
  type TableRow,
} from './database-adapter'
import {
  nodeToRow,
  rowToNode,
  rowToSentence,
  sentenceToRow,
} from './database-content-rows'

export async function insertNodes(db: Database, nodes: Node[]): Promise<void> {
  if (isSqlDatabase(db)) {
    for (const node of nodes) {
      const row = nodeToRow(node)
      await db.exec(
        'INSERT INTO node (id, video_id, parent_id, kind, title, type, start_time, end_time, text, translation, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        [
          row.id,
          row.video_id,
          row.parent_id,
          row.kind,
          row.title,
          row.type,
          row.start_time,
          row.end_time,
          row.text,
          row.translation,
          row.sort_order,
        ],
      )
    }
    return
  }

  const memory = asMemoryDatabase(db)
  const rows = memory.readTable('node')
  for (const node of nodes) rows.push(nodeToRow(node))
  memory.replaceTable('node', rows)
}

export async function getNodesByVideoId(db: Database, videoId: string): Promise<Node[]> {
  if (isSqlDatabase(db)) {
    const rows = await db.query<TableRow>('SELECT * FROM node WHERE video_id = $1', [videoId])
    return rows.map(rowToNode)
  }

  return asMemoryDatabase(db)
    .readTable('node')
    .filter((row) => row.video_id === videoId)
    .map(rowToNode)
}

export async function insertSentences(
  db: Database,
  sentences: Sentence[],
): Promise<void> {
  if (isSqlDatabase(db)) {
    for (const sentence of sentences) {
      const row = sentenceToRow(sentence)
      await db.exec(
        'INSERT INTO sentence (id, node_id, text, start_time, end_time, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          row.id,
          row.node_id,
          row.text,
          row.start_time,
          row.end_time,
          row.sort_order,
        ],
      )
    }
    return
  }

  const memory = asMemoryDatabase(db)
  const rows = memory.readTable('sentence')
  for (const sentence of sentences) rows.push(sentenceToRow(sentence))
  memory.replaceTable('sentence', rows)
}

export async function getSentencesByNodeId(
  db: Database,
  nodeId: string,
): Promise<Sentence[]> {
  if (isSqlDatabase(db)) {
    const rows = await db.query<TableRow>(
      'SELECT * FROM sentence WHERE node_id = $1 ORDER BY sort_order ASC',
      [nodeId],
    )
    return rows.map(rowToSentence)
  }

  return asMemoryDatabase(db)
    .readTable('sentence')
    .filter((row) => row.node_id === nodeId)
    .map(rowToSentence)
    .sort((left, right) => left.sortOrder - right.sortOrder)
}

export async function getSentencesByVideoId(
  db: Database,
  videoId: string,
): Promise<Sentence[]> {
  if (isSqlDatabase(db)) {
    const rows = await db.query<TableRow>(
      'SELECT sentence.* FROM sentence LEFT JOIN node ON sentence.node_id = node.id WHERE sentence.node_id = $1 OR node.video_id = $1 ORDER BY sentence.sort_order ASC',
      [videoId],
    )
    return rows.map(rowToSentence)
  }

  const memory = asMemoryDatabase(db)
  const nodeIds = new Set(
    memory.readTable('node')
      .filter((row) => row.video_id === videoId)
      .map((row) => row.id),
  )
  return memory.readTable('sentence')
    .filter((row) => row.node_id === videoId || nodeIds.has(row.node_id))
    .map(rowToSentence)
    .sort((left, right) => left.sortOrder - right.sortOrder)
}
