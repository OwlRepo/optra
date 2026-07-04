import { Injectable } from '@nestjs/common'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, documents } from '@repo/db'

type DocumentSearchResult = {
  documentId: string
  knowledgeBaseId: string
  title: string
  sourceUrl: string | null
  snippet: string
  score: number
}

type TicketSearchResult = {
  ticketId: string
  title: string
  snippet: string
  score: number
}

type ChatMessageSearchResult = {
  messageId: string
  sessionId: string
  snippet: string
  score: number
}

@Injectable()
export class SearchService {
  async search(workspaceId: string, query: string, limit = 5) {
    const trimmed = query.trim()

    if (!trimmed) {
      return { documents: [], tickets: [], chatMessages: [] }
    }

    const [documentResults, ticketResults, chatMessageResults] = await Promise.all([
      this.searchDocuments(workspaceId, trimmed, limit),
      this.searchTickets(workspaceId, trimmed, limit),
      this.searchChatMessages(workspaceId, trimmed, limit),
    ])

    return {
      documents: documentResults,
      tickets: ticketResults,
      chatMessages: chatMessageResults,
    }
  }

  private async searchDocuments(workspaceId: string, query: string, limit: number): Promise<DocumentSearchResult[]> {
    const { similaritySearch } = await import('@repo/ai')
    const chunks = await similaritySearch(query, workspaceId, limit)

    const bestChunkByDocumentId = new Map<string, { snippet: string; score: number }>()

    for (const chunk of chunks) {
      const documentId = typeof chunk.metadata?.documentId === 'string' ? chunk.metadata.documentId : null
      if (!documentId) continue

      const current = bestChunkByDocumentId.get(documentId)
      if (!current || chunk.score > current.score) {
        bestChunkByDocumentId.set(documentId, {
          snippet: chunk.content,
          score: chunk.score,
        })
      }
    }

    const documentIds = [...bestChunkByDocumentId.keys()]
    if (documentIds.length === 0) {
      return []
    }

    const rows = await db
      .select({
        id: documents.id,
        knowledgeBaseId: documents.knowledgeBaseId,
        title: documents.title,
        sourceUrl: documents.sourceUrl,
      })
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceId), inArray(documents.id, documentIds)))

    const documentMap = new Map(rows.map((row) => [row.id, row]))

    return documentIds.flatMap((documentId) => {
      const row = documentMap.get(documentId)
      const chunk = bestChunkByDocumentId.get(documentId)

      if (!row || !chunk) {
        return []
      }

      return [{
        documentId,
        knowledgeBaseId: row.knowledgeBaseId,
        title: row.title,
        sourceUrl: row.sourceUrl,
        snippet: chunk.snippet,
        score: chunk.score,
      }]
    })
  }

  private async searchTickets(workspaceId: string, query: string, limit: number): Promise<TicketSearchResult[]> {
    const rows = await db.execute<TicketSearchResult>(sql`
      SELECT
        id AS "ticketId",
        coalesce(title, 'Ticket draft') AS title,
        left(coalesce(issue_summary, title, ''), 240) AS snippet,
        ts_rank(search_vector, plainto_tsquery('english', ${query})) AS score
      FROM tickets
      WHERE workspace_id = ${workspaceId}::uuid
        AND search_vector @@ plainto_tsquery('english', ${query})
      ORDER BY
        ts_rank(search_vector, plainto_tsquery('english', ${query})) DESC,
        created_at DESC,
        id DESC
      LIMIT ${limit}
    `)

    return rows.rows
  }

  private async searchChatMessages(workspaceId: string, query: string, limit: number): Promise<ChatMessageSearchResult[]> {
    const rows = await db.execute<ChatMessageSearchResult>(sql`
      SELECT
        chat_messages.id AS "messageId",
        chat_messages.session_id AS "sessionId",
        left(chat_messages.content, 240) AS snippet,
        ts_rank(chat_messages.search_vector, plainto_tsquery('english', ${query})) AS score
      FROM chat_messages
      INNER JOIN chat_sessions ON chat_sessions.id = chat_messages.session_id
      WHERE chat_sessions.workspace_id = ${workspaceId}::uuid
        AND chat_messages.search_vector @@ plainto_tsquery('english', ${query})
      ORDER BY
        ts_rank(chat_messages.search_vector, plainto_tsquery('english', ${query})) DESC,
        chat_messages.created_at DESC,
        chat_messages.id DESC
      LIMIT ${limit}
    `)

    return rows.rows
  }
}
