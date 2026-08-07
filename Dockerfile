# OSCAR ARENA — production image.
# Multi-stage: build the React client, then run ONE Node process that serves
# both the built frontend and the Socket.IO engine on port 8080. No CDN, no
# serverless — a single always-on node is what a persistent WebSocket needs.
#
# NOTE: we use node:20-slim (Debian glibc) on purpose. better-sqlite3 is a
# native addon with prebuilt binaries for glibc; alpine uses musl and would
# force a from-source rebuild (needs python3/make/g++, fragile in CI).
#
# Build:        docker build -t oscar-arena .
# Run local:    docker run -p 8080:8080 -e ADMIN_PIN=000000 -v arena-data:/app/server/data oscar-arena

# ---------- Stage 1: build the client ----------
FROM node:20-slim AS build
WORKDIR /app
# npm workspaces: manifests first so layer caching works.
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci
COPY client ./client
RUN npm run build -w client

# ---------- Stage 2: runtime (server + built client) ----------
FROM node:20-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=./data/oscar-arena.db
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
RUN mkdir -p /app/server/data

VOLUME ["/app/server/data"]
EXPOSE 8080
CMD ["node", "server/src/index.js"]