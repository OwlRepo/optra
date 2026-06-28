"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invitations = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const workspaces_1 = require("./workspaces");
exports.invitations = (0, pg_core_1.pgTable)('invitations', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    workspaceId: (0, pg_core_1.uuid)('workspace_id').references(() => workspaces_1.workspaces.id).notNull(),
    email: (0, pg_core_1.varchar)('email', { length: 255 }).notNull(),
    token: (0, pg_core_1.text)('token').notNull().unique(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at').notNull(),
    acceptedAt: (0, pg_core_1.timestamp)('accepted_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
//# sourceMappingURL=invitations.js.map