import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * AST 级守卫：这些测试文件里**不得再出现同步子进程调用**。
 *
 * 为什么必须有这条守卫（根因，别再退回去）：
 * vitest 3.2.7 的 worker 通过 birpc 回调主进程，调用带超时（超时计时器是 `setTimeout`）。
 * 一个 worker 只要**长时间不回到事件循环**，那个计时器就永远没机会按时触发，收尾时会抛
 * `[vitest-worker]: Timeout calling "onTaskUpdate"` —— 零测试失败、却 exit 1。
 *
 * 本地实测（探针逐次计时）：`validate-visual-evidence.test.ts` 一条链上串了 82 次同步
 * PowerShell 调用、**连续 39.3 秒不回到事件循环**（单次最长只有 0.7 秒 —— 所以问题不是
 * "某一次太慢"，而是"一长串首尾相接"）。托管 runner 更慢、多 worker 并发时这段只会更长。
 *
 * 因此：单个调用再快也不够，**必须让每次调用都让出事件循环**（异步化）。
 * 这条守卫用 AST 判定（不是字符串匹配），避免".sync 出现在注释/字符串里"误报，
 * 也避免"换个写法绕过"。
 */
const repoRoot = join(__dirname, '..')

/** 已改造完成、必须保持为 0 的文件（守卫严格绑定这些） */
const convertedFiles = [
  'scripts/validate-visual-evidence.test.ts',
]

/**
 * 待改造清单：本轮已逐个实测出阻塞量级，但尚未异步化的文件。
 *
 * 为什么允许它们暂时留着：**先说清量级**。本地探针实测（15 个文件、189 次同步调用、
 * 同步总时长 73.8 秒）显示，最长的一段连续同步区间 **39.3 秒**里串了 **82 次**调用，
 * 而其中 **79 次**是 `scripts/validate-visual-evidence.ps1` —— 全部来自上面那个已改造的文件。
 * 其余文件的**整文件**同步总时长都在 8 秒以内（次高 7.9 秒）。也就是说：
 * 先改这一个文件就移除了那段最长区间；剩下的量级目前不足以单独撑起一次 RPC 窗口错过。
 *
 * 但这不是"可以永远留着"：下面这份清单必须逐项清零，改完一项就从这里删一项
 * （删除即由上面的严格断言接管）。等它们全部清零后，本清单与本段说明一并删除。
 */
const pendingFiles = [
  'scripts/controlled-owned-directory.test.ts', // 实测 7 次调用
  'scripts/generate-nvidia-evidence-admin-launcher.test.ts', // 6 次
  'scripts/validate-evidence.test.ts', // 4 次调用 / 整文件 7.9 秒
  'scripts/build-whisper-cuda-worker.test.ts', // 4 次
  'scripts/nvidia-release-evidence.test.ts', // 3 次
  'scripts/controlled-candidate-source.test.ts', // 3 次
  'scripts/controlled-toolchain-install.test.ts', // 2 次
  'scripts/controlled-gpu-artifact-build.workflow.test.ts', // 2 次
  'scripts/release-artifact-import-output.test.ts', // 2 次
  'scripts/controlled-native-tool-probe.test.ts', // 2 次
  'scripts/injected-scripts-parse.test.ts', // 1 次
  'scripts/release-artifact-generator.test.ts', // 1 次
  'scripts/verify-e2e-build-isolation.test.ts', // 1 次
  'scripts/controlled-build-disk.test.ts', // 1 次
]

/** 本轮治理范围 = 已改造 + 待改造（共 15 个） */
const guardedFiles = [...convertedFiles, ...pendingFiles]

const forbiddenApis = [
  'execFileSync',
  'execSync',
  'spawnSync',
  'execFileSync as',
]

/**
 * 只认「真的调用了同步子进程 API」：
 *  - `foo.execFileSync(...)` / `execFileSync(...)` 这类**调用表达式**，或
 *  - 从 child_process 的 import 里出现同步 API 名字（防止用别名绕过）。
 * 刻意不匹配注释与普通字符串：用 TS 的 AST 解析，只有标识符/属性访问节点才算数。
 */
