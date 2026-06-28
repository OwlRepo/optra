export type ChunkStrategy = 'recursive' | 'markdown' | 'section-aware'

export interface Chunk {
  content: string
  contentHash: string
  metadata: {
    source: string
    fileType: string
    chunkIndex: number
    totalChunks: number
    strategy: ChunkStrategy
    sectionId?: string
    sectionTitle?: string
    workspaceId?: string
    knowledgeBaseId?: string
    documentId?: string
    [key: string]: unknown
  }
}

export interface ChunkOptions {
  chunkSize?: number
  chunkOverlap?: number
  strategy?: ChunkStrategy
}
