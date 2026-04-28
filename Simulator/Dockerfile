FROM node:22-bookworm-slim

WORKDIR /app/Simulator

COPY Simulator/package*.json ./
RUN npm ci

COPY Simulator ./
RUN npm run build

EXPOSE 3101

CMD ["npm", "start"]
