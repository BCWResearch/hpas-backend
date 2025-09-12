# ---- Base image (common) ----
ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Install system deps needed by Prisma & OpenSSL
RUN apk add --no-cache openssl

# ---- Dependencies (with dev deps for build) ----
FROM base AS deps
# Copy just package files first for better layer caching
COPY package*.json ./
# If you use pnpm or yarn, swap these lines accordingly
RUN npm ci

# Copy Prisma schema so we can generate the client
COPY prisma ./prisma
# Generate Prisma client (needs dev deps present)
RUN npx prisma generate

# ---- Builder (compile TypeScript) ----
FROM deps AS builder
# Copy the rest of the source to build
COPY tsconfig*.json ./
COPY src ./src
# If you have swagger/openapi generation steps, copy those too
# COPY openapi.yaml ./openapi.yaml

# Build to /app/dist
RUN npm run build

# ---- Prune to production deps only ----
FROM deps AS prod-deps
RUN npm prune --omit=dev

# ---- Runtime (smallest possible) ----
FROM base AS runner
# Use non-root user for security
RUN addgroup -g 1001 nodejs && adduser -D -u 1001 nodeuser
USER nodeuser

# Copy production node_modules and Prisma client
COPY --from=prod-deps /app/node_modules ./node_modules
# Copy built JS
COPY --from=builder /app/dist ./dist
# Keep prisma folder only if you run migrations at startup
COPY --from=builder /app/prisma ./prisma

# Cloud Run will inject PORT. Your app should read process.env.PORT.
# If your app is hard-coded (e.g., 3002), consider updating it to use PORT.
ENV PORT=8080
EXPOSE 8080

# Optional: run migrations on boot (comment out if you migrate elsewhere)
# Note: `npx` is available with npm; Prisma CLI was installed during build.
CMD [ "sh", "-c", "npx prisma migrate deploy && node dist/index.js" ]
