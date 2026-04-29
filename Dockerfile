FROM node:22-slim

# Install FFmpeg, yt-dlp (B-roll fallback), and the headless-Chrome
# shared libraries HyperFrames needs to render HF thumbnails server-side.
# Without these, hyperframes' bundled chrome-headless-shell fails with
# `libnss3.so: cannot open shared object file` on every produce, which
# is what killed HF thumbnails 0% live in production after the f1a9e6b
# wiring landed (see PULSE_DEFENSIVE_PRODUCTION_PASS.md §C).
RUN apt-get update && apt-get install -y \
      ffmpeg curl ca-certificates python3 \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libasound2 \
      fonts-liberation && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json* ./
RUN npm install

# Copy all source files
COPY . .

# Build the Vite dashboard inside the deployment image. Railway uses this
# Dockerfile path, so railway.json's buildCommand is not the build authority.
RUN npm run build && npm prune --omit=dev

# Create output directories
RUN mkdir -p output/audio output/images output/final output/overlays

# Expose the approval page + API port
EXPOSE 3001

# Start the unified server (handles API, approval page and cron scheduler).
# Must match package.json's `start` script and railway.json's startCommand.
# There is one canonical Node entrypoint and it is server.js. The retired
# cloud.js entrypoint was removed in Phase B of hardening/cutover. Do not
# reintroduce a second entrypoint here.
CMD ["node", "server.js"]
