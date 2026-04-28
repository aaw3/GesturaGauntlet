FROM node:22-alpine

WORKDIR /app/kasa-manager

COPY kasa-manager/package*.json ./
RUN npm ci --omit=dev

COPY kasa-manager ./

CMD ["node", "src/index.js"]
