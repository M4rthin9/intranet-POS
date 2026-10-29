FROM node:24-trixie-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl postgresql-client-17 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN npm run build
RUN cp -r public .next/standalone/public && cp -r .next/static .next/standalone/.next/static

FROM base AS runtime
# Include the existing backup worker and its tools alongside the standalone app.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /backups && chown node:node /backups
ENV NODE_ENV=production BACKUP_DIRECTORY=/backups
USER node
EXPOSE 10000
CMD ["node", "deploy/render/start.mjs"]
