import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import mammoth from 'mammoth'
import type { LoadedDocument } from './types'

export async function loadDOCX(filePath: string): Promise<LoadedDocument> {
  const [buffer, stats] = await Promise.all([
    readFile(filePath),
    stat(filePath),
  ])

  const result = await mammoth.extractRawText({ buffer })

  return {
    content: result.value,
    metadata: {
      source: filePath,
      fileType: 'docx',
      fileName: basename(filePath),
      fileSize: stats.size,
    },
  }
}
