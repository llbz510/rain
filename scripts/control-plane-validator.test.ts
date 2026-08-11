import { describe, expect, it } from 'vitest'
// @ts-expect-error The production validator is a directly executable Node ESM module.
import { validateControlPlaneDocuments } from './control-plane-validator.mjs'

const acceptance = `
### AC-TEST-01 保存必须可靠

状态：\`Confirmed\`

实现归属：Runtime Settings Store。

裁判：\`good.test.ts\`。

### AC-TEST-02 尚未确认的行为

状态：\`Proposed\`
`

const coverage = `
| AC | 当前裁判 | 等级 | 当前结论与缺口 |
| --- | --- | --- | --- |
| AC-TEST-01 | \`good.test.ts\` | Strong | 公开行为通过 |
`

function decisionRows(overrides: Record<number, string> = {}) {
  return Array.from({ length: 99 }, (_, index) => {
    const number = index + 1
    const id = `DEC-PRD-${String(number).padStart(3, '0')}`
    if (overrides[number]) return overrides[number]
    if (number <= 72) {
      return `| ${id} | \`M01-positioning.md\` | Confirmed AC | \`AC-TEST-01\` | intent ${number} |`
    }
    if (number <= 95) {
      return `| ${id} | \`M01-positioning.md\` | Proposed | Post-release boundary | intent ${number} |`
    }
    return `| ${id} | \`M01-positioning.md\` | Out-of-scope | Excluded boundary | intent ${number} |`
  }).join('\n')
}

const decisionCoverage = `
| Decision | Current source | Disposition | Current control | Intent |
| --- | --- | --- | --- | --- |
${decisionRows()}
`

function validate(overrides = {}) {
  return validateControlPlaneDocuments({
    acceptance,
    coverage,
    decisionCoverage,
    projectState: '# State\n\nPrimary checkout: current Git worktree.\n\n## Known defects\n\nNone.\n\n## What changed\n',
    deliveryPlan: '# Delivery plan\n\nM3-S2 is Superseded and not a release blocker.\n',
    availableFiles: ['good.test.ts', 'M01-positioning.md'],
    ...overrides,
  })
}

