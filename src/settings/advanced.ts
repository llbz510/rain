// src/settings/advanced.ts
// ========================================
// 高级设置
// ========================================

let chunkThreshold = 0.33

export function getChunkThreshold(): number {
  return chunkThreshold
}

export function setChunkThreshold(value: number): void {
  chunkThreshold = value
}
