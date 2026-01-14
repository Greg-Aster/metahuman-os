# Event Bus Server Dockerfile
# Aggregates events from all MetaHuman services for unified debugging

FROM node:20-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package files for dependency resolution
COPY packages/core/package.json packages/core/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @metahuman/core

# Copy source code
COPY packages/core/src packages/core/src
COPY packages/core/tsconfig.json packages/core/

# Build TypeScript
RUN pnpm --filter @metahuman/core build

# Expose WebSocket port
EXPOSE 3100

# Create logs directory
RUN mkdir -p /app/logs/events

# Run the event bus server
CMD ["node", "packages/core/dist/infrastructure/event-bus/server.js"]
