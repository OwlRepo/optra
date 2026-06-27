import { stat } from 'fs/promises'
import { basename } from 'path'
import officeParser from 'officeparser'
import type { LoadedDocument } from './types'

export async function loadPPTX(filePath: string): Promise<LoadedDocument> {
  const stats = await stat(filePath)

  const ast = await officeParser.parseOffice(filePath)
  const content = ast.toText()

  return {
    content: content.replace(/\s+/g, ' ').trim(),
    metadata: {
      source: filePath,
      fileType: 'pptx',
      fileName: basename(filePath),
      fileSize: stats.size,
    },
  }
}
