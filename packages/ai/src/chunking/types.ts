export interface Chunk {
  content: string
  metadata: {
    source: string
    fileType: string
    chunkIndex: number
    totalChunks: number
    tenantId?: string
    knowledgeBaseId?: string
    documentId?: string
    [key: string]: unknown
  }
}

export interface ChunkOptions {
  chunkSize?: number   // max tokens per chunk (default: 512)
  chunkOverlap?: number // tokens shared between adjacent chunks (default: 50)
}
