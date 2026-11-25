import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import argon2 from "argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  credentialsSchema,
  createBoardSchema,
  createCardSchema,
  createColumnSchema,
  createBoardLabelSchema,
  inviteSchema,
  moveCardSchema,
  updateCardSchema,
  updateBoardSchema,
  updateColumnSchema,
  can,
  orderBetween,
  boardEventSchema,
} from "@flowboard/shared";
import { db } from "./db/index.js";
import {
  boards,
  boardLabels,
  cards,
  columns,
  invitations,
  memberships,
  refreshSessions,
  users,
  workspaces,
} from "./db/schema.js";

type Socket = { send: (message: string) => void; close: () => void };
type Viewer = { userId: string; displayName: string; connections: number };
const rooms = new Map<string, Set<Socket>>();
const presence = new Map<string, Map<string, Viewer>>();
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(cookie);
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? "local-only-change-me-long-secret",
    cookie: { cookieName: "access_token", signed: false },
    sign: { expiresIn: "15m" },
  });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(websocket);

  const authenticate = {
    preHandler: async (
      request: { jwtVerify: () => Promise<unknown> },
      reply: { code: (status: number) => { send: (body: unknown) => unknown } },
    ) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.code(401).send({ error: "Authentication required" });
      }
    },
  };
  app.get("/health", async () => ({ status: "ok" }));

  app.post("/auth/register", async (request, reply) => {
    const parsed = credentialsSchema
      .extend({ displayName: z.string().trim().min(1).max(100).optional() })
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid registration details" });
    const { email, password } = parsed.data;
    const displayName =
      parsed.data.displayName ?? email.split("@")[0] ?? "Member";
    const passwordHash = await argon2.hash(password);
    const [user] = await db
      .insert(users)
      .values({ email: email.toLowerCase(), passwordHash, displayName })
      .returning();
    if (!user)
      return reply.code(500).send({ error: "Could not create account" });
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: `${displayName}'s workspace`, ownerId: user.id })
      .returning();
    if (!workspace)
      return reply.code(500).send({ error: "Could not create workspace" });
    const [board] = await db
      .insert(boards)
      .values({ workspaceId: workspace.id, name: "My first board" })
      .returning();
    if (board)
      await db
        .insert(memberships)
        .values({ userId: user.id, boardId: board.id, role: "owner" });
    await issueTokens(app, reply, user.id);
    return reply
      .code(201)
      .send({ id: user.id, email: user.email, displayName: user.displayName });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid credentials" });
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, parsed.data.email.toLowerCase()))
      .limit(1);
    if (
      !user ||
      !(await argon2.verify(user.passwordHash, parsed.data.password))
    )
      return reply.code(401).send({ error: "Email or password is incorrect" });
    await issueTokens(app, reply, user.id);
    return { id: user.id, email: user.email, displayName: user.displayName };
  });

  app.post("/auth/refresh", async (request, reply) => {
    const token = request.cookies.refresh_token;
    if (!token)
      return reply.code(401).send({ error: "Refresh session is missing" });
    try {
      const payload = app.jwt.verify<{
        sub: string;
        jti: string;
        kind: string;
      }>(token, {
        key:
          process.env.REFRESH_TOKEN_SECRET ??
          process.env.JWT_SECRET ??
          "local-only-change-me-long-secret",
      });
      const [session] = await db
        .select()
        .from(refreshSessions)
        .where(
          and(
            eq(refreshSessions.id, payload.jti),
            eq(refreshSessions.tokenHash, sha(token)),
          ),
        )
        .limit(1);
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt < new Date() ||
        payload.kind !== "refresh"
      )
        return reply.code(401).send({ error: "Refresh session is invalid" });
      await db
        .update(refreshSessions)
        .set({ revokedAt: new Date() })
        .where(eq(refreshSessions.id, session.id));
      await issueTokens(app, reply, payload.sub);
      return { refreshed: true };
    } catch {
      return reply.code(401).send({ error: "Refresh session is invalid" });
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies.refresh_token;
    if (token)
      await db
        .update(refreshSessions)
        .set({ revokedAt: new Date() })
        .where(eq(refreshSessions.tokenHash, sha(token)));
    reply
      .clearCookie("access_token", { path: "/" })
      .clearCookie("refresh_token", { path: "/" });
    return { loggedOut: true };
  });

  app.get("/auth/me", authenticate, async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return reply.code(401).send({ error: "Authentication required" });
    return { id: user.id, email: user.email, displayName: user.displayName };
  });

  app.post(
    "/boards/:boardId/live-ticket",
    authenticate,
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      const userId = (request.user as { sub: string }).sub;
      if (!can(await getRole(userId, boardId), "read"))
        return reply.code(403).send({ error: "Board access denied" });
      reply.header("cache-control", "no-store");
      return {
        ticket: app.jwt.sign(
          { sub: userId, boardId, kind: "socket", jti: randomUUID() },
          { expiresIn: "60s" },
        ),
        expiresIn: 60,
      };
    },
  );

  app.get("/boards", authenticate, async (request) => {
    const userId = (request.user as { sub: string }).sub;
    return db
      .select({ id: boards.id, name: boards.name, role: memberships.role })
      .from(boards)
      .innerJoin(memberships, eq(boards.id, memberships.boardId))
      .where(eq(memberships.userId, userId));
  });

  app.post("/boards", authenticate, async (request, reply) => {
    const parsed = createBoardSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid board name" });
    const userId = (request.user as { sub: string }).sub;
    let [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.ownerId, userId))
      .limit(1);
    if (!workspace)
      [workspace] = await db
        .insert(workspaces)
        .values({ name: "Workspace", ownerId: userId })
        .returning();
    if (!workspace)
      return reply.code(500).send({ error: "Workspace unavailable" });
    const [board] = await db
      .insert(boards)
      .values({ workspaceId: workspace.id, name: parsed.data.name })
      .returning();
    if (!board) return reply.code(500).send({ error: "Board unavailable" });
    await db
      .insert(memberships)
      .values({ userId, boardId: board.id, role: "owner" });
    return reply.code(201).send(board);
  });

  app.get("/boards/:boardId", authenticate, async (request, reply) => {
    const { boardId } = request.params as { boardId: string };
    const userId = (request.user as { sub: string }).sub;
    const role = await getRole(userId, boardId);
    if (!can(role, "read"))
      return reply.code(403).send({ error: "Board access denied" });
    const [board] = await db
      .select()
      .from(boards)
      .where(eq(boards.id, boardId))
      .limit(1);
    if (!board) return reply.code(404).send({ error: "Board not found" });
    const boardColumns = await db
      .select()
      .from(columns)
      .where(eq(columns.boardId, boardId))
      .orderBy(columns.order);
    return {
      ...board,
      role,
      columns: await Promise.all(
        boardColumns.map(async (column) => ({
          ...column,
          cards: await db
            .select()
            .from(cards)
            .where(eq(cards.columnId, column.id))
            .orderBy(cards.order),
        })),
      ),
    };
  });

  app.get("/boards/:boardId/members", authenticate, async (request, reply) => {
    const { boardId } = request.params as { boardId: string };
    const userId = (request.user as { sub: string }).sub;
    if (!can(await getRole(userId, boardId), "read"))
      return reply.code(403).send({ error: "Board access denied" });
    return db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.boardId, boardId));
  });

  app.get("/boards/:boardId/labels", authenticate, async (request, reply) => {
    const { boardId } = request.params as { boardId: string };
    const userId = (request.user as { sub: string }).sub;
    if (!can(await getRole(userId, boardId), "read"))
      return reply.code(403).send({ error: "Board access denied" });
    return db
      .select()
      .from(boardLabels)
      .where(eq(boardLabels.boardId, boardId))
      .orderBy(boardLabels.name);
  });

  app.post("/boards/:boardId/labels", authenticate, async (request, reply) => {
    const { boardId } = request.params as { boardId: string };
    const parsed = createBoardLabelSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid label" });
    const userId = (request.user as { sub: string }).sub;
    if (!can(await getRole(userId, boardId), "create"))
      return reply.code(403).send({ error: "Board access denied" });
    const [label] = await db
      .insert(boardLabels)
      .values({ boardId, ...parsed.data })
      .onConflictDoUpdate({
        target: [boardLabels.boardId, boardLabels.name],
        set: { color: parsed.data.color },
      })
      .returning();
    if (!label) return reply.code(500).send({ error: "Could not save label" });
    publish(boardId, { type: "label.created", label });
    return reply.code(201).send(label);
  });

  app.patch("/boards/:boardId", authenticate, async (request, reply) => {
    const { boardId } = request.params as { boardId: string };
    const parsed = updateBoardSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid board update" });
    const userId = (request.user as { sub: string }).sub;
    if (!can(await getRole(userId, boardId), "update"))
      return reply.code(403).send({ error: "Board access denied" });
    const [board] = await db
      .update(boards)
      .set(parsed.data)
      .where(eq(boards.id, boardId))
      .returning();
    if (!board) return reply.code(404).send({ error: "Board not found" });
    publish(boardId, { type: "board.updated", board });
    return board;
  });

  app.delete("/boards/:boardId", authenticate, async (request, reply) => {
    const { boardId } = request.params as { boardId: string };
    const userId = (request.user as { sub: string }).sub;
    if (!can(await getRole(userId, boardId), "delete"))
      return reply.code(403).send({ error: "Board access denied" });
    const [board] = await db
      .delete(boards)
      .where(eq(boards.id, boardId))
      .returning({ id: boards.id });
    if (!board) return reply.code(404).send({ error: "Board not found" });
    publish(boardId, { type: "board.deleted", boardId });
    return reply.code(204).send();
  });

  app.post("/boards/:boardId/columns", authenticate, async (request, reply) => {
    const { boardId } = request.params as { boardId: string };
    const parsed = createColumnSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid column" });
    const userId = (request.user as { sub: string }).sub;
    if (!can(await getRole(userId, boardId), "create"))
      return reply.code(403).send({ error: "Board access denied" });
    const [column] = await db
      .insert(columns)
      .values({
        boardId,
        name: parsed.data.name,
        order: parsed.data.order ?? 1024,
      })
      .returning();
    publish(boardId, { type: "column.created", column });
    return reply.code(201).send(column);
  });

  app.patch(
    "/boards/:boardId/columns/:columnId",
    authenticate,
    async (request, reply) => {
      const { boardId, columnId } = request.params as {
        boardId: string;
        columnId: string;
      };
      const userId = (request.user as { sub: string }).sub;
      if (!can(await getRole(userId, boardId), "update"))
        return reply.code(403).send({ error: "Board access denied" });
      const [existing] = await db
        .select({ id: columns.id })
        .from(columns)
        .where(and(eq(columns.id, columnId), eq(columns.boardId, boardId)))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: "Column not found" });
      const parsed = updateColumnSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid column update" });
      const [updated] = await db
        .update(columns)
        .set(parsed.data)
        .where(and(eq(columns.id, columnId), eq(columns.boardId, boardId)))
        .returning();
      if (!updated) return reply.code(404).send({ error: "Column not found" });
      publish(boardId, { type: "column.updated", column: updated });
      return updated;
    },
  );

  app.delete(
    "/boards/:boardId/columns/:columnId",
    authenticate,
    async (request, reply) => {
      const { boardId, columnId } = request.params as {
        boardId: string;
        columnId: string;
      };
      const userId = (request.user as { sub: string }).sub;
      if (!can(await getRole(userId, boardId), "delete"))
        return reply.code(403).send({ error: "Board access denied" });
      const [removed] = await db
        .delete(columns)
        .where(and(eq(columns.id, columnId), eq(columns.boardId, boardId)))
        .returning({ id: columns.id });
      if (!removed) return reply.code(404).send({ error: "Column not found" });
      publish(boardId, { type: "column.deleted", columnId });
      return reply.code(204).send();
    },
  );

  app.post("/boards/:boardId/cards", authenticate, async (request, reply) => {
    const { boardId } = request.params as { boardId: string };
    const parsed = createCardSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid card" });
    const userId = (request.user as { sub: string }).sub;
    if (!can(await getRole(userId, boardId), "create"))
      return reply.code(403).send({ error: "Board access denied" });
    const [column] = await db
      .select()
      .from(columns)
      .where(
        and(eq(columns.id, parsed.data.columnId), eq(columns.boardId, boardId)),
      )
      .limit(1);
    if (!column) return reply.code(404).send({ error: "Column not found" });
    if (
      parsed.data.assigneeId &&
      !(
        await db
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.boardId, boardId),
              eq(memberships.userId, parsed.data.assigneeId),
            ),
          )
          .limit(1)
      )[0]
    )
      return reply.code(404).send({ error: "Assignee not found" });
    if (parsed.data.labels.length) {
      const found = await db
        .select({ name: boardLabels.name })
        .from(boardLabels)
        .where(
          and(
            eq(boardLabels.boardId, boardId),
            inArray(boardLabels.name, parsed.data.labels),
          ),
        );
      if (found.length !== new Set(parsed.data.labels).size)
        return reply
          .code(400)
          .send({ error: "Card contains an unknown label" });
    }
    const [card] = await db
      .insert(cards)
      .values({
        ...parsed.data,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        order: parsed.data.order ?? orderBetween(),
      })
      .returning();
    if (!card) return reply.code(500).send({ error: "Could not create card" });
    publish(boardId, { type: "card.created", card });
    return reply.code(201).send(card);
  });

  app.patch(
    "/boards/:boardId/cards/:cardId",
    authenticate,
    async (request, reply) => {
      const { boardId, cardId } = request.params as {
        boardId: string;
        cardId: string;
      };
      const userId = (request.user as { sub: string }).sub;
      if (!can(await getRole(userId, boardId), "update"))
        return reply.code(403).send({ error: "Board access denied" });
      const [existing] = await db
        .select({ id: cards.id })
        .from(cards)
        .innerJoin(columns, eq(cards.columnId, columns.id))
        .where(and(eq(cards.id, cardId), eq(columns.boardId, boardId)))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: "Card not found" });
      const parsed = updateCardSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid card update" });
      if (
        parsed.data.assigneeId &&
        !(
          await db
            .select({ userId: memberships.userId })
            .from(memberships)
            .where(
              and(
                eq(memberships.boardId, boardId),
                eq(memberships.userId, parsed.data.assigneeId),
              ),
            )
            .limit(1)
        )[0]
      )
        return reply.code(404).send({ error: "Assignee not found" });
      if (parsed.data.labels?.length) {
        const found = await db
          .select({ name: boardLabels.name })
          .from(boardLabels)
          .where(
            and(
              eq(boardLabels.boardId, boardId),
              inArray(boardLabels.name, parsed.data.labels),
            ),
          );
        if (found.length !== new Set(parsed.data.labels).size)
          return reply
            .code(400)
            .send({ error: "Card contains an unknown label" });
      }
      const { dueDate, ...patch } = parsed.data;
      const values = {
        ...patch,
        ...(dueDate !== undefined
          ? { dueDate: dueDate ? new Date(dueDate) : null }
          : {}),
        updatedAt: new Date(),
      };
      const [updated] = await db
        .update(cards)
        .set(values)
        .where(
          and(
            eq(cards.id, cardId),
            inArray(
              cards.columnId,
              db
                .select({ id: columns.id })
                .from(columns)
                .where(eq(columns.boardId, boardId)),
            ),
          ),
        )
        .returning();
      if (!updated) return reply.code(404).send({ error: "Card not found" });
      publish(boardId, { type: "card.updated", cardId, patch: parsed.data });
      return updated;
    },
  );

  app.delete(
    "/boards/:boardId/cards/:cardId",
    authenticate,
    async (request, reply) => {
      const { boardId, cardId } = request.params as {
        boardId: string;
        cardId: string;
      };
      const userId = (request.user as { sub: string }).sub;
      if (!can(await getRole(userId, boardId), "delete"))
        return reply.code(403).send({ error: "Board access denied" });
      const [existing] = await db
        .select({ id: cards.id })
        .from(cards)
        .innerJoin(columns, eq(cards.columnId, columns.id))
        .where(and(eq(cards.id, cardId), eq(columns.boardId, boardId)))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: "Card not found" });
      const [removed] = await db
        .delete(cards)
        .where(
          and(
            eq(cards.id, cardId),
            inArray(
              cards.columnId,
              db
                .select({ id: columns.id })
                .from(columns)
                .where(eq(columns.boardId, boardId)),
            ),
          ),
        )
        .returning({ id: cards.id });
      if (!removed) return reply.code(404).send({ error: "Card not found" });
      publish(boardId, { type: "card.deleted", cardId });
      return reply.code(204).send();
    },
  );

  app.patch(
    "/boards/:boardId/cards/:cardId/move",
    authenticate,
    async (request, reply) => {
      const { boardId, cardId } = request.params as {
        boardId: string;
        cardId: string;
      };
      const userId = (request.user as { sub: string }).sub;
      if (!can(await getRole(userId, boardId), "update"))
        return reply.code(403).send({ error: "Board access denied" });
      const [card] = await db
        .select({ id: cards.id })
        .from(cards)
        .innerJoin(columns, eq(cards.columnId, columns.id))
        .where(and(eq(cards.id, cardId), eq(columns.boardId, boardId)))
        .limit(1);
      if (!card) return reply.code(404).send({ error: "Card not found" });
      const parsed = moveCardSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid position" });
      const [destination] = await db
        .select()
        .from(columns)
        .where(
          and(
            eq(columns.id, parsed.data.columnId),
            eq(columns.boardId, boardId),
          ),
        )
        .limit(1);
      if (!destination)
        return reply.code(404).send({ error: "Column not found" });
      const [updated] = await db
        .update(cards)
        .set({
          columnId: destination.id,
          order: parsed.data.order,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(cards.id, cardId),
            inArray(
              cards.columnId,
              db
                .select({ id: columns.id })
                .from(columns)
                .where(eq(columns.boardId, boardId)),
            ),
          ),
        )
        .returning();
      if (!updated) return reply.code(404).send({ error: "Card not found" });
      publish(boardId, {
        type: "card.moved",
        cardId,
        columnId: destination.id,
        order: parsed.data.order,
      });
      return updated;
    },
  );

  app.post("/boards/:boardId/invites", authenticate, async (request, reply) => {
    const { boardId } = request.params as { boardId: string };
    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid invitation" });
    const userId = (request.user as { sub: string }).sub;
    if (!can(await getRole(userId, boardId), "invite"))
      return reply.code(403).send({ error: "Only board owners can invite" });
    const token = randomBytes(32).toString("base64url");
    await db.insert(invitations).values({
      boardId,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      tokenHash: sha(token),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    return reply.code(201).send({
      inviteUrl: `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/invite/${token}`,
    });
  });

  app.post("/invites/:token/accept", authenticate, async (request, reply) => {
    const { token } = request.params as { token: string };
    if (token.length > 128)
      return reply.code(400).send({ error: "Invalid invitation" });
    const userId = (request.user as { sub: string }).sub;
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const [invite] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, sha(token)))
      .limit(1);
    if (
      !user ||
      !invite ||
      invite.expiresAt < new Date() ||
      user.email !== invite.email
    )
      return reply
        .code(404)
        .send({ error: "Invitation is invalid or expired" });
    await db
      .insert(memberships)
      .values({ userId, boardId: invite.boardId, role: invite.role })
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.boardId],
        set: { role: invite.role },
      });
    await db.delete(invitations).where(eq(invitations.id, invite.id));
    return { boardId: invite.boardId, role: invite.role };
  });

  const consumedSocketTickets = new Map<string, number>();
  app.get("/boards/:boardId/live", { websocket: true }, (socket, request) => {
    const { boardId } = request.params as { boardId: string };
    const origin = request.headers.origin;
    if (
      origin &&
      origin !== (process.env.WEB_ORIGIN ?? "http://localhost:3000")
    )
      return socket.close();
    const { ticket } = request.query as { ticket?: string };
    if (!ticket || ticket.length > 4096) return socket.close();
    let claims: { sub: string; boardId: string; kind: string; jti: string };
    try {
      claims = app.jwt.verify<{
        sub: string;
        boardId: string;
        kind: string;
        jti: string;
      }>(ticket);
    } catch {
      return socket.close();
    }
    if (
      claims.kind !== "socket" ||
      claims.boardId !== boardId ||
      !claims.jti ||
      consumedSocketTickets.has(claims.jti)
    )
      return socket.close();
    const now = Date.now();
    for (const [jti, expiresAt] of consumedSocketTickets)
      if (expiresAt <= now) consumedSocketTickets.delete(jti);
    consumedSocketTickets.set(claims.jti, now + 60_000);
    const userId = claims.sub;
    void Promise.all([
      getRole(userId, boardId),
      db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    ])
      .then(([role, [user]]) => {
        if (!can(role, "read")) return socket.close();
        if (!user) return socket.close();
        const room = rooms.get(boardId) ?? new Set<Socket>();
        room.add(socket as Socket);
        rooms.set(boardId, room);
        const boardPresence =
          presence.get(boardId) ?? new Map<string, Viewer>();
        const current = boardPresence.get(userId) ?? {
          userId,
          displayName: user.displayName,
          connections: 0,
        };
        current.connections += 1;
        boardPresence.set(userId, current);
        presence.set(boardId, boardPresence);
        publishPresence(boardId);
        socket.on("close", () => {
          room.delete(socket as Socket);
          if (!room.size) rooms.delete(boardId);
          current.connections -= 1;
          if (current.connections <= 0) boardPresence.delete(userId);
          if (!boardPresence.size) presence.delete(boardId);
          publishPresence(boardId);
        });
      })
      .catch(() => socket.close());
  });

  return app;
}

