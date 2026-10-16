# Pulse cloud factory: one container that discovers, writes, narrates,
# renders, checks and uploads. Railway builds this from the cloud/ directory.
FROM node:22-bookworm-slim

# ffmpeg for QA and loudness; the rest are Chrome Headless Shell's runtime deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates fonts-noto-color-emoji \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev \
      libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Bake the render browser into the image so nothing downloads at render time.
RUN npx remotion browser ensure

COPY tsconfig.json ./
COPY migrations ./migrations
COPY public ./public
COPY src ./src

ENV NODE_ENV=production DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "src/server.ts"]
