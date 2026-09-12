FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts/ops/ensure-prisma-client-link.mjs ./scripts/ops/ensure-prisma-client-link.mjs
RUN npm ci --include=dev
COPY src ./src
COPY infra/self-host/v1/tsconfig.build.json ./tsconfig.build.json
RUN npx prisma generate && node --max-old-space-size=1536 node_modules/typescript/bin/tsc -p tsconfig.build.json
COPY apps/beta-web/package.json apps/beta-web/package-lock.json ./apps/beta-web/
RUN npm --prefix apps/beta-web ci --include=dev
COPY apps/beta-web/src ./apps/beta-web/src
COPY apps/beta-web/index.html apps/beta-web/vite.config.ts apps/beta-web/tsconfig.json apps/beta-web/tsconfig.app.json apps/beta-web/tailwind.config.ts apps/beta-web/postcss.config.js ./apps/beta-web/
RUN npm --prefix apps/beta-web run build

FROM build AS migrations
COPY infra/self-host/v1/entry.mjs ./self-host-entry.mjs
ENTRYPOINT ["node","/app/self-host-entry.mjs"]
CMD ["migrate"]

FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
RUN npm prune --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/apps/beta-web/dist ./apps/beta-web/dist
COPY apps/beta-web/server.mjs apps/beta-web/proxy.mjs ./apps/beta-web/
COPY infra/self-host/v1/entry.mjs ./self-host-entry.mjs
COPY infra/self-host/v1/bootstrap.mjs ./self-host-bootstrap.mjs
USER node
ENV NODE_ENV=production
ENTRYPOINT ["node","/app/self-host-entry.mjs"]
CMD ["api"]
