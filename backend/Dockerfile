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

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
