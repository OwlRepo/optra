import { isEmptyLineItem, mapRowToLineItem, validateLineItem } from './column-mapping'

describe('validateLineItem', () => {
  const base = { sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.50', lineTotal: '55' }

  it('keeps plain decimal numbers, including signs and exponents', () => {
    expect(validateLineItem({ ...base, quantity: '-3', unitPrice: '.5', lineTotal: '1e3', uom: null })).toEqual({
      ...base,
      quantity: '-3',
      unitPrice: '.5',
      lineTotal: '1e3',
      uom: null,
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
