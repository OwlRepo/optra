export interface Tenant {
  id: string
  name: string
  createdAt: Date
}

export interface Document {
  id: string
  tenantId: string
  title: string
  sourceUrl?: string
  createdAt: Date
}

export interface Chunk {
  id: string
  documentId: string
  tenantId: string
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
