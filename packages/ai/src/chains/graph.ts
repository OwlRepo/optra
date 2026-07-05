import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { db, documents, tickets } from "@repo/db";
import { inArray } from "drizzle-orm";
import {
  similaritySearch,
  similaritySearchWithTicketSlot,
  type RetrievalFilters,
} from "../vectorstore";
import { resolveModel } from "./models";
import { buildEvidencePack } from "./context";
import type { AnswerResult, ChatSource } from "./index";

// Answering streams and is quality-critical; rewrite/grade are cheap classification
// calls that can run on a faster/cheaper model. See resolveModel for the fallback chain.
const answerLlm = new ChatOpenAI({
  modelName: resolveModel("answer"),
  temperature: 0,
  streaming: true,
});

const rewriteLlm = new ChatOpenAI({
  modelName: resolveModel("rewrite"),
  temperature: 0,
});

const gradeLlm = new ChatOpenAI({
  modelName: resolveModel("grade"),
  temperature: 0,
});

const FALLBACK_MESSAGE =
  "I don't have enough information to answer that. Consider escalating to a human.";

const ANSWER_SYSTEM_PROMPT = `You are a helpful support assistant.
Answer using ONLY the context provided below.
If the context fully answers the question, answer directly and concisely.
If the context is only partially relevant, say what you found, be explicit about what's missing or
uncertain, and point the user to the sources below. Do not invent specifics that aren't stated in the
context.
If the context has nothing relevant to the question, say: "I don't have enough information to answer that."
Be concise, accurate, and do not make up information.`;

const REGENERATE_SYSTEM_PROMPT = `You are a careful support assistant.
Answer using ONLY the provided context.
If any part is unsupported, omit it.
If the context is only partially relevant, keep only the supported parts, state clearly what's missing, and
point the user to the sources below.
If context is insufficient, say: "I don't have enough information to answer that."`;

const REWRITE_SYSTEM_PROMPT = `Rewrite the user question so vector retrieval is more likely to find matching support documentation.
Keep meaning unchanged. Return rewritten question only.`;

const GRADE_SYSTEM_PROMPT = `Answer "yes" if the answer is fully grounded in the provided context.
Answer "no" if any part is unsupported or missing from the context.`;

const GraphState = Annotation.Root({
  // The user's real question — used for generation/grading, never mutated.
  originalQuestion: Annotation<string>,
  // The query used for vector retrieval — rewrites mutate THIS, not the original.
  retrievalQuery: Annotation<string>,
  workspaceId: Annotation<string>,
  limit: Annotation<number>,
  rewrites: Annotation<number>,
  chunks: Annotation<any[]>,
  sources: Annotation<ChatSource[]>,
  grounded: Annotation<boolean | undefined>,
  regenerated: Annotation<boolean>,
  answerText: Annotation<string | undefined>,
  isFallback: Annotation<boolean>,
  shouldStream: Annotation<boolean>,
  // Embedding of the original question, reused for the FIRST retrieval so the
  // caller's cache-lookup embedding isn't recomputed. Rewrites re-embed.
  precomputedEmbedding: Annotation<number[] | undefined>,
  // Optional metadata filters applied to retrieval.
  filters: Annotation<RetrievalFilters | undefined>,
});

function buildContext(
  chunks: Awaited<ReturnType<typeof similaritySearch>>,
): string {
  return buildEvidencePack(chunks);
}

