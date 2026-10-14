FROM node:24-trixie-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl postgresql-client-17 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM dependencies AS builder
COPY . .
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN npm run build

FROM dependencies AS tools
COPY . .
RUN mkdir -p /backups && chown node:node /backups
USER node
CMD ["npm","run","backup:worker"]

FROM base AS runner
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
RUN mkdir -p /backups && chown node:node /backups
USER node
EXPOSE 3000
CMD ["node","server.js"]
