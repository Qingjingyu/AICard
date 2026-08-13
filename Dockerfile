FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home-dir /app aicard
COPY --from=builder --chown=aicard:nodejs /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=aicard:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=aicard:nodejs /app/.next ./.next
COPY --from=builder --chown=aicard:nodejs /app/infra ./infra
COPY --from=builder --chown=aicard:nodejs /app/scripts ./scripts
COPY --from=builder --chown=aicard:nodejs /app/src ./src
COPY --from=builder --chown=aicard:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=aicard:nodejs /app/next.config.ts ./next.config.ts
USER aicard
EXPOSE 3000
CMD ["npm", "run", "start"]