async function buildSources(
  chunks: Awaited<ReturnType<typeof similaritySearch>>,
): Promise<ChatSource[]> {
  type RetrievedChunk = (typeof chunks)[number];
  const bestDocumentChunkById = new Map<string, RetrievedChunk>();
  const bestTicketChunkById = new Map<string, RetrievedChunk>();

  for (const chunk of chunks) {
    const ticketId =
      typeof chunk.metadata?.ticketId === "string"
        ? chunk.metadata.ticketId
        : null;
    const documentId =
      typeof chunk.metadata?.documentId === "string"
        ? chunk.metadata.documentId
        : null;

    if (ticketId) {
      const current = bestTicketChunkById.get(ticketId);
      if (!current || chunk.score > current.score) {
        bestTicketChunkById.set(ticketId, chunk);
      }
    } else if (documentId) {
      const current = bestDocumentChunkById.get(documentId);
      if (!current || chunk.score > current.score) {
        bestDocumentChunkById.set(documentId, chunk);
      }
    }
  }

  const documentIds = [...bestDocumentChunkById.keys()];
  const documentRows =
    documentIds.length > 0
      ? await db
          .select({
            id: documents.id,
            title: documents.title,
            sourceUrl: documents.sourceUrl,
            knowledgeBaseId: documents.knowledgeBaseId,
          })
          .from(documents)
          .where(inArray(documents.id, documentIds))
      : [];

  const documentMap = new Map(documentRows.map((row) => [row.id, row]));
  const ticketIds = [...bestTicketChunkById.keys()];
  const ticketRows =
    ticketIds.length > 0
      ? await db
          .select({ id: tickets.id, title: tickets.title })
          .from(tickets)
          .where(inArray(tickets.id, ticketIds))
      : [];
  const ticketMap = new Map(ticketRows.map((row) => [row.id, row]));

  const documentSources: ChatSource[] = documentIds.flatMap((documentId) => {
    const chunk = bestDocumentChunkById.get(documentId);
    const row = documentMap.get(documentId);

    if (!chunk || !row) return [];

    return [
      {
        sourceType: "document" as const,
        documentId,
        knowledgeBaseId: row.knowledgeBaseId,
        title: row.title,
        sourceUrl: row.sourceUrl,
        score: chunk.score,
        snippet: chunk.content.slice(0, 200),
      },
    ];
  });

  const ticketSources: ChatSource[] = ticketIds.flatMap((ticketId) => {
    const chunk = bestTicketChunkById.get(ticketId);
    const row = ticketMap.get(ticketId);

    if (!chunk || !row) return [];

    return [
      {
        sourceType: "ticket" as const,
        ticketId,
        title: row.title ?? "Ticket draft",
        score: chunk.score,
        snippet: chunk.content.slice(0, 200),
      },
    ];
  });

  return [...documentSources, ...ticketSources];
}

async function collectAnswer(
  question: string,
  chunks: Awaited<ReturnType<typeof similaritySearch>>,
  systemPrompt: string,
): Promise<string> {
  const stream = await answerLlm.stream([
    new SystemMessage(systemPrompt),
    new HumanMessage(
      `Context:\n${buildContext(chunks)}\n\nQuestion: ${question}`,
    ),
  ]);
  const parts: string[] = [];

  for await (const chunk of stream) {
    if (typeof chunk.content === "string" && chunk.content.length > 0) {
      parts.push(chunk.content);
    }
  }

  return parts.join("");
}

// Confident-answer path: stream generation tokens straight to the caller so
// time-to-first-token is one LLM token, not the whole buffered answer (+ grade).
async function* streamAnswer(
  question: string,
  chunks: Awaited<ReturnType<typeof similaritySearch>>,
  systemPrompt: string,
): AsyncGenerator<string> {
  const stream = await answerLlm.stream([
    new SystemMessage(systemPrompt),
    new HumanMessage(
      `Context:\n${buildContext(chunks)}\n\nQuestion: ${question}`,
    ),
  ]);

  for await (const chunk of stream) {
    if (typeof chunk.content === "string" && chunk.content.length > 0) {
      yield chunk.content;
    }
  }
}

function maxQueryRewrites() {
  return Number.parseInt(process.env.MAX_QUERY_REWRITES ?? "2", 10);
}

function retrievalThreshold() {
  return Number.parseFloat(process.env.RETRIEVAL_SCORE_THRESHOLD ?? "0.35");
}

async function retrieveNode(state: typeof GraphState.State) {
  // Reuse the caller's embedding only on the first pass; a rewrite changes the
  // query text, so that must be embedded fresh.
  const embedding =
    state.rewrites === 0
      ? (state.precomputedEmbedding ?? undefined)
      : undefined;
  const chunks = await similaritySearchWithTicketSlot(
    state.retrievalQuery,
    state.workspaceId,
    state.limit,
    embedding,
    state.filters ?? undefined,
  );
  const sources = await buildSources(chunks);
  return { chunks, sources };
}

// Grade only low-confidence answers. Grading needs the full answer up front, so
// it is incompatible with streaming; confident answers skip it and stream.
function shouldGradeAtScore(topScore: number): boolean {
  if (process.env.SELF_GRADE_ENABLED !== "true") return false;
  const minScore = selfGradeMinScore();
  if (minScore === undefined) return true;
  return topScore < minScore;
}

function routeAfterRetrieve(state: typeof GraphState.State) {
  const topScore = Math.max(0, ...state.chunks.map((chunk) => chunk.score));

  if (topScore >= retrievalThreshold()) {
    // Confident retrieval + no grading needed -> stream. Otherwise fall into the
    // buffered generate -> grade -> maybe regenerate path.
    return shouldGradeAtScore(topScore) ? "generate" : "prepareStream";
  }

  if (state.rewrites < maxQueryRewrites()) {
    return "rewrite";
  }

  return "fallback";
}

