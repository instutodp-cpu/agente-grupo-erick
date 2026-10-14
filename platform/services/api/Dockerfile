# Hermes Core — API (scaffold).
FROM node:20-alpine

WORKDIR /app

# Copy manifests first to keep dependency installation cacheable and deterministic.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY scripts/hermes-maintainer-staging-readiness-probe.js ./scripts/hermes-maintainer-staging-readiness-probe.js

ENV NODE_ENV=production
EXPOSE 8080

# Healthcheck simples usando o endpoint /health.
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.API_PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/index.js"]
