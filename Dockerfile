# bit-dokumen Dockerfile (Node.js + clamd + freshclam + Supervisor)
# revisi.txt §6: ClamAV running inside document container via Unix domain socket

FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; else npm install --ignore-scripts; fi
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:24-alpine AS runtime
WORKDIR /app

# Install ClamAV, clamd daemon, freshclam signature updater, and supervisor
RUN apk add --no-cache \
    clamav \
    clamav-daemon \
    freshclam \
    supervisor \
    ca-certificates

# Setup user and groups
RUN addgroup -g 1001 appgroup && \
    adduser -u 1001 -G appgroup -s /bin/sh -D appuser && \
    addgroup appuser clamav 2>/dev/null || true

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; else npm install --omit=dev --ignore-scripts; fi && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY db/ ./db/
COPY scripts/ ./scripts/
COPY config/ ./config/

RUN chmod +x ./scripts/docker-entrypoint.sh

# Storage and ClamAV directories
RUN mkdir -p /run/clamav /var/lib/clamav /var/log/clamav /var/log/supervisor /storage/permohonan/quarantine /storage/permohonan/active && \
    chown -R clamav:clamav /run/clamav /var/lib/clamav /var/log/clamav && \
    chown -R appuser:appgroup /storage/permohonan && \
    chmod 777 /run/clamav /storage/permohonan

EXPOSE 3000

ENTRYPOINT ["/bin/sh", "scripts/docker-entrypoint.sh"]
