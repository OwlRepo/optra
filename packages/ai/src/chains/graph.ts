import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { db, documents, tickets } from '@repo/db'
import { inArray } from 'drizzle-orm'
import { similaritySearch } from '../vectorstore'
import type { AnswerResult, ChatSource } from './index'

const llm = new ChatOpenAI({
  modelName: process.env.OPENAI_CHAT_MODEL ?? 'gpt-4-turbo',
  temperature: 0,
  streaming: true,
})

const FALLBACK_MESSAGE =
  "I don't have enough information to answer that. Consider escalating to a human."

const ANSWER_SYSTEM_PROMPT = `You are a helpful support assistant.
Answer questions using ONLY the context provided below.
If the answer is not in the context, say: "I don't have enough information to answer that."
Be concise, accurate, and do not make up information.`

const REGENERATE_SYSTEM_PROMPT = `You are a careful support assistant.
Answer using ONLY the provided context.
If any part is unsupported, omit it.
If context is insufficient, say: "I don't have enough information to answer that."`

const REWRITE_SYSTEM_PROMPT = `Rewrite the user question so vector retrieval is more likely to find matching support documentation.
Keep meaning unchanged. Return rewritten question only.`

const GRADE_SYSTEM_PROMPT = `Answer "yes" if the answer is fully grounded in the provided context.
Answer "no" if any part is unsupported or missing from the context.`

const GraphState = Annotation.Root({
  question: Annotation<string>,
  workspaceId: Annotation<string>,
  limit: Annotation<number>,
  rewrites: Annotation<number>,
  chunks: Annotation<any[]>,
  sources: Annotation<ChatSource[]>,
  grounded: Annotation<boolean | undefined>,
  regenerated: Annotation<boolean>,
  answerText: Annotation<string | undefined>,
})

function buildContext(chunks: Awaited<ReturnType<typeof similaritySearch>>): string {
  if (chunks.length === 0) return ''
  return chunks.map((chunk) => chunk.content).join('\n---\n')
}

async function buildSources(
  chunks: Awaited<ReturnType<typeof similaritySearch>>,
): Promise<ChatSource[]> {
  type RetrievedChunk = (typeof chunks)[number]
  const bestDocumentChunkById = new Map<string, RetrievedChunk>()
  const bestTicketChunkById = new Map<string, RetrievedChunk>()

  for (const chunk of chunks) {
    const ticketId =
      typeof chunk.metadata?.ticketId === 'string' ? chunk.metadata.ticketId : null
    const documentId =
      typeof chunk.metadata?.documentId === 'string' ? chunk.metadata.documentId : null

    if (ticketId) {
      const current = bestTicketChunkById.get(ticketId)
      if (!current || chunk.score > current.score) {
        bestTicketChunkById.set(ticketId, chunk)
      }
    } else if (documentId) {
      const current = bestDocumentChunkById.get(documentId)
      if (!current || chunk.score > current.score) {
        bestDocumentChunkById.set(documentId, chunk)
      }
    }
  }

  const documentIds = [...bestDocumentChunkById.keys()]
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
  const ticketIds = [...bestTicketChunkById.keys()]
  const ticketRows =
    ticketIds.length > 0
      ? await db
          .select({ id: tickets.id, title: tickets.title })
          .from(tickets)
          .where(inArray(tickets.id, ticketIds))
      : []
  const ticketMap = new Map(ticketRows.map((row) => [row.id, row]))

  const documentSources: ChatSource[] = documentIds.flatMap((documentId) => {
    const chunk = bestDocumentChunkById.get(documentId)
    const row = documentMap.get(documentId)

    if (!chunk || !row) return []

    return [
      {
        sourceType: 'document' as const,
        documentId,
        title: row.title,
        sourceUrl: row.sourceUrl,
        score: chunk.score,
        snippet: chunk.content.slice(0, 200),
      },
    ]
  })

  const ticketSources: ChatSource[] = ticketIds.flatMap((ticketId) => {
    const chunk = bestTicketChunkById.get(ticketId)
    const row = ticketMap.get(ticketId)

    if (!chunk || !row) return []

    return [
      {
        sourceType: 'ticket' as const,
        ticketId,
        title: row.title ?? 'Ticket draft',
        score: chunk.score,
        snippet: chunk.content.slice(0, 200),
      },
    ]
  })

  return [...documentSources, ...ticketSources]
}

