/**
 * `Clean Windows Harness` 的**窄条件自动重试**判据（纯函数，可单测）。
 *
 * ## 为什么需要它
 *
 * 上游 vitest 3.2.7 的已知问题：worker 侧 RPC 带默认 60s 超时
 * （`node_modules/vitest/dist/chunks/rpc.-pEldfrD.js` 的 `onTimeoutError`），收尾阶段报
 * `[vitest-worker]: Timeout calling "onTaskUpdate"` 作为**恰好一个未处理错误** →
 * `exit 1`，但**零测试失败**。上游修复只随 vitest 4.x 发布、未回移 3.2.7；升级属"测试引擎迁移"，
 * 不在当前范围内。因此它的表现是"**全绿却判红**"，会长期挡住与本改动无关的合并。
 *
 * ## 这个判据的边界（用户 2026-10-01 批准的确切语义）
 *
 * **只有同时满足下面全部条件才允许重试**，任何一条不满足都**不得**重试：
 *
 * 1. 退出码非 0；
 * 2. 零失败测试、零失败文件、零失败快照：`Test Files` 行与 `Tests` 行都**必须出现**，且都
 *    **不得**含 `failed` 段（`Test Files … X failed` 必须为 0，`Tests … X failed` 必须为 0）；
 * 3. **恰好一个**未处理错误：`Errors 1 error` 恰出现一次，且 `Unhandled Error` 段恰出现一次；
 * 4. 错误消息规范化后**精确匹配** `[vitest-worker]: Timeout calling "onTaskUpdate"`
 *    （**不**用宽泛正则：不匹配任何 `Timeout calling …`，也不匹配其它 `vitest-worker` 错误）；
 * 5. 只允许重试**一次**（由调用方保证；本函数只回答"这一次该不该重试"）。
 *
 * ## 为什么这是"窄"而不是"放宽门禁"
 *
 * 任何**真实的**失败都会在 `Test Files` / `Tests` 行留下 `failed` 段，于是第 2 条不成立、不重试；
 * 任何**别的**未处理错误（例如别的 `Timeout calling "fetch"`）会在第 4 条被拒。也就是说：
 * 这个判据只把"零测试失败 + 那一条精确签名"的红色当成基础设施抖动，其余一律照旧判红。
 *
 * 纯函数：不读环境、不读文件、不写任何东西、无副作用，输入即全部依据。
 */

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** ANSI 转义序列（vitest 在 CI 上给输出着色；判定必须在无色文本上做）。 */
const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g

/** `Errors` 摘要行的计数（`Errors 1 error` / `Errors 2 errors`）。 */
const ERRORS_SUMMARY_PATTERN = /^\s*Errors\s+(\d+)\s+errors?\s*$/
/** `Test Files` 摘要行。 */
const TEST_FILES_SUMMARY_PATTERN = /^\s*Test Files\s+(.+)$/
/** `Tests` 摘要行（不是 `Test Files`）。 */
const TESTS_SUMMARY_PATTERN = /^\s*Tests\s+(.+)$/
/** `Unhandled Error` 分节标题（不是复数 `Unhandled Errors` 那个总标题）。 */
const UNHANDLED_ERROR_SECTION_PATTERN = /Unhandled Error\b(?!s)/
/** 唯一允许重试的错误消息（规范化后精确相等）。 */
export const RETRYABLE_ERROR_MESSAGE = '[vitest-worker]: Timeout calling "onTaskUpdate"'

export interface HarnessRetryInput {
  /** 第一次运行的退出码。0 一律不重试。 */
  exitCode: number
  /** 第一次运行的完整 stdout + stderr（含 ANSI 也可以）。 */
  output: string
}

export type HarnessRetryDecision =
  | { retry: true; reason: 'vitest-worker-rpc-timeout-with-zero-test-failures' }
  | { retry: false; reason: string }

