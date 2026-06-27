import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import type { LoadedDocument } from './types'

export async function loadJSON(filePath: string): Promise<LoadedDocument> {
  const [raw, stats] = await Promise.all([
    readFile(filePath, 'utf-8'),
    stat(filePath),
  ])

  // Validate it is real JSON before passing it on.
  // Pretty-print it back so the content is human-readable for the embedder.
  const parsed: unknown = JSON.parse(raw)
  const content = JSON.stringify(parsed, null, 2)

  return {
    content,
    metadata: {
      source: filePath,
      fileType: 'json',
      fileName: basename(filePath),
      fileSize: stats.size,
    },
  }
}
