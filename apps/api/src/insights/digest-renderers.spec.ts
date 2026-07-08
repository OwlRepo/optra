import { renderDigestEmailHtml, renderDigestSlackPayload } from './digest-renderers'
import type { DigestContent } from './digest-content.service'

function baseContent(overrides: Partial<DigestContent> = {}): DigestContent {
  return {
    workspaceId: 'ws-1',
    windowDays: 7,
    eventCounts: {},
    chatSummary: { totalQueries: 0, fallbackRate: 0, cacheHitRate: 0, avgTopScore: null },
    newFreshnessFlags: 0,
    newFaqDrafts: 0,
    newTickets: 0,
    ...overrides,
  }
}

describe('digest renderers', () => {
  describe('quiet week (no notable activity)', () => {
    it('email renders a quiet-week message instead of an empty list', () => {
      const html = renderDigestEmailHtml(baseContent())
      expect(html).toContain('Quiet week')
      expect(html).not.toContain('<ul>')
    })

    it('slack renders a quiet-week message', () => {
      const payload = renderDigestSlackPayload(baseContent())
      expect(payload.text).toContain('Quiet week')
    })
  })

  describe('an active week', () => {
    const content = baseContent({
      eventCounts: { document_ingested: 3, ticket_extracted: 2 },
      chatSummary: { totalQueries: 40, fallbackRate: 0.25, cacheHitRate: 0.5, avgTopScore: 0.8 },
      newFreshnessFlags: 2,
      newFaqDrafts: 1,
      newTickets: 5,
    })

    it('email lists every notable metric', () => {
      const html = renderDigestEmailHtml(content)
      expect(html).toContain('3 documents ingested')
      expect(html).toContain('2 tickets extracted')
      expect(html).toContain('5 new tickets')
      expect(html).toContain('40 chat questions asked')
      expect(html).toContain('25% had no good answer')
      expect(html).toContain('2 documents flagged as possibly stale')
      expect(html).toContain('1 FAQ drafts waiting for review')
    })

    it('slack lists every notable metric as bullet points', () => {
      const payload = renderDigestSlackPayload(content)
      expect(payload.text).toContain('• 3 documents ingested')
      expect(payload.text).toContain('• 5 new tickets')
    })

    it('omits zero-count event types', () => {
      const html = renderDigestEmailHtml(content)
      expect(html).not.toContain('crawls completed')
    })
  })
})
