// src/architecture/module-registry.ts
// ========================================
// 模块注册表（决策92-93）
// ========================================

// LLM 调用函数列表（全部前端直连，决策92）
export const LLM_FUNCTIONS = [
  'callStage2',
  'callMerge',
  'streamAiChat',
] as const

// 前端专属模块（不经过 Rust IPC）
export const FRONTEND_ONLY_MODULES = [
  'llm',
  'database',
] as const
