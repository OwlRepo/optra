import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import { PDFParse } from 'pdf-parse'
import type { LoadedDocument } from './types'

export async function loadPDF(filePath: string): Promise<LoadedDocument> {
  const [buffer, stats] = await Promise.all([
    readFile(filePath),
    stat(filePath),
  ])

  const parser = new PDFParse({ data: buffer })
  const result = await parser.getText()
  await parser.destroy()

  return {
    content: result.text,
    metadata: {
      source: filePath,
      fileType: 'pdf',
      fileName: basename(filePath),
      fileSize: stats.size,
      pageCount: result.total,
    },
  }
}
