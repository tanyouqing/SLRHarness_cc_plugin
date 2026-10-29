FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22.23.4-bookworm-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /uvx /usr/local/bin/
WORKDIR /app
ENV NODE_ENV=production
ARG DEBIAN_MIRROR=https://deb.debian.org
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g; s|https://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends python3 poppler-utils ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /data/mcp-home /data/mcp-cache /app/reports && chown -R node:node /data /app/reports
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY prompts ./prompts
COPY examples ./examples
COPY scripts/paper-text.py ./scripts/paper-text.py
USER node
CMD ["node", "dist/server.js"]