function findSyncCalls(source: string): string[] {
  const ts = require('typescript') as typeof import('typescript')
  const sourceFile = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
  const hits: string[] = []
  const lineOf = (node: { getStart: (sf?: unknown) => number }) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

  const walk = (node: import('typescript').Node): void => {
    // 调用表达式：execFileSync(...) 或 cp.execFileSync(...)
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : ''
      if (['execFileSync', 'execSync', 'spawnSync'].includes(name)) {
        hits.push(`行 ${lineOf(node)}: 同步调用 ${name}()`)
      }
    }
    // import { execFileSync } from 'node:child_process' —— 只要还导进来就说明还能用
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text
      if (from === 'node:child_process' || from === 'child_process') {
        const bindings = node.importClause?.namedBindings
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = element.propertyName?.text ?? element.name.text
            if (['execFileSync', 'execSync', 'spawnSync'].includes(imported)) {
              hits.push(`行 ${lineOf(node)}: 仍从 ${from} 导入 ${imported}`)
            }
          }
        }
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  return hits
}

describe('AST 守卫：脚本测试不得再用同步子进程调用', () => {
  it('已改造的文件里，同步子进程调用必须为 0（一条都不许剩）', () => {
    const offenders: string[] = []
    for (const relative of convertedFiles) {
      const source = readFileSync(join(repoRoot, relative), 'utf8')
      const hits = findSyncCalls(source)
      if (hits.length > 0) offenders.push(`${relative}\n    ${hits.join('\n    ')}`)
    }
    expect(offenders, `仍在使用同步子进程调用（会阻塞 worker 事件循环）：\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  it('待改造清单只能缩小：清单里每一条都真的还有同步调用（改完必须从清单删掉）', () => {
    // 这条断言的作用是"防止清单僵化"：如果有人把某个文件改造完了却忘记从 pendingFiles 删掉，
    // 这条会失败并点名，逼着把清单清空——否则"待改造"会变成永久的借口。
    const stale: string[] = []
    for (const relative of pendingFiles) {
      const source = readFileSync(join(repoRoot, relative), 'utf8')
      if (findSyncCalls(source).length === 0) stale.push(relative)
    }
    expect(stale, `这些文件已经不含同步子进程调用了，请从 pendingFiles 删除：\n  ${stale.join('\n  ')}`).toEqual([])
  })

  it('注入证明：分析器必须能抓到同步调用（否则这条守卫是空断言）', () => {
    const samples: [string, string][] = [
      ['直接调用', `import { execFileSync } from 'node:child_process'\nexecFileSync('powershell.exe', ['-File', 'x.ps1'])`],
      ['命名空间调用', `import * as cp from 'node:child_process'\ncp.spawnSync('git', ['status'])`],
      ['动态导入后调用', `const cp = await import('node:child_process')\ncp.execSync('git status')`],
      ['别名导入', `import { execFileSync as run } from 'node:child_process'\nrun('x', [])`],
      ['仅导入未调用', `import { spawnSync } from 'node:child_process'\nexport const x = 1`],
    ]
    for (const [label, source] of samples) {
      expect(findSyncCalls(source).length, `注入样本必须被抓到：${label}`).toBeGreaterThan(0)
    }
  })

  it('不误报：注释与字符串里出现这些名字不算违规，异步版本也不算', () => {
    const benign = [
      `// execFileSync 曾经在这里，现在改成异步了\nexport const x = 1`,
      `const text = 'execSync 是同步的'\nexport const y = text`,
      `import { execFile } from 'node:child_process'\nexecFile('x', [], () => {})`,
      `import { spawn } from 'node:child_process'\nconst child = spawn('git', ['status'])`,
    ]
    for (const source of benign) {
      expect(findSyncCalls(source), `不该误报：${source.split('\n')[0]}`).toEqual([])
    }
  })

  it('守卫自身覆盖到的是真实存在的文件（防止清单写错而静默失效）', () => {
    for (const relative of guardedFiles) {
      expect(() => readFileSync(join(repoRoot, relative), 'utf8'), `${relative} 必须存在`).not.toThrow()
    }
    expect(guardedFiles.length).toBe(15)
    expect(forbiddenApis.length).toBeGreaterThan(0)
  })
})
