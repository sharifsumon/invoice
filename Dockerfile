# syntax=docker/dockerfile:1
# Invoice + CRM — production image. Build:  docker build -t invoice-crm .
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 STORAGE_DIR=/app/storage
# postgresql-client: lets scripts/backup.sh run inside the container if you choose to.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 1001 --home /app app && mkdir -p /app/storage && chown app /app/storage
COPY --from=build --chown=app /app/package.json /app/package-lock.json /app/prisma.config.ts /app/next.config.ts ./
COPY --from=build --chown=app /app/node_modules ./node_modules
COPY --from=build --chown=app /app/.next ./.next
COPY --from=build --chown=app /app/public ./public
COPY --from=build --chown=app /app/prisma ./prisma
COPY --from=build --chown=app /app/src/generated ./src/generated
COPY --from=build --chown=app /app/scripts ./scripts
USER app
EXPOSE 3000
VOLUME ["/app/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p ${PORT}"]
