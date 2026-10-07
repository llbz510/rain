/**
 * `Clean Windows Harness` 窄条件自动重试判据的 **CLI 接线**（薄薄一层）。
 *
 * 判据本体与它的进程入口都在 `scripts/harness-rpc-retry.ts`（纯函数 `decideHarnessRetry` + `runCli`，
 * 由 `scripts/harness-rpc-retry.test.ts` 裁判）。本文件只负责把那个 TypeScript 用 Node 的
 * **类型剥离**跑起来——`--experimental-strip-types` 自 Node 22.6 起可用、22.18/23.6 起默认开启；
 * 本仓 CI 用 Node 22，显式给上可避免随小版本行为不同。
 *
 * 用法：
 *   node scripts/harness-rpc-retry-cli.mjs decide <firstRunLogFile> <firstRunExitCode>
 *     → 允许重试：打印 `RETRY=<reason>`，**退出码 0**
 *     → 不允许  ：打印 `NO_RETRY=<reason>`，**退出码 1**
 *
 * 结论编码在**退出码**里，workflow 侧因此不必解析文本。
 * 本文件与 `scripts/**` 一样不在 `tsconfig.json` 的 `include` 内，故不会被类型检查牵连。
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const predicatePath = join(here, 'harness-rpc-retry.ts')

// `--no-warnings` 是必需的（本机实测）：判据文件是 `.ts` 而本仓 `package.json` 没有
// `"type": "module"`，Node 运行它时会往 stderr 打一条 `[MODULE_TYPELESS_PACKAGE_JSON]` 警告；
// PowerShell 会把子进程的 stderr 包成 NativeCommandError 噪音，把真正的结论淹掉。
const child = spawnSync(
  process.execPath,
  ['--no-warnings', '--experimental-strip-types', predicatePath, ...process.argv.slice(2)],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)

if (child.error) {
  process.stdout.write(`NO_RETRY=cannot run retry predicate: ${String(child.error)}\n`)
  process.exit(1)
}
if (child.stdout) process.stdout.write(child.stdout)
if (child.stderr) process.stderr.write(child.stderr)
// 判据用退出码表达结论；判据自己崩了（status 为 null）一律按"不重试"处理（fail-closed）。
process.exit(child.status === null ? 1 : child.status)
