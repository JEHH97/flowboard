FROM node:24.22.3-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run typecheck && npm run build --workspace @flowboard/web

FROM node:24.22.3-alpine3.24 AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/apps/web/.next/standalone ./
COPY --from=build --chown=1000:1000 /app/apps/web/.next/static ./apps/web/.next/static
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
LABEL org.opencontainers.image.source="https://github.com/JEHH97/flowboard" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="Flowboard Web" \
      org.opencontainers.image.description="Runtime-configurable Flowboard web application"
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/runtime-config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
