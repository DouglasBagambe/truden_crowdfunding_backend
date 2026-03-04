# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first for better layer caching
COPY package*.json ./

# Install ALL deps (including devDeps needed for build)
RUN npm ci

# Copy source
COPY . .

# Build without running tests (Render handles that separately if needed)
RUN npm run build:skip-tests

# ── Stage 2: Production image ──────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Copy manifests
COPY package*.json ./

# Install ONLY production deps
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Expose the port NestJS listens on
EXPOSE 3000

# Start
CMD ["node", "dist/main"]
