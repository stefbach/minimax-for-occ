# Axon dialer worker — Node 20 slim
# Build context = repo root. Sources live in dialer/.
FROM node:20-slim AS build
WORKDIR /app
COPY dialer/package.json dialer/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY dialer/tsconfig.json ./
COPY dialer/src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY dialer/package.json dialer/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
CMD ["node", "dist/main.js"]