/** 去掉 ANSI 转义与行尾的 `\r`，并把非断行空白留给各行的正则去处理。 */
function normalize(raw: string): string[] {
  return raw
    .replace(ANSI_PATTERN, '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
}

/** 从一行里取出失败计数；没有 `failed` 段就是 0。 */
function failedCount(summaryLine: string): number {
  const match = summaryLine.match(/(\d+)\s+failed/)
  return match ? Number(match[1]) : 0
}

/**
 * 判定这一次 Harness 失败是否属于"可重试的那一种"。
 *
 * @returns `{ retry: true, reason }` 仅当上面 5 条全部成立；否则 `{ retry: false, reason }`，
 *          `reason` 是**可读的拒绝理由**（写进日志与 job summary，便于事后复核）。
 */
export function decideHarnessRetry(input: HarnessRetryInput): HarnessRetryDecision {
  const reject = (reason: string): HarnessRetryDecision => ({ retry: false, reason })

  if (input.exitCode === 0) {
    return reject('exit code is 0: nothing to retry')
  }

  const lines = normalize(input.output)
  const nonEmpty = lines.filter((line) => line.trim() !== '')

  // ---- 条件 2：零失败测试 / 零失败文件；两条摘要必须都在 --------------------
  const testFilesLines = nonEmpty.filter((line) => TEST_FILES_SUMMARY_PATTERN.test(line))
  if (testFilesLines.length === 0) {
    return reject('no "Test Files" summary line: cannot prove zero failing test files')
  }
  const testsLines = nonEmpty.filter((line) => TESTS_SUMMARY_PATTERN.test(line))
  if (testsLines.length === 0) {
    return reject('no "Tests" summary line: cannot prove zero failing tests')
  }
  // 取最后一条（多次运行时以最终摘要为准）。
  const testFilesFailed = failedCount(testFilesLines[testFilesLines.length - 1])
  const testsFailed = failedCount(testsLines[testsLines.length - 1])
  if (testFilesFailed > 0) {
    return reject(`Test Files reports ${testFilesFailed} failed: a real test-file failure must NOT be retried`)
  }
  if (testsFailed > 0) {
    return reject(`Tests reports ${testsFailed} failed: a real test failure must NOT be retried`)
  }

  // ---- 条件 3：恰好一个未处理错误 ------------------------------------------
  const errorsSummaryLines = nonEmpty.filter((line) => ERRORS_SUMMARY_PATTERN.test(line))
  if (errorsSummaryLines.length !== 1) {
    return reject(`expected exactly one "Errors <n> error(s)" summary line, found ${errorsSummaryLines.length}`)
  }
  const declaredErrors = Number(errorsSummaryLines[0].match(ERRORS_SUMMARY_PATTERN)![1])
  if (declaredErrors !== 1) {
    return reject(`"Errors" summary declares ${declaredErrors} errors: only exactly one is retryable`)
  }
  const unhandledSections = nonEmpty.filter((line) => UNHANDLED_ERROR_SECTION_PATTERN.test(line))
  if (unhandledSections.length !== 1) {
    return reject(`expected exactly one "Unhandled Error" section, found ${unhandledSections.length}`)
  }

  // ---- 条件 4：错误消息精确匹配 --------------------------------------------
  const errorMessages = collectErrorMessages(nonEmpty)
  if (errorMessages.length !== 1) {
    return reject(`expected exactly one "Error:" message in the unhandled-error block, found ${errorMessages.length}`)
  }
  if (errorMessages[0] !== RETRYABLE_ERROR_MESSAGE) {
    return reject(`unhandled error message is not the retryable signature: ${JSON.stringify(errorMessages[0])}`)
  }

  return { retry: true, reason: 'vitest-worker-rpc-timeout-with-zero-test-failures' }
}

/**
 * 抽出"未处理错误"块里的 `Error:` 消息（已规范化：去 ANSI、压缩内部空白、去首尾空白）。
 *
 * 只认 `Error` 开头的行；`❯ …js:48:10` 这类堆栈行没有 `Error` 前缀，自然被排除。
 */
function collectErrorMessages(lines: string[]): string[] {
  const start = lines.findIndex((line) => UNHANDLED_ERROR_SECTION_PATTERN.test(line))
  if (start < 0) return []
  const messages: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    // 摘要行意味着这个块结束了。
    if (TEST_FILES_SUMMARY_PATTERN.test(line) || TESTS_SUMMARY_PATTERN.test(line)) break
    const match = line.match(/(?:^|\s)Error:\s*(.+)$/)
    if (match) messages.push(match[1].replace(/\s+/g, ' ').trim())
  }
  return messages
}

/**
 * CLI 的**纯**部分：把 argv 变成"要打印什么 + 用什么退出码"。
 *
 * 做 I/O 的那一层（进程入口）单独放在 `scripts/harness-rpc-retry-cli.mjs`：
 * 本仓 `tsconfig.json` 的 `include` 只有 `src` 与 `harness`，但 `scripts/harness-rpc-retry.test.ts`
 * 会 import 本文件，**import 关系会把本文件拖进 `tsc --noEmit` 的检查**；而 ESM 下"是否被直接执行"
 * 的惯用判断要用 `import.meta`，在 CommonJS 目标下会报错。所以判据留 `.ts`（可单测、被类型检查），
 * 进程入口放 `.mjs`（不进类型检查）。
 *
 * 退出码即判定结果：**0 = 允许重试 / 1 = 不允许**，打印 `RETRY=<reason>` 或 `NO_RETRY=<reason>`。
 * 让退出码承载结论，workflow 侧就不必解析文本——接线越少越不容易错。
 */
export function runCli(argv: string[]): { stdout: string; exitCode: number } {
  const [command, logPath, rawExitCode] = argv
  if (command !== 'decide' || !logPath || rawExitCode === undefined) {
    return { stdout: 'usage: harness-rpc-retry decide <logFile> <exitCode>\n', exitCode: 2 }
  }
  const parsedExitCode = Number(rawExitCode)
  if (!Number.isInteger(parsedExitCode)) {
    return { stdout: `NO_RETRY=exit code is not an integer: ${JSON.stringify(rawExitCode)}\n`, exitCode: 1 }
  }
  let output: string
  try {
    output = readFileSync(logPath, 'utf8')
  } catch (cause) {
    // 读不到日志就无法证明"零测试失败"，一律不重试（fail-closed）。
    return { stdout: `NO_RETRY=cannot read first-run log ${JSON.stringify(logPath)}: ${String(cause)}\n`, exitCode: 1 }
  }
  const decision = decideHarnessRetry({ exitCode: parsedExitCode, output })
  return decision.retry
    ? { stdout: `RETRY=${decision.reason}\n`, exitCode: 0 }
    : { stdout: `NO_RETRY=${decision.reason}\n`, exitCode: 1 }
}

// ---- 进程入口：仅当本文件被 `node` **直接执行**时跑（被 import 时不跑）----
// 判据"我是不是入口"用 `process.argv[1]` 与 `import.meta.url` 比对，两条路径都过 `realpath`：
// Windows 上 `argv[1]` 与 `import.meta.url` 的大小写/短名/符号链接形态可能不同。
const invokedAsScript = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (invokedAsScript) {
  const result = runCli(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.exit(result.exitCode)
}


