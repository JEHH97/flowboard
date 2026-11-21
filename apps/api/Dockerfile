FROM node:24.22.3-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run typecheck && npm run build --workspace @flowboard/api
RUN npm prune --omit=dev

FROM node:24.22.3-alpine3.24 AS runtime
ENV NODE_ENV=production PORT=4000 RUN_SEED=true
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/apps/api/package.json apps/api/package.json
COPY --from=build --chown=1000:1000 /app/apps/api/dist apps/api/dist
COPY --from=build --chown=1000:1000 /app/apps/api/migrations apps/api/migrations
COPY --from=build --chown=1000:1000 /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=1000:1000 /app/packages/shared/package.json packages/shared/package.json
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
LABEL org.opencontainers.image.source="https://github.com/JEHH97/flowboard" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="Flowboard API" \
      org.opencontainers.image.description="Flowboard REST and WebSocket API service"
USER 1000:1000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node apps/api/dist/migrate.js && if [ \"${RUN_SEED:-true}\" = \"true\" ]; then node apps/api/dist/seed.js; fi && node apps/api/dist/server.js"]
