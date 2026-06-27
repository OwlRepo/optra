import { OpenAIEmbeddings } from '@langchain/openai'
import type { Chunk } from '../chunking/types'
import type { EmbeddedChunk } from './types'

export type { EmbeddedChunk }

const embedder = new OpenAIEmbeddings({
  modelName: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  openAIApiKey: process.env.OPENAI_API_KEY,
})

export async function embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
  const texts = chunks.map(c => c.content)
  const vectors = await embedder.embedDocuments(texts)

  return chunks.map((chunk, index) => ({
    ...chunk,
    embedding: vectors[index]!,
  }))
}

export async function embedQuery(text: string): Promise<number[]> {
  return embedder.embedQuery(text)
}
