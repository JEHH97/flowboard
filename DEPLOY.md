# Deployment guide

## PostgreSQL on Neon

1. Create a PostgreSQL project and copy its pooled connection string.
2. Keep the connection string private and enable TLS in the URL.
3. Run `scripts/in-dev npm run db:migrate --workspace @flowboard/api` against that database.
4. Run `scripts/in-dev npm run db:seed --workspace @flowboard/api` once for the showcase board, with `DEMO_PASSWORD` set to a unique secret.

## API on Render

Create a web service from this repository and use the included `render.yaml` blueprint. Configure `DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, and `WEB_ORIGIN` as secrets/settings. Set `WEB_ORIGIN` to the final web origin. Use long random secrets, enable TLS, and rotate the demo credential before sharing a public instance.

## Web on Vercel

Import the repository and set the project root to `apps/web` (or use the repository root with npm workspaces enabled). Set `NEXT_PUBLIC_API_URL` to the public API origin and redeploy after setting it, because the browser API address is compiled into the web bundle. Configure the API CORS origin to the exact Vercel production URL. For preview deployments, add the preview origin only when needed.

## Required environment variables

| Variable               | Used by | Purpose                                         |
| ---------------------- | ------- | ----------------------------------------------- |
| `DATABASE_URL`         | API     | PostgreSQL connection string                    |
| `JWT_SECRET`           | API     | Signing key for short-lived access sessions     |
| `REFRESH_TOKEN_SECRET` | API     | Separate signing key for refresh sessions       |
| `WEB_ORIGIN`           | API     | Credentialed CORS and invitation-link origin    |
| `NEXT_PUBLIC_API_URL`  | Web     | Public API origin included in the client bundle |
| `DEMO_PASSWORD`        | Seed    | Local/demo account password                     |

Do not commit production environment files or share deployment credentials.
