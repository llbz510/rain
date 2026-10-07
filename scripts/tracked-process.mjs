/**
 * 可跟踪的**异步**子进程调用：这是本轮"消除长同步阻塞"的统一替换件。
 *
 * 为什么不能再用 `execFileSync` / `spawnSync` / `execSync`：
 * vitest 3.2.7 的 worker 通过 birpc 向主进程回调，每次调用都带一个 `setTimeout` 超时计时器。
 * 同步调用期间 worker **无法回到事件循环**，计时器就没机会按时触发；一旦阻塞超过该窗口，
 * 收尾时会抛 `[vitest-worker]: Timeout calling "onTaskUpdate"` —— 零测试失败、门禁却 exit 1。
 * 本地实测：`validate-visual-evidence.test.ts` 把 82 次同步 PowerShell 调用首尾相接成
 * **连续 39.3 秒**不回到事件循环（单次最长仅 0.7 秒）。
 *
 * 本模块保证：
 *  - `execFile` 异步执行，调用期间事件循环始终可调度（其余测试/计时器/日志照常推进）；
 *  - 持续消费 stdout/stderr，不会因为缓冲区写满而把子进程卡死（`execFile` 自带）；
 *  - 带超时；超时或清理时对**已记录的 pid** 发 SIGKILL，**杀不掉就如实失败**（fail-closed），
 *    绝不静默放过；
 *  - 返回值同时兼容两种旧语义：`status/stdout/stderr`（spawnSync 形态）与
 *    `status === 0 ? stdout : throw`（execFileSync 形态），用 `ok` 字段区分，避免误判。
 */
import { execFile } from 'node:child_process'

/** 默认预算：与 scripts 里既有的 PowerShell 合约预算保持一致 */
export const DEFAULT_PROCESS_TIMEOUT_MS = 60_000

/**
 * @typedef {object} TrackedProcessResult
 * @property {number|null} status 0 成功；非 0 是退出码；null 表示超时/被终止/未能启动
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} ok status === 0 的便捷判定
 * @property {boolean} timedOut
 * @property {string} [error] 失败原因
 * @property {number} [pid]
 */

/** @type {Set<{child: import('node:child_process').ChildProcess, exited: Promise<void>, terminate: () => void}>} */
const activeProcesses = new Set()

/**
 * 测试 afterEach/afterAll 用：把本轮启动过、还没退出的子进程全部杀掉。
 * 杀不掉就抛错（fail-closed），让"残留进程"显式失败而不是被忽略。
 */
export async function cleanupTrackedProcesses() {
  const pending = [...activeProcesses]
  const failures = []
  for (const active of pending) {
    if (active.child.exitCode !== null || active.child.signalCode !== null) continue
    try {
      active.terminate()
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  await Promise.all(pending.map((active) => active.exited))
  if (failures.length > 0) {
    throw new Error(`清理残留子进程失败：${failures.join('; ')}`)
  }
}

export function trackedProcessCount() {
  return activeProcesses.size
}

/**
 * 异步执行一个子进程，带超时与 pid 跟踪。
 *
 * 与 `execFileSync(..., { encoding: 'utf8', stdio: 'pipe' })` 的差异只有一处：
 * **不再阻塞事件循环**。成功时 `status === 0`、`stdout` 为完整标准输出。
 *
 * @param {string} executable
 * @param {readonly string[]} arguments_
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, maxBufferBytes?: number}} [options]
 * @returns {Promise<TrackedProcessResult>}
 */
export function runTrackedProcess(executable, arguments_, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS

  return new Promise((resolve) => {
    let settled = false
    let terminationFailed = false
    let terminationFailure
    let terminated = false
    let timeoutHandle
    let resolveExited
    const exited = new Promise((r) => {
      resolveExited = r
    })
    let child
    let active

    const settle = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const terminate = () => {
      if (terminated) {
        if (terminationFailure) throw terminationFailure
        return
      }
      terminated = true
      try {
        if (!child.kill('SIGKILL')) {
          throw new Error(`the child process rejected SIGKILL (pid ${child.pid})`)
        }
      } catch (error) {
        terminationFailed = true
        terminationFailure = error instanceof Error ? error : new Error(String(error))
        settle({
          status: null,
          stdout: '',
          stderr: '',
          ok: false,
          timedOut: true,
          error: `子进程超时（${timeoutMs} ms）但终止失败：${terminationFailure.message}`,
          pid: child?.pid,
        })
      }
    }

    try {
      child = execFile(
        executable,
        [...arguments_],
        {
          encoding: 'utf8',
          // 刻意**不设** windowsHide：本机实测它会改变子进程的 stdout 编码，
          // 把 PowerShell 输出里的非 ASCII 字符（例如 ②）变成 "??"，与同步版
          // （execFileSync，未设该选项）的字节不再一致。保持一致优先于隐藏窗口。
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.env === undefined ? {} : { env: options.env }),
          ...(options.maxBufferBytes === undefined ? {} : { maxBuffer: options.maxBufferBytes }),
        },
        (error, stdout, stderr) => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          if (active) activeProcesses.delete(active)
          resolveExited()
          const code = error?.code
          const status = terminated
            ? null
            : error
              ? typeof code === 'number'
                ? code
                : 1
              : 0
          settle({
            status,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
            ok: status === 0,
            timedOut: terminated && !terminationFailed,
            error: terminated
              ? terminationFailed
                ? `子进程超时（${timeoutMs} ms）但终止失败：${terminationFailure?.message}`
                : `子进程超时（${timeoutMs} ms）已被终止：${executable}`
              : error?.message,
            pid: child?.pid,
          })
        },
      )
    } catch (error) {
      // 连启动都失败（例如可执行文件不存在）：如实失败，不静默
      settle({
        status: null,
        stdout: '',
        stderr: '',
        ok: false,
        timedOut: false,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    active = { child, exited, terminate }
    activeProcesses.add(active)
    timeoutHandle = setTimeout(terminate, timeoutMs)
  })
}
