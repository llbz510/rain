// src/architecture/ytdlp-check.ts
// ========================================
// yt-dlp 可用性检测（决策95）
// ========================================

export interface YtdlpCheckResult {
  available: boolean
  message?: string
}

const YT_DLP_INSTALL_GUIDE =
  'yt-dlp 未安装。请访问 https://github.com/yt-dlp/yt-dlp 下载安装并添加到 PATH。'

const YT_DLP_AVAILABLE = 'yt-dlp 可用'

/// 检测是否在 Tauri 环境中运行
function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/// 真实检测：调用 Tauri invoke('check_ytdlp_command')
/// 测试环境（jsdom）：返回可用状态（Tauri 不可用时的 fallback）
export async function checkYtdlpAvailability(): Promise<YtdlpCheckResult> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const result = await invoke<YtdlpCheckResult>('check_ytdlp_command')
      return result
    } catch (e) {
      return {
        available: false,
        message: YT_DLP_INSTALL_GUIDE,
      }
    }
  }

  // 非 Tauri 环境（开发/测试）：返回可用
  return {
    available: true,
    message: YT_DLP_AVAILABLE,
  }
}

/// 不可用时的标准结果（用于前端展示安装指引）
export function getYtdlpUnavailableResult(): YtdlpCheckResult {
  return {
    available: false,
    message: YT_DLP_INSTALL_GUIDE,
  }
}

/// 作为值导出（便于测试引用类型/工厂方法）
export const YtdlpCheckResult = {
  unavailable(): YtdlpCheckResult {
    return {
      available: false,
      message: YT_DLP_INSTALL_GUIDE,
    }
  },
  available(): YtdlpCheckResult {
    return {
      available: true,
      message: YT_DLP_AVAILABLE,
    }
  },
}
