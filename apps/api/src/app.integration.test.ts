import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

const databaseReady = Boolean(process.env.DATABASE_URL);
const suite = databaseReady ? describe : describe.skip;

suite("API integration with PostgreSQL", () => {
  let app: FastifyInstance;
  let cookie = "";

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("registers, creates a board, and enforces board roles", async () => {
    const identity = `member-${crypto.randomUUID()}@flowboard.dev`;
    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: identity,
        password: "safe-test-password",
        displayName: "Test Member",
      },
    });
    expect(registration.statusCode).toBe(201);
    const rawCookies = registration.headers["set-cookie"];
    cookie = (
      Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : []
    )
      .map((value) => value.split(";")[0])
      .join("; ");

    const created = await app.inject({
      method: "POST",
      url: "/boards",
      headers: { cookie },
      payload: { name: "Integration board" },
    });
    expect(created.statusCode).toBe(201);
    const board = created.json() as { id: string };
    const read = await app.inject({
      method: "GET",
      url: `/boards/${board.id}`,
      headers: { cookie },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      name: "Integration board",
      role: "owner",
    });
    const owner = registration.json() as { id: string };
    const members = await app.inject({
      method: "GET",
      url: `/boards/${board.id}/members`,
      headers: { cookie },
    });
    expect(members.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: owner.id, role: "owner" }),
      ]),
    );
    const label = await app.inject({
      method: "POST",
      url: `/boards/${board.id}/labels`,
      headers: { cookie },
      payload: { name: "Quality", color: "#427a60" },
    });
    expect(label.statusCode).toBe(201);
    const column = await app.inject({
      method: "POST",
      url: `/boards/${board.id}/columns`,
      headers: { cookie },
      payload: { name: "Review" },
    });
    const columnId = (column.json() as { id: string }).id;
    const createdCard = await app.inject({
      method: "POST",
      url: `/boards/${board.id}/cards`,
      headers: { cookie },
      payload: {
        title: "A card with details",
        description: "Details survive round trips",
        columnId,
        assigneeId: owner.id,
        labels: ["Quality"],
        dueDate: "2026-05-01T23:59:59.999Z",
      },
    });
    expect(createdCard.statusCode).toBe(201);
    const card = createdCard.json() as { id: string };
    const updatedCard = await app.inject({
      method: "PATCH",
      url: `/boards/${board.id}/cards/${card.id}`,
      headers: { cookie },
      payload: {
        description: "Updated details",
        assigneeId: null,
        dueDate: null,
      },
    });
    expect(updatedCard.json()).toMatchObject({
      description: "Updated details",
      assigneeId: null,
      dueDate: null,
      labels: ["Quality"],
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/boards",
      headers: { cookie },
      payload: { name: "" },
    });
    expect(invalid.statusCode).toBe(400);

    const oldRefresh = cookie
      .split("; ")
      .find((value) => value.startsWith("refresh_token="));
    expect(oldRefresh).toBeDefined();
    const rotated = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { cookie: oldRefresh },
    });
    expect(rotated.statusCode).toBe(200);
    const newCookies = rotated.headers["set-cookie"];
    const newRefresh = (Array.isArray(newCookies) ? newCookies : [newCookies])
      .filter((value): value is string => Boolean(value))
      .map((value) => value.split(";")[0])
      .find((value) => value.startsWith("refresh_token="));
    expect(newRefresh).toBeDefined();
    expect(newRefresh).not.toBe(oldRefresh);
    const reused = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { cookie: oldRefresh },
    });
    expect(reused.statusCode).toBe(401);

    const guestEmail = `guest-${crypto.randomUUID()}@flowboard.dev`;
    const invitation = await app.inject({
      method: "POST",
      url: `/boards/${board.id}/invites`,
      headers: { cookie },
      payload: { email: guestEmail, role: "viewer" },
    });
    expect(invitation.statusCode).toBe(201);
    const inviteUrl = (invitation.json() as { inviteUrl: string }).inviteUrl;
    const inviteToken = inviteUrl.split("/").at(-1);
    expect(inviteToken).toBeTruthy();
    const guestRegistration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: guestEmail, password: "guest-test-password" },
    });
    const guestCookie = (
      Array.isArray(guestRegistration.headers["set-cookie"])
        ? guestRegistration.headers["set-cookie"]
        : [guestRegistration.headers["set-cookie"]]
    )
      .filter((value): value is string => Boolean(value))
      .map((value) => value.split(";")[0])
      .join("; ");
    const accepted = await app.inject({
      method: "POST",
      url: `/invites/${inviteToken}/accept`,
      headers: { cookie: guestCookie },
    });
    expect(accepted.statusCode).toBe(200);
    const guestRead = await app.inject({
      method: "GET",
      url: `/boards/${board.id}`,
      headers: { cookie: guestCookie },
    });
    expect(guestRead.json()).toMatchObject({ role: "viewer" });
    const viewerEdit = await app.inject({
      method: "PATCH",
      url: `/boards/${board.id}/cards/${card.id}`,
      headers: { cookie: guestCookie },
      payload: { title: "Unauthorized edit" },
    });
    expect(viewerEdit.statusCode).toBe(403);
    const denied = await app.inject({
      method: "POST",
      url: `/boards/${board.id}/columns`,
      headers: { cookie: guestCookie },
      payload: { name: "Should not be created" },
    });
    expect(denied.statusCode).toBe(403);
  }, 30000);
});
