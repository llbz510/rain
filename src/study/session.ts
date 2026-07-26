import { getDb } from '@/models/db-singleton'
import { updateVideoPosition } from '@/models/database'

export async function recordPlaybackProgress(
  videoId: string,
  position: number,
): Promise<void> {
  if (!videoId || !Number.isFinite(position) || position < 0) return
  await updateVideoPosition(await getDb(), videoId, position)
}
