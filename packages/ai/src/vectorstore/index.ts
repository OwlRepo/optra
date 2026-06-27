import { Document } from 'langchain/document'

export interface VectorStoreChunk {
  id: string
  documentId: string
  tenantId: string
  content: string
  embedding: number[]
  metadata: Record<string, any>
}

export async function upsertChunks(chunks: VectorStoreChunk[]): Promise<void> {
  // TODO: Implement pgvector upsert
  // Insert chunks with embeddings into the chunks table
  // Use Drizzle ORM from @repo/db
  throw new Error('Not implemented')
}

export interface SearchResult {
  chunk: VectorStoreChunk
  score: number
}

export async function similaritySearch(
  query: string,
  tenantId: string,
  limit: number = 5
): Promise<SearchResult[]> {
  // TODO: Implement pgvector similarity search
  // 1. Generate embedding for query
  // 2. Use pgvector <=> operator for cosine similarity
  // 3. Return top k results with scores
  throw new Error('Not implemented')
}
