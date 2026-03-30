FROM node:20-slim

WORKDIR /app

# Server deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev 2>/dev/null || npm install

# Client deps + build
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install

COPY . .
RUN cd client && npm run build

# SQLite data dir
RUN mkdir -p /data

ENV NODE_ENV=production
ENV DB_DIR=/data
EXPOSE 3000

CMD ["node", "server.js"]
