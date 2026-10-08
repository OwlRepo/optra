import { safeCell } from './safe-cell'

describe('safeCell', () => {
  it.each([
    ['=', '=HYPERLINK("http://evil.example","click")'],
    ['+', '+1+1'],
    ['-', '-2+3'],
    ['@', '@SUM(A1:A2)'],
    ['tab', '\t=1+1'],
    ['carriage return', '\r=1+1'],
    ['line feed', '\n=1+1'],
  ])('error: a text cell starting with %s is prefixed with a single quote', (_name, input) => {
    expect(safeCell(input)).toBe(`'${input}`)
  })

  it('error: only the first character decides, so a formula after leading text is left alone', () => {
    expect(safeCell('total =A1')).toBe('total =A1')
  })

  it('edge: an empty string stays empty', () => {
    expect(safeCell('')).toBe('')
  })

  it('edge: null and undefined pass through untouched', () => {
    expect(safeCell(null)).toBeNull()
    expect(safeCell(undefined)).toBeUndefined()
  })

  it('edge: a real number, including a negative one, is not turned into text', () => {
    expect(safeCell(-12.5)).toBe(-12.5)
    expect(safeCell(0)).toBe(0)
  })

  it('edge: a boolean passes through', () => {
    expect(safeCell(true)).toBe(true)
  })

  it('regression: a value that already starts with a quote is not quoted twice', () => {
    expect(safeCell("'=1+1")).toBe("'=1+1")
  })

  it('happy: ordinary text is returned unchanged', () => {
    expect(safeCell('Widget A1')).toBe('Widget A1')
  })
})