// Marks the confident streaming branch; generation itself happens in the
// streaming layer (streamAnswer), not inside the graph, so tokens are not buffered.
function prepareStreamNode() {
  return { shouldStream: true };
}

async function rewriteNode(state: typeof GraphState.State) {
  const response = await rewriteLlm.invoke([
    new SystemMessage(REWRITE_SYSTEM_PROMPT),
    new HumanMessage(state.retrievalQuery),
  ]);

  // Rewrite only the retrieval query. The original question is left untouched so
  // generation still answers what the user actually asked.
  return {
    retrievalQuery:
      typeof response.content === "string" && response.content.trim().length > 0
        ? response.content.trim()
        : state.retrievalQuery,
    rewrites: state.rewrites + 1,
  };
}

async function generateNode(state: typeof GraphState.State) {
  return {
    answerText: await collectAnswer(
      state.originalQuestion,
      state.chunks,
      ANSWER_SYSTEM_PROMPT,
    ),
  };
}

function selfGradeMinScore(): number | undefined {
  const raw = process.env.SELF_GRADE_MIN_SCORE;
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function routeAfterGenerate(state: typeof GraphState.State) {
  const topScore = Math.max(0, ...state.chunks.map((chunk) => chunk.score));
  return shouldGradeAtScore(topScore) ? "gradeAnswer" : END;
}

async function gradeAnswerNode(state: typeof GraphState.State) {
  const response = await gradeLlm.invoke([
    new SystemMessage(GRADE_SYSTEM_PROMPT),
    new HumanMessage(
      `Context:\n${buildContext(state.chunks)}\n\nAnswer:\n${state.answerText ?? ""}`,
    ),
  ]);
  const text =
    typeof response.content === "string"
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .map((part) => ("text" in part ? part.text : ""))
            .join(" ")
        : "";

  return {
    grounded: text.toLowerCase().includes("yes"),
  };
}

function routeAfterGrade(state: typeof GraphState.State) {
  if (state.grounded === false && !state.regenerated) {
    return "regenerate";
  }

  return END;
}

async function regenerateNode(state: typeof GraphState.State) {
  return {
    answerText: await collectAnswer(
      state.originalQuestion,
      state.chunks,
      REGENERATE_SYSTEM_PROMPT,
    ),
    regenerated: true,
  };
}

async function fallbackNode() {
  return {
    answerText: FALLBACK_MESSAGE,
    sources: [],
    isFallback: true,
  };
}

const graph = new StateGraph(GraphState)
  .addNode("retrieve", retrieveNode)
  .addNode("rewrite", rewriteNode)
  .addNode("prepareStream", prepareStreamNode)
  .addNode("generate", generateNode)
  .addNode("gradeAnswer", gradeAnswerNode)
  .addNode("regenerate", regenerateNode)
  .addNode("fallback", fallbackNode)
  .addEdge(START, "retrieve")
  .addConditionalEdges("retrieve", routeAfterRetrieve)
  .addEdge("rewrite", "retrieve")
  .addEdge("prepareStream", END)
  .addConditionalEdges("generate", routeAfterGenerate)
  .addConditionalEdges("gradeAnswer", routeAfterGrade)
  .addEdge("regenerate", END)
  .addEdge("fallback", END)
  .compile();

export async function answerQuestionWithGraph(
  question: string,
  workspaceId: string,
  limit = 5,
  precomputedEmbedding?: number[],
  filters?: RetrievalFilters,
): Promise<AnswerResult> {
  const result = await graph.invoke({
    originalQuestion: question,
    retrievalQuery: question,
    workspaceId,
    limit,
    rewrites: 0,
    chunks: [],
    sources: [],
    regenerated: false,
    isFallback: false,
    shouldStream: false,
    precomputedEmbedding,
    filters,
  });

  if (result.isFallback) {
    return {
      sources: result.sources ?? [],
      isFallback: true,
      stream: (async function* () {
        yield FALLBACK_MESSAGE;
      })(),
    };
  }

  // Confident path: stream tokens live. Low-confidence graded path: the graph
  // already produced a buffered (possibly regenerated) answer; yield it as one chunk.
  if (result.shouldStream) {
    return {
      sources: result.sources ?? [],
      isFallback: false,
      stream: streamAnswer(
        result.originalQuestion,
        result.chunks,
        ANSWER_SYSTEM_PROMPT,
      ),
    };
  }

  return {
    sources: result.sources ?? [],
    isFallback: false,
    stream: (async function* () {
      yield result.answerText ?? FALLBACK_MESSAGE;
    })(),
  };
}
