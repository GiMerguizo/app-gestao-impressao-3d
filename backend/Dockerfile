FROM node:22-alpine

ENV NODE_ENV=production TZ=America/Sao_Paulo
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src
COPY migrations ./migrations

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
