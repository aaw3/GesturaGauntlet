FROM node:22-bookworm-slim

WORKDIR /app/gestura-backend

COPY gestura-backend/package*.json ./
RUN npm ci --omit=dev

COPY gestura-backend ./

EXPOSE 3001 1883

CMD ["node", "server.js"]
