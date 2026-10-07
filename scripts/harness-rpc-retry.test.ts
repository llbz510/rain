import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decideHarnessRetry, runCli, RETRYABLE_ERROR_MESSAGE } from './harness-rpc-retry'

/**
 * `Clean Windows Harness` 窄条件自动重试判据的公开裁判（测试先行）。
 *
 * ## 为什么这条判据存在
 *
 * 上游 vitest 3.2.7 的已知问题：worker 侧 RPC 带默认 60s 超时，收尾阶段报
 * `[vitest-worker]: Timeout calling "onTaskUpdate"` 作为**恰好一个未处理错误** → `exit 1`，
 * 但**零测试失败**。上游修复只随 vitest 4.x 发布、未回移 3.2.7。用户 **2026-10-01 批准**：
 * 给门禁加"窄条件自动重试一次"。本文件是那条语义的裁判。
 *
 * ## 样本来源（不手写、取自真实运行）
 *
 * `REAL_FLAKE_OUTPUT` 逐字复制自 GitHub Actions 真实失败日志（`Clean Windows Harness`
 * run `36664326244` 的 `Run repository Harness` step），只去掉了 gh 前缀与 ANSI 颜色码；
 * `Test Files` / `Tests` / `Errors` 三行与 `Unhandled Error` 段都是**原样**。
 * 其余样本由这一份**定向变异**得到（注入法），每个变异只改一处、用来证明对应条件真的在起作用。
 *
 * ## 每条都要能失败
 *
 * 每条 `it()` 都用"删掉/放宽判据里的某一条件就会红"的反例锚点配套：见 `describe('注入证明')`。
 */

const ROOT = process.cwd()

/**
 * 真实失败样本：`Clean Windows Harness` 在 `36664326244` 上判红的**完整尾部**（逐字）。
 * 注意 `Test Files` / `Tests` 两行**没有** `failed` 段，`Errors` 恰为 1。
 */
const REAL_FLAKE_OUTPUT = [
  ' ✓ scripts/gpu-release-bundle.test.ts (2 tests) 6ms',
  ' ✓ harness/m02-types.test.ts (2 tests) 4ms',
  '⎯⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯⎯',
  '',
  'Vitest caught 1 unhandled error during the test run.',
  'This might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.',
  '',
  '⎯⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯',
  'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
  ' ❯ Object.onTimeoutError node_modules/vitest/dist/chunks/rpc.-pEldfrD.js:53:10',
  ' ❯ Timeout._onTimeout node_modules/vitest/dist/chunks/index.B521nVV-.js:59:62',
  ' ❯ listOnTimeout node:internal/timers:585:17',
  ' ❯ processTimers node:internal/timers:521:7',
  '',
  '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯',
  '',
  '',
  ' Test Files  116 passed | 1 skipped (117)',
  '      Tests  988 passed | 1 skipped (989)',
  '     Errors  1 error',
  '   Start at  03:27:53',
  '   Duration  211.31s (transform 3.94s, setup 15.32s, collect 23.46s, tests 431.34s, environment 115.82s, prepare 18.49s)',
  '',
].join('\n')

/** 同一个样本但带 ANSI 颜色码（CI 上的真实形态），用来证明判定在无美化前做过。 */
const WITH_ANSI = `\u001b[31m⎯⎯⎯⎯⎯⎯⎯\u001b[39m\u001b[1m\u001b[41m Unhandled Errors \u001b[49m\u001b[22m\u001b[31m⎯⎯⎯⎯⎯⎯⎯\u001b[39m
\u001b[31m\u001b[1mError\u001b[22m:\u001b[39m\u001b[1m [vitest-worker]: Timeout calling "onTaskUpdate"\u001b[22m\u001b[39m
\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m116 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m1 skipped\u001b[39m\u001b[90m (117)\u001b[39m
\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m988 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m1 skipped\u001b[39m\u001b[90m (989)\u001b[39m
\u001b[2m     Errors \u001b[22m \u001b[1m\u001b[31m1 error\u001b[39m\u001b[22m\u001b[39m
`
// ANSI 样本里缺少 "Unhandled Error" 单数分节标题与 "Vitest caught …" 行，补齐以便与真实形态一致。
const WITH_ANSI_COMPLETE = WITH_ANSI.replace(
  '\u001b[31m\u001b[1mError\u001b[22m:',
  '\u001b[31m⎯⎯⎯⎯⎯⎯⎯\u001b[39m\u001b[1m\u001b[41m Unhandled Error \u001b[49m\u001b[22m\u001b[31m⎯⎯⎯⎯⎯⎯⎯\u001b[39m\n\u001b[31m\u001b[1mError\u001b[22m:',
)

