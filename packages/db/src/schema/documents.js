"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documents = exports.documentStatusEnum = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const workspaces_1 = require("./workspaces");
const knowledgeBases_1 = require("./knowledgeBases");
exports.documentStatusEnum = (0, pg_core_1.pgEnum)('document_status', [
    'pending',
    'processing',
    'done',
    'failed',
]);
exports.documents = (0, pg_core_1.pgTable)('documents', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    workspaceId: (0, pg_core_1.uuid)('workspace_id').references(() => workspaces_1.workspaces.id).notNull(),
    knowledgeBaseId: (0, pg_core_1.uuid)('knowledge_base_id').references(() => knowledgeBases_1.knowledgeBases.id).notNull(),
    title: (0, pg_core_1.varchar)('title', { length: 500 }).notNull(),
    sourceUrl: (0, pg_core_1.text)('source_url'),
    contentHash: (0, pg_core_1.varchar)('content_hash', { length: 64 }),
    status: (0, exports.documentStatusEnum)('status').notNull().default('pending'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
});
//# sourceMappingURL=documents.js.map