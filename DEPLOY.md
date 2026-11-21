# Deployment guide

This guide deploys the public demo with a free Neon PostgreSQL database, a free Render API service, and a Vercel web app. Do not put database credentials or signing secrets in the web project's `NEXT_PUBLIC_*` variables.

The demo account is public by design: `demo@flowboard.dev` / `flowboard-demo-password`. Anyone can sign in and edit the shared board. `DEMO_PASSWORD` must exactly match the password shown in the web sign-in form. Running the seed again safely synchronizes the account password and preserves the existing showcase board.

## 1. Create the Neon database

1. Create a Neon project on the free plan and choose a region close to the Render service.
2. In the Neon project dashboard, open **Connect** and choose the default database and role. Copy the **pooled** connection string and keep it private. It must use TLS (`sslmode=require`); Neon provides this by default.
3. Keep the connection string available for the API's `DATABASE_URL` and the migration/seed commands below. Do not commit it or enter it in a Vercel variable.

## 2. Create and configure the Render API

1. In Render, choose **New → Blueprint**, select this repository, and confirm the `render.yaml` blueprint. It creates the `flowboard-api` Docker web service with the **Free** plan and `/health` health check.
2. In the service's **Environment** settings, add the following values. Replace the sample origins with the final deployed URLs; do not include a trailing slash.

   | Field                  | Value                                                                                     |
   | ---------------------- | ----------------------------------------------------------------------------------------- |
   | `DATABASE_URL`         | The pooled Neon connection string from step 1                                             |
   | `JWT_SECRET`           | Output of `openssl rand -hex 32`                                                          |
   | `REFRESH_TOKEN_SECRET` | A separate output of `openssl rand -hex 32`                                               |
   | `WEB_ORIGIN`           | The exact production Vercel origin, e.g. `https://flowboard-demo.vercel.app`              |
   | `DEMO_PASSWORD`        | `flowboard-demo-password` (public demo credential; it must match the prefilled web login) |

   The blueprint declares these values as unsynchronized settings so Render prompts you to enter them. Do not use the same value for both signing secrets.

3. Save the settings and deploy. For `WEB_ORIGIN`, you can enter the planned Vercel production origin and correct it after step 4 if Vercel assigns a different alias. Copy the service's public origin, e.g. `https://flowboard-api.onrender.com`; use only the origin, without a path.

Render's free web service sleeps after 15 minutes without activity. Its first request after sleeping can take about 50 seconds while the service starts. This is expected for the public demo.

## 3. Migrate and seed Neon

The API container applies migrations and runs the seed when it starts. To run these steps manually (for example, to sync the public password later), use Node.js 24 and npm from the repository root. Install workspace dependencies once, then use the same `DATABASE_URL` and `DEMO_PASSWORD` configured in Render:

```sh
scripts/in-dev npm ci
DATABASE_URL='<pooled Neon connection string>' scripts/in-dev npm run db:migrate --workspace @flowboard/api
DATABASE_URL='<pooled Neon connection string>' DEMO_PASSWORD='flowboard-demo-password' scripts/in-dev npm run db:seed --workspace @flowboard/api
```

The seed is safe to rerun: it updates the demo user's password hash to the configured value and does not recreate existing board content. Run it again if you change `DEMO_PASSWORD`; update the prefilled web credential at the same time if you choose a different public password.

## 4. Configure Vercel

1. Import the repository in Vercel. Use the repository root (`.`) as **Root Directory**, enable **Include files outside the Root Directory** if shown, and select **Next.js** as the framework. The checked-in `vercel.json` runs `npm ci` and `npm run build --workspace @flowboard/web`; leave **Output Directory** unset. Use Node.js 24 in Project Settings.
2. Add these environment variables for the **Production** environment (and for Preview only if you deliberately configure a matching API `WEB_ORIGIN`):

   | Field                 | Value                                                                      |
   | --------------------- | -------------------------------------------------------------------------- |
   | `API_ORIGIN`          | Render API origin from step 2, e.g. `https://flowboard-api.onrender.com`   |
   | `NEXT_PUBLIC_API_URL` | The same Render API origin; used only by the browser to open the WebSocket |

   `API_ORIGIN` is used server-side by the Next.js `/api/*` rewrite so REST requests and HttpOnly cookies use the Vercel origin. `NEXT_PUBLIC_API_URL` is necessarily visible in the browser bundle; it is an API address, not a secret. Do not put a signing key, database URL, or password in any `NEXT_PUBLIC_*` variable.

3. Deploy the Vercel project. Copy its canonical production origin and put that exact value in Render's `WEB_ORIGIN`. If you change the Vercel domain, update `WEB_ORIGIN` and redeploy/restart the API.
4. If you enabled Preview deployments, configure an exact matching `WEB_ORIGIN` for the preview and make sure the preview uses the same `API_ORIGIN`. The API intentionally rejects WebSocket origins that do not exactly match `WEB_ORIGIN`.

`output: "standalone"` remains enabled for the repository's container build. Vercel uses its Next.js framework integration and the app's workspace build command; do not set a static output directory.

## 5. Verify the demo

1. Open `https://<your-vercel-domain>/api/health`; it should return `{"status":"ok"}` through the same-origin rewrite.
2. Open the Vercel site. The login form should be prefilled with `demo@flowboard.dev` and `flowboard-demo-password`, and the seeded **Product Launch** board should appear.
3. Wait for the live indicator to show connected. Open the site in another browser context and move or create a card; both clients should see the update. This also verifies the short-lived WebSocket ticket flow.
4. Verify the Render service health directly at `https://<your-render-service>.onrender.com/health` if needed. The first request may take about 50 seconds after the free service has slept.

The repository README intentionally keeps its hosted demo link as “coming soon” until the owner has deployed and checked the service.
