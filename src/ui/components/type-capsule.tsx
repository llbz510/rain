import type { CSSProperties } from 'react'
import type { ParagraphType } from '@/models/types'

/**
 * 段落类型胶囊 —— 决策 71 / 视觉合同 `VC-09`（缺口 `VCGAP-05`）
 *
 * 形态（全部来自 `docs/development/visual-contract.md`，不得自行改）：
 * - 类型色**字**：`var(--color-concept/example/analogy/transition)`，取值见 §5.5.1「彩字态」
 *   （`#5b9bf8` / `#3ecf8e` / `#f0a13c` / `#9e9e9e`，压面板最小 5.54 / 7.78 / 7.29 / 5.79）；
 * - 同色**淡底**：同色 `alpha = 0.10`（§5.5.1 的可测边界 0.05–0.12，验算彩字压合成底 4.74 / 6.43 / 6.03 / 4.93）；
 * - 同色**细边**：`1px` **全色**同色值（`DEC-VC-02` 边界 4「1px 边框一律 ≥3:1」的从严读法，与 S3 已落地的浅底套一致；
 *   浅色那套的同名组件见 `src/ui/components/settings/shared.ts` 的 `TAG_STYLES`）。
 *
 * 淡底用 `rgba()` 字面量而不是 `color-mix()`：值与 `--color-*` 令牌是同一色的两个角色，
 * 由 `src/__tests__/visual-contract-type-colors.test.ts` 断言「rgb 必须与令牌一致、alpha 必须在 0.05–0.12」，
 * 防止两处漂移。
 */

export const PARAGRAPH_TYPE_LABELS: Record<ParagraphType, string> = {
  concept: '概念描述',
  example: '例子',
  analogy: '类比',
  transition: '过渡',
}

interface TypeStyle {
  color: string
  borderColor: string
  background: string
}

export const PARAGRAPH_TYPE_STYLES: Record<ParagraphType, TypeStyle> = {
  concept: { color: 'var(--color-concept)', borderColor: 'var(--color-concept)', background: 'rgba(91,155,248,.1)' },
  example: { color: 'var(--color-example)', borderColor: 'var(--color-example)', background: 'rgba(62,207,142,.1)' },
  analogy: { color: 'var(--color-analogy)', borderColor: 'var(--color-analogy)', background: 'rgba(240,161,60,.1)' },
  transition: { color: 'var(--color-transition)', borderColor: 'var(--color-transition)', background: 'rgba(158,158,158,.1)' },
}

const capsuleStyle: CSSProperties = {
  display: 'inline-block',
  padding: '1px 8px',
  // 圆角取中档 8px：VC-09 / VC-15 与决策 76 明文「类型胶囊=8（中）」；不得取 --radius-1（4px）。
  borderRadius: 'var(--radius-2)',
  border: '1px solid',
  fontSize: 'var(--font-size-xs)',
  lineHeight: 1.6,
  whiteSpace: 'nowrap',
}

export function TypeCapsule({ type }: { type: ParagraphType }) {
  const tone = PARAGRAPH_TYPE_STYLES[type]
  return (
    <span data-testid="type-capsule" data-paragraph-type={type} style={{ ...capsuleStyle, ...tone }}>
      {PARAGRAPH_TYPE_LABELS[type]}
    </span>
  )
}
