export declare const documentStatusEnum: import("drizzle-orm/pg-core").PgEnum<["pending", "processing", "done", "failed"]>;
export declare const documents: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "documents";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "documents";
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
            tableName: "documents";
            dataType: "string";
            columnType: "PgUUID";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: undefined;
            baseColumn: never;
        }, {}, {}>;
        knowledgeBaseId: import("drizzle-orm/pg-core").PgColumn<{
            name: "knowledge_base_id";
            tableName: "documents";
            dataType: "string";
            columnType: "PgUUID";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: undefined;
            baseColumn: never;
        }, {}, {}>;
        title: import("drizzle-orm/pg-core").PgColumn<{
            name: "title";
            tableName: "documents";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, {}, {}>;
        sourceUrl: import("drizzle-orm/pg-core").PgColumn<{
            name: "source_url";
            tableName: "documents";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, {}, {}>;
        contentHash: import("drizzle-orm/pg-core").PgColumn<{
            name: "content_hash";
            tableName: "documents";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, {}, {}>;
        status: import("drizzle-orm/pg-core").PgColumn<{
            name: "status";
            tableName: "documents";
            dataType: "string";
            columnType: "PgEnumColumn";
            data: "pending" | "processing" | "done" | "failed";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: ["pending", "processing", "done", "failed"];
            baseColumn: never;
        }, {}, {}>;
        createdAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_at";
            tableName: "documents";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, {}, {}>;
        updatedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "updated_at";
            tableName: "documents";
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
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
