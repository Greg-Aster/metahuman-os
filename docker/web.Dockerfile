# Web UI Dockerfile
# Astro + Svelte frontend for MetaHuman OS

FROM node:20-slim AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy all package.json files for dependency resolution
COPY packages/core/package.json packages/core/
COPY apps/site/package.json apps/site/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/core packages/core
COPY apps/site apps/site

# Build the core package first
RUN pnpm --filter @metahuman/core build

# Build the Astro site
RUN pnpm --filter @metahuman/site build

# Production stage
FROM node:20-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy built assets
COPY --from=builder /app/apps/site/dist /app/dist
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/site/node_modules /app/apps/site/node_modules
COPY --from=builder /app/apps/site/package.json /app/package.json

# Environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

# Expose web port
EXPOSE 4321

# Run the Astro server
CMD ["npx", "astro", "preview", "--host", "0.0.0.0"]