/** 约定：任何"不得重试"的样本都要给出可读理由。 */
function expectNoRetry(exitCode: number, output: string, reasonPattern?: RegExp) {
  const decision = decideHarnessRetry({ exitCode, output })
  expect(decision.retry, `expected NO retry, got: ${JSON.stringify(decision)}`).toBe(false)
  if (reasonPattern) {
    expect(decision.retry ? '' : decision.reason).toMatch(reasonPattern)
  }
  return decision
}

describe('Harness 窄条件自动重试：允许重试的唯一样本', () => {
  it('① 真实 flake 样本（零测试失败 + 恰好一个 onTaskUpdate 未处理错误 + 退出码非 0）→ 允许重试', () => {
    const decision = decideHarnessRetry({ exitCode: 1, output: REAL_FLAKE_OUTPUT })
    expect(decision.retry, JSON.stringify(decision)).toBe(true)
    expect(decision.retry ? decision.reason : '').toBe('vitest-worker-rpc-timeout-with-zero-test-failures')
  })

  it('①b 带 ANSI 颜色码的真实形态同样允许（判定前必须先去掉颜色码）', () => {
    const decision = decideHarnessRetry({ exitCode: 1, output: WITH_ANSI_COMPLETE })
    expect(decision.retry, JSON.stringify(decision)).toBe(true)
  })

  it('①c 允许重试的签名是**精确字符串**，不是宽泛正则', () => {
    // 判据里用的常量必须逐字等于真实日志里那一行（规范化后）。
    expect(RETRYABLE_ERROR_MESSAGE).toBe('[vitest-worker]: Timeout calling "onTaskUpdate"')
    expect(REAL_FLAKE_OUTPUT).toContain(`Error: ${RETRYABLE_ERROR_MESSAGE}`)
  })
})

describe('Harness 窄条件自动重试：任何真实失败都不得重试', () => {
  it('② 有测试失败（Tests 行含 failed）→ 不得重试', () => {
    const output = REAL_FLAKE_OUTPUT.replace(
      '      Tests  988 passed | 1 skipped (989)',
      '      Tests  987 failed | 1 passed | 1 skipped (989)',
    )
    expectNoRetry(1, output, /Tests reports 987 failed/)
  })

  it('②b 有失败文件（Test Files 行含 failed）→ 不得重试', () => {
    const output = REAL_FLAKE_OUTPUT.replace(
      ' Test Files  116 passed | 1 skipped (117)',
      ' Test Files  1 failed | 115 passed | 1 skipped (117)',
    )
    expectNoRetry(1, output, /Test Files reports 1 failed/)
  })

  it('②c 两条摘要行都不见了（例如输出被截断）→ 不得重试（fail-closed）', () => {
    const output = REAL_FLAKE_OUTPUT.replace(' Test Files  116 passed | 1 skipped (117)\n', '').replace(
      '      Tests  988 passed | 1 skipped (989)\n',
      '',
    )
    expectNoRetry(1, output, /no "Test Files" summary line/)
  })

  it('②d 只有 Test Files 行、没有 Tests 行 → 不得重试', () => {
    const output = REAL_FLAKE_OUTPUT.replace('      Tests  988 passed | 1 skipped (989)\n', '')
    expectNoRetry(1, output, /no "Tests" summary line/)
  })
})

