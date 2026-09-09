#!/bin/sh
set -e

# Setup directories
mkdir -p /run/clamav \
         /var/lib/clamav \
         /var/log/clamav \
         /var/log/supervisor \
         /storage/permohonan/quarantine \
         /storage/permohonan/active

# Ensure user and group memberships
addgroup -S appgroup 2>/dev/null || true
adduser -S -D -G appgroup appuser 2>/dev/null || true
addgroup -S clamav 2>/dev/null || true
adduser -S -D -G clamav clamav 2>/dev/null || true

# Cross-group permissions
addgroup appuser clamav 2>/dev/null || true
addgroup clamav appgroup 2>/dev/null || true

# Ownership and permissions
chown -R clamav:clamav /run/clamav /var/lib/clamav /var/log/clamav
chmod 777 /run/clamav
chown -R appuser:appgroup /storage/permohonan
chmod -R 777 /storage/permohonan

# Seed baseline ClamAV database if volume is empty so clamd can start immediately
if [ ! -f /var/lib/clamav/main.cvd ] && [ ! -f /var/lib/clamav/main.cld ] && [ ! -f /var/lib/clamav/local.ndb ]; then
  echo "[document-entrypoint] Seeding baseline ClamAV signatures into /var/lib/clamav/local.ndb..."
  echo "EICAR.Test.Signature:0:*:58354f2150254041505b345c505a58353428505e2937434329377d2445494341522d5354414e444152442d414e544956495255532d544553542d46494c452124482b482a" > /var/lib/clamav/local.ndb
  chown clamav:clamav /var/lib/clamav/local.ndb
  chmod 644 /var/lib/clamav/local.ndb
fi

# Copy configs if mounted or needed
if [ -f /app/config/clamd.conf ]; then
  mkdir -p /etc/clamav
  cp /app/config/clamd.conf /etc/clamav/clamd.conf
fi
if [ -f /app/config/freshclam.conf ]; then
  mkdir -p /etc/clamav
  cp /app/config/freshclam.conf /etc/clamav/freshclam.conf
fi
if [ -f /app/config/supervisord.conf ]; then
  mkdir -p /etc/supervisor
  cp /app/config/supervisord.conf /etc/supervisor/supervisord.conf
fi

echo "[document-entrypoint] Initializing Supervisor with ClamAV and Dokumen API..."
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
