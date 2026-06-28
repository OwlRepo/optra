"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaces = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const users_1 = require("./users");
exports.workspaces = (0, pg_core_1.pgTable)('workspaces', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    ownerId: (0, pg_core_1.uuid)('owner_id').references(() => users_1.users.id).notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
//# sourceMappingURL=workspaces.js.map