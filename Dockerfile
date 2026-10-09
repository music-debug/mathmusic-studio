FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv ca-certificates curl tesseract-ocr-eng fonts-dejavu-core \
    libasound2t64 libx11-6 libxext6 libxi6 libxrender1 libxtst6 libgl1 \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fL --retry 3 -o /tmp/audiveris.deb \
    https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-ubuntu24.04-x86_64.deb \
    && echo 'f20113aaa33b3149ec8d6a09b2a7963360e65fafd92d69389987a85bbc3ec7a3  /tmp/audiveris.deb' | sha256sum -c - \
    && apt-get update && apt-get install -y --no-install-recommends /tmp/audiveris.deb \
    && rm /tmp/audiveris.deb && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    MATHMUSIC_AUDIVERIS=/app/run_audiveris.py \
    MATHMUSIC_HOSTED_OMR=1 \
    TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata \
    XDG_DATA_HOME=/tmp/studio-data \
    XDG_CONFIG_HOME=/tmp/studio-config \
    XDG_CACHE_HOME=/tmp/studio-cache \
    OMP_THREAD_LIMIT=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN chmod +x /app/run_audiveris.py && useradd --create-home --uid 10001 studio
USER studio
RUN /app/run_audiveris.py -help
EXPOSE 10000
CMD ["sh", "-c", "exec gunicorn cloud:application --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 4 --timeout 60"]
