import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const GENERATED_DIRECTORIES = new Set([
  '.git',
  '.worktrees',
  'dist',
  'node_modules',
  'target',
])

function parseAcceptanceCriteria(source) {
  const headings = [...source.matchAll(/^###\s+(AC-[A-Z]+-\d+)\b.*$/gm)]
  return headings.map((match, index) => {
    const start = match.index + match[0].length
    const end = headings[index + 1]?.index ?? source.length
    const block = source.slice(start, end)
    const status = block.match(/^状态：[ \t]*`?([^`\s]+)`?[ \t]*$/m)?.[1] ?? ''
    const owner = block.match(/^实现归属：[ \t]*(.*?)[ \t]*$/m)?.[1] ?? ''
    const judge = block.match(/^裁判：[ \t]*(.*?)[ \t]*$/m)?.[1] ?? ''
    return { id: match[1], status, owner, judge }
  })
}

function parseCoverageRows(source) {
  return source.split(/\r?\n/).flatMap((line) => {
    if (!/^\|\s*AC-[A-Z]+-\d+\s*\|/.test(line)) return []
    const columns = line.split('|').slice(1, -1).map((column) => column.trim())
    return [{ id: columns[0], judges: columns[1] ?? '' }]
  })
}

function parseDecisionCoverageRows(source) {
  return source.split(/\r?\n/).flatMap((line) => {
    if (!/^\|\s*DEC-PRD-\d{3}\s*\|/.test(line)) return []
    const columns = line.split('|').slice(1, -1).map((column) => column.trim())
    return [{
      id: columns[0],
      sources: columns[1] ?? '',
      disposition: columns[2] ?? '',
      control: columns[3] ?? '',
      intent: columns[4] ?? '',
    }]
  })
}

function referencedJudgeFiles(judges) {
  return [...judges.matchAll(/`([^`]+\.(?:test\.(?:ts|tsx)|ps1|rs))`/g)]
    .map((match) => match[1].replaceAll('\\', '/'))
    .filter((path) => !path.includes('*'))
}

function hasFile(reference, availableFiles) {
  const normalized = reference.replace(/^\.\//, '')
  if (normalized.includes('/')) return availableFiles.has(normalized)
  return [...availableFiles].some((path) => basename(path) === normalized)
}

function normalizeWindowsPath(value) {
  return value
    .trim()
    .replaceAll('/', '\\')
    .replace(/\\+/g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase()
}

function hasActiveNoNvidiaExitSemantics(deliveryPlan) {
  return deliveryPlan.split(/\r?\n/).some((line) => {
    const describesNoNvidia = /(?:no[-\s]?nvidia|without\s+(?:an?\s+)?nvidia|无\s*(?:nvidia|gpu))/i.test(line)
    const requiresExitEvidence = /(?:release blocker|exit criterion|before\s+release\s+exit|(?:requires?|must|remains|required).*?(?:evidence|release\s+exit|exit)|(?:evidence).*?(?:required|must))/i.test(line)
    const isRetiredContext = /\b(?:superseded|retired|not a release blocker|no longer)\b|不再|不是|退役/i.test(line)
    return describesNoNvidia && requiresExitEvidence && !isRetiredContext
  })
}

export function validateControlPlaneDocuments({
  acceptance,
  coverage,
  decisionCoverage = '',
  projectState,
  deliveryPlan = '',
  availableFiles,
}) {
  const errors = []
  const criteria = parseAcceptanceCriteria(acceptance)
  const coverageRows = parseCoverageRows(coverage)
  const decisionRows = parseDecisionCoverageRows(decisionCoverage)
  const files = new Set(availableFiles.map((path) => path.replaceAll('\\', '/')))
  const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]))
  const confirmed = criteria.filter((criterion) => criterion.status === 'Confirmed')

  const criteriaGroups = new Map()
  for (const criterion of criteria) {
    criteriaGroups.set(criterion.id, [...(criteriaGroups.get(criterion.id) ?? []), criterion])
  }
  for (const [id, definitions] of criteriaGroups) {
    const statuses = [...new Set(definitions.map((definition) => definition.status))].sort()
    if (statuses.length > 1) {
      errors.push(`${id} has conflicting acceptance statuses: ${statuses.join(', ')}.`)
    } else if (definitions.length > 1) {
      errors.push(`${id} is defined ${definitions.length} times in the acceptance standard.`)
    }
  }

  for (const criterion of confirmed) {
    const rows = coverageRows.filter((row) => row.id === criterion.id)
    if (rows.length !== 1) {
      errors.push(`${criterion.id} is Confirmed but has ${rows.length} coverage rows (expected exactly 1).`)
    }
    if (!criterion.owner.replace(/[。.]$/, '').trim()) {
      errors.push(`${criterion.id} is Confirmed but has no implementation owner.`)
    }
    if (!criterion.judge.replace(/[。.]$/, '').trim()) {
      errors.push(`${criterion.id} is Confirmed but has no judge.`)
    }
  }

  for (const row of coverageRows) {
    if (!criteriaById.has(row.id)) {
      errors.push(`${row.id} has a coverage row but no acceptance criterion.`)
    }
    for (const reference of referencedJudgeFiles(row.judges)) {
      if (!hasFile(reference, files)) {
        errors.push(`${row.id} references missing judge file: ${reference}.`)
      }
    }
  }

  const decisionGroups = new Map()
  for (const row of decisionRows) {
    decisionGroups.set(row.id, [...(decisionGroups.get(row.id) ?? []), row])
  }
  for (let number = 1; number <= 99; number += 1) {
    const id = `DEC-PRD-${String(number).padStart(3, '0')}`
    const rows = decisionGroups.get(id) ?? []
    if (rows.length === 0) {
      errors.push(`Product decision coverage is missing ${id}.`)
    } else if (rows.length !== 1) {
      errors.push(`${id} is mapped ${rows.length} times (expected exactly 1).`)
    }
  }

  const validDispositions = new Set(['Confirmed AC', 'Proposed', 'Out-of-scope'])
  const emptyBoundary = (value) => !value.replace(/[—–\-`.。\s]/g, '')
  for (const row of decisionRows) {
    if (!/^DEC-PRD-(?:0(?:0[1-9]|[1-9]\d)|099)$/.test(row.id)) {
      errors.push(`Product decision coverage contains unexpected id: ${row.id}.`)
    }
    if (!validDispositions.has(row.disposition)) {
      errors.push(`${row.id} has invalid disposition: ${row.disposition || '(empty)'}.`)
    } else if (row.disposition === 'Confirmed AC') {
      const references = [...new Set(row.control.match(/\bAC-[A-Z]+-\d+\b/g) ?? [])]
      if (references.length === 0) {
        errors.push(`${row.id} is Confirmed AC but references no acceptance criterion.`)
      }
      for (const reference of references) {
        if (criteriaById.get(reference)?.status !== 'Confirmed') {
          errors.push(`${row.id} references ${reference}, which is not a Confirmed acceptance criterion.`)
        }
      }
    } else if (emptyBoundary(row.control)) {
      errors.push(`${row.id} is ${row.disposition} but has no current boundary.`)
    }

    if (emptyBoundary(row.intent)) {
      errors.push(`${row.id} has no product intent summary.`)
    }

    const sourceReferences = [...row.sources.matchAll(/`([^`]+\.md)`/g)].map((match) => match[1])
    if (sourceReferences.length === 0) {
      errors.push(`${row.id} references no current product source.`)
    }
    for (const reference of sourceReferences) {
      if (reference !== 'PRD.md' && !/^M\d{2}-[^/\\]+\.md$/.test(reference)) {
        errors.push(`${row.id} references non-current product source: ${reference}.`)
      } else if (!files.has(reference)) {
        errors.push(`${row.id} references missing product source: ${reference}.`)
      }
    }
  }

  const expectedDispositionCounts = new Map([
    ['Confirmed AC', 72],
    ['Proposed', 23],
    ['Out-of-scope', 4],
  ])
  const actualDispositionCounts = new Map([...expectedDispositionCounts.keys()]
    .map((disposition) => [disposition, decisionRows.filter((row) => row.disposition === disposition).length]))
  const dispositionSummary = [...expectedDispositionCounts.keys()]
    .map((disposition) => `${disposition}=${actualDispositionCounts.get(disposition)}`)
    .join(', ')
  const expectedDispositionSummary = [...expectedDispositionCounts.entries()]
    .map(([disposition, count]) => `${disposition}=${count}`)
    .join(', ')
  if ([...expectedDispositionCounts].some(([disposition, count]) => actualDispositionCounts.get(disposition) !== count)) {
    errors.push(`Product decision disposition counts are ${dispositionSummary}; expected ${expectedDispositionSummary}.`)
  }

  const currentFacts = projectState.split(/^## What changed\b/m)[0]
  const primaryCheckout = currentFacts.match(/^Primary checkout:[ \t]*(.+)$/m)?.[1]?.trim() ?? ''
  if (!primaryCheckout) {
    errors.push('PROJECT_STATE active current facts define no canonical checkout.')
  } else if (normalizeWindowsPath(primaryCheckout).includes(normalizeWindowsPath('D:\\gongju\\shengcan\\rain'))) {
    errors.push('PROJECT_STATE active canonical checkout still uses legacy path: D:\\gongju\\shengcan\\rain.')
  }
  for (const criterion of confirmed) {
    const contradictoryLine = currentFacts.split(/\r?\n/).find((line) => (
      line.includes(criterion.id) && /\bProposed\b/i.test(line)
    ))
    if (contradictoryLine) {
      errors.push(`PROJECT_STATE current facts call Confirmed ${criterion.id} Proposed.`)
    }
  }

  for (const criterion of criteria.filter((item) => item.status === 'Superseded')) {
    const activeExitCriterion = deliveryPlan.split(/\r?\n/).find((line) => {
      if (!line.includes(criterion.id)) return false
      if (!/release blocker|exit criterion|requires? .*evidence|must .*evidence|发布阻断|退出条件|必须.*证据/i.test(line)) return false
      return !/\bSuperseded\b|\bRetired\b|not a release blocker|不再|不是|退役/i.test(line)
    })
    if (activeExitCriterion) {
      errors.push(`Active delivery plan treats Superseded ${criterion.id} as an exit criterion.`)
    }
    if (criterion.id === 'AC-RL-07' && hasActiveNoNvidiaExitSemantics(deliveryPlan)) {
      errors.push('Active delivery plan requires no-NVIDIA Evidence despite a Superseded no-NVIDIA release contract.')
    }
  }

  return [...new Set(errors)].sort()
}

function repositoryFiles(root) {
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (GENERATED_DIRECTORIES.has(entry)) continue
      const path = join(directory, entry)
      const stats = statSync(path)
      if (stats.isDirectory()) visit(path)
      else files.push(relative(root, path).replaceAll('\\', '/'))
    }
  }
  visit(root)
  return files
}

export function validateControlPlane(root) {
  const paths = {
    acceptance: join(root, 'docs', 'development', 'acceptance-standard.md'),
    coverage: join(root, 'docs', 'development', 'harness-coverage.md'),
    decisionCoverage: join(root, 'docs', 'development', 'product-decision-coverage.md'),
    projectState: join(root, 'docs', 'PROJECT_STATE.md'),
    deliveryPlan: join(root, 'docs', 'development', 'rain-project-delivery-plan.md'),
  }
  const missingDocuments = Object.entries(paths)
    .filter(([, path]) => !existsSync(path))
    .map(([name, path]) => `Missing ${name} control document: ${relative(root, path)}.`)
  if (missingDocuments.length > 0) return missingDocuments

  return validateControlPlaneDocuments({
    acceptance: readFileSync(paths.acceptance, 'utf8'),
    coverage: readFileSync(paths.coverage, 'utf8'),
    decisionCoverage: readFileSync(paths.decisionCoverage, 'utf8'),
    projectState: readFileSync(paths.projectState, 'utf8'),
    deliveryPlan: readFileSync(paths.deliveryPlan, 'utf8'),
    availableFiles: repositoryFiles(root),
  })
}

const isCli = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href

if (isCli) {
  const root = resolve(process.argv[2] ?? process.cwd())
  const errors = validateControlPlane(root)
  if (errors.length > 0) {
    console.error(`Control plane validation failed with ${errors.length} error(s):`)
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
  } else {
    console.log('Control plane validation passed.')
  }
}
