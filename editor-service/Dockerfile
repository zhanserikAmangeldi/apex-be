FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init wget

RUN addgroup -g 1001 -S nodejs \
 && adduser -S nodejs -u 1001

COPY package*.json ./
RUN npm ci --only=production \
 && npm cache clean --force

COPY --from=builder /app/src ./src
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts ./scripts

RUN chmod +x ./scripts/start.sh

RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000 1234

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["./scripts/start.sh"]