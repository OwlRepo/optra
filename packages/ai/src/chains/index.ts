import { ChatOpenAI } from '@langchain/openai'
import { RunnableSequence } from '@langchain/core/runnables'

const llm = new ChatOpenAI({
  modelName: 'gpt-4-turbo',
  temperature: 0,
})

export async function buildRetrievalChain() {
  // TODO: Build a retrieval-augmented generation chain
  // 1. Create a retrieval step using similaritySearch
  // 2. Format context into prompt
  // 3. Pass to LLM
  // 4. Return chain that can be invoked with { question, tenantId }
  
  throw new Error('Not implemented')
}

export { llm }
