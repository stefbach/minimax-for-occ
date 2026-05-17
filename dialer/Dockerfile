# Axon dialer worker — Node 20 slim
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# Required env at runtime:
#   SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
#   TWILIO_ACCOUNT_SID
#   TWILIO_AUTH_TOKEN
#   REDIS_URL
#   APP_URL   (public base url of the Next.js app, used for TwiML callbacks)
# Optional:
#   POLL_INTERVAL_MS (default 30000)
#   WORKER_CONCURRENCY (default 10)
CMD ["node", "dist/main.js"]
