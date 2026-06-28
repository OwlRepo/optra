export declare const workspaceMemberRoleEnum: import("drizzle-orm/pg-core").PgEnum<["owner", "admin", "member"]>;
export declare const workspaceMembers: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "workspace_members";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "workspace_members";
            dataType: "string";
            columnType: "PgUUID";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, {}, {}>;
        workspaceId: import("drizzle-orm/pg-core").PgColumn<{
            name: "workspace_id";
            tableName: "workspace_members";
            dataType: "string";
            columnType: "PgUUID";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: undefined;
            baseColumn: never;
        }, {}, {}>;
        userId: import("drizzle-orm/pg-core").PgColumn<{
            name: "user_id";
            tableName: "workspace_members";
            dataType: "string";
            columnType: "PgUUID";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: undefined;
            baseColumn: never;
        }, {}, {}>;
        role: import("drizzle-orm/pg-core").PgColumn<{
            name: "role";
            tableName: "workspace_members";
            dataType: "string";
            columnType: "PgEnumColumn";
            data: "owner" | "admin" | "member";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: ["owner", "admin", "member"];
            baseColumn: never;
        }, {}, {}>;
        joinedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "joined_at";
            tableName: "workspace_members";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, {}, {}>;
    };
    dialect: "pg";
}>;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;
