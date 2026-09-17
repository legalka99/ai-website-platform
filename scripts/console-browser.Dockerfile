# Optional local test fallback when Microsoft browser CDN is unavailable.
# Reuse the project's PostgreSQL base image; this image never hosts production services.
FROM postgres:17
RUN apt-get update -qq && apt-get install -y --no-install-recommends nodejs npm chromium ca-certificates fonts-liberation && rm -rf /var/lib/apt/lists/*
RUN npm install --global node@22.22.0 && node --version
RUN apt-get update -qq && apt-get install -y --no-install-recommends build-essential python3 && rm -rf /var/lib/apt/lists/*
