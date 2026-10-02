import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import { loadPdfjs } from './pdfjs'
import type { LoadedDocument } from './types'

interface TextItem {
  str?: string
  hasEOL?: boolean
}

// Page text in reading order: items concatenated, a newline wherever pdfjs
// marks end-of-line, a blank line between pages. Uses the shared pdfjs copy
// (./pdfjs) - never a second PDF library, see pdfjs.ts for why.
function pageText(items: TextItem[]): string {
  return items
    .map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ''}`)
    .join('')
    .trim()
}

export async function loadPDF(filePath: string): Promise<LoadedDocument> {
  const [buffer, stats] = await Promise.all([
    readFile(filePath),
    stat(filePath),
  ])

  const pdfjs = await loadPdfjs()
  // pdfjs rejects a Node Buffer instance; it needs a plain Uint8Array.
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) })
  try {
    const doc = await task.promise
    const pages: string[] = []
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      pages.push(pageText(content.items as TextItem[]))
      page.cleanup()
    }

    return {
      content: pages.join('\n\n'),
      metadata: {
        source: filePath,
        fileType: 'pdf',
        fileName: basename(filePath),
        fileSize: stats.size,
        pageCount: doc.numPages,
      },
    }
  } finally {
    // Cleanup lives on the loading task in pdfjs 6 (PDFDocumentLoadingTask.destroy).
    await task.destroy()
  }
}
