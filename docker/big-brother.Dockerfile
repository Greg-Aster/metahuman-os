# Big Brother Dockerfile
# Claude CLI integration for tool execution and reasoning

FROM node:20-slim

WORKDIR /app

# Install system dependencies including stdbuf for line buffering
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    coreutils \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

# Install Claude CLI (requires npm)
# Note: Claude CLI auth must be configured via volume mount
RUN npm install -g @anthropic-ai/claude-code

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package files for dependency resolution
COPY packages/core/package.json packages/core/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @metahuman/core

# Copy source code
COPY packages/core packages/core
COPY etc etc

# Build TypeScript
RUN pnpm --filter @metahuman/core build

# Create necessary directories
RUN mkdir -p /app/logs/run

# Environment variables
ENV NODE_ENV=production
ENV METAHUMAN_ROOT=/app

# Expose Big Brother WebSocket port
EXPOSE 3099

# Note: Claude authentication should be mounted from host:
# -v ~/.config/claude:/root/.config/claude

# The big-brother service is typically started by the core server
# but can be run standalone for testing
CMD ["node", "packages/core/dist/big-brother-terminal.js"]
