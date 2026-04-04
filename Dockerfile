FROM node:22-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

# Install deps separately for caching
FROM base AS deps
RUN apk add --no-cache python3 make g++ git
COPY package*.json ./
RUN npm ci --unsafe-perm

# Build (skip tests)
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build:skip-tests

# Production deps only (prune from full install to avoid a second npm ci)
FROM deps AS prod-deps
RUN npm prune --omit=dev && npm cache clean --force

# Runtime
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
