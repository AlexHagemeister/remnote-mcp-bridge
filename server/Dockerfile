# remnote mcp server dockerfile
# optimized for railway deployment

FROM node:20-slim AS builder

WORKDIR /app

# copy package files first for layer caching
COPY package*.json ./

# install all deps (incl devdeps for typescript)
RUN npm ci

# copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# production stage
FROM node:20-slim

WORKDIR /app

# copy package files and install prod deps only
COPY package*.json ./
RUN npm ci --only=production

# copy built output
COPY --from=builder /app/dist ./dist

# runtime config
ENV NODE_ENV=production

# railway sets PORT dynamically
EXPOSE ${PORT:-3002}

# start server
CMD ["node", "dist/index.js"]

