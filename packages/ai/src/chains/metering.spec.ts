import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Every metered chain must record its call under its OWN model name: the
// @langchain/openai response does not carry one, so the call site passes
// `llm.modelName`. Each role gets a distinct env model so a chain that records
// under the wrong instance (or none) is caught.

const invokeMock = vi.fn()
const loadPDFMock = vi.fn()
const readFileMock = vi.fn()

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    modelName: string
    constructor(fields: { modelName: string; maxTokens?: number }) {
      // The photo path builds a second instance with maxTokens; tag it so its
      // meter name is distinguishable from the PDF instance.
      this.modelName = fields.maxTokens ? `${fields.modelName}:image` : fields.modelName
    }
    invoke = invokeMock
  },
}))

vi.mock('../loaders/pdf', () => ({
  loadPDF: (...args: unknown[]) => loadPDFMock(...args),
}))

vi.mock('../loaders/pdf-render', () => ({
  renderPdfToImages: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}))

const USAGE = { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 }
const JPEG_PAGE = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]), mime: 'image/jpeg' as const }
const ENV_KEYS = [
  'OPENAI_CONDENSE_MODEL',
  'OPENAI_REFINE_MODEL',
  'OPENAI_FAQ_MODEL',
  'OPENAI_GRADE_MODEL',
  'OPENAI_SQL_MODEL',
  'OPENAI_EXTRACTION_MODEL',
  'OPENAI_PROCUREMENT_EXTRACTION_MODEL',
  'OPENAI_CHAT_MODEL',
  'HISTORY_CONDENSE_ENABLED',
]

async function freshMeter() {
  const { TokenMeter } = await import('../tokens')
  return new TokenMeter()
}

