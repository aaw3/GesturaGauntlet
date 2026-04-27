FROM node:22-bookworm-slim

WORKDIR /app/Dashboard

COPY Dashboard/package*.json ./
RUN npm ci

COPY Dashboard ./
RUN npm run build

EXPOSE 3100

CMD ["npm", "start"]
