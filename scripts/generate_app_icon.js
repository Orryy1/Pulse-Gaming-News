const sharp = require('sharp');
const path = require('path');

async function generateIcon() {
  const size = 1024;
  const svg = `
  <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#1a1a2e"/>
        <stop offset="100%" style="stop-color:#0d0d1a"/>
      </linearGradient>
      <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#FF6B1A"/>
        <stop offset="100%" style="stop-color:#FF9500"/>
      </linearGradient>
    </defs>
    <!-- Background -->
    <rect width="${size}" height="${size}" rx="200" fill="url(#bg)"/>
    <!-- Pulse wave -->
    <path d="M 200 512 L 350 512 L 420 300 L 500 700 L 580 350 L 660 650 L 730 512 L 824 512"
          stroke="url(#accent)" stroke-width="48" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Text: PG -->
    <text x="512" y="860" font-family="Arial Black, Arial, sans-serif" font-size="180" font-weight="900"
          fill="#FF6B1A" text-anchor="middle" letter-spacing="20">PG</text>
  </svg>`;

  const outPath = path.join(__dirname, '..', 'output', 'pulse_gaming_icon.png');
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ quality: 95 })
    .toFile(outPath);

  console.log(`[icon] Generated ${outPath}`);
  return outPath;
}

generateIcon().catch(console.error);
