import { mapRowToLineItem } from './column-mapping'

describe('mapRowToLineItem', () => {
  it('maps common column aliases case-insensitively', () => {
    const row = { SKU: 'ABC-123', Description: 'Widget', Qty: '10', 'Unit Price': '5.50', Total: '55.00' }

    expect(mapRowToLineItem(row)).toEqual({
      sku: 'ABC-123',
      description: 'Widget',
      quantity: '10',
      unitPrice: '5.50',
      lineTotal: '55.00',
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
    })
  })
})
