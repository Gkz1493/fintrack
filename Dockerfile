FROM node:20-slim
WORKDIR /app
# Install build tools needed for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY . .
# Remove postinstall so npm install won't try to cd into client
RUN node -e "const f='package.json';const p=JSON.parse(require('fs').readFileSync(f,'utf8'));delete p.scripts.postinstall;require('fs').writeFileSync(f,JSON.stringify(p,null,2))"
# Install server deps (with scripts enabled so better-sqlite3 compiles)
RUN npm install
# Build client
RUN cd client && npm install && npm run build
RUN mkdir -p /data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
