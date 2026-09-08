# bit-dokumen Dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; else npm install --ignore-scripts; fi
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:24-alpine AS runtime
WORKDIR /app
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; else npm install --omit=dev --ignore-scripts; fi && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY db/ ./db/
COPY scripts/ ./scripts/
RUN mkdir -p /storage/permohonan && chown -R appuser:appgroup /storage/permohonan
USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