describe('Harness 窄条件自动重试：签名不同（别的未处理错误）不得重试', () => {
  it('③ 别的 `Timeout calling`（例如 "fetch"）→ 不得重试', () => {
    const output = REAL_FLAKE_OUTPUT.replace(
      'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
      'Error: [vitest-worker]: Timeout calling "fetch"',
    )
    expectNoRetry(1, output, /not the retryable signature/)
  })

  it('③b 别的 vitest-worker 错误（不是 timeout）→ 不得重试', () => {
    const output = REAL_FLAKE_OUTPUT.replace(
      'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
      'Error: [vitest-worker]: Worker exited unexpectedly',
    )
    expectNoRetry(1, output, /not the retryable signature/)
  })

  it('③c 完全不同的未处理错误 → 不得重试', () => {
    const output = REAL_FLAKE_OUTPUT.replace(
      'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
      'Error: read ECONNRESET',
    )
    expectNoRetry(1, output, /not the retryable signature/)
  })

  it('③d 消息带尾巴（前缀匹配也不行，必须精确相等）→ 不得重试', () => {
    const output = REAL_FLAKE_OUTPUT.replace(
      'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
      'Error: [vitest-worker]: Timeout calling "onTaskUpdate" (retrying)',
    )
    expectNoRetry(1, output, /not the retryable signature/)
  })
})

describe('Harness 窄条件自动重试：错误个数与退出码', () => {
  it('④ 有两个未处理错误 → 不得重试', () => {
    const output = REAL_FLAKE_OUTPUT.replace(
      '     Errors  1 error',
      '     Errors  2 errors',
    ).replace(
      'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
      'Error: [vitest-worker]: Timeout calling "onTaskUpdate"\nError: [vitest-worker]: Timeout calling "onTaskUpdate"',
    ).replace(' Unhandled Error ', ' Unhandled Error ').concat('⎯⎯⎯ Unhandled Error ⎯⎯⎯\n')
    expectNoRetry(1, output, /"Errors" summary declares 2 errors|exactly one/)
  })

  it('④b `Errors 1 error` 出现两次（两次运行拼在一份日志里）→ 不得重试', () => {
    const output = `${REAL_FLAKE_OUTPUT}\n${REAL_FLAKE_OUTPUT}`
    expectNoRetry(1, output, /exactly one "Errors <n> error\(s\)" summary line, found 2/)
  })

  it('④c 缺 `Errors` 摘要行 → 不得重试', () => {
    const output = REAL_FLAKE_OUTPUT.replace('     Errors  1 error\n', '')
    expectNoRetry(1, output, /exactly one "Errors <n> error\(s\)" summary line, found 0/)
  })

  it('⑤ 退出码为 0 → 不重试（无论输出长什么样）', () => {
    expectNoRetry(0, REAL_FLAKE_OUTPUT, /exit code is 0/)
    expectNoRetry(0, '', /exit code is 0/)
  })
})

describe('Harness 窄条件自动重试：CLI 接线（退出码即判定）', () => {
  it('读不到日志 → 不重试（fail-closed），退出码 1', () => {
    const result = runCli(['decide', join(ROOT, 'scripts', '__does-not-exist__.log'), '1'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toMatch(/^NO_RETRY=cannot read first-run log/)
  })

  it('用法错误 → 退出码 2', () => {
    expect(runCli([]).exitCode).toBe(2)
    expect(runCli(['decide']).exitCode).toBe(2)
  })

  it('退出码不是整数 → 不重试，退出码 1', () => {
    const result = runCli(['decide', join(ROOT, 'scripts', 'harness-rpc-retry.ts'), 'abc'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toMatch(/^NO_RETRY=exit code is not an integer/)
  })

  it('真实样本文件 → 允许重试，退出码 0（把样本写到临时文件再喂给 CLI）', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'rain-harness-retry-'))
    const logPath = join(dir, 'first-run.log')
    writeFileSync(logPath, REAL_FLAKE_OUTPUT, 'utf8')
    const result = runCli(['decide', logPath, '1'])
    expect(result.exitCode, result.stdout).toBe(0)
    expect(result.stdout).toBe('RETRY=vitest-worker-rpc-timeout-with-zero-test-failures\n')
  })

  it('真实失败样本（有测试失败）→ 不重试，退出码 1', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'rain-harness-retry-'))
    const logPath = join(dir, 'first-run.log')
    writeFileSync(logPath, REAL_FLAKE_OUTPUT.replace('988 passed', '987 failed | 1 passed'), 'utf8')
    const result = runCli(['decide', logPath, '1'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toMatch(/^NO_RETRY=/)
  })
})

