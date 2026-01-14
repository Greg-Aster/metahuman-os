# Core Backend Server Dockerfile
# Main MetaHuman backend service (API server)

FROM node:20-slim

WORKDIR /app

# Install pnpm and system dependencies
RUN npm install -g pnpm && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy all package.json files for dependency resolution
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/core packages/core
COPY packages/cli packages/cli
COPY etc etc
COPY persona persona

# Build TypeScript
RUN pnpm --filter @metahuman/core build && \
    pnpm --filter metahuman-cli build

# Create necessary directories
RUN mkdir -p /app/logs/audit /app/logs/run /app/profiles

# Environment variables
ENV NODE_ENV=production
ENV METAHUMAN_ROOT=/app

# Expose API port
EXPOSE 3000

# Run the core server
CMD ["node", "packages/core/dist/server.js"]
