import { BadRequestException } from '@nestjs/common'

export type Cursor = { k: (string | number)[]; id: string }

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!parsed || !Array.isArray(parsed.k) || typeof parsed.id !== 'string') {
      throw new Error('shape')
    }
    return parsed as Cursor
  } catch {
    throw new BadRequestException('Invalid cursor')
  }
}

// --- Offset pagination (admin tables: page jump / first / last / page-size) ---

export type OffsetPage = { page: number; pageSize: number; offset: number }

export type OffsetResult<T> = {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed) || parsed < min) return Math.min(Math.max(fallback, min), max)
  return Math.min(parsed, max)
}

/**
 * Resolve raw `page`/`pageSize` query values into a clamped, SQL-ready page.
 * `page` clamps to >= 1, `pageSize` clamps to 1..100 (default 20, overridable).
 */
export function resolveOffsetPage(
  rawPage?: number | string,
  rawPageSize?: number | string,
  defaults?: { pageSize?: number },
): OffsetPage {
  const pageSizeDefault = defaults?.pageSize ?? DEFAULT_PAGE_SIZE
  const pageSize = clampInt(rawPageSize, pageSizeDefault, 1, MAX_PAGE_SIZE)
  const page = clampInt(rawPage, 1, 1, Number.MAX_SAFE_INTEGER)
  return { page, pageSize, offset: (page - 1) * pageSize }
}

/** Wrap a page of rows + total count into the standard offset response shape. */
export function buildOffsetResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): OffsetResult<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  }
}
