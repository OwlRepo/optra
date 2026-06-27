import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import type { LoadedDocument } from './types'

// Direct internal import avoids a bug in pdf-parse where the default
// entry point tries to read test files on import, which crashes in
// environments that don't have those test files present.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js')

export async function loadPDF(filePath: string): Promise<LoadedDocument> {
  const [buffer, stats] = await Promise.all([
    readFile(filePath),
    stat(filePath),
  ])

  const result = await pdfParse(buffer)

  return {
    content: result.text,
    metadata: {
      source: filePath,
      fileType: 'pdf',
      fileName: basename(filePath),
      fileSize: stats.size,
      pageCount: result.numpages,
    },
  }
}
