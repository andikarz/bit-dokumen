# bit-dokumen Dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:24-alpine AS runtime
WORKDIR /app
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY db/ ./db/
COPY scripts/ ./scripts/
RUN mkdir -p /storage/permohonan && chown appuser:appgroup /storage/permohonan
USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