describe('chain metering (S4)', () => {
  const env = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    process.env = { ...env }
    for (const key of ENV_KEYS) delete process.env[key]
    process.env.OPENAI_CONDENSE_MODEL = 'condense-model'
    process.env.OPENAI_REFINE_MODEL = 'refine-model'
    process.env.OPENAI_FAQ_MODEL = 'faq-model'
    process.env.OPENAI_GRADE_MODEL = 'topic-model'
    process.env.OPENAI_SQL_MODEL = 'sql-model'
    process.env.OPENAI_EXTRACTION_MODEL = 'ticket-model'
    process.env.OPENAI_PROCUREMENT_EXTRACTION_MODEL = 'procurement-model'
    loadPDFMock.mockResolvedValue({
      content: 'PO-1001\nSKU A1 Widget qty 10 unit price 5.00',
      metadata: { source: 'x.pdf', fileType: 'pdf', fileName: 'x.pdf', fileSize: 100, pageCount: 1 },
    })
    readFileMock.mockResolvedValue(Buffer.from('fake pdf bytes'))
  })

  afterEach(() => {
    process.env = env
    vi.restoreAllMocks()
  })

  it('error: condenseQuestion records nothing when the response has no usage', async () => {
    invokeMock.mockResolvedValue({ content: 'standalone question' })
    const { condenseQuestion } = await import('./condense')
    const meter = await freshMeter()

    await condenseQuestion('and the price?', [{ role: 'user', content: 'tell me about widgets' }], { meter })

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(meter.total).toBe(0)
    expect(meter.dominantModel).toBeNull()
  })

  it('edge: condenseQuestion records its usage under its own model name', async () => {
    invokeMock.mockResolvedValue({ content: 'standalone question', usage_metadata: USAGE })
    const { condenseQuestion } = await import('./condense')
    const meter = await freshMeter()

    await condenseQuestion('and the price?', [{ role: 'user', content: 'tell me about widgets' }], { meter })

    expect(meter.total).toBe(1500)
    expect(meter.dominantModel).toBe('condense-model')
  })

  it('edge: refineMessage records its usage under its own model name', async () => {
    invokeMock.mockResolvedValue({ content: 'Refined question?', usage_metadata: USAGE })
    const { refineMessage } = await import('./refine')
    const meter = await freshMeter()

    await refineMessage('raw text', { meter })

    expect(meter.total).toBe(1500)
    expect(meter.dominantModel).toBe('refine-model')
  })

  it('edge: generateFaqDraft records its usage under its own model name', async () => {
    invokeMock.mockResolvedValue({ content: JSON.stringify({ question: 'Q?', answer: 'A.' }), usage_metadata: USAGE })
    const { generateFaqDraft } = await import('./faq-draft')
    const meter = await freshMeter()

    await generateFaqDraft([{ title: 't', issueSummary: 's', nextAction: 'n' }], { meter })

    expect(meter.total).toBe(1500)
    expect(meter.dominantModel).toBe('faq-model')
  })

  it('edge: generateTopicLabel records its usage under its own model name', async () => {
    invokeMock.mockResolvedValue({ content: 'SSO login troubleshooting', usage_metadata: USAGE })
    const { generateTopicLabel } = await import('./topic-label')
    const meter = await freshMeter()

    await generateTopicLabel(['why does sso fail'], { meter })

    expect(meter.total).toBe(1500)
    expect(meter.dominantModel).toBe('topic-model')
  })

  it('edge: generateSql records its usage under its own model name', async () => {
    invokeMock.mockResolvedValue({ content: 'SELECT product FROM dataset', usage_metadata: USAGE })
    const { generateSql } = await import('./text-to-sql')
    const meter = await freshMeter()

    await generateSql('list products', 'dataset', [{ name: 'product', type: 'string' }], undefined, { meter })

    expect(meter.total).toBe(1500)
    expect(meter.dominantModel).toBe('sql-model')
  })

  it('edge: generateMultiTableSql records its usage under its own model name', async () => {
    invokeMock.mockResolvedValue({ content: 'SELECT a.product FROM t1 a', usage_metadata: USAGE })
    const { generateMultiTableSql } = await import('./text-to-sql')
    const meter = await freshMeter()

    await generateMultiTableSql(
      'compare',
      [{ tableName: 't1', name: 'one.csv', columns: [{ name: 'product', type: 'string' }] }],
      undefined,
      { meter },
    )

    expect(meter.total).toBe(1500)
    expect(meter.dominantModel).toBe('sql-model')
  })

  it('edge: extractTicketFromTranscript records its usage under its own model name', async () => {
    invokeMock.mockResolvedValue({
      content: JSON.stringify({
        shouldCreateTicket: true,
        title: 'Login loop after OTP verify',
        issueSummary: 'User verifies OTP, then gets redirected back to login.',
        reproSteps: '1. Register',
        severity: 'high',
        productArea: 'auth',
        hypothesizedRootCause: null,
        nextAction: 'Trace verify response cookie write.',
        fieldConfidence: {
          title: 0.9,
          issueSummary: 0.9,
          reproSteps: 0.9,
          severity: 0.9,
          productArea: 0.9,
          hypothesizedRootCause: 0.5,
          nextAction: 0.9,
        },
      }),
      usage_metadata: USAGE,
    })
    const { extractTicketFromTranscript } = await import('./ticket-extraction')
    const meter = await freshMeter()

    await extractTicketFromTranscript('customer transcript', { meter })

    expect(meter.total).toBe(1500)
    expect(meter.dominantModel).toBe('ticket-model')
  })

  it('edge: extractLineItemsFromPdf records its usage under its own model name', async () => {
    invokeMock.mockResolvedValue({
      content: JSON.stringify({
        items: [{ sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00', lineTotal: '50.00', confidence: 0.9 }],
      }),
      usage_metadata: USAGE,
    })
    const { extractLineItemsFromPdf } = await import('./procurement-extraction')
    const meter = await freshMeter()

    await extractLineItemsFromPdf('/tmp/x.pdf', { meter })

    expect(meter.total).toBe(1500)
    expect(meter.dominantModel).toBe('procurement-model')
  })

  it("edge: extractLineItemsFromImages records its usage under the image model's name", async () => {
    invokeMock.mockResolvedValue({
      content: JSON.stringify({
        items: [{ sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00', lineTotal: '50.00', confidence: 0.9 }],
      }),
      usage_metadata: USAGE,
    })
    const { extractLineItemsFromImages } = await import('./procurement-extraction')
    const meter = await freshMeter()

    await extractLineItemsFromImages([JPEG_PAGE], 'invoice', { meter })

    expect(meter.total).toBe(1500)
    expect(meter.dominantModel).toBe('procurement-model:image')
  })

  it('edge: extractCatalogItemsFromImage records its usage under its own model name', async () => {
    invokeMock.mockResolvedValue({
      content: JSON.stringify({ items: [{ sku: 'A1', description: 'Widget', confidence: 0.9 }] }),
      usage_metadata: USAGE,
    })
    const { extractCatalogItemsFromImage } = await import('./catalog-match')
    const meter = await freshMeter()

    await extractCatalogItemsFromImage(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { meter })

    expect(meter.total).toBe(1500)
    expect(meter.dominantModel).toBe('procurement-model')
  })

  it('edge: compareLineItemToCatalogImage records its usage under its own model name', async () => {
    invokeMock.mockResolvedValue({
      content: JSON.stringify({ isMatch: true, score: 0.9, reason: 'Same widget.' }),
      usage_metadata: USAGE,
    })
    const { compareLineItemToCatalogImage } = await import('./catalog-match')
    const meter = await freshMeter()

    await compareLineItemToCatalogImage({
      queryText: 'SKU A1: Widget',
      candidateText: 'SKU A1: Widget',
      candidateImageBase64: null,
      meter,
    })

    expect(meter.total).toBe(1500)
    expect(meter.dominantModel).toBe('procurement-model')
  })

  it('regression: refineMessage still works with no meter option', async () => {
    invokeMock.mockResolvedValue({ content: 'Refined question?', usage_metadata: USAGE })
    const { refineMessage } = await import('./refine')

    await expect(refineMessage('raw text')).resolves.toBe('Refined question?')
  })

  it("happy: a metered chain's meter prices the call (costMicroUsd above zero for a known model)", async () => {
    process.env.OPENAI_SQL_MODEL = 'gpt-4o'
    invokeMock.mockResolvedValue({ content: 'SELECT product FROM dataset', usage_metadata: USAGE })
    const { generateSql } = await import('./text-to-sql')
    const meter = await freshMeter()

    await generateSql('list products', 'dataset', [{ name: 'product', type: 'string' }], undefined, { meter })

    expect(meter.costMicroUsd).toBe(7500)
    expect(meter.dominantModel).toBe('gpt-4o')
  })
})
