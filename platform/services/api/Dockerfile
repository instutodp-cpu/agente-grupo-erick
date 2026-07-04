# Hermes Core — API (scaffold). Sem dependências npm ainda: imagem enxuta.
FROM node:20-alpine

WORKDIR /app

# Copia manifesto primeiro (cache de camada). Sem deps → sem npm install.
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 8080

# Healthcheck simples usando o endpoint /health.
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.API_PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/index.js"]
