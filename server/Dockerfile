FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine

RUN apk add --no-cache sqlite-libs curl

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package.json server.js ./
COPY public ./public

EXPOSE 3456

ENV PORT=3456
ENV NODE_ENV=production

CMD ["node", "server.js"]