FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TILE_CACHE_DIR=/tmp/tiles \
    TRUSTED_PROXY_HOPS=1 \
    ENABLE_HSTS=1

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY data ./data
COPY run.py .

# Run as an unprivileged user.
RUN useradd --system --no-create-home appuser && mkdir -p /tmp/tiles && chown appuser /tmp/tiles
USER appuser

# Cloud Run sets $PORT. One process with threads shares the in-memory rate limiter and DEM.
CMD exec gunicorn --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 8 --timeout 120 run:app
