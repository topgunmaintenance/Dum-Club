FROM python:3.11-slim

WORKDIR /app

# System deps + Node.js 20 for Solana token scripts + ffmpeg for live relay
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    gnupg \
    build-essential \
    ffmpeg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements-prod.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && pip install --no-cache-dir -r requirements-prod.txt

# Copy backend code
COPY . .

# Install Node.js dependencies for Solana SPL token minting
# package.json and scripts/ must exist in backend/ (copied via CI or manually)
RUN if [ -f package.json ]; then npm install --production; else echo "[docker] No package.json — Solana minting will use DB fallback"; fi

# Smoke test: import the app at BUILD time so any import-time error
# (undefined name, bad import) fails the build instead of crash-looping
# the container on Railway. Placeholder env vars are supplied so this
# tests import only, never configuration — get_client() and friends are
# lazy and don't connect at import. See scripts/smoke_import.py.
RUN SUPABASE_URL="http://localhost" SUPABASE_ANON_KEY="x" SUPABASE_SERVICE_KEY="x" \
    python scripts/smoke_import.py

# ── WORKER COUNT MUST STAY 1 (until realtime moves off process memory) ──
# The live-chat relay, viewer counts, auction timers, host bans, and the
# order-paid broadcast (auction_ws._connections and friends) live in EACH
# WORKER'S OWN MEMORY. With 2+ workers, the host's WebSocket lands on one
# process and a viewer's on another — the host never sees viewer chat,
# counts drift, and webhook pushes reach only one worker's sockets. This
# bit founding merchant #1 live on air (2026-07-02): viewers were chatting
# and the host's feed stayed empty.
#
# Do NOT raise this for capacity until the realtime layer moves to a
# shared bus (Redis pub/sub or Supabase Realtime). Async uvicorn on one
# worker comfortably handles the current IO-bound load.
#
# The inner `exec` is critical: it replaces the shell process with
# uvicorn so uvicorn becomes PID 1 and Railway's SIGTERM forwards
# cleanly on deploys. Without `exec`, sh stays PID 1 and uvicorn is a
# child — graceful shutdown breaks. JSON-array form wraps the shell so
# Docker still records the CMD as exec-form for image inspection.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-1} --proxy-headers --forwarded-allow-ips '*'"]
