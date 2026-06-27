import { OpenAIEmbeddings } from '@langchain/openai'

const embeddings = new OpenAIEmbeddings({
  modelName: 'text-embedding-3-small',
})

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  // TODO: Generate embeddings for array of texts
  // Returns array of embedding vectors (1536 dimensions for text-embedding-3-small)
  return embeddings.embedDocuments(texts)
}

export async function generateEmbedding(text: string): Promise<number[]> {
  // TODO: Generate embedding for single text
  return embeddings.embedQuery(text)
}

export { embeddings }
