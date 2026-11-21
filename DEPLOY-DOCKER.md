# Docker deployment

Flowboard publishes two prebuilt images to GitHub Container Registry (GHCR):

- `ghcr.io/jehh97/flowboard-api`
- `ghcr.io/jehh97/flowboard-web`

The API and web images are built for `linux/amd64`. A release tag such as
`v1.0.1` publishes
the version tag and `sha-<short-commit>`; manual workflow runs publish only the
commit tag. There is no floating `latest` tag. The workflow scans each local
image for vulnerabilities and secrets before publishing: fixable CRITICAL
findings block release, and HIGH findings are reported. Pin both services to the
same release with `FLOWBOARD_VERSION` (default `v1.0.1`) for reproducible
upgrades. No secrets are included in image layers, build
arguments, or the published image configuration; credentials are supplied only
when the containers start.

PostgreSQL is built locally from the pinned `postgres:17.12-alpine3.24` base.
The small derivative applies available Alpine security patches and omits the
unused `gosu` binary (the service runs as the `postgres` UID).

## Start with Compose

Install Docker Engine and the Compose plugin. Copy the example environment file
and edit every placeholder before starting the stack:

```sh
cp deploy/.env.example deploy/.env
openssl rand -hex 32 # use separate output for JWT_SECRET and REFRESH_TOKEN_SECRET
openssl rand -hex 32 # suitable for POSTGRES_PASSWORD as well
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml pull api web
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml build postgres
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml up -d --wait
```

Use the first generated random value for `JWT_SECRET`, a different one for
`REFRESH_TOKEN_SECRET`, and a separate one for `POSTGRES_PASSWORD`. Hex output
is URL-safe for the generated PostgreSQL connection string. Replace
`DEMO_PASSWORD` with a strong value for a shared deployment. `RUN_SEED=true` is
the default and creates/synchronizes the demo user and sample board at API
startup; set `RUN_SEED=false` to skip demo seeding. Database migrations still
run on startup in either case.

If the GHCR packages are private, authenticate before pulling. Create a GitHub
PAT with `read:packages` access and enter it interactively (do not put it in a
shell command or checked-in file):

```sh
docker login ghcr.io -u YOUR_GITHUB_USERNAME
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml pull api web
```

`deploy/.env.example` lists all supported settings:

| Variable                                            | Purpose                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `FLOWBOARD_VERSION`                                 | Shared API/web image tag; defaults to `v1.0.1`.                                                                                          |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | PostgreSQL account and database; database data persists in a named volume.                                                               |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET`                | Independent API signing keys.                                                                                                            |
| `WEB_ORIGIN`                                        | Exact public web origin including scheme, with no trailing slash; used for CORS and WebSocket origin checks.                             |
| `API_ORIGIN`                                        | Container-internal API address used by the web server-side `/api/*` proxy; normally `http://api:4000`.                                   |
| `WS_PUBLIC_URL`                                     | Public API origin reachable by browsers for WebSockets, e.g. `https://api.example.com`; the browser upgrades HTTPS to WSS automatically. |
| `DEMO_PASSWORD`                                     | Seeded demo account password.                                                                                                            |
| `RUN_SEED`                                          | `true` (default) runs the demo seed; set `false` to disable it.                                                                          |
| `BIND_ADDRESS`                                      | Host address for web and API ports; defaults to loopback `127.0.0.1` so the reverse proxy can publish them.                              |
| `WEB_PORT`, `API_PORT`                              | Host ports published for web and the API/WebSocket upstream; default to `3000` and `4000`.                                               |

`DATABASE_URL` is composed for the API from the `POSTGRES_*` settings. It is not
necessary to configure it separately. The `web` image reads `API_ORIGIN` and
`WS_PUBLIC_URL` at runtime; neither requires rebuilding the image. `API_ORIGIN`
must be the internal Compose service address, not the public browser URL.

## Domains, TLS, and WebSockets

The Compose stack publishes only the web and API ports on `127.0.0.1` by
default; PostgreSQL is private on the internal `flowboard` network and has no
published port. Web and API also join a private bridge for host-port forwarding.
Put a TLS reverse proxy in front of the web and API
containers. Configure `WEB_ORIGIN` to the exact browser origin, such as
`https://flowboard.example.com`, and set `WS_PUBLIC_URL` to the externally
reachable API origin. The API requires the WebSocket `Origin` to match
`WEB_ORIGIN` exactly. REST calls and auth cookies travel through the web
container's same-origin `/api/*` proxy, so the browser's auth cookies remain
first-party. The API port is bound to loopback for the WebSocket connection, so
only a local reverse proxy can reach it by default. Set `BIND_ADDRESS` only if a
different host binding is deliberately required.

Example Caddy configuration when both services are reachable on localhost:

```caddyfile
flowboard.example.com {
    reverse_proxy 127.0.0.1:3000
}

api.example.com {
    reverse_proxy 127.0.0.1:4000
}
```

Caddy automatically handles WebSocket upgrades. With nginx, route the API host
to port 4000 and forward the upgrade headers, for example:

```nginx
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

For a local HTTP-only test, set `WEB_ORIGIN=http://localhost:3000` and
`WS_PUBLIC_URL=http://localhost:4000`; do not use `wss://` without TLS. In
production behind TLS, use `https://` in `WS_PUBLIC_URL` (the runtime client
will connect using `wss://`).

## Ports, health, and startup

- Web: container port `3000`, published on loopback as `WEB_PORT`; its health check requests
  `/api/runtime-config`.
- API: container port `4000`, published on loopback as `API_PORT`; health is `/health`.
- PostgreSQL: container port `5432`, never published to the host by this file.
- All containers run read-only with dropped Linux capabilities and
  no-new-privileges; writable temporary paths use bounded tmpfs mounts. Memory
  and PID limits are set per service.
- Startup ordering: Compose waits for PostgreSQL health, then the API applies
  migrations and (unless disabled) seeds data before it becomes healthy; the
  web service starts after the API health check passes.
- Data: PostgreSQL lives in the persistent `flowboard-postgres` volume. Back it
  up before removing volumes or changing database versions.

Check the running services and endpoints:

```sh
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml ps
curl -fsS https://flowboard.example.com/api/health
curl -fsS https://api.example.com/health
curl -fsS https://flowboard.example.com/api/runtime-config
```

The runtime-config response contains only the public WebSocket API address, not
credentials. Sign in with the configured demo account, load the seeded board,
and confirm that the live indicator connects. A successful `/api/health`
request verifies the same-origin API proxy and the API health request verifies
the API service itself.

To upgrade, change `FLOWBOARD_VERSION` to a published tag, then run `pull api
web` and `up -d --build --wait`. For rollback, select the previous version and
repeat those commands.
Container logs are available with `docker compose ... logs -f web api`.
