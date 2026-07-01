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
