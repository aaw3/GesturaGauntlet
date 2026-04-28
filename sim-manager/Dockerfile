FROM node:22-bookworm-slim

WORKDIR /app/sim-manager

COPY sim-manager/package*.json ./
RUN npm ci --omit=dev

COPY sim-manager/src/package*.json ./src/
RUN npm ci --prefix src --omit=dev

COPY sim-manager ./

EXPOSE 3102

CMD ["npx", "tsx", "src/app.ts"]
