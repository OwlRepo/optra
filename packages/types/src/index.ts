export interface Workspace {
  id: string
  name: string
  ownerId: string
  createdAt: Date
}

export interface Document {
  id: string
  workspaceId: string
  title: string
  sourceUrl?: string
  createdAt: Date
}

export interface Chunk {
  id: string
  documentId: string
  workspaceId: string
  content: string
  embedding?: number[]
  metadata?: Record<string, any>
  createdAt: Date
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

export interface IngestJob {
  id: string
  documentId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error?: string
  createdAt: Date
  completedAt?: Date
}

export interface RetrievalResult {
  chunk: Chunk
  score: number
  document?: Document
}

export * from './procurement'
