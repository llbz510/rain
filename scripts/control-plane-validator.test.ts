import { describe, expect, it } from 'vitest'
// @ts-expect-error The production validator is a directly executable Node ESM module.
import { validateControlPlaneDocuments } from './control-plane-validator.mjs'

const acceptance = `
### AC-TEST-01 保存必须可靠

状态：\`Confirmed\`

实现归属：Runtime Settings Store。

裁判：\`good.test.ts\`。
`

const coverage = `
| AC | 当前裁判 | 等级 | 当前结论与缺口 |
| --- | --- | --- | --- |
| AC-TEST-01 | \`good.test.ts\` | Strong | 公开行为通过 |
`

function validate(overrides = {}) {
  return validateControlPlaneDocuments({
    acceptance,
    coverage,
    projectState: '# State\n\n## Known defects\n\nNone.\n\n## What changed\n',
    availableFiles: ['good.test.ts'],
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
    const projectState = '# State\n\n## Known defects\n\nAC-TEST-01 remains Proposed.\n\n## What changed\n'

    expect(validate({ projectState }))
      .toContain('PROJECT_STATE current facts call Confirmed AC-TEST-01 Proposed.')
  })

  it('rejects conflicting statuses inside the acceptance standard', () => {
    const conflictingAcceptance = `${acceptance}\n${acceptance.replace('`Confirmed`', '`Proposed`')}`

    expect(validate({ acceptance: conflictingAcceptance }))
      .toContain('AC-TEST-01 has conflicting acceptance statuses: Confirmed, Proposed.')
  })
})
