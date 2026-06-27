import { extname } from 'path'
import { loadText } from './txt'
import { loadPDF } from './pdf'
import { loadDOCX } from './docx'
import { loadCSV } from './csv'
import { loadJSON } from './json'
import { loadHTML } from './html'
import { loadXLSX } from './xlsx'
import { loadPPTX } from './pptx'
import { loadEML } from './eml'
import { loadMSG } from './msg'
import { loadYAML } from './yaml'
import type { LoadedDocument } from './types'

export type { LoadedDocument }

type LoaderFn = (filePath: string) => Promise<LoadedDocument>

const LOADERS: Record<string, LoaderFn> = {
  // Tier 1
  txt:  loadText,
  md:   loadText,
  mdx:  loadText,
  rst:  loadText,
  pdf:  loadPDF,
  docx: loadDOCX,
  csv:  loadCSV,
  json: loadJSON,
  html: loadHTML,
  htm:  loadHTML,
  // Tier 2
  xlsx: loadXLSX,
  pptx: loadPPTX,
  eml:  loadEML,
  msg:  loadMSG,
  yaml: loadYAML,
  yml:  loadYAML,
}

export async function loadDocument(filePath: string): Promise<LoadedDocument> {
  const ext = extname(filePath).replace('.', '').toLowerCase()
  const loader = LOADERS[ext]

  if (!loader) {
    throw new Error(`Unsupported file type: .${ext}`)
  }

  return loader(filePath)
}
