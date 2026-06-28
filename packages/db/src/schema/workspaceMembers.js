"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceMembers = exports.workspaceMemberRoleEnum = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const workspaces_1 = require("./workspaces");
const users_1 = require("./users");
exports.workspaceMemberRoleEnum = (0, pg_core_1.pgEnum)('workspace_member_role', [
    'owner',
    'admin',
    'member',
]);
exports.workspaceMembers = (0, pg_core_1.pgTable)('workspace_members', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    workspaceId: (0, pg_core_1.uuid)('workspace_id').references(() => workspaces_1.workspaces.id).notNull(),
    userId: (0, pg_core_1.uuid)('user_id').references(() => users_1.users.id).notNull(),
    role: (0, exports.workspaceMemberRoleEnum)('role').notNull().default('member'),
    joinedAt: (0, pg_core_1.timestamp)('joined_at').defaultNow().notNull(),
});
//# sourceMappingURL=workspaceMembers.js.map