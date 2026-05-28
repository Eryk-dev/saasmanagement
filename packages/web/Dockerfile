# Build do front (Vite) e serve estático via nginx, com proxy de /api e /mcp.
FROM node:20-bookworm-slim AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci
COPY packages/web packages/web
RUN npm run build -w packages/web

FROM nginx:1.27-alpine
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 80
