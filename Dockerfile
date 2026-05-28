# Imagem dos serviços Node (api e mcp) — mesma imagem, comandos diferentes no compose.
# Debian slim (glibc) para o better-sqlite3 baixar o binário pré-compilado (sem toolchain).
FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# Instala só as deps de produção de todos os workspaces (pula vite/concurrently etc.).
COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci --omit=dev

# Código dos serviços Node.
COPY packages/api/src packages/api/src
COPY packages/mcp/src packages/mcp/src

# Pasta do banco SQLite (montada como volume no compose para persistir).
RUN mkdir -p packages/api/data

EXPOSE 8787 8788

# Default = API. O serviço mcp sobrescreve o command no docker-compose.
CMD ["node", "packages/api/src/index.js"]
