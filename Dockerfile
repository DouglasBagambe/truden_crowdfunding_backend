FROM node:22-alpine AS base
WORKDIR /app

# Install deps separately for caching
FROM base AS deps
RUN apk add --no-cache python3 make g++ git
COPY package*.json ./
RUN npm ci --unsafe-perm

# Build
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Runtime
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3005
CMD ["node", "dist/main.js"]
