const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');
const util = require('util');

const execAsync = util.promisify(exec);

dotenv.config({ override: true });

async function assemble() {
  console.log('[assemble] Loading daily_news.json...');

  if (!await fs.pathExists('daily_news.json')) {
    console.log('[assemble] ERROR: daily_news.json not found.');
    return;
  }

  const stories = await fs.readJson('daily_news.json');
  const toProcess = stories.filter(s =>
    s.approved === true &&
    s.audio_path &&
    s.image_path &&
    !s.exported_path
  );

  console.log(`[assemble] ${toProcess.length} stories ready for assembly`);

  let rendered = 0;
  let skipped = 0;

  for (const story of toProcess) {
    if (!await fs.pathExists(story.audio_path)) {
      console.log(`[assemble] WARNING: Audio missing for ${story.id}, skipping`);
      skipped++;
      continue;
    }
    if (!await fs.pathExists(story.image_path)) {
      console.log(`[assemble] WARNING: Image missing for ${story.id}, skipping`);
      skipped++;
      continue;
    }

    const outputPath = path.join('output', 'final', `${story.id}.mp4`);
    await fs.ensureDir(path.dirname(outputPath));

    // Escape text for FFmpeg drawtext filter
    const escapeFFmpeg = (text) => {
      return text
        .replace(/\\/g, '\\\\\\\\')
        .replace(/'/g, "'\\\\\\''")
        .replace(/:/g, '\\\\:')
        .replace(/%/g, '%%');
    };

    const hookText = escapeFFmpeg((story.hook || '').substring(0, 100));
    const titleText = escapeFFmpeg((story.suggested_thumbnail_text || '').substring(0, 60));

    const cmd = [
      'ffmpeg -y',
      `-loop 1 -i "${story.image_path}"`,
      `-i "${story.audio_path}"`,
      '-filter_complex',
      `"[0:v]scale=1080:1920,zoompan=z='min(zoom+0.0001,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,format=yuv420p,`,
      `drawtext=text='${titleText}':fontsize=44:fontcolor=#39FF14:x=(w-text_w)/2:y=80:borderw=2:bordercolor=black,`,
      `drawtext=text='${hookText}':fontsize=52:fontcolor=white:x=(w-text_w)/2:y=h-200:enable='lt(t,3)':box=1:boxcolor=black@0.6:boxborderw=10[outv]"`,
      `-map "[outv]" -map 1:a`,
      '-c:v libx264 -crf 23 -preset medium',
      '-c:a aac -b:a 192k',
      '-r 30 -shortest',
      `-movflags +faststart "${outputPath}"`,
    ].join(' ');

    console.log(`[assemble] Rendering: ${story.id}`);

    try {
      await execAsync(cmd, { timeout: 120000 });
      story.exported_path = outputPath;
      rendered++;
      console.log(`[assemble] Exported: ${outputPath}`);
    } catch (err) {
      console.log(`[assemble] ERROR rendering ${story.id}: ${err.message}`);
      skipped++;
    }
  }

  await fs.writeJson('daily_news.json', stories, { spaces: 2 });
  console.log(`[assemble] Summary: ${rendered} rendered, ${skipped} skipped`);
}

module.exports = assemble;

if (require.main === module) {
  assemble().catch(err => {
    console.log(`[assemble] ERROR: ${err.message}`);
    process.exit(1);
  });
}
