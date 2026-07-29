const SQL_PLUGIN = '@tauri-apps/plugin-sql'
const SQL_PLUGIN_OWNER = 'src/models/database.ts'
const FRONTEND_TRANSACTION_SQL = /\b(?:exec|execute)\s*\(\s*['"`]\s*(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i
const INTERNAL_DATABASE_MODULE = /(?:^|\/)models\/database-[^/]+(?:\.[cm]?[jt]sx?)?$/

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}

function moduleSpecifiers(source) {
  const moduleLoad = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g
  return [...new Set(Array.from(source.matchAll(moduleLoad), (match) => match[1]))]
}

function importsModule(source, moduleName) {
  return moduleSpecifiers(source).includes(moduleName)
}

export function validateDatabaseArchitectureSources(sources) {
  const errors = []

  for (const [inputPath, source] of Object.entries(sources)) {
    const path = normalizePath(inputPath)
    if (path !== SQL_PLUGIN_OWNER && importsModule(source, SQL_PLUGIN)) {
      errors.push(`${path} loads ${SQL_PLUGIN} outside ${SQL_PLUGIN_OWNER}.`)
    }

    if (!path.startsWith('src/models/')) {
      for (const specifier of moduleSpecifiers(source)) {
        if (INTERNAL_DATABASE_MODULE.test(specifier)) {
          errors.push(`${path} imports internal database module ${specifier} outside src/models.`)
        }
      }
    }

    if (FRONTEND_TRANSACTION_SQL.test(source)) {
      errors.push(`${path} orchestrates a frontend SQL transaction; use one Rust transaction command.`)
    }
  }

  return errors.sort()
}
