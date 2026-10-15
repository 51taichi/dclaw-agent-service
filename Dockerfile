# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node public ./public
COPY --chown=node:node src ./src

RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 4310

CMD ["node", "src/server.js"]
