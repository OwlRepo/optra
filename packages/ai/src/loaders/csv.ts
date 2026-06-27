import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import Papa from 'papaparse'
import type { LoadedDocument } from './types'

export async function loadCSV(filePath: string): Promise<LoadedDocument> {
  const [raw, stats] = await Promise.all([
    readFile(filePath, 'utf-8'),
    stat(filePath),
  ])

  const result = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
  })

  // Turn each row into "key: value, key: value" lines so the content
  // reads naturally when the chunker and embedder process it later.
  const content = result.data
    .map(row =>
      Object.entries(row)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ')
    )
    .join('\n')

  return {
    content,
    metadata: {
      source: filePath,
      fileType: 'csv',
      fileName: basename(filePath),
      fileSize: stats.size,
      headers: result.meta.fields ?? [],
      rowCount: result.data.length,
    },
  }
}
