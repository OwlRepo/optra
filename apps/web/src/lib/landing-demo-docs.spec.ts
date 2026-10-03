import { describe, expect, it } from 'vitest'
import {
  DEMO_DOCS,
  DEMO_DWELL_MS,
  DEMO_HISTORY_ROWS,
  DEMO_SCAN_MS,
  TOUR_CHAT_EXCHANGE,
  TOUR_VIGNETTES,
  type DemoDoc,
  type DemoLineKind,
} from './landing-demo-docs'

// Prices are written "$1.80"; the demo uses no thousands separators.
function dollars(price: string): number {
  return Number(price.slice(1))
}

// An increase is quoted against the price that was agreed (the PO), never the
// new one: $0.42 -> $0.51 is +21.4%, while measuring from $0.51 gives the
// 17.6% that was rounded to the wrong "18%".
function increaseOver(agreed: string, charged: string): number {
  return ((dollars(charged) - dollars(agreed)) / dollars(agreed)) * 100
}

const TAG_FOR_KIND: Record<DemoLineKind, string> = { ok: 'Matched', warn: 'Flagged', bad: 'Mismatch' }
const docs: readonly DemoDoc[] = DEMO_DOCS
const l03 = DEMO_DOCS[0].lines[1]
const l05 = DEMO_DOCS[1].lines[1]
const l06 = DEMO_DOCS[1].lines[2]

describe('landing demo data', () => {
  it('edge: every line carries the tag its kind stands for', () => {
    for (const doc of docs) {
      for (const line of doc.lines) {
        expect(line.tag).toBe(TAG_FOR_KIND[line.kind])
      }
    }
  })

  it('edge: a matched line agrees with the PO and the catalog on price', () => {
    const matched = docs.flatMap((doc) => doc.lines).filter((line) => line.kind === 'ok')
    expect(matched.length).toBeGreaterThan(0)
    for (const line of matched) {
      expect(line.price).toBe(line.poPrice)
      expect(line.catPrice).toBe(line.poPrice)
    }
  })

  it('edge: the L05 invoice increase is quoted against the PO price to one decimal', () => {
    expect(l05.price).not.toBe(l05.poPrice)
    expect(l05.text).toContain(`${increaseOver(l05.poPrice, l05.price).toFixed(1)}% increase`)
  })

  it('edge: the L06 overage is the billed quantity minus the ordered one', () => {
    const billed = Number(l06.item.split(' × ')[0])
    const match = /bills (\d+) rolls where the PO ordered (\d+)\. Quantity overage of (\d+)/.exec(l06.text)
    expect(match).not.toBeNull()
    const [quotedBilled, ordered, overage] = (match ?? []).slice(1).map(Number)
    expect(quotedBilled).toBe(billed)
    expect(overage).toBe(billed - ordered)
  })

  it('edge: every tour vignette but the chat one points at a real demo line of the right kind', () => {
    const expectedKind: Record<string, DemoLineKind> = { price: 'warn', photo: 'bad', quantity: 'bad' }
    for (const vignette of TOUR_VIGNETTES) {
      if (!vignette.line) {
        expect(vignette.id).toBe('history')
        continue
      }
      const [docIndex, lineIndex] = vignette.line
      const line = docs[docIndex]?.lines[lineIndex]
      expect(line).toBeDefined()
      expect(line?.kind).toBe(expectedKind[vignette.id])
    }
  })

  it('edge: the chat answer quotes L03, cites its page and dates the flag the history row records', () => {
    expect(TOUR_CHAT_EXCHANGE.answer).toContain(`from ${l03.poPrice} to ${l03.catPrice}`)
    expect(TOUR_CHAT_EXCHANGE.citations[0]).toBe(l03.source)
    expect(DEMO_HISTORY_ROWS[0].date.startsWith('2026-01')).toBe(true)
    expect(TOUR_CHAT_EXCHANGE.answer).toContain('January 2026')
  })

  it('regression: the L03 increase is quoted against the PO price, not the catalog price', () => {
    expect(l03.text).toContain(`${Math.round(increaseOver(l03.poPrice, l03.catPrice))}% above the PO price`)
  })

  it('regression: the vendor-history row records the same increase as L03', () => {
    expect(DEMO_HISTORY_ROWS[0].detail).toBe(
      `flagged +${Math.round(increaseOver(l03.poPrice, l03.catPrice))}% · resolved`,
    )
  })

  it('happy: line ids are unique within each document and the scan resolves before the dwell ends', () => {
    for (const doc of docs) {
      const ids = doc.lines.map((line) => line.no)
      expect(new Set(ids).size).toBe(ids.length)
    }
    expect(DEMO_SCAN_MS).toBeLessThan(DEMO_DWELL_MS)
  })
})
