import { isEmptyLineItem, mapRowToLineItem, receivedQuantity, validateLineItem } from './column-mapping'

describe('validateLineItem', () => {
  const base = { sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.50', lineTotal: '55' }

  it('keeps plain decimal numbers, including signs and exponents', () => {
    expect(validateLineItem({ ...base, quantity: '-3', unitPrice: '.5', lineTotal: '1e3', uom: null })).toEqual({
      ...base,
      quantity: '-3',
      unitPrice: '.5',
      lineTotal: '1e3',
      uom: null,
      quantityReceived: null,
      quantityAccepted: null,
      quantityRejected: null,
    })
  })

  it('nulls numeric cells Postgres numeric would reject or misread', () => {
    const result = validateLineItem({ ...base, quantity: 'ten', unitPrice: '1,200', lineTotal: '0x1A', uom: null })
    expect(result.quantity).toBeNull()
    expect(result.unitPrice).toBeNull()
    expect(result.lineTotal).toBeNull()
  })

  it('nulls a SKU longer than the 200-character column', () => {
    expect(validateLineItem({ ...base, sku: 'S'.repeat(201), uom: null }).sku).toBeNull()
    expect(validateLineItem({ ...base, sku: 'S'.repeat(200), uom: null }).sku).toBe('S'.repeat(200))
  })
})

describe('isEmptyLineItem', () => {
  it('is true only when every mapped field is null', () => {
    const empty = { sku: null, description: null, quantity: null, unitPrice: null, lineTotal: null, uom: null }
    expect(isEmptyLineItem(empty)).toBe(true)
    expect(isEmptyLineItem({ ...empty, quantity: '1', uom: null })).toBe(false)
  })
})

describe('mapRowToLineItem', () => {
  it('maps common column aliases case-insensitively', () => {
    const row = { SKU: 'ABC-123', Description: 'Widget', Qty: '10', 'Unit Price': '5.50', Total: '55.00' }

    expect(mapRowToLineItem(row)).toEqual({
      sku: 'ABC-123',
      description: 'Widget',
      quantity: '10',
      unitPrice: '5.50',
      lineTotal: '55.00',
      uom: null,
      quantityReceived: null,
      quantityAccepted: null,
      quantityRejected: null,
    })
  })

  it('resolves alternate aliases for each field', () => {
    const row = { 'Item Code': 'X1', 'Item Name': 'Gadget', Quantity: '3', 'Unit Cost': '9.99', Amount: '29.97' }

    expect(mapRowToLineItem(row)).toEqual({
      sku: 'X1',
      description: 'Gadget',
      quantity: '3',
      unitPrice: '9.99',
      lineTotal: '29.97',
      uom: null,
      quantityReceived: null,
      quantityAccepted: null,
      quantityRejected: null,
    })
  })

  it('returns null for fields with no matching header', () => {
    const row = { Foo: 'bar' }

    expect(mapRowToLineItem(row)).toEqual({
      sku: null,
      description: null,
      quantity: null,
      unitPrice: null,
      lineTotal: null,
      uom: null,
      quantityReceived: null,
      quantityAccepted: null,
      quantityRejected: null,
    })
  })

  it('treats blank cell values as null even when the header matches', () => {
    const row = { sku: '   ', description: 'Widget', qty: '10', 'unit price': '5', total: '50' }

    expect(mapRowToLineItem(row).sku).toBeNull()
  })

  it('trims whitespace from matched values', () => {
    const row = {
      sku: '  ABC-123  ',
      description: ' Widget ',
      qty: ' 10 ',
      'unit price': ' 5.50 ',
      total: ' 55.00 ',
    }

    expect(mapRowToLineItem(row)).toEqual({
      sku: 'ABC-123',
      description: 'Widget',
      quantity: '10',
      unitPrice: '5.50',
      lineTotal: '55.00',
      uom: null,
      quantityReceived: null,
      quantityAccepted: null,
      quantityRejected: null,
    })
  })
})

describe('uom mapping (S3a)', () => {
  it('maps unambiguous unit-of-measure headers', () => {
    expect(mapRowToLineItem({ sku: 'A1', uom: 'each' }).uom).toBe('each')
    expect(mapRowToLineItem({ sku: 'A1', UOM: 'BOX' }).uom).toBe('BOX')
    expect(mapRowToLineItem({ sku: 'A1', 'unit of measure': 'roll' }).uom).toBe('roll')
    expect(mapRowToLineItem({ sku: 'A1', 'u/m': 'set' }).uom).toBe('set')
  })

  // `units` is already a quantity alias. A vendor export with a Units column
  // means "how many", and stealing it for UOM would silently corrupt every
  // quantity on that document — the worst outcome available here.
  it('leaves a Units header mapping to quantity, not uom', () => {
    const mapped = mapRowToLineItem({ sku: 'A1', Units: '12' })
    expect(mapped.quantity).toBe('12')
    expect(mapped.uom).toBeNull()
  })

  it('returns null when no unit-of-measure header is present', () => {
    expect(mapRowToLineItem({ sku: 'A1', qty: '2' }).uom).toBeNull()
  })

  it('nulls a uom longer than the 20-character column', () => {
    expect(validateLineItem({ sku: null, description: null, quantity: null, unitPrice: null, lineTotal: null, uom: 'x'.repeat(21) }).uom).toBeNull()
    expect(validateLineItem({ sku: null, description: null, quantity: null, unitPrice: null, lineTotal: null, uom: 'each' }).uom).toBe('each')
  })

  // A unit of measure with nothing to measure describes no line at all.
  it('still treats a row carrying only a uom as empty', () => {
    expect(
      isEmptyLineItem({ sku: null, description: null, quantity: null, unitPrice: null, lineTotal: null, uom: 'each' }),
    ).toBe(true)
  })
})

// S5. A goods receipt states what arrived, what was accepted and what was sent
// back. Header matching is exact-equality (findValue), so none of these spellings
// resolved to anything before this slice — a GRN CSV parsed to zero rows, and the
// upload reported success on an empty document.
describe('goods receipt quantities (S5)', () => {
  it('maps the received quantity from each of its aliases', () => {
    for (const header of ['Qty Received', 'Received Qty', 'Received Quantity', 'Qty Rcvd']) {
      const item = mapRowToLineItem({ SKU: 'A1', [header]: '8' })
      expect(item.quantityReceived).toBe('8')
    }
  })

  it('maps accepted and rejected quantities from their aliases', () => {
    for (const header of ['Qty Accepted', 'Accepted Qty', 'Accepted Quantity']) {
      expect(mapRowToLineItem({ SKU: 'A1', [header]: '6' }).quantityAccepted).toBe('6')
    }
    for (const header of ['Qty Rejected', 'Rejected Qty', 'Rejected Quantity']) {
      expect(mapRowToLineItem({ SKU: 'A1', [header]: '2' }).quantityRejected).toBe('2')
    }
  })

  // Alias lookup is first-match-wins, and 'qty' is already a QUANTITY alias, so
  // a receipt carrying both columns must not let the generic one win.
  it('prefers an explicit received column over a generic Qty column', () => {
    const item = mapRowToLineItem({ SKU: 'A1', Qty: '10', 'Qty Received': '8' })

    expect(item.quantity).toBe('10')
    expect(item.quantityReceived).toBe('8')
    expect(receivedQuantity(item)).toBe('8')
  })

  // A receipt whose only quantity column is a plain "Qty" still means received.
  it('falls back to the generic quantity when no received column exists', () => {
    const item = mapRowToLineItem({ SKU: 'A1', Qty: '10' })

    expect(item.quantityReceived).toBeNull()
    expect(receivedQuantity(item)).toBe('10')
  })

  // Without this the row is filtered out at procurement-parse.processor.ts and
  // the document parses to nothing.
  it('does not treat a row carrying only a received quantity as empty', () => {
    const item = validateLineItem(
      mapRowToLineItem({ 'Qty Received': '8' }),
    )

    expect(item.sku).toBeNull()
    expect(item.quantity).toBeNull()
    expect(isEmptyLineItem(item)).toBe(false)
  })

  it('still treats a genuinely blank row as empty', () => {
    expect(isEmptyLineItem(validateLineItem(mapRowToLineItem({ SKU: '', Qty: '' })))).toBe(true)
  })

  it('nulls a non-numeric quantity the way it does for the other numeric columns', () => {
    const item = validateLineItem(mapRowToLineItem({ SKU: 'A1', 'Qty Received': 'eight' }))

    expect(item.quantityReceived).toBeNull()
  })

  // POLICY v1 #14 and §1B: a source that does not state acceptance must not be
  // read as "nothing accepted". Absent stays null all the way to the column.
  it('leaves accepted and rejected null when the source does not state them', () => {
    const item = validateLineItem(mapRowToLineItem({ SKU: 'A1', 'Qty Received': '8' }))

    expect(item.quantityAccepted).toBeNull()
    expect(item.quantityRejected).toBeNull()
  })

  // The purchase-order and invoice paths must be untouched by all of the above.
  it('leaves the receipt fields null for an ordinary purchase order row', () => {
    const item = validateLineItem(mapRowToLineItem({ SKU: 'A1', Description: 'Widget', Qty: '10', Price: '5.00' }))

    expect(item.quantity).toBe('10')
    expect(item.quantityReceived).toBeNull()
    expect(item.quantityAccepted).toBeNull()
    expect(item.quantityRejected).toBeNull()
  })
})
