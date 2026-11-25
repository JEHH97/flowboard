# Flowboard Flows (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flowboard's login, logout, create, and delete flows real — removing the hardcoded auto-login and `window.prompt()`-based creation, and exposing the delete/session-refresh capability the API already has but the web app never uses.

**Architecture:** One small backend addition (`GET /auth/me`) so the browser can learn who's signed in without reading the `HttpOnly` auth cookies. A new frontend API-client module centralizes request handling, including a one-shot refresh-and-retry on token expiry. `board-app.tsx` is rewired to use real session bootstrap, a logout control, inline create forms (no native dialogs), and delete controls for boards/columns/cards, all gated by the existing `viewer`-role permission pattern.

**Tech Stack:** Next.js (App Router) + React 19, Fastify + Drizzle + PostgreSQL, Vitest (API integration tests via `app.inject`, and a pure-logic web unit test following the existing `apps/web/src/lib/runtime-config.test.ts` pattern), Playwright for browser flows. The project has no React component test harness (no jsdom/@testing-library) — component-level changes are verified via `typecheck`/`lint`/`build` plus Playwright e2e against the real stack, matching how this repo already verifies UI (see `apps/web/e2e/board.spec.ts`). Do not introduce a new component-testing framework for this plan.

**Spec:** `docs/superpowers/specs/2026-11-24-flowboard-flows-design.md`

## Global Constraints

- Frontend-only changes except the one explicit backend addition this spec calls for: `GET /auth/me` (HttpOnly cookies make any frontend-only alternative impossible).
- No native browser dialogs (`window.prompt`, `window.confirm`) anywhere in the changed flows — that is the exact pattern this plan removes.
- Delete controls follow the existing `board.role === "viewer"` disable/hide pattern already used for "add" actions; viewers never see a delete control.
- A board cannot be deleted while it is the user's only board (this phase does not build a "no boards" empty state; the spec's non-goals keep the app shell as-is otherwise).
- `vitest.config.ts` coverage thresholds (`lines/functions/branches/statements: 70`) only gate `packages/shared/src/domain/**`. New tests in `apps/api` and `apps/web/src/lib` must pass but do not need to satisfy a coverage percentage.
- Demo credentials for e2e tests: email `demo@flowboard.dev`, password `process.env.DEMO_PASSWORD ?? "flowboard-demo-password"` (seeded by `apps/api/src/seed.ts`), seeded board name `"Product Launch"`.

## Review Focus

- Wrong credentials on login must still show a clear inline error — not a silent failure or a session-expired reset.
- Reloading the page mid-session must land directly on the board (no login-screen flash, no re-entering credentials) once a valid session exists.
- An access token expiring mid-session (15-minute lifetime) must recover transparently via one refresh-and-retry, not surface as a generic "Request failed" notice or bounce the user out immediately.
- Deleting a column that still has cards must remove the cards along with it in the UI (the DB cascades `cards.columnId → columns.id` and `columns.boardId → boards.id` on delete, so this should "just work," but nothing currently exercises it end to end).
- Deleting the board currently being viewed must land the user on one of their remaining boards, not a blank or broken state; deleting your only board must be prevented before the request is ever made.

---

### Task 1: `GET /auth/me` endpoint

**Files:**

- Modify: `apps/api/src/app.ts` (add the route near the other `/auth/*` routes, after `/auth/logout`)
- Test: `apps/api/src/app.integration.test.ts`

**Interfaces:**

- Produces: `GET /auth/me` — authenticated route; `200` returns `{ id: string, email: string, displayName: string }` for the signed-in user; `401 { error: string }` when unauthenticated (via the existing `authenticate` preHandler, same as `GET /boards`).

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe("API integration with PostgreSQL", ...)` block (it already registers a user and keeps its session `cookie` — reuse that same `cookie` variable from the first `it`, or register a fresh user if test ordering independence is preferred):

```ts
it("returns the signed-in user's identity from /auth/me", async () => {
  const identity = `me-${crypto.randomUUID()}@flowboard.dev`;
  const registration = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: identity,
      password: "safe-test-password",
      displayName: "Me Member",
    },
  });
  const rawCookies = registration.headers["set-cookie"];
  const meCookie = (
    Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : []
  )
    .map((value) => value.split(";")[0])
    .join("; ");
  const me = await app.inject({
    method: "GET",
    url: "/auth/me",
    headers: { cookie: meCookie },
  });
  expect(me.statusCode).toBe(200);
  expect(me.json()).toMatchObject({
    email: identity,
    displayName: "Me Member",
  });
});

