FROM python:3.11-slim

WORKDIR /app

# System deps + Node.js 20 for Solana token scripts
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    gnupg \
    build-essential \
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

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
