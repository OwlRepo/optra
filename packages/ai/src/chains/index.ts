import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { similaritySearch } from '../vectorstore'

const llm = new ChatOpenAI({
  modelName: process.env.OPENAI_CHAT_MODEL ?? 'gpt-4-turbo',
  temperature: 0,
  streaming: true,
})

const SYSTEM_PROMPT = `You are a helpful support assistant.
Answer questions using ONLY the context provided below.
If the answer is not in the context, say: "I don't have enough information to answer that."
Be concise, accurate, and do not make up information.`

function buildContext(chunks: Awaited<ReturnType<typeof similaritySearch>>): string {
  if (chunks.length === 0) return ''
  return chunks.map(c => c.content).join('\n---\n')
}

export async function* askQuestion(
  question: string,
  workspaceId: string,
  limit = 5
): AsyncGenerator<string> {
  const chunks = await similaritySearch(question, workspaceId, limit)

  if (chunks.length === 0) {
    yield "I don't have enough information to answer that."
    return
  }

  const context = buildContext(chunks)

  const stream = await llm.stream([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(`Context:\n${context}\n\nQuestion: ${question}`),
  ])

  for await (const chunk of stream) {
    const token = chunk.content
    if (typeof token === 'string' && token.length > 0) {
      yield token
    }
  }
}
