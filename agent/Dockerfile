FROM python:3.11-slim

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
