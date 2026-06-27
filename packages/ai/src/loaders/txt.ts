import { readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'
import type { LoadedDocument } from './types'

export async function loadText(filePath: string): Promise<LoadedDocument> {
  const [content, stats] = await Promise.all([
    readFile(filePath, 'utf-8'),
    stat(filePath),
  ])

  const ext = extname(filePath).replace('.', '').toLowerCase()

  return {
    content,
    metadata: {
      source: filePath,
      fileType: ext,
      fileName: basename(filePath),
      fileSize: stats.size,
    },
  }
}
