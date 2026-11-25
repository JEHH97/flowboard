# Flowboard — fix auth and CRUD flows (Phase A)

## Intent and why

Flowboard's API already has a complete, tested auth and CRUD implementation
(login, logout, refresh rotation, delete for boards/columns/cards, role
permissions), but the web app barely uses it:

- The login screen auto-submits hardcoded demo credentials on every page
  load (`useEffect(() => { void signIn(); }, [signIn])` in `board-app.tsx`),
  so a real login/logout cycle never happens in practice.
- There is no logout control anywhere in the UI, even though
  `POST /auth/logout` works and revokes the refresh session.
- Creating a board, column, or card uses `window.prompt()`.
- There is no delete UI at all for boards, columns, or cards, even though
  `DELETE /boards/:id`, `DELETE /boards/:id/columns/:id`, and
  `DELETE /boards/:id/cards/:id` exist, are permission-checked, and are
  covered by integration tests.

This phase makes those flows real, frontend-only, as groundwork before the
visual redesign (Phase B, approved separately: full redesign using the
frontend-design skill).

## Goals

- A login screen that only appears when there is no valid session, and
  stays empty by default (no hardcoded auto-login).
- A session that actually persists across page reloads and across the
  15-minute access-token lifetime, by using the refresh endpoint the API
  already exposes (today the frontend never calls it, so any session
  silently breaks after 15 minutes).
- A visible logout action that calls `POST /auth/logout` and returns the
  user to the login screen with client state cleared.
- Create board/column/card through an inline form instead of
  `window.prompt()`.
- Delete board/column/card from the UI, wired to the existing `DELETE`
  endpoints, hidden/disabled for `viewer` role the same way "add" already
  is.
- Update `apps/web/e2e/board.spec.ts` to match the new interactions
  (it currently drives card creation through the `window.prompt()` dialog
  handler).

## Non-goals

- Visual/brand redesign (color, typography, layout). That's Phase B,
  confirmed to use the frontend-design skill. This phase keeps the current
  look and CSS classes wherever reasonable, since Phase B will replace them.
- Sign-up/registration UI. `POST /auth/register` already works on the API,
  but it wasn't part of the request. Flagging it as a natural fast-follow,
  not building it now.
- Backend changes beyond one small addition. Every CRUD/auth endpoint this
  phase needs already exists and is tested; the one exception is a new
  `GET /auth/me` (see Approach 1) needed because `access_token`/
  `refresh_token` are `HttpOnly` — client JS cannot read them, and no
  existing endpoint returns the signed-in user's `displayName` on its own.

## Anti-goals

- Don't keep a hidden auto-login fallback "for convenience" — that's the
  exact bug being fixed.
- Don't introduce new native browser dialogs (`window.confirm()`) as a
  shortcut for delete confirmation — that would reintroduce the same kind
  of shortcut `window.prompt()` was.

## Constraints

- `apps/web/e2e/board.spec.ts` depends on today's `window.prompt()` flow,
  exact CSS classes, and overwrites `docs/board-*.png` / `docs/card-details.png`
  screenshots used in the README. It must be updated in the same change,
  not after.
- Role permissions are already defined in
  `packages/shared/src/domain/authorization.ts`: `viewer` can only `read`;
  `editor` and `owner` can `create`/`update`/`delete`; only `owner` can
  `invite`/`manage-members`. Delete controls follow the same
  `board.role === "viewer"` disabling pattern already used for "add".

## Approaches

**1. Detecting whether a session is already valid on page load, and who it belongs to**

- _A — Reuse `GET /boards`:_ call it on mount; `200` means signed in, load
  the board; `401` means show the (now empty) login form. No backend
  change — but it doesn't solve identity: nothing in its response carries
  the signed-in user's `displayName`, and the auth cookies are `HttpOnly`,
  so the browser cannot read them to find out another way.
- _B — Add `GET /auth/me`_ (authenticated, returns
  `{ id, email, displayName }` by reading `request.user.sub` the same way
  every other authenticated route already does): one small backend
  addition, but it is the only way to answer "who is this?" after a
  reload where no login form was submitted.
- **Picked: B.** Session restore calls `GET /auth/me` first; `200` means
  signed in (use the response to set `user` and proceed to `loadBoard()`),
  `401` means show the (now empty) login form. This is the one exception
  to the "frontend-only" non-goal above.

**1b. Access-token expiry (15 minutes) during an active session**

- _A — Do nothing (today's behavior):_ once the access token expires, every
  authenticated call starts failing with 401 and the user is silently stuck,
  since nothing currently calls `POST /auth/refresh`.
- _B — Retry-once-after-refresh in `request()`:_ when any authenticated
  call gets a 401, call `POST /auth/refresh` once; on success, retry the
  original call once; on failure, treat it as a real session end (clear
  `user`/`board` state, show the login screen).
- **Picked: B.** This is what `POST /auth/refresh` exists for; leaving it
  unused is the kind of half-done flow this phase is meant to fix. The
  retry logic lives in `request()` so every caller gets it for free. To
  keep `request()`'s existing contract for callers that already handle
  errors as user-facing messages (e.g. "Could not create card"), it throws
  a distinct `SessionExpiredError` when the retried call still fails,
  instead of a plain `Error` — the top level catches that one type to
  reset to the login screen instead of showing it as an inline notice.

**2. Delete confirmation UX**

- _A — `window.confirm()`:_ simplest, but a native dialog — same category
  of shortcut as the `window.prompt()` this phase removes.
- _B — Inline confirm:_ the delete control (e.g. a trash icon) turns into
  "Delete? [Confirm] [Cancel]" in place, no dialog.
- **Picked: B.** Keeps "no native browser dialogs" consistent across the
  whole app; Phase B will restyle it but the interaction pattern stays.

**3. Create forms for board/column/card**

- _A — Inline input appearing in place of the "+ Add" button:_ press Enter
  to submit, Escape/blur to cancel. Matches today's single-field creation.
- _B — A modal, reusing the `<dialog>` pattern from
  `card-details-dialog.tsx`:_ more structure than a one-field form needs.
- **Picked: A**, for boards, columns, and cards alike. Phase B can turn
  these into richer components once the visual redesign happens; this
  phase only needs to stop using `window.prompt()`.
- Submitting an empty/whitespace-only value is a no-op, same guard the
  current `window.prompt()` calls already use (`if (!title?.trim()) return`).
  Escape or blur always cancels and discards whatever was typed — no
  draft-saving on blur, to keep the interaction as simple as what it's
  replacing.

## What's left to the builder

- Exact inline-input markup and which existing CSS classes to reuse (new
  classes are fine where nothing fits, kept minimal since Phase B replaces
  styling anyway).
- Where exactly the logout control sits in the sidebar (near the user
  avatar is the natural spot, matching `sidebar-bottom`'s existing layout).
- State shape for "which item is mid-delete-confirmation" (e.g. a single
  `deletingId` per entity type is enough; no need to support multiple
  simultaneous confirmations).
- Updating `board.spec.ts`: removing the `window.prompt()` dialog handler
  for card creation, adding assertions for the new inline-form and delete
  interactions, and keeping the screenshot steps working end to end.