describe('control-plane validator', () => {
  it('accepts a Confirmed AC with an owner, judge, coverage row and real judge file', () => {
    expect(validate()).toEqual([])
  })

  it('rejects a Confirmed AC without exactly one coverage row', () => {
    expect(validate({ coverage: '| AC | 当前裁判 | 等级 | 当前结论与缺口 |' }))
      .toContain('AC-TEST-01 is Confirmed but has 0 coverage rows (expected exactly 1).')
  })

  it('rejects a Confirmed AC without an implementation owner or judge', () => {
    const incomplete = acceptance
      .replace('实现归属：Runtime Settings Store。', '实现归属：')
      .replace('裁判：`good.test.ts`。', '裁判：')

    expect(validate({ acceptance: incomplete })).toEqual(expect.arrayContaining([
      'AC-TEST-01 is Confirmed but has no implementation owner.',
      'AC-TEST-01 is Confirmed but has no judge.',
    ]))
  })

  it('rejects a coverage judge reference that does not exist in the repository', () => {
    const brokenCoverage = coverage.replace('good.test.ts', 'missing.test.ts')

    expect(validate({ coverage: brokenCoverage }))
      .toContain('AC-TEST-01 references missing judge file: missing.test.ts.')
  })

  it('rejects a current-state claim that demotes a Confirmed AC to Proposed', () => {
    const projectState = '# State\n\nPrimary checkout: current Git worktree.\n\n## Known defects\n\nAC-TEST-01 remains Proposed.\n\n## What changed\n'

    expect(validate({ projectState }))
      .toContain('PROJECT_STATE current facts call Confirmed AC-TEST-01 Proposed.')
  })

  it('rejects conflicting statuses inside the acceptance standard', () => {
    const conflictingAcceptance = `${acceptance}\n${acceptance.replace('`Confirmed`', '`Proposed`')}`

    expect(validate({ acceptance: conflictingAcceptance }))
      .toContain('AC-TEST-01 has conflicting acceptance statuses: Confirmed, Proposed.')
  })

  it('rejects a missing or duplicate historical product decision', () => {
    const missing = decisionCoverage.replace(/^\| DEC-PRD-099 .*\r?\n?/m, '')
    const duplicate = `${decisionCoverage}\n${decisionRows({ 1: '| DEC-PRD-001 | `M01-positioning.md` | Proposed | not accepted | duplicate |' }).split('\n')[0]}`

    expect(validate({ decisionCoverage: missing }))
      .toContain('Product decision coverage is missing DEC-PRD-099.')
    expect(validate({ decisionCoverage: duplicate }))
      .toContain('DEC-PRD-001 is mapped 2 times (expected exactly 1).')
  })

  it('rejects invalid dispositions and incomplete current controls', () => {
    const invalidDisposition = decisionCoverage.replace(
      '| DEC-PRD-001 | `M01-positioning.md` | Confirmed AC | `AC-TEST-01` | intent 1 |',
      '| DEC-PRD-001 | `M01-positioning.md` | Implemented | `AC-TEST-01` | intent 1 |',
    )
    const unknownAc = decisionCoverage.replace(
      '| DEC-PRD-001 | `M01-positioning.md` | Confirmed AC | `AC-TEST-01` | intent 1 |',
      '| DEC-PRD-001 | `M01-positioning.md` | Confirmed AC | `AC-TEST-99` | intent 1 |',
    )
    const proposedAc = decisionCoverage.replace(
      '| DEC-PRD-001 | `M01-positioning.md` | Confirmed AC | `AC-TEST-01` | intent 1 |',
      '| DEC-PRD-001 | `M01-positioning.md` | Confirmed AC | `AC-TEST-02` | intent 1 |',
    )
    const emptyBoundary = decisionCoverage.replace(
      '| DEC-PRD-001 | `M01-positioning.md` | Confirmed AC | `AC-TEST-01` | intent 1 |',
      '| DEC-PRD-001 | `M01-positioning.md` | Proposed | — | intent 1 |',
    )

    expect(validate({ decisionCoverage: invalidDisposition }))
      .toContain('DEC-PRD-001 has invalid disposition: Implemented.')
    expect(validate({ decisionCoverage: unknownAc }))
      .toContain('DEC-PRD-001 references AC-TEST-99, which is not a Confirmed acceptance criterion.')
    expect(validate({ decisionCoverage: proposedAc }))
      .toContain('DEC-PRD-001 references AC-TEST-02, which is not a Confirmed acceptance criterion.')
    expect(validate({ decisionCoverage: emptyBoundary }))
      .toContain('DEC-PRD-001 is Proposed but has no current boundary.')
  })

  it('rejects historical or missing product fact sources', () => {
    const historical = decisionCoverage.replace(
      '| DEC-PRD-001 | `M01-positioning.md` | Confirmed AC | `AC-TEST-01` | intent 1 |',
      '| DEC-PRD-001 | `HANDOFF.md` | Confirmed AC | `AC-TEST-01` | intent 1 |',
    )
    const missingSource = decisionCoverage.replace(
      '| DEC-PRD-001 | `M01-positioning.md` | Confirmed AC | `AC-TEST-01` | intent 1 |',
      '| DEC-PRD-001 | `M99-missing.md` | Confirmed AC | `AC-TEST-01` | intent 1 |',
    )

    expect(validate({ decisionCoverage: historical }))
      .toContain('DEC-PRD-001 references non-current product source: HANDOFF.md.')
    expect(validate({ decisionCoverage: missingSource }))
      .toContain('DEC-PRD-001 references missing product source: M99-missing.md.')
  })

  it('rejects product-decision disposition count drift from the user-confirmed 72/23/4 summary', () => {
    const drifted = decisionCoverage.replace(
      '| DEC-PRD-073 | `M01-positioning.md` | Proposed | Post-release boundary | intent 73 |',
      '| DEC-PRD-073 | `M01-positioning.md` | Confirmed AC | `AC-TEST-01` | intent 73 |',
    )

    expect(validate({ decisionCoverage: drifted }))
      .toContain('Product decision disposition counts are Confirmed AC=73, Proposed=22, Out-of-scope=4; expected Confirmed AC=72, Proposed=23, Out-of-scope=4.')
  })

  it('rejects an active delivery exit criterion that resurrects a Superseded AC', () => {
    const supersededAcceptance = `${acceptance}

### AC-RL-07 Historical no-NVIDIA evidence

状态：\`Superseded\`
`
    const deliveryPlan = '# Delivery plan\n\nAC-RL-07 is a release blocker and requires no-NVIDIA Evidence before exit.\n'

    expect(validate({ acceptance: supersededAcceptance, deliveryPlan }))
      .toContain('Active delivery plan treats Superseded AC-RL-07 as an exit criterion.')
  })

  it('rejects active no-NVIDIA exit semantics even when the Superseded AC id is not on the same line', () => {
    const supersededAcceptance = `${acceptance}

### AC-RL-07 Historical no-NVIDIA evidence

状态：\`Superseded\`
`
    const deliveryPlan = '# Delivery plan\n\n## M3 exit conditions\n\nA clean no-NVIDIA Windows Evidence remains required before release exit.\n'

    expect(validate({ acceptance: supersededAcceptance, deliveryPlan }))
      .toContain('Active delivery plan requires no-NVIDIA Evidence despite a Superseded no-NVIDIA release contract.')
  })

  it('rejects the legacy checkout path in active current facts', () => {
    const projectState = '# State\n\nPrimary checkout: `D:\\gongju\\shengcan\\rain`\n\n## What changed\n'

    expect(validate({ projectState }))
      .toContain('PROJECT_STATE active canonical checkout still uses legacy path: D:\\gongju\\shengcan\\rain.')
  })

  it('normalizes case and slash variants before rejecting a legacy checkout path', () => {
    const projectState = '# State\n\nPrimary checkout: `d:/GONGJU/shengcan/RAIN/`\n\n## What changed\n'

    expect(validate({ projectState }))
      .toContain('PROJECT_STATE active canonical checkout still uses legacy path: D:\\gongju\\shengcan\\rain.')
  })
})
