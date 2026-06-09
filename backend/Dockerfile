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

# Worker count is env-tunable via WEB_CONCURRENCY without a Dockerfile
# redeploy — owner can bump from 2 to 4+ in the Railway dashboard once
# the plan tier is confirmed safe for the higher memory footprint. The
# default 2 doubles concurrent request capacity over the prior --workers 1
# (~50 -> ~100 concurrent) while staying safe on any Railway plan tier.
# The inner `exec` is critical: it replaces the shell process with
# uvicorn so uvicorn becomes PID 1 and Railway's SIGTERM forwards
# cleanly on deploys. Without `exec`, sh stays PID 1 and uvicorn is a
# child — graceful shutdown breaks. JSON-array form wraps the shell so
# Docker still records the CMD as exec-form for image inspection.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2} --proxy-headers --forwarded-allow-ips '*'"]
