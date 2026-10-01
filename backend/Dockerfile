# Build context: repository root (npm workspaces share one lockfile).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w backend --include-workspace-root
COPY backend backend
RUN npm run build -w backend \
 && cp -r backend/src/db/migrations backend/dist/db/migrations

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w backend --include-workspace-root --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
# Migrations are a separate one-off task in prod: node backend/dist/db/migrate.js
CMD ["node", "backend/dist/server.js"]
