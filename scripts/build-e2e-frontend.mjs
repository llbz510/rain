import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildEnvironment = {
  ...process.env,
  RAIN_E2E_BUILD: '1',
}

function runNodeScript(relativeScript, args = []) {
  const result = spawnSync(
    process.execPath,
    [resolve(repositoryRoot, relativeScript), ...args],
    {
      cwd: repositoryRoot,
      env: buildEnvironment,
      stdio: 'inherit',
    },
  )

  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

runNodeScript('node_modules/typescript/bin/tsc')
runNodeScript('node_modules/vite/bin/vite.js', ['build'])
runNodeScript('scripts/verify-e2e-build-isolation.mjs', ['e2e'])
