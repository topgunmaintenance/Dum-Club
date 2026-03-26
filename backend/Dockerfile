FROM python:3.11-slim

WORKDIR /app

# System deps for Node.js token scripts
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    gnupg \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-prod.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && pip install --no-cache-dir -r requirements-prod.txt

# Copy backend code
COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
