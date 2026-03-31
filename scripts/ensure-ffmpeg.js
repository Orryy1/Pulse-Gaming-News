// Ensures FFmpeg is available at runtime.
// On Railway (Debian/Ubuntu), installs via apt if missing.
const { execSync } = require('child_process');

try {
  execSync('ffmpeg -version', { stdio: 'pipe' });
  console.log('[startup] FFmpeg already installed');
} catch {
  console.log('[startup] FFmpeg not found — installing...');
  try {
    execSync('apt-get update -qq && apt-get install -y -qq ffmpeg fonts-dejavu-core fonts-liberation > /dev/null 2>&1', {
      stdio: 'inherit',
      timeout: 120000,
    });
    // Verify
    execSync('ffmpeg -version', { stdio: 'pipe' });
    console.log('[startup] FFmpeg installed successfully');
  } catch (err) {
    console.log('[startup] WARNING: Could not install FFmpeg — video assembly will fail');
    console.log('[startup] Error:', err.message);
    // Don't exit — server can still run (hunt, approve, etc.) without FFmpeg
  }
}
