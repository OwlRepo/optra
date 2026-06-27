import { readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'
import yaml from 'js-yaml'
import type { LoadedDocument } from './types'

export async function loadYAML(filePath: string): Promise<LoadedDocument> {
  const [raw, stats] = await Promise.all([
    readFile(filePath, 'utf-8'),
    stat(filePath),
  ])

  const parsed: unknown = yaml.load(raw)

  // Convert the parsed object back to a readable string the same way
  // we do for JSON — structured but human-readable.
  const content = JSON.stringify(parsed, null, 2)

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