/**
 * 注入证明：把判据里的每一条件单独"打瞎"，对应样本就会**错误地**允许重试。
 * 这不是又写一遍实现，而是证明上面那些 `it()` 真的绑在这四个条件上。
 */
describe('Harness 窄条件自动重试：注入证明（每条判据都有失败能力）', () => {
  it('把"零失败测试"这条打瞎（忽略 failed 段）会让「有测试失败」的样本误判为重试', () => {
    const output = REAL_FLAKE_OUTPUT.replace('      Tests  988 passed | 1 skipped (989)', '      Tests  987 failed | 1 passed | 1 skipped (989)')
    // 打瞎版：不看 failed 段，只看"有签名、Errors 恰 1"。
    const blind = (text: string) =>
      /\[vitest-worker\]: Timeout calling "onTaskUpdate"/.test(text) && /Errors\s+1\s+error/.test(text)
    expect(blind(output), '打瞎版必须放行该样本（否则这条注入无效）').toBe(true)
    expect(decideHarnessRetry({ exitCode: 1, output }).retry, '真判据必须拒绝').toBe(false)
  })

  it('把"精确签名"这条放宽成任何 `Timeout calling` 会让「fetch 超时」的样本误判为重试', () => {
    const output = REAL_FLAKE_OUTPUT.replace('"onTaskUpdate"', '"fetch"')
    const loose = (text: string) => /Timeout calling/.test(text)
    expect(loose(output), '宽泛正则必须放行该样本（证明"精确匹配"这条在起作用）').toBe(true)
    expect(decideHarnessRetry({ exitCode: 1, output }).retry, '真判据必须拒绝').toBe(false)
  })

  it('把"恰好一个错误"这条打瞎会让「两个错误」的样本误判为重试', () => {
    const output = REAL_FLAKE_OUTPUT.replace('     Errors  1 error', '     Errors  2 errors')
    const blind = (text: string) => /Errors\s+\d+\s+errors?/.test(text)
    expect(blind(output), '打瞎版必须放行该样本').toBe(true)
    expect(decideHarnessRetry({ exitCode: 1, output }).retry, '真判据必须拒绝').toBe(false)
  })

  it('把"退出码非 0"这条打瞎会让成功运行也被判为重试', () => {
    expect(decideHarnessRetry({ exitCode: 0, output: REAL_FLAKE_OUTPUT }).retry).toBe(false)
    const blind = () => true
    expect(blind(), '打瞎版会允许（证明这条在起作用）').toBe(true)
  })
})

