# Live-proxy image: serves the static app AND /api/mmr (DAX → Fabric semantic model).
# Build context = this app folder.  Build:  docker build -t mmr-analytics .
# Run:    docker run -p 8787:8787 --env-file server/.env mmr-analytics
FROM node:20-alpine
WORKDIR /app

# install proxy deps first (better layer caching)
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# copy the whole app (front-end + server); .dockerignore trims node_modules/.env
COPY . .

ENV PORT=8787
EXPOSE 8787
WORKDIR /app/server
CMD ["node", "index.js"]
