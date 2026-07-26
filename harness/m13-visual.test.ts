import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let style: HTMLStyleElement

beforeAll(() => {
  style = document.createElement('style')
  style.textContent = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')
  document.head.append(style)
})

afterAll(() => {
  style.remove()
})

function cssVariable(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

describe('M13: 应用实际加载的视觉令牌', () => {
  it('加载四种段落颜色', () => {
    expect([
      cssVariable('--color-concept'),
      cssVariable('--color-example'),
      cssVariable('--color-analogy'),
      cssVariable('--color-transition'),
    ]).toEqual(['#3b82f6', '#10b981', '#f59e0b', '#6b7280'])
  })

  it('加载间距、字号、圆角和动效阶梯', () => {
    expect(Array.from({ length: 8 }, (_, index) => cssVariable(`--spacing-${index + 1}`)))
      .toEqual(['4px', '8px', '12px', '16px', '20px', '24px', '32px', '48px'])
    expect([
      cssVariable('--font-size-lg'),
      cssVariable('--font-size-md'),
      cssVariable('--font-size-sm'),
      cssVariable('--font-size-xs'),
      cssVariable('--font-size-2xs'),
    ]).toEqual(['18px', '16px', '14px', '13px', '12px'])
    expect([
      cssVariable('--radius-0'),
      cssVariable('--radius-1'),
      cssVariable('--radius-2'),
      cssVariable('--radius-3'),
      cssVariable('--radius-pill'),
    ]).toEqual(['0px', '4px', '8px', '12px', '9999px'])
    expect([
      cssVariable('--anim-fast'),
      cssVariable('--anim-base'),
      cssVariable('--anim-slow'),
    ]).toEqual(['120ms', '200ms', '320ms'])
  })
})
