FROM node:20-slim

# Install FFmpeg for video assembly + yt-dlp for B-roll fallback downloads
# (yt-dlp fetches short trailer clips from YouTube/IGDB when Steam has no trailer)
RUN apt-get update && apt-get install -y ffmpeg curl ca-certificates python3 && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy all source files
COPY . .

# Create output directories
RUN mkdir -p output/audio output/images output/final output/overlays

# Expose the approval page + API port
EXPOSE 3001

# Start the unified server (handles API, approval page, and cron scheduler).
# Must match package.json's `start` script and railway.json's startCommand —
# there is one canonical Node entrypoint and it is server.js. The retired
# cloud.js entrypoint was removed in Phase B of hardening/cutover. Do not
# reintroduce a second entrypoint here.
CMD ["node", "server.js"]
