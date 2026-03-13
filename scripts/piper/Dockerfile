FROM python:3.11-slim

RUN apt-get update && apt-get install -y wget ffmpeg && rm -rf /var/lib/apt/lists/*

RUN wget -q https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz \
    -O /tmp/piper.tar.gz \
    && tar -xzf /tmp/piper.tar.gz -C /usr/local/bin \
    && chmod +x /usr/local/bin/piper

VOLUME ["/voices"]

EXPOSE 5500

# Simple HTTP wrapper so frontend can call it directly if needed
RUN pip install --no-cache-dir flask

COPY server.py /server.py
CMD ["python", "/server.py"]
