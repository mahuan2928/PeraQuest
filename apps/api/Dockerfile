# Deployment placeholder for the Node API. Configure DATABASE_URL and CORS_ORIGIN in the host.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY apps apps
COPY packages packages
RUN npm ci
RUN npm run build -w @peraquest/api
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