describe('Harness 窄条件自动重试：workflow 接线（只改 harness.yml，不重实现命令链）', () => {
  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'harness.yml'), 'utf8')

  it('仍然调用唯一完整入口 `npm run harness:check`，没有重实现命令链', () => {
    expect(workflow).toMatch(/npm run harness:check/)
    // 不得把那串命令拆开重写（语义漂移风险）：
    for (const forbidden of ['npm run harness:control', 'npm run build:e2e', 'npm run test:rust', 'npm test']) {
      expect(workflow, `harness.yml 不得自己拼命令链：${forbidden}`).not.toContain(forbidden)
    }
  })

  it('重试判据来自同一个脚本文件，且只跑一次（不得出现第二个重试分支）', () => {
    expect(workflow).toMatch(/scripts\/harness-rpc-retry-cli\.mjs/)
    const decideCalls = [...workflow.matchAll(/harness-rpc-retry-cli\.mjs/g)].length
    expect(decideCalls, '判据只应被调用一次（第一次运行之后）').toBe(1)
    // 只重试一次：同一个完整入口最多出现两次（首次 + 一次重跑），不得有第三次。
    const checkCalls = [...workflow.matchAll(/npm run harness:check/g)].length
    expect(checkCalls, `唯一完整入口应恰好调用两次（首次 + 一次重跑），实际 ${checkCalls}`).toBe(2)
  })

  it('CLI 接线必须抑制 Node 的模块类型警告（否则 PowerShell 会把 stderr 噪音当错误）', () => {
    const cli = readFileSync(join(ROOT, 'scripts', 'harness-rpc-retry-cli.mjs'), 'utf8')
    expect(cli, '必须带 --no-warnings（本机实测：不加会把 [MODULE_TYPELESS_PACKAGE_JSON] 警告打进 stderr）').toMatch(
      /--no-warnings/,
    )
    expect(cli, '必须用类型剥离跑判据').toMatch(/--experimental-strip-types/)
    expect(cli, '判据崩了要 fail-closed（status 为 null 一律不重试）').toMatch(/child\.status === null \? 1 : child\.status/)
  })

  it('重试前把首次运行的退出码写进文件再读回（判定只认文件里的那个数）', () => {
    expect(workflow).toMatch(/harness-check-first-run\.exit-code/)
    // 先记码、再落盘：`$code = $LASTEXITCODE` 必须出现在 Set-Content 之前。
    const codeCapture = workflow.indexOf('$code = $LASTEXITCODE')
    const codeWrite = workflow.indexOf('harness-check-first-run.exit-code')
    expect(codeCapture, '必须显式把管道后的 $LASTEXITCODE 记进变量').toBeGreaterThan(-1)
    expect(codeWrite, '必须把退出码落盘').toBeGreaterThan(-1)
    expect(codeCapture, '先记码、再落盘').toBeLessThan(codeWrite)
    // 判据只从文件读退出码（而不是再从 shell 变量里捞）。
    expect(workflow).toMatch(/decide \$checkLog \$code/)
  })

  it('留痕：job summary 必须写明"是否用了恢复重试"', () => {
    expect(workflow).toMatch(/GITHUB_STEP_SUMMARY/)
    expect(workflow).toMatch(/窄条件自动重试已触发/)
    expect(workflow).toMatch(/第 1 次运行的退出码/)
    expect(workflow).toMatch(/只重试一次/)
    // 日志与注解也要留痕（不只是 summary）。
    expect(workflow).toMatch(/::warning::Narrow auto-retry triggered/)
    expect(workflow).toMatch(/::warning::Harness failed and the narrow retry condition did NOT match/)
  })

  it('重跑仍失败必须判红（不得吞掉），且首次运行日志作为 artifact 保留', () => {
    expect(workflow).toMatch(/exit \$retryCode/)
    expect(workflow).toMatch(/actions\/upload-artifact@v\d+/)
    expect(workflow).toMatch(/harness-check-first-run\.log/)
    // 未触发重试时用首次运行的退出码判红。
    expect(workflow).toMatch(/exit \$code/)
  })

  it('重跑的失败类别必须留痕：重跑日志的尾部必须无条件打印进 job 日志，并随首次运行日志一起上传', () => {
    expect(workflow).toMatch(/harness-check-retry\.log/)
    // 无条件打印尾部：不得"先挑摘要行、挑不到就什么都不打印"（实测 Select-String 在这份日志上
    // 会一行都挑不出来，于是最需要现场的时候反而留白）。
    expect(workflow).toMatch(/Get-Content -LiteralPath \$retryLog -Tail \d+/)
    expect(workflow).not.toMatch(/retry log: failure summary/)
    // upload 步骤必须同时纳入两份日志，且缺文件时不判错（首次即绿时本来就没有重跑日志）。
    const uploadAt = workflow.indexOf('actions/upload-artifact')
    expect(uploadAt).toBeGreaterThan(-1)
    const uploadBlock = workflow.slice(uploadAt)
    expect(uploadBlock, 'upload 必须同时上传首次运行日志与重跑日志').toMatch(/harness-check-first-run\.log[\s\S]*harness-check-retry\.log/)
    expect(uploadBlock, '缺文件（例如首次即绿）不得让 upload 步骤判错').toMatch(/if-no-files-found:\s*ignore/)
  })

  it('不得放宽超时 / 不设抑制开关 / 不加 skip', () => {
    for (const forbidden of [
      'dangerouslyIgnoreUnhandledErrors',
      'continue-on-error: true',
      '--no-verify',
      'timeout-minutes: 1',
    ]) {
      expect(workflow, `harness.yml 不得出现 ${forbidden}`).not.toContain(forbidden)
    }
  })
})
