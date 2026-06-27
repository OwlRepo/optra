import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import * as XLSX from 'xlsx'
import type { LoadedDocument } from './types'

export async function loadXLSX(filePath: string): Promise<LoadedDocument> {
  const [buffer, stats] = await Promise.all([
    readFile(filePath),
    stat(filePath),
  ])

  const workbook = XLSX.read(buffer, { type: 'buffer' })

  // Excel files can have multiple sheets. We process all of them
  // and join them together so nothing gets lost.
  const sections = workbook.SheetNames.map(sheetName => {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: '',
    })

    const sheetText = rows
      .map(row =>
        Object.entries(row)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ')
      )
      .join('\n')

    return `[Sheet: ${sheetName}]\n${sheetText}`
  })

  return {
    content: sections.join('\n\n'),
    metadata: {
      source: filePath,
      fileType: 'xlsx',
      fileName: basename(filePath),
      fileSize: stats.size,
      sheetNames: workbook.SheetNames,
      sheetCount: workbook.SheetNames.length,
    },
  }
}
