# Agents Dockerfile
# Autonomous agent scheduler service

FROM node:20-slim

WORKDIR /app

# Install pnpm and tsx for TypeScript execution
RUN npm install -g pnpm tsx

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package files for dependency resolution
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/core packages/core
COPY packages/cli packages/cli
COPY brain brain
COPY etc etc
COPY persona persona

# Build TypeScript
RUN pnpm --filter @metahuman/core build && \
    pnpm --filter metahuman-cli build

# Create necessary directories
RUN mkdir -p /app/logs/run/agents /app/logs/run/locks

# Environment variables
ENV NODE_ENV=production
ENV METAHUMAN_ROOT=/app

# Run the agent scheduler
CMD ["tsx", "packages/core/src/agent-scheduler.ts"]
