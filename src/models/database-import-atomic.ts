import type { Node, Sentence } from './types'
import {
  asMemoryDatabase,
  isSqlDatabase,
  type Database,
} from './database-adapter'
import {
  assertSentenceIdsAvailable,
  nodeToRow,
  sentenceToRow,
} from './database-content-rows'

interface SentenceAssignment {
  id: string
  nodeId: string
  sortOrder: number
}

function toAssignments(sentences: Sentence[]): SentenceAssignment[] {
  return sentences.map((sentence) => ({
    id: sentence.id,
    nodeId: sentence.nodeId,
    sortOrder: sentence.sortOrder,
  }))
}

async function assertVideoExists(db: Database, videoId: string): Promise<void> {
  const exists = isSqlDatabase(db)
    ? (await db.query('SELECT * FROM video WHERE id = $1', [videoId])).length > 0
    : asMemoryDatabase(db).readTable('video').some((row) => row.id === videoId)
  if (!exists) throw new Error(`Video not found: ${videoId}`)
}

export async function saveAsrAtomically(
  videoId: string,
  language: string,
  sentences: Sentence[],
  database?: Database,
): Promise<void> {
  const db = database ?? await (await import('./db-singleton')).getDb()
  await assertVideoExists(db, videoId)
  const asrSentences = sentences.map((sentence) =>
    sentence.nodeId ? sentence : { ...sentence, nodeId: videoId })

  if (isSqlDatabase(db)) {
    const { tauriInvoke } = await import('@/lib/tauri-env')
    await tauriInvoke<void>('save_asr_atomically', {
      videoId,
      language,
      sentences: asrSentences,
    })
    return
  }

  const memory = asMemoryDatabase(db)
  const sentenceRows = memory.readTable('sentence')
  const videoRows = memory.readTable('video')
  const sentenceBackup = sentenceRows.map((row) => ({ ...row }))
  const videoBackup = videoRows.map((row) => ({ ...row }))
  try {
    const video = videoRows.find((row) => row.id === videoId)
    if (!video) throw new Error(`Video not found: ${videoId}`)
    if (video.status !== 'processing' || video.stage !== 'asr') {
      throw new Error(`Persisted import state changed for video "${videoId}"`)
    }
    for (const sentence of asrSentences) {
      assertSentenceIdsAvailable(sentenceRows, [sentence])
      sentenceRows.push(sentenceToRow(sentence))
    }
    video.language = language
    video.status = 'processing'
    video.stage = 'stage2'
    memory.replaceTable('sentence', sentenceRows)
    memory.replaceTable('video', videoRows)
  } catch (error) {
    memory.replaceTable('sentence', sentenceBackup)
    memory.replaceTable('video', videoBackup)
    throw error
  }
}

export async function assignAsrSentencesToNodes(
  db: Database,
  videoId: string,
  sentences: Sentence[],
): Promise<void> {
  const assignments = toAssignments(sentences)
  if (isSqlDatabase(db)) {
    const { tauriInvoke } = await import('@/lib/tauri-env')
    await tauriInvoke<void>('assign_asr_sentences_atomically', {
      videoId,
      assignments,
    })
    return
  }

  const memory = asMemoryDatabase(db)
  const rows = memory.readTable('sentence')
  const backup = rows.map((row) => ({ ...row }))
  const validNodeIds = new Set(
    memory.readTable('node')
      .filter((row) => row.video_id === videoId)
      .map((row) => row.id),
  )
  try {
    for (const assignment of assignments) {
      if (!validNodeIds.has(assignment.nodeId)) {
        throw new Error(`Cannot assign ASR sentence "${assignment.id}" to node "${assignment.nodeId}"`)
      }
      const row = rows.find((candidate) =>
        candidate.id === assignment.id && candidate.node_id === videoId)
      if (!row) {
        throw new Error(`Cannot assign ASR sentence "${assignment.id}" to node "${assignment.nodeId}"`)
      }
      row.node_id = assignment.nodeId
      row.sort_order = assignment.sortOrder
    }
    memory.replaceTable('sentence', rows)
  } catch (error) {
    memory.replaceTable('sentence', backup)
    throw error
  }
}

export async function mergeImportAtomically(
  db: Database,
  videoId: string,
  nodes: Node[],
  sentences: Sentence[],
): Promise<void> {
  const assignments = toAssignments(sentences)
  if (isSqlDatabase(db)) {
    const { tauriInvoke } = await import('@/lib/tauri-env')
    await tauriInvoke<void>('merge_import_atomically', { videoId, nodes, assignments })
    return
  }

  const memory = asMemoryDatabase(db)
  const nodeRows = memory.readTable('node')
  const sentenceRows = memory.readTable('sentence')
  const videoRows = memory.readTable('video')
  const nodeBackup = nodeRows.map((row) => ({ ...row }))
  const sentenceBackup = sentenceRows.map((row) => ({ ...row }))
  const videoBackup = videoRows.map((row) => ({ ...row }))
  try {
    const video = videoRows.find((row) => row.id === videoId)
    if (!video || video.status !== 'processing' || video.stage !== 'merging') {
      throw new Error(`Persisted import state changed for video "${videoId}"`)
    }

    const submittedNodeIds = new Set(nodes.map((node) => node.id))
    if (submittedNodeIds.size !== nodes.length) {
      throw new Error('Submitted node graph contains duplicate node IDs')
    }
    for (const node of nodes) {
      if (node.videoId !== videoId) throw new Error(`Cannot insert import node "${node.id}"`)
      if (node.parentId !== null && !submittedNodeIds.has(node.parentId)) {
        throw new Error(`Submitted node "${node.id}" has missing parent "${node.parentId}"`)
      }
    }

    const placeholderIds = sentenceRows
      .filter((row) => row.node_id === videoId)
      .map((row) => String(row.id))
    const assignmentIds = assignments.map((assignment) => assignment.id)
    const uniqueAssignmentIds = new Set(assignmentIds)
    if (
      assignmentIds.length !== placeholderIds.length
      || uniqueAssignmentIds.size !== assignmentIds.length
      || placeholderIds.some((id) => !uniqueAssignmentIds.has(id))
    ) {
      throw new Error('Sentence assignments must exhaust placeholder ASR sentences exactly once')
    }
    if (assignments.some((assignment) => !submittedNodeIds.has(assignment.nodeId))) {
      throw new Error('Sentence assignment targets a node outside the submitted graph')
    }

    const allNodeIds = new Set(nodeRows.map((row) => row.id))
    for (const node of nodes) {
      if (allNodeIds.has(node.id)) throw new Error(`Cannot insert import node "${node.id}"`)
      allNodeIds.add(node.id)
      nodeRows.push(nodeToRow(node))
    }
    for (const assignment of assignments) {
      const row = sentenceRows.find((candidate) =>
        candidate.id === assignment.id && candidate.node_id === videoId)
      if (!row) {
        throw new Error(`Cannot assign ASR sentence "${assignment.id}" to node "${assignment.nodeId}"`)
      }
      row.node_id = assignment.nodeId
      row.sort_order = assignment.sortOrder
    }
    video.status = 'ready'
    video.stage = null
    video.error_message = null
    memory.replaceTable('node', nodeRows)
    memory.replaceTable('sentence', sentenceRows)
    memory.replaceTable('video', videoRows)
  } catch (error) {
    memory.replaceTable('node', nodeBackup)
    memory.replaceTable('sentence', sentenceBackup)
    memory.replaceTable('video', videoBackup)
    throw error
  }
}
