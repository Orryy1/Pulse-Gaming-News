const fs = require('fs-extra');

const PLATFORM_SIZE_LIMITS = {
  youtube: 128 * 1024 * 1024 * 1024,   // 128 GB
  instagram: 1024 * 1024 * 1024,        // 1 GB
  facebook: 4 * 1024 * 1024 * 1024,     // 4 GB
  tiktok: 287 * 1024 * 1024,            // 287 MB
  twitter: 512 * 1024 * 1024,           // 512 MB
};

async function validateVideo(filePath, platform) {
  if (!filePath || !await fs.pathExists(filePath)) {
    throw new Error(`Video file not found: ${filePath}`);
  }
  const stats = await fs.stat(filePath);
  const limit = PLATFORM_SIZE_LIMITS[platform];
  if (limit && stats.size > limit) {
    throw new Error(
      `Video too large for ${platform}: ${Math.round(stats.size / 1024 / 1024)}MB exceeds ${Math.round(limit / 1024 / 1024)}MB limit`
    );
  }
  return stats.size;
}

module.exports = { validateVideo, PLATFORM_SIZE_LIMITS };
