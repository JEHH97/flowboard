import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { db, pool } from "./db/index.js";
import {
  boardLabels,
  boards,
  cards,
  columns,
  memberships,
  users,
  workspaces,
} from "./db/schema.js";

const email = "demo@flowboard.dev";
let [user] = await db
  .select()
  .from(users)
  .where(eq(users.email, email))
  .limit(1);
if (!user)
  [user] = await db
    .insert(users)
    .values({
      email,
      displayName: "Flowboard Demo",
      passwordHash: await argon2.hash(
        process.env.DEMO_PASSWORD ?? "flowboard-demo-password",
      ),
    })
    .returning();
if (user) {
  let [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.ownerId, user.id))
    .limit(1);
  if (!workspace)
    [workspace] = await db
      .insert(workspaces)
      .values({ name: "Product Studio", ownerId: user.id })
      .returning();
  if (workspace) {
    let [board] = await db
      .select()
      .from(boards)
      .where(eq(boards.workspaceId, workspace.id))
      .limit(1);
    if (!board)
      [board] = await db
        .insert(boards)
        .values({ workspaceId: workspace.id, name: "Product Launch" })
        .returning();
    if (board) {
      await db
        .insert(memberships)
        .values({ userId: user.id, boardId: board.id, role: "owner" })
        .onConflictDoNothing();
      await db
        .insert(boardLabels)
        .values([
          { boardId: board.id, name: "Research", color: "#d8e9c9" },
          { boardId: board.id, name: "Planning", color: "#dce7f5" },
        ])
        .onConflictDoNothing();
      const existing = await db
        .select()
        .from(columns)
        .where(eq(columns.boardId, board.id));
      if (!existing.length) {
        const createdColumns = await db
          .insert(columns)
          .values([
            { boardId: board.id, name: "Ideas", order: 1024 },
            { boardId: board.id, name: "In progress", order: 2048 },
            { boardId: board.id, name: "Done", order: 3072 },
          ])
          .returning();
        const firstColumn = createdColumns[0];
        if (firstColumn)
          await db.insert(cards).values([
            {
              columnId: firstColumn.id,
              title: "Map the first customer journey",
              order: 1024,
              labels: ["Research"],
            },
            {
              columnId: firstColumn.id,
              title: "Agree on the launch checklist",
              order: 2048,
              labels: ["Planning"],
            },
          ]);
      }
    }
  }
}
await pool.end();
console.log(`Demo workspace ready for ${email}.`);
