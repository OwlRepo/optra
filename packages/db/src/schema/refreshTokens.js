"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshTokens = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const users_1 = require("./users");
exports.refreshTokens = (0, pg_core_1.pgTable)('refresh_tokens', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)('user_id').references(() => users_1.users.id).notNull(),
    tokenHash: (0, pg_core_1.varchar)('token_hash', { length: 64 }).notNull(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at').notNull(),
    revokedAt: (0, pg_core_1.timestamp)('revoked_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
//# sourceMappingURL=refreshTokens.js.map