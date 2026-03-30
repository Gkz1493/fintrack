FROM node:20-slim

WORKDIR /app

# Copy full source first (so client dir exists for postinstall)
COPY . .

# Install server deps (skip postinstall, we'll handle client manually)
RUN npm install --ignore-scripts

# Install client deps and build
RUN cd client && npm install && npm run build

# SQLite data dir
RUN mkdir -p /data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