async function getRole(userId: string, boardId: string) {
  const [member] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.boardId, boardId)),
    )
    .limit(1);
  return member?.role === "owner" ||
    member?.role === "editor" ||
    member?.role === "viewer"
    ? member.role
    : null;
}

function publish(boardId: string, message: unknown, except?: Socket) {
  const event = boardEventSchema.parse(message);
  for (const client of rooms.get(boardId) ?? [])
    if (client !== except) client.send(JSON.stringify(event));
}

function publishPresence(boardId: string) {
  const viewers = Array.from(presence.get(boardId)?.values() ?? []).map(
    ({ userId, displayName }) => ({ userId, displayName }),
  );
  publish(boardId, { type: "presence.snapshot", users: viewers });
}

async function issueTokens(
  app: FastifyInstance,
  reply: {
    setCookie: (
      name: string,
      value: string,
      options: Record<string, unknown>,
    ) => unknown;
  },
  userId: string,
) {
  const access = app.jwt.sign({ sub: userId });
  const refreshSecret =
    process.env.REFRESH_TOKEN_SECRET ??
    process.env.JWT_SECRET ??
    "local-only-change-me-long-secret";
  const sessionId = randomUUID();
  const refresh = app.jwt.sign(
    { sub: userId, jti: sessionId, kind: "refresh" },
    { key: refreshSecret, expiresIn: "30d" },
  );
  await db.insert(refreshSessions).values({
    id: sessionId,
    userId,
    tokenHash: sha(refresh),
    expiresAt: new Date(Date.now() + 30 * 86400000),
  });
  const secure = process.env.NODE_ENV === "production";
  reply.setCookie("access_token", access, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 900,
  });
  reply.setCookie("refresh_token", refresh, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 2592000,
  });
}
