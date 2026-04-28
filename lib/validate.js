const fs = require("fs-extra");

const PLATFORM_SIZE_LIMITS = {
  youtube: 128 * 1024 * 1024 * 1024, // 128 GB
  instagram: 1024 * 1024 * 1024, // 1 GB
  facebook: 4 * 1024 * 1024 * 1024, // 4 GB
  tiktok: 287 * 1024 * 1024, // 287 MB
  twitter: 512 * 1024 * 1024, // 512 MB
};

// Anything under this is almost certainly a render-failed placeholder
// rather than a real Short. ffmpeg sometimes writes a header-only
// container (~2-3 KB) when an input stream errors mid-encode; an empty
// MP4 (0 bytes) is the silent-fail case we want to catch loudly before
// the platform API rejects it with an opaque error message.
const MIN_VIDEO_BYTES = 16 * 1024; // 16 KB

async function validateVideo(filePath, platform) {
  if (!filePath || !(await fs.pathExists(filePath))) {
    throw new Error(`Video file not found: ${filePath}`);
  }
  const stats = await fs.stat(filePath);
  if (stats.size === 0) {
    throw new Error(`Video file is empty (0 bytes): ${filePath}`);
  }
  if (stats.size < MIN_VIDEO_BYTES) {
    throw new Error(
      `Video file is suspiciously small (${stats.size} bytes < ${MIN_VIDEO_BYTES}): ${filePath} — likely a render-failed placeholder`,
    );
  }
  const limit = PLATFORM_SIZE_LIMITS[platform];
  if (limit && stats.size > limit) {
    throw new Error(
      `Video too large for ${platform}: ${Math.round(stats.size / 1024 / 1024)}MB exceeds ${Math.round(limit / 1024 / 1024)}MB limit`,
    );
  }
  return stats.size;
}

module.exports = { validateVideo, PLATFORM_SIZE_LIMITS, MIN_VIDEO_BYTES };
