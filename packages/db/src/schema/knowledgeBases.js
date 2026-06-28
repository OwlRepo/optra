"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.knowledgeBases = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const workspaces_1 = require("./workspaces");
exports.knowledgeBases = (0, pg_core_1.pgTable)('knowledge_bases', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    workspaceId: (0, pg_core_1.uuid)('workspace_id').references(() => workspaces_1.workspaces.id).notNull(),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
//# sourceMappingURL=knowledgeBases.js.map