export interface LoadedDocument {
  content: string
  metadata: {
    source: string    // absolute path to the file
    fileType: string  // lowercase extension without dot: "pdf", "docx", "csv", etc.
    fileName: string  // basename: "report.pdf", "notes.md", etc.
    fileSize?: number // bytes, populated when the loader stats the file
    [key: string]: unknown // loader-specific extras (pageCount, sheetNames, headers, etc.)
  }
}
