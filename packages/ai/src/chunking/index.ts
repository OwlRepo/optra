import { Document } from 'langchain/document'

export interface ChunkConfig {
  chunkSize?: number
  chunkOverlap?: number
}

export async function chunkDocuments(
  documents: Document[],
  config: ChunkConfig = {}
): Promise<Document[]> {
  // TODO: Implement text chunking using RecursiveCharacterTextSplitter
  // Default chunk size: 1000, overlap: 200
  const { chunkSize = 1000, chunkOverlap = 200 } = config
  
  throw new Error('Not implemented')
}
