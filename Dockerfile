# syntax=docker/dockerfile:1
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so this layer is cached until package*.json changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# Run as the unprivileged "node" user that ships with the official image.
USER node

EXPOSE 3000
CMD ["node", "src/index.js"]
