FROM node:22-bookworm-slim

WORKDIR /app

COPY gestura-backend/runtime ./gestura-backend/runtime
COPY node-agent/package*.json ./node-agent/
WORKDIR /app/node-agent
RUN npm ci --omit=dev

COPY node-agent ./

EXPOSE 3201

CMD ["node", "src/index.js"]
