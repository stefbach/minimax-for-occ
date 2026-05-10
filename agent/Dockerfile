FROM python:3.11-slim

# Build label that bumps every time we need to bust LiveKit Cloud's image cache.
# Increment this when a `lk agent update` skips the rebuild.
LABEL build_id="2026-05-10-voice-studio-v1"

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY *.py ./

# Pre-download Silero VAD + turn-detector weights so the first cold-start is fast.
RUN python agent.py download-files

CMD ["python", "agent.py", "start"]
