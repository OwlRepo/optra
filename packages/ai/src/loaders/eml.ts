import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import { simpleParser } from 'mailparser'
import type { LoadedDocument } from './types'

export async function loadEML(filePath: string): Promise<LoadedDocument> {
  const [buffer, stats] = await Promise.all([
    readFile(filePath),
    stat(filePath),
  ])

  const parsed = await simpleParser(buffer)

  // Prefer plain text body. Fall back to stripped HTML if plain text
  // is not present (some email clients only send HTML).
  const htmlText = typeof parsed.html === 'string'
    ? parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : undefined
  const content = parsed.text ?? htmlText ?? ''

  return {
    content,
    metadata: {
      source: filePath,
      fileType: 'eml',
      fileName: basename(filePath),
      fileSize: stats.size,
      subject: parsed.subject ?? undefined,
      from: parsed.from?.text ?? undefined,
      to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(a => a.text).join(', ') : parsed.to.text) : undefined,
      date: parsed.date?.toISOString() ?? undefined,
    },
  }
}
