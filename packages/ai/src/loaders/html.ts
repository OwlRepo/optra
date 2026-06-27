import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import * as cheerio from 'cheerio'
import type { LoadedDocument } from './types'

export async function loadHTML(filePath: string): Promise<LoadedDocument> {
  const [raw, stats] = await Promise.all([
    readFile(filePath, 'utf-8'),
    stat(filePath),
  ])

  const $ = cheerio.load(raw)

  // Remove tags that carry no readable content.
  $('script, style, noscript').remove()

  // Extract visible text and collapse extra whitespace.
  const content = $('body').text().replace(/\s+/g, ' ').trim()

  return {
    content,
    metadata: {
      source: filePath,
      fileType: 'html',
      fileName: basename(filePath),
      fileSize: stats.size,
      title: $('title').text().trim() || undefined,
    },
  }
}