async function collectAnswer(
  question: string,
  chunks: Awaited<ReturnType<typeof similaritySearch>>,
  systemPrompt: string,
): Promise<string> {
  const stream = await llm.stream([
    new SystemMessage(systemPrompt),
    new HumanMessage(`Context:\n${buildContext(chunks)}\n\nQuestion: ${question}`),
  ])
  const parts: string[] = []

  for await (const chunk of stream) {
    if (typeof chunk.content === 'string' && chunk.content.length > 0) {
      parts.push(chunk.content)
    }
  }

  return parts.join('')
}

function maxQueryRewrites() {
  return Number.parseInt(process.env.MAX_QUERY_REWRITES ?? '2', 10)
}

function retrievalThreshold() {
  return Number.parseFloat(process.env.RETRIEVAL_SCORE_THRESHOLD ?? '0.78')
}

async function retrieveNode(state: typeof GraphState.State) {
  const chunks = await similaritySearch(state.question, state.workspaceId, state.limit)
  const sources = await buildSources(chunks)
  return { chunks, sources }
}

function routeAfterRetrieve(state: typeof GraphState.State) {
  const topScore = Math.max(0, ...state.chunks.map((chunk) => chunk.score))

  if (topScore >= retrievalThreshold()) {
    return 'generate'
  }

  if (state.rewrites < maxQueryRewrites()) {
    return 'rewrite'
  }

  return 'fallback'
}

async function rewriteNode(state: typeof GraphState.State) {
  const response = await llm.invoke([
    new SystemMessage(REWRITE_SYSTEM_PROMPT),
    new HumanMessage(state.question),
  ])

  return {
    question:
      typeof response.content === 'string' && response.content.trim().length > 0
        ? response.content.trim()
        : state.question,
    rewrites: state.rewrites + 1,
  }
}

async function generateNode(state: typeof GraphState.State) {
  return {
    answerText: await collectAnswer(state.question, state.chunks, ANSWER_SYSTEM_PROMPT),
  }
}

function routeAfterGenerate() {
  return process.env.SELF_GRADE_ENABLED === 'true' ? 'gradeAnswer' : END
}

async function gradeAnswerNode(state: typeof GraphState.State) {
  const response = await llm.invoke([
    new SystemMessage(GRADE_SYSTEM_PROMPT),
    new HumanMessage(
      `Context:\n${buildContext(state.chunks)}\n\nAnswer:\n${state.answerText ?? ''}`,
    ),
  ])
  const text =
    typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content.map((part) => ('text' in part ? part.text : '')).join(' ')
        : ''

  return {
    grounded: text.toLowerCase().includes('yes'),
  }
}

function routeAfterGrade(state: typeof GraphState.State) {
  if (state.grounded === false && !state.regenerated) {
    return 'regenerate'
  }

  return END
}

async function regenerateNode(state: typeof GraphState.State) {
  return {
    answerText: await collectAnswer(state.question, state.chunks, REGENERATE_SYSTEM_PROMPT),
    regenerated: true,
  }
}

async function fallbackNode() {
  return {
    answerText: FALLBACK_MESSAGE,
    sources: [],
  }
}

const graph = new StateGraph(GraphState)
  .addNode('retrieve', retrieveNode)
  .addNode('rewrite', rewriteNode)
  .addNode('generate', generateNode)
  .addNode('gradeAnswer', gradeAnswerNode)
  .addNode('regenerate', regenerateNode)
  .addNode('fallback', fallbackNode)
  .addEdge(START, 'retrieve')
  .addConditionalEdges('retrieve', routeAfterRetrieve)
  .addEdge('rewrite', 'retrieve')
  .addConditionalEdges('generate', routeAfterGenerate)
  .addConditionalEdges('gradeAnswer', routeAfterGrade)
  .addEdge('regenerate', END)
  .addEdge('fallback', END)
  .compile()

export async function answerQuestionWithGraph(
  question: string,
  workspaceId: string,
  limit = 5,
): Promise<AnswerResult> {
  const result = await graph.invoke({
    question,
    workspaceId,
    limit,
    rewrites: 0,
    chunks: [],
    sources: [],
    regenerated: false,
  })

  return {
    sources: result.sources ?? [],
    stream: (async function* () {
      yield result.answerText ?? FALLBACK_MESSAGE
    })(),
  }
}
