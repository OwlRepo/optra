const FORMULA_LEAD = new Set(['=', '+', '-', '@', '\t', '\r', '\n'])

/**
 * Neutralises spreadsheet formula injection: a text cell whose first character
 * Excel/Sheets would read as a formula gets a single-quote prefix. Numbers,
 * booleans, null and undefined pass through so numeric cells stay numeric.
 */
export function safeCell<T>(value: T): T | string {
  if (typeof value !== 'string' || value === '') return value
  return FORMULA_LEAD.has(value[0]) ? `'${value}` : value
}
