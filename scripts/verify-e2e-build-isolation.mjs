import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const mode = process.argv[2] ?? (process.env.RAIN_E2E_BUILD === '1' ? 'e2e' : 'production')
if (mode !== 'production' && mode !== 'e2e') {
  throw new Error('Usage: node scripts/verify-e2e-build-isolation.mjs <production|e2e>')
}

const distDirectory = resolve(process.cwd(), 'dist')

async function listBuildTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listBuildTextFiles(path))
    else if (
      entry.isFile()
      && (entry.name.endsWith('.js') || entry.name.endsWith('.js.map'))
    ) files.push(path)
  }
  return files
}

const markers = [
  '__RAIN_E2E_RESULT__',
  '__RAIN_RUNTIME_SETTINGS_SCHEMA__',
  'rain-real-e2e-status',
]
const files = await listBuildTextFiles(distDirectory)
const javaScriptFiles = files.filter((file) => file.endsWith('.js'))
if (javaScriptFiles.length === 0) throw new Error(`No JavaScript build output found under ${distDirectory}`)

const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')))
const presentMarkers = markers.filter((marker) => contents.some((content) => content.includes(marker)))

if (mode === 'production' && presentMarkers.length > 0) {
  throw new Error(`Production bundle contains E2E automation markers: ${presentMarkers.join(', ')}`)
}
if (mode === 'e2e' && presentMarkers.length !== markers.length) {
  const missingMarkers = markers.filter((marker) => !presentMarkers.includes(marker))
  throw new Error(`E2E bundle is missing automation markers: ${missingMarkers.join(', ')}`)
}

console.log(`${mode} bundle E2E isolation check passed across ${files.length} JavaScript/source-map files.`)
