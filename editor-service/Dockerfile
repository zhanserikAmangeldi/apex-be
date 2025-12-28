# ------------------------
# Build stage
# ------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .


# ------------------------
# Production stage
# ------------------------
FROM node:20-alpine

WORKDIR /app

# Install dumb-init + wget (for healthcheck)
RUN apk add --no-cache dumb-init wget

# Create non-root user
RUN addgroup -g 1001 -S nodejs \
 && adduser -S nodejs -u 1001

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production \
 && npm cache clean --force

# Copy source code and scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts ./scripts

# Make start script executable
RUN chmod +x ./scripts/start.sh

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose ports
EXPOSE 3000 1234

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run with dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["./scripts/start.sh"]
