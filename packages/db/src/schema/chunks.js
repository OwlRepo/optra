"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chunks = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const documents_1 = require("./documents");
const workspaces_1 = require("./workspaces");
const vector = (0, pg_core_1.customType)({
    dataType() {
        return 'vector(1536)';
    },
    toDriver(value) {
        return JSON.stringify(value);
    },
});
exports.chunks = (0, pg_core_1.pgTable)('chunks', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    documentId: (0, pg_core_1.uuid)('document_id').references(() => documents_1.documents.id).notNull(),
    workspaceId: (0, pg_core_1.uuid)('workspace_id').references(() => workspaces_1.workspaces.id).notNull(),
    content: (0, pg_core_1.text)('content').notNull(),
    contentHash: (0, pg_core_1.varchar)('content_hash', { length: 64 }).notNull(),
    embedding: vector('embedding'),
    metadata: (0, pg_core_1.jsonb)('metadata').$type(),
    sectionId: (0, pg_core_1.varchar)('section_id', { length: 255 }),
    sectionTitle: (0, pg_core_1.text)('section_title'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
//# sourceMappingURL=chunks.js.map