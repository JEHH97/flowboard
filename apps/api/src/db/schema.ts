import {
  pgTable,
  text,
  timestamp,
  uuid,
  doublePrecision,
  primaryKey,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .references(() => users.id)
    .notNull(),
});
export const boards = pgTable("boards", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.boardId] })],
);
export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id")
    .references(() => boards.id, { onDelete: "cascade" })
    .notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
});
export const boardLabels = pgTable(
  "board_labels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
  },
  (table) => [
    uniqueIndex("board_labels_board_name_unique").on(table.boardId, table.name),
  ],
);
export const columns = pgTable("columns", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id")
    .references(() => boards.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  order: doublePrecision("order").notNull(),
});
export const cards = pgTable("cards", {
  id: uuid("id").defaultRandom().primaryKey(),
  columnId: uuid("column_id")
    .references(() => columns.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  description: text("description"),
  order: doublePrecision("order").notNull(),
  assigneeId: uuid("assignee_id").references(() => users.id),
  dueDate: timestamp("due_date"),
  labels: jsonb("labels").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const refreshSessions = pgTable("refresh_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
});
