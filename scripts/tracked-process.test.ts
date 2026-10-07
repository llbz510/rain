import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PROCESS_TIMEOUT_MS,
  cleanupTrackedProcesses,
  runTrackedProcess,
  trackedProcessCount,
} from './tracked-process.mjs'

afterEach(async () => {
  await cleanupTrackedProcesses()
})

describe('异步可跟踪子进程：语义与同步版一致', () => {
  it('成功时 status=0、ok=true，stdout 完整返回（对应 execFileSync 的返回值）', async () => {
    const result = await runTrackedProcess(process.execPath, ['-e', 'process.stdout.write("hello\\n")'])
    expect(result.status).toBe(0)
    expect(result.ok).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.stdout).toBe('hello\n')
    expect(result.stderr).toBe('')
  })

  it('非 0 退出码原样返回（不再像 execFileSync 那样抛异常，调用方按 status 判定）', async () => {
    const result = await runTrackedProcess(process.execPath, ['-e', 'process.stdout.write("out"); process.exit(7)'])
    expect(result.status).toBe(7)
    expect(result.ok).toBe(false)
    expect(result.stdout).toBe('out')
    expect(result.timedOut).toBe(false)
  })

  it('stderr 与 stdout 分别捕获，互不混淆', async () => {
    const result = await runTrackedProcess(process.execPath, ['-e', 'process.stdout.write("o"); process.stderr.write("e")'])
    expect(result.stdout).toBe('o')
    expect(result.stderr).toBe('e')
  })

  it('cwd 生效（替换件必须能带上原来传的 cwd）', async () => {
    const result = await runTrackedProcess(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], {
      cwd: process.env.TEMP,
    })
    expect(result.status).toBe(0)
    expect(result.stdout.toLowerCase()).toBe(String(process.env.TEMP).toLowerCase())
  })

  it('可执行文件不存在时如实失败，不静默放过', async () => {
    const result = await runTrackedProcess('definitely-not-a-real-executable-rain.exe', [])
    // 语义对齐 Node 原生：ENOENT 下 execFileSync 抛出的错误 status 就是 1（不是 0），
    // 替换件必须同样"非成功"，并且把原因放在 error 里，绝不能看起来像成功。
    expect(result.ok).toBe(false)
    expect(result.status).toBe(1)
    expect(result.timedOut).toBe(false)
    expect(result.error ?? '').toMatch(/ENOENT|not found|系统找不到/i)
    expect(result.stdout).toBe('')
  })
})

describe('异步可跟踪子进程：事件循环必须保持可调度（这就是本轮的根因）', () => {
  it('子进程运行期间，同 worker 里的计时器仍能按时触发', async () => {
    const startedAt = Date.now()
    let timerFiredAt: number | null = null
    const timer = new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFiredAt = Date.now()
        resolve()
      }, 150)
    })

    // 子进程会忙 800ms；同步版在这 800ms 内计时器绝无可能触发
    const invocation = runTrackedProcess(process.execPath, ['-e', 'const t=Date.now(); while(Date.now()-t<800){}'])
    const first = await Promise.race([timer.then(() => 'timer'), invocation.then(() => 'child')])
    expect(first, '计时器必须先于子进程结束触发，否则说明调用把事件循环堵住了').toBe('timer')
    expect(timerFiredAt).not.toBeNull()
    expect(Date.now() - startedAt).toBeLessThan(800)

    const result = await invocation
    expect(result.status).toBe(0)
  })

  it('长时间的异步等待不会累积成"连续同步区间"（对照组：同步版会）', async () => {
    // 连续 5 个子进程，每个 120ms；若为同步实现，这 600ms 将是一整段不可调度区间。
    // 这里逐个 await，并断言期间计时器至少触发了多次。
    let ticks = 0
    const interval = setInterval(() => {
      ticks += 1
    }, 20)
    try {
      for (let i = 0; i < 5; i += 1) {
        await runTrackedProcess(process.execPath, ['-e', 'const t=Date.now(); while(Date.now()-t<120){}'])
      }
    } finally {
      clearInterval(interval)
    }
    expect(ticks, '异步实现下计时器应持续触发').toBeGreaterThan(5)
  })
})

describe('异步可跟踪子进程：超时与残留进程 fail-closed', () => {
  it('超时会 SIGKILL 子进程，并如实报告 status=null / timedOut=true', async () => {
    const startedAt = Date.now()
    const result = await runTrackedProcess(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { timeoutMs: 300 },
    )
    expect(result.status).toBeNull()
    expect(result.timedOut).toBe(true)
    expect(result.error).toContain('超时')
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })

  it('默认预算与仓库既有 PowerShell 合约预算同量级（60s）', () => {
    expect(DEFAULT_PROCESS_TIMEOUT_MS).toBe(60_000)
  })

  it('正常结束后不会有残留子进程被登记', async () => {
    await runTrackedProcess(process.execPath, ['-e', 'process.exit(0)'])
    expect(trackedProcessCount()).toBe(0)
  })

  it('清理钩子能杀掉仍在运行的子进程，并把它从登记表里摘掉', async () => {
    // 故意不 await：模拟测试结束时还挂着的子进程
    const hanging = runTrackedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 30_000 })
    // 等到它真的被登记
    for (let i = 0; i < 50 && trackedProcessCount() === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(trackedProcessCount()).toBeGreaterThan(0)

    await cleanupTrackedProcesses()
    expect(trackedProcessCount()).toBe(0)

    const result = await hanging
    expect(result.status).toBeNull()
    expect(result.timedOut).toBe(true)
  })
})
