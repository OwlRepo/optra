"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.otps = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const users_1 = require("./users");
exports.otps = (0, pg_core_1.pgTable)('otps', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)('user_id').references(() => users_1.users.id).notNull(),
    code: (0, pg_core_1.varchar)('code', { length: 6 }).notNull(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at').notNull(),
    usedAt: (0, pg_core_1.timestamp)('used_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
//# sourceMappingURL=otps.js.map