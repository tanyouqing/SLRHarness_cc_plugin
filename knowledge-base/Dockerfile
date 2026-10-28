FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22.23.4-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /data /app/reports && chown -R node:node /data /app/reports
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY prompts ./prompts
COPY examples ./examples
USER node
CMD ["node", "dist/server.js"]
