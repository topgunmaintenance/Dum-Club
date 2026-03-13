FROM python:3.11-slim

WORKDIR /app

# System deps for audio + Piper
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    wget \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Piper TTS binary
RUN wget -q https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz \
    -O /tmp/piper.tar.gz \
    && tar -xzf /tmp/piper.tar.gz -C /usr/local/bin \
    && chmod +x /usr/local/bin/piper \
    && rm /tmp/piper.tar.gz

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