it("rejects /auth/me without a session", async () => {
  const response = await app.inject({ method: "GET", url: "/auth/me" });
  expect(response.statusCode).toBe(401);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (needs `DATABASE_URL`, see `README.md`'s "Tests and checks" section): `scripts/in-dev npm run test -- app.integration.test.ts`
Expected: FAIL — `/auth/me` returns 404.

- [ ] **Step 3: Implement the route in `apps/api/src/app.ts`**

Add directly after the `app.post("/auth/logout", ...)` handler:

```ts
app.get("/auth/me", authenticate, async (request, reply) => {
  const userId = (request.user as { sub: string }).sub;
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return reply.code(401).send({ error: "Authentication required" });
  return { id: user.id, email: user.email, displayName: user.displayName };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `scripts/in-dev npm run test -- app.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/app.integration.test.ts
git commit -m "feat(api): add GET /auth/me so the web app can restore a session"
```

---

### Task 2: Frontend API client with session-refresh retry

**Files:**

- Create: `apps/web/src/lib/api-client.ts`
- Test: `apps/web/src/lib/api-client.test.ts`

**Interfaces:**

- Produces: `API: string` (the `"/api"` base path), `class SessionExpiredError extends Error`, `request<T>(path: string, init?: RequestInit, fetcher?: typeof fetch): Promise<T>`.
- `request` throws a plain `Error` (message from the server's `{ error }` body, or `"Request failed"`) for any non-401 failure, and `SessionExpiredError` when the caller has no valid session even after one refresh attempt. A `204` response resolves to `undefined`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { request, SessionExpiredError } from "./api-client";

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
  });
}

describe("api-client request()", () => {
  it("returns parsed JSON on success", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, { ok: true }),
    );
    await expect(request("/boards", undefined, fetcher)).resolves.toEqual({
      ok: true,
    });
  });

  it("returns undefined for a 204 response", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(204));
    await expect(
      request("/boards/1", { method: "DELETE" }, fetcher),
    ).resolves.toBeUndefined();
  });

  it("throws the server's error message on a non-401 failure", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse(400, { error: "Invalid board" }),
    );
    await expect(request("/boards", undefined, fetcher)).rejects.toThrow(
      "Invalid board",
    );
  });

  it("refreshes once and retries after a 401, then succeeds", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(200)) // POST /auth/refresh
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await expect(request("/boards", undefined, fetcher)).resolves.toEqual({
      ok: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/auth/refresh");
  });

  it("throws SessionExpiredError when refresh itself fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(401)); // POST /auth/refresh fails
    await expect(request("/boards", undefined, fetcher)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
  });

  it("throws SessionExpiredError when the retried request is still 401", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(200)) // refresh succeeds
      .mockResolvedValueOnce(jsonResponse(401)); // retry still fails
    await expect(request("/boards", undefined, fetcher)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not attempt a refresh for a failed /auth/login", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse(401, { error: "Email or password is incorrect" }),
    );
    await expect(
      request("/auth/login", { method: "POST" }, fetcher),
    ).rejects.toThrow("Email or password is incorrect");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- api-client.test.ts`
Expected: FAIL — `./api-client` does not exist.

- [ ] **Step 3: Implement `apps/web/src/lib/api-client.ts`**

```ts
export const API = "/api";

export class SessionExpiredError extends Error {}

async function refreshSession(fetcher: typeof fetch): Promise<boolean> {
  const response = await fetcher(`${API}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  return response.ok;
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  fetcher: typeof fetch = fetch,
  isRetry = false,
): Promise<T> {
  const response = await fetcher(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (response.status === 401 && path !== "/auth/login") {
    if (isRetry) throw new SessionExpiredError("Session expired");
    if (await refreshSession(fetcher))
      return request<T>(path, init, fetcher, true);
    throw new SessionExpiredError("Session expired");
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok)
    throw new Error(
      ((await response.json()) as { error?: string }).error ?? "Request failed",
    );
  return response.json() as Promise<T>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- api-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/lib/api-client.test.ts
git commit -m "feat(web): add API client with one-shot session-refresh retry"
```

---

### Task 3: Real session bootstrap and logout in `board-app.tsx`

**Files:**

- Modify: `apps/web/src/components/board-app.tsx:1-198` (imports, the local `request`/`API` definitions, state, `signIn`, the auto-login effect)
- Modify: `apps/web/src/components/board-app.tsx:424-443` (sidebar bottom — add the logout control)
- Modify: `apps/web/e2e/board.spec.ts` (replace the implicit auto-login the test currently relies on with an explicit sign-in step for both `page` and `second`)
- Create: `apps/web/e2e/auth.spec.ts`

**Interfaces:**

- Consumes (from Task 1 & 2): `GET /auth/me`; `request<T>()`, `API`, `SessionExpiredError` from `../lib/api-client`.
- Produces: `board-app.tsx` no longer defines its own `API`/`request`; it imports them. New local helper `resetSessionIfExpired(error: unknown): boolean` (returns `true` and clears `user`/`board`/sets a notice when `error instanceof SessionExpiredError`, otherwise returns `false`) — used by every existing catch block that currently does `setNotice(error instanceof Error ? error.message : "...")`, and analogously by the ones that use `setCardError`.

- [ ] **Step 1: Remove the local `API`/`request` definitions and import from the new client**

Replace lines 36–61 (`const API = "/api"; ... async function request...`) with:

```ts
import { API, request, SessionExpiredError } from "../lib/api-client";
```

(move this import up with the other imports at the top of the file).

- [ ] **Step 2: Replace hardcoded demo credentials and the auto-login effect**

Replace:

```ts
const [email, setEmail] = useState("demo@flowboard.dev");
const [password, setPassword] = useState("flowboard-demo-password");
```

with:

```ts
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
const [checkingSession, setCheckingSession] = useState(true);
```

Add `type AuthenticatedUser = { id: string; email: string; displayName: string };` near the file's other type aliases (`Card`, `Column`, `Board`, `Viewer`). Change `const [user, setUser] = useState<{ displayName: string } | null>(null);` to `useState<AuthenticatedUser | null>(null)`, and change `signIn`'s call from `request<{ displayName: string }>("/auth/login", ...)` to `request<AuthenticatedUser>("/auth/login", ...)`.

Replace:

```ts
useEffect(() => {
  void signIn();
}, [signIn]);
```

with a session-restore effect that does not depend on `signIn` and never submits the (now empty) form:

```ts
useEffect(() => {
  void (async () => {
    try {
      const signedIn = await request<AuthenticatedUser>("/auth/me");
      setUser(signedIn);
      await loadBoard();
    } catch {
      // No valid session — show the empty login form.
    } finally {
      setCheckingSession(false);
    }
  })();
}, [loadBoard]);
```

- [ ] **Step 3: Add `resetSessionIfExpired` and use it in every existing catch block**

```ts
function resetSessionIfExpired(error: unknown): boolean {
  if (!(error instanceof SessionExpiredError)) return false;
  setUser(null);
  setBoard(null);
  setNotice("Your session expired. Please sign in again.");
  return true;
}
```

Update the catch blocks in `createCard`, `onDragEnd`, `saveCard`, the share/invite handler, and the sidebar "New board" handler: each gets `if (resetSessionIfExpired(error)) return;` as its first line, before the existing `setNotice(...)` / `setCardError(...)` fallback.

- [ ] **Step 4: Add the logout action and control**

```ts
async function signOut() {
  try {
    await fetch(`${API}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } finally {
    setUser(null);
    setBoard(null);
    setBoards([]);
  }
}
```

In the `sidebar-bottom` block (around line 424), add a logout button next to the existing theme toggle, importing `LogOut` from `lucide-react`:

```tsx
<button
  title="Sign out"
  aria-label="Sign out"
  className="theme-toggle"
  onClick={() => void signOut()}
>
  <LogOut size={16} aria-hidden="true" />
</button>
```

- [ ] **Step 5: Gate rendering on `checkingSession`**

Change the login-screen branch condition from `if (!user || !board)` to render `null` while `checkingSession` is true, so the empty login form never flashes before the session check resolves:

```ts
if (checkingSession) return null;
if (!user || !board) return (/* existing login screen JSX, unchanged */);
```

- [ ] **Step 6: Update `apps/web/e2e/board.spec.ts`'s setup to sign in explicitly**

The test currently does `await page.goto("/"); await expect(page.getByRole("heading", { name: "Product Launch" })).toBeVisible(...)`, relying on the auto-login this task removes. For both `page` and `second`, after `goto("/")`, fill and submit the login form before asserting the board heading:

```ts
await page.goto("/");
await page.getByLabel("Email").fill("demo@flowboard.dev");
await page
  .getByLabel("Password")
  .fill(process.env.DEMO_PASSWORD ?? "flowboard-demo-password");
await page.getByRole("button", { name: /Open your workspace/ }).click();
await expect(page.getByRole("heading", { name: "Product Launch" })).toBeVisible(
  { timeout: 30000 },
);
```

Apply the same three lines before `second`'s existing assertion.

- [ ] **Step 7: Create `apps/web/e2e/auth.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("shows an error for wrong credentials, signs in, persists across reload, and signs out", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@flowboard.dev");
  await page.getByLabel("Password").fill("not-the-right-password");
  await page.getByRole("button", { name: /Open your workspace/ }).click();
  await expect(page.getByRole("status")).toHaveText(/incorrect/i);

  await page
    .getByLabel("Password")
    .fill(process.env.DEMO_PASSWORD ?? "flowboard-demo-password");
  await page.getByRole("button", { name: /Open your workspace/ }).click();
  await expect(
    page.getByRole("heading", { name: "Product Launch" }),
  ).toBeVisible({ timeout: 30000 });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Product Launch" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel("Email")).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
});
```

- [ ] **Step 8: Run the full e2e suite**

Run (with the Compose stack up, per `README.md`): `scripts/in-dev npm run e2e`
Expected: PASS for `auth.spec.ts` and `board.spec.ts`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/board-app.tsx apps/web/e2e/board.spec.ts apps/web/e2e/auth.spec.ts
git commit -m "feat(web): real session bootstrap, logout, and refresh-aware error handling"
```

---

### Task 4: Inline create forms (replace `window.prompt()`)

**Files:**

- Create: `apps/web/src/components/inline-create-field.tsx`
- Modify: `apps/web/src/components/board-app.tsx` (the "New board" handler around line 409, the "new-column" handler around line 577, and `createCard` plus its two trigger buttons around lines 251, 540, 568)
- Modify: `apps/web/e2e/board.spec.ts`
- Modify: `apps/web/src/app/styles.css` (one small class for the inline field, reusing existing input styling where possible)

**Interfaces:**

- Produces: `InlineCreateField({ placeholder, onSubmit, onCancel }: { placeholder: string; onSubmit: (value: string) => void | Promise<void>; onCancel: () => void })` — a controlled single-field form. Submitting an empty/whitespace-only value is a no-op (field stays open); Escape or blur calls `onCancel`.

- [ ] **Step 1: Create `InlineCreateField`**

```tsx
"use client";

import { useState } from "react";

export default function InlineCreateField({
  placeholder,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  onSubmit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    void onSubmit(trimmed);
  }

  return (
    <form className="inline-create-field" onSubmit={submit}>
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        onBlur={onCancel}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </form>
  );
}
```

- [ ] **Step 2: Add the `.inline-create-field` class to `apps/web/src/app/styles.css`**

Reuse the existing input look; append near `.add-card`/`.new-column`:

```css
.inline-create-field input {
  width: 100%;
  border: 1px solid #dce5dd;
  border-radius: 7px;
  padding: 8px 10px;
  font-size: 12px;
}
```

- [ ] **Step 3: Wire board creation**

Add `const [creatingBoard, setCreatingBoard] = useState(false);` and a `createBoard`:

```ts
async function createBoard(name: string) {
  try {
    await request("/boards", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setCreatingBoard(false);
    await loadBoard();
  } catch (error) {
    if (resetSessionIfExpired(error)) return;
    setNotice(
      error instanceof Error ? error.message : "Could not create board",
    );
  }
}
```

Replace the `"add-board"` button's `onClick` (currently `window.prompt`) with conditional rendering: show `<InlineCreateField placeholder="Board name" onSubmit={createBoard} onCancel={() => setCreatingBoard(false)} />` when `creatingBoard`, otherwise the existing button with `onClick={() => setCreatingBoard(true)}`.

- [ ] **Step 4: Wire column creation**

Add `const [creatingColumn, setCreatingColumn] = useState(false);` and `createColumn`:

```ts
async function createColumn(name: string) {
  if (!board) return;
  try {
    await request(`/boards/${board.id}/columns`, {
      method: "POST",
      body: JSON.stringify({
        name,
        order: (board.columns.at(-1)?.order ?? 0) + 1024,
      }),
    });
    setCreatingColumn(false);
    await loadBoard(board.id);
  } catch (error) {
    if (resetSessionIfExpired(error)) return;
    setNotice(
      error instanceof Error ? error.message : "Could not create column",
    );
  }
}
```

Replace the `"new-column"` button the same way: `<InlineCreateField placeholder="Column name" onSubmit={createColumn} onCancel={() => setCreatingColumn(false)} />` when `creatingColumn`, else the existing button with `onClick={() => setCreatingColumn(true)}`.

- [ ] **Step 5: Wire card creation**

Add `const [creatingCardFor, setCreatingCardFor] = useState<string | null>(null);`. Change `createCard` to take a title instead of prompting:

```ts
async function createCard(column: Column, title: string) {
  try {
    await request(`/boards/${board?.id}/cards`, {
      method: "POST",
      body: JSON.stringify({ title, columnId: column.id, labels: [] }),
    });
    setCreatingCardFor(null);
    await loadBoard(board?.id);
  } catch (error) {
    if (resetSessionIfExpired(error)) return;
    setNotice(error instanceof Error ? error.message : "Could not create card");
  }
}
```

Both the `column-menu` button and the `add-card` button for a column now call `onClick={() => setCreatingCardFor(column.id)}` instead of `onClick={() => void createCard(column)}`. Render `<InlineCreateField placeholder="Card title" onSubmit={(title) => createCard(column, title)} onCancel={() => setCreatingCardFor(null)} />` in place of the `add-card` button when `creatingCardFor === column.id`.

- [ ] **Step 6: Update `apps/web/e2e/board.spec.ts`**

Remove the `dialogHandler`/`page.on("dialog", ...)` setup (no native dialog exists anymore). Replace the card-creation step:

```ts
await page.getByRole("button", { name: /Add card to Ideas/ }).click();
await page.getByPlaceholder("Card title").fill(cardTitle);
await page.getByPlaceholder("Card title").press("Enter");
```

- [ ] **Step 7: Run the full e2e suite**

Run: `scripts/in-dev npm run e2e`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/inline-create-field.tsx apps/web/src/components/board-app.tsx apps/web/src/app/styles.css apps/web/e2e/board.spec.ts
git commit -m "feat(web): replace window.prompt() creation with inline forms"
```

---

### Task 5: Delete flows for cards, columns, and boards

**Files:**

- Modify: `apps/web/src/components/card-details-dialog.tsx` (add a delete action)
- Modify: `apps/web/src/components/board-app.tsx` (delete handlers, confirm state, delete controls for columns and boards, widen the `boards` state type to include `role`)
- Modify: `apps/web/src/app/styles.css` (minimal classes for the danger button and inline confirm row)
- Modify: `apps/web/e2e/board.spec.ts`

**Interfaces:**

- Consumes: `DELETE /boards/:id`, `DELETE /boards/:id/columns/:id`, `DELETE /boards/:id/cards/:id` (all already implemented and tested server-side).
- Produces: `CardDetailsDialog` gains an `onDelete: () => Promise<void>` prop and a `deleting: boolean` prop, rendering a two-step inline confirm ("Delete card" → "Delete this card? / Cancel / Confirm delete") in its `dialog-actions` footer, shown only when `!readOnly`.

- [ ] **Step 1: Add delete to `CardDetailsDialog`**

Add props `onDelete: () => Promise<void>` and `deleting: boolean` to the component's prop type. Add `const [confirmingDelete, setConfirmingDelete] = useState(false);`, reset to `false` in the existing `useEffect` keyed on `card?.id`. Replace the `dialog-actions` footer:

```tsx
<footer className="dialog-actions">
  {!readOnly &&
    (confirmingDelete ? (
      <>
        <span className="dialog-confirm-prompt">Delete this card?</span>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setConfirmingDelete(false)}
        >
          Cancel
        </button>
        <button
          className="danger-button"
          type="button"
          disabled={deleting}
          onClick={() => void onDelete()}
        >
          {deleting ? "Deleting…" : "Confirm delete"}
        </button>
      </>
    ) : (
      <button
        className="danger-button"
        type="button"
        onClick={() => setConfirmingDelete(true)}
      >
        Delete card
      </button>
    ))}
  <span className="dialog-actions-spacer" />
  <button className="secondary-button" type="button" onClick={onClose}>
    Close
  </button>
  {!readOnly && !confirmingDelete && (
    <button
      className="primary"
      type="submit"
      disabled={saving || !title.trim()}
    >
      {saving ? "Saving…" : "Save changes"}
    </button>
  )}
</footer>
```

- [ ] **Step 2: Add the CSS for the new elements to `apps/web/src/app/styles.css`**

```css
.dialog-actions-spacer {
  flex: 1;
}
.danger-button {
  border: 1px solid #e3b8b2;
  border-radius: 7px;
  padding: 9px 12px;
  background: #fff;
  color: #b2463f;
  font-size: 11px;
  font-weight: 650;
}
.danger-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.dialog-confirm-prompt {
  font-size: 11px;
  color: #46564b;
  margin-right: auto;
}
.confirm-delete {
  display: inline-flex;
  gap: 4px;
}
.icon-button.danger {
  color: #b2463f;
  border-color: #e3b8b2;
}
.board-link-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.board-link-row .board-link {
  flex: 1;
}
```

- [ ] **Step 3: Wire card deletion in `board-app.tsx`**

Add `const [deletingCard, setDeletingCard] = useState(false);` and:

```ts
async function deleteCard() {
  if (!board || !selectedCard) return;
  setDeletingCard(true);
  setCardError("");
  try {
    await request(`/boards/${board.id}/cards/${selectedCard.id}`, {
      method: "DELETE",
    });
    await loadBoard(board.id);
    setSelectedCard(null);
  } catch (error) {
    if (resetSessionIfExpired(error)) return;
    setCardError(
      error instanceof Error ? error.message : "Could not delete card",
    );
  } finally {
    setDeletingCard(false);
  }
}
```

Pass `onDelete={deleteCard}` and `deleting={deletingCard}` to `<CardDetailsDialog>`.

- [ ] **Step 4: Wire column deletion**

Add `const [deletingColumnId, setDeletingColumnId] = useState<string | null>(null);` and:

```ts
async function deleteColumn(columnId: string) {
  if (!board) return;
  try {
    await request(`/boards/${board.id}/columns/${columnId}`, {
      method: "DELETE",
    });
    setDeletingColumnId(null);
    await loadBoard(board.id);
  } catch (error) {
    if (resetSessionIfExpired(error)) return;
    setNotice(
      error instanceof Error ? error.message : "Could not delete column",
    );
  }
}
```

In the `column-head` (around line 536), when `board.role !== "viewer"`, add a trash button after the existing `column-menu` button, importing `Trash2`, `Check`, and `X` from `lucide-react`:

```tsx
{
  board.role !== "viewer" &&
    (deletingColumnId === column.id ? (
      <span className="confirm-delete">
        <button
          aria-label={`Cancel deleting ${column.name}`}
          className="icon-button"
          onClick={() => setDeletingColumnId(null)}
        >
          <X size={13} aria-hidden="true" />
        </button>
        <button
          aria-label={`Confirm delete ${column.name}`}
          className="icon-button danger"
          onClick={() => void deleteColumn(column.id)}
        >
          <Check size={13} aria-hidden="true" />
        </button>
      </span>
    ) : (
      <button
        aria-label={`Delete ${column.name}`}
        className="column-menu"
        onClick={() => setDeletingColumnId(column.id)}
      >
        <Trash2 size={13} aria-hidden="true" />
      </button>
    ));
}
```

- [ ] **Step 5: Wire board deletion**

Widen the `boards` state type from `Array<{ id: string; name: string }>` to `Array<{ id: string; name: string; role: string }>` (the API already returns `role`; see `apps/api/src/app.ts`'s `GET /boards` handler). Add `const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null);` and:

```ts
async function deleteBoard(boardId: string) {
  try {
    await request(`/boards/${boardId}`, { method: "DELETE" });
    setDeletingBoardId(null);
    // Deleting the board you're viewing: loadBoard(undefined) falls back to
    // the first remaining board. Deleting a different one: pass the current
    // board's id through so the view doesn't jump. Either way, `board` is
    // never set to null here — `loadBoard` only replaces it once the fresh
    // data has arrived, so the old board stays on screen during the fetch
    // instead of a login-screen flash (the `!user || !board` check below
    // would otherwise treat a momentarily-null board as "signed out").
    await loadBoard(board?.id === boardId ? undefined : board?.id);
  } catch (error) {
    if (resetSessionIfExpired(error)) return;
    setNotice(
      error instanceof Error ? error.message : "Could not delete board",
    );
  }
}
```

In the sidebar board list (around line 395), wrap each entry in a `.board-link-row` and add a delete control next to the `board-link` button, shown only when `item.role !== "viewer"` and `boards.length > 1` (a board cannot be deleted while it is the user's only board):

```tsx
<div className="board-link-row" key={item.id}>
  <button
    className={`board-link ${board.id === item.id ? "selected" : ""}`}
    onClick={() => void loadBoard(item.id)}
  >
    <LayoutDashboard className="board-dot" size={15} aria-hidden="true" />
    {item.name}
  </button>
  {item.role !== "viewer" &&
    boards.length > 1 &&
    (deletingBoardId === item.id ? (
      <span className="confirm-delete">
        <button
          aria-label={`Cancel deleting ${item.name}`}
          className="icon-button"
          onClick={() => setDeletingBoardId(null)}
        >
          <X size={12} aria-hidden="true" />
        </button>
        <button
          aria-label={`Confirm delete ${item.name}`}
          className="icon-button danger"
          onClick={() => void deleteBoard(item.id)}
        >
          <Check size={12} aria-hidden="true" />
        </button>
      </span>
    ) : (
      <button
        aria-label={`Delete ${item.name}`}
        className="icon-button"
        onClick={() => setDeletingBoardId(item.id)}
      >
        <Trash2 size={12} aria-hidden="true" />
      </button>
    ))}
</div>
```

(Remove the now-redundant `key={item.id}` from the inner `button` since it moved to the wrapping `div`.)

- [ ] **Step 6: Extend `apps/web/e2e/board.spec.ts`**

Add a new `test()` covering all three deletions, run after the existing test (same file, separate `test(...)` block so it can run independently):

```ts
test("deletes a card, a column, and a board", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@flowboard.dev");
  await page
    .getByLabel("Password")
    .fill(process.env.DEMO_PASSWORD ?? "flowboard-demo-password");
  await page.getByRole("button", { name: /Open your workspace/ }).click();
  await expect(
    page.getByRole("heading", { name: "Product Launch" }),
  ).toBeVisible({ timeout: 30000 });

  // A column with a card cascades on delete. Named to not be a substring
  // of any other accessible name used in this test (Playwright's `name`
  // matching is substring-based unless `exact: true` is passed).
  await page.getByRole("button", { name: /Add column/ }).click();
  await page.getByPlaceholder("Column name").fill("Temp Column");
  await page.getByPlaceholder("Column name").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Temp Column" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Add card to Temp Column/ }).click();
  await page.getByPlaceholder("Card title").fill("Temporary card");
  await page.getByPlaceholder("Card title").press("Enter");
  await expect(page.getByText("Temporary card")).toBeVisible();
  await page.getByRole("button", { name: "Delete Temp Column" }).click();
  await page
    .getByRole("button", { name: "Confirm delete Temp Column" })
    .click();
  await expect(page.getByRole("heading", { name: "Temp Column" })).toHaveCount(
    0,
  );
  await expect(page.getByText("Temporary card")).toHaveCount(0);

  // Deleting the board you're currently viewing must land you back on a
  // remaining board, not a blank state; the only board can't be deleted.
  await page.getByRole("button", { name: /New board/ }).click();
  await page.getByPlaceholder("Board name").fill("Scratch board");
  await page.getByPlaceholder("Board name").press("Enter");
  await page
    .getByRole("button", { name: "Scratch board", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Scratch board" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete Scratch board" }).click();
  await page
    .getByRole("button", { name: "Confirm delete Scratch board" })
    .click();
  await expect(page.getByText("Scratch board")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Product Launch" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete Product Launch" }),
  ).toHaveCount(0);
});
```

- [ ] **Step 7: Run the full e2e suite**

Run: `scripts/in-dev npm run e2e`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/card-details-dialog.tsx apps/web/src/components/board-app.tsx apps/web/src/app/styles.css apps/web/e2e/board.spec.ts
git commit -m "feat(web): add delete flows for cards, columns, and boards"
```

---

### Task 6: Full verification and refreshed screenshots

**Files:**

- No source changes expected; regenerate `docs/board-light.png`, `docs/board-dark.png`, `docs/card-details.png` (produced by `apps/web/e2e/board.spec.ts`'s existing screenshot steps).

**Interfaces:**

- None (verification task).

- [ ] **Step 1: Run the full project check**

Run: `scripts/in-dev npm ci && scripts/in-dev npm run check`
Expected: scan, format, lint, typecheck, unit/integration tests, and build all pass. Fix any fallout from Tasks 1–5 before proceeding (e.g. unused `window.prompt`-era code, stale types).

- [ ] **Step 2: Run the full Playwright suite against the live stack**

Run: `docker compose up --build -d`, then `scripts/in-dev npx playwright install chromium && scripts/in-dev npm run e2e`
Expected: `auth.spec.ts` and both `board.spec.ts` tests pass; `docs/board-light.png`, `docs/board-dark.png`, and `docs/card-details.png` are rewritten with the new UI.

- [ ] **Step 3: Review the regenerated screenshots**

Open the three PNGs and confirm they reflect the new logout control, inline create fields, and delete controls (no native dialogs visible, no stale "Product Studio"/fixed-date artifacts introduced by this phase — those remain out of scope for Phase A, unchanged).

- [ ] **Step 4: Commit**

```bash
git add docs/board-light.png docs/board-dark.png docs/card-details.png
git commit -m "chore: refresh docs screenshots after flow fixes"
```
