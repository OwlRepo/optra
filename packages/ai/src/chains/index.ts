import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { db, documents } from '@repo/db'
import { inArray } from 'drizzle-orm'
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

export interface ChatSource {
  documentId: string
  title: string
  sourceUrl: string | null
  score: number
  snippet: string
}

export interface AnswerResult {
  sources: ChatSource[]
  stream: AsyncGenerator<string>
}

export async function answerQuestion(
  question: string,
  workspaceId: string,
  limit = 5
): Promise<AnswerResult> {
  if (process.env.LANGGRAPH_ENABLED === 'true') {
    const { answerQuestionWithGraph } = await import('./graph')
    return answerQuestionWithGraph(question, workspaceId, limit)
  }

  const chunks = await similaritySearch(question, workspaceId, limit)

  if (chunks.length === 0) {
    return {
      sources: [],
      stream: (async function* () {
        yield "I don't have enough information to answer that."
      })(),
    }
  }

  const bestChunkByDocumentId = new Map<
    string,
    Awaited<ReturnType<typeof similaritySearch>>[number]
  >()

  for (const chunk of chunks) {
    const documentId =
      typeof chunk.metadata?.documentId === 'string' ? chunk.metadata.documentId : null

    if (!documentId) continue

    const current = bestChunkByDocumentId.get(documentId)
    if (!current || chunk.score > current.score) {
      bestChunkByDocumentId.set(documentId, chunk)
    }
  }

  const documentIds = [...bestChunkByDocumentId.keys()]
  const documentRows =
    documentIds.length > 0
      ? await db
          .select({
            id: documents.id,
            title: documents.title,
            sourceUrl: documents.sourceUrl,
          })
          .from(documents)
          .where(inArray(documents.id, documentIds))
      : []

  const documentMap = new Map(documentRows.map((row) => [row.id, row]))
  const sources: ChatSource[] = documentIds.flatMap((documentId) => {
    const chunk = bestChunkByDocumentId.get(documentId)
    const row = documentMap.get(documentId)

    if (!chunk || !row) return []

    return [
      {
        documentId,
        title: row.title,
        sourceUrl: row.sourceUrl,
        score: chunk.score,
        snippet: chunk.content.slice(0, 200),
      },
    ]
  })

  return {
    sources,
    stream: (async function* () {
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
    })(),
  }
}

export async function* askQuestion(
  question: string,
  workspaceId: string,
  limit = 5
): AsyncGenerator<string> {
  const result = await answerQuestion(question, workspaceId, limit)
  for await (const token of result.stream) {
    if (token.length > 0) {
      yield token
    }
  }
}
