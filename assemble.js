const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');
const util = require('util');

const execAsync = util.promisify(exec);

dotenv.config({ override: true });

// --- Get audio duration via ffprobe ---
async function getAudioDuration(audioPath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`,
      { timeout: 10000 }
    );
    return parseFloat(stdout.trim()) || 50;
  } catch (err) {
    return 50; // default 50s for a Short
  }
}

// --- Build a multi-image video with Ken Burns, lower thirds and transitions ---
function buildMultiImageCommand(story, images, audioPath, outputPath, duration) {
  // If we only have the thumbnail image, use enhanced single-image mode
  if (images.length <= 1) {
    return buildSingleImageCommand(story, images[0] || story.image_path, audioPath, outputPath);
  }

  // Calculate time per image segment
  const segmentDuration = Math.max(3, Math.floor(duration / images.length));
  const inputs = [];
  const filterParts = [];

  // Input: all images + audio
  for (let i = 0; i < images.length; i++) {
    inputs.push(`-loop 1 -t ${segmentDuration} -i "${images[i]}"`);
  }
  inputs.push(`-i "${audioPath}"`);

  const audioIdx = images.length;

  // Build filter for each image: scale + Ken Burns (alternating zoom directions)
  for (let i = 0; i < images.length; i++) {
    const zoomIn = i % 2 === 0;
    const zoomExpr = zoomIn
      ? `z='min(zoom+0.0008,1.15)'`   // slow zoom in
      : `z='if(eq(on,1),1.15,max(zoom-0.0008,1.0))'`; // slow zoom out

    const xPan = i % 3 === 0 ? `x='iw/2-(iw/zoom/2)'` :
                 i % 3 === 1 ? `x='(iw-iw/zoom)*on/${segmentDuration * 30}'` :
                               `x='(iw-iw/zoom)*(1-on/${segmentDuration * 30})'`;

    filterParts.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920,` +
      `zoompan=${zoomExpr}:${xPan}:y='ih/2-(ih/zoom/2)':` +
      `d=${segmentDuration * 30}:s=1080x1920:fps=30,` +
      `format=yuv420p[v${i}]`
    );
  }

  // Concatenate all segments
  const concatInputs = images.map((_, i) => `[v${i}]`).join('');
  filterParts.push(`${concatInputs}concat=n=${images.length}:v=1:a=0[base]`);

  // Add text overlays
  const escapeFFmpeg = (text) => {
    return (text || '')
      .replace(/\\/g, '\\\\\\\\')
      .replace(/'/g, "'\\\\\\''")
      .replace(/:/g, '\\\\:')
      .replace(/%/g, '%%');
  };

  const hookText = escapeFFmpeg((story.hook || '').substring(0, 100));
  const titleText = escapeFFmpeg((story.suggested_thumbnail_text || '').substring(0, 50));
  const flairText = escapeFFmpeg((story.flair || 'NEWS').toUpperCase());
  const brandText = escapeFFmpeg('PULSE GAMING');

  // Lower third overlay + hook text + brand watermark
  filterParts.push(
    `[base]` +
    // Dark gradient at bottom for lower third
    `drawbox=x=0:y=ih-280:w=iw:h=280:color=black@0.65:t=fill,` +
    // Neon accent line
    `drawbox=x=0:y=ih-280:w=iw:h=3:color=0x39FF14@0.8:t=fill,` +
    // Breaking flair badge (top left)
    `drawbox=x=30:y=30:w=220:h=44:color=0x39FF14@0.2:t=fill,` +
    `drawtext=text='${flairText}':fontsize=20:fontcolor=0x39FF14:` +
    `x=70:y=42:borderw=1:bordercolor=black,` +
    // Live indicator
    `drawtext=text='\\\\u25CF':fontsize=16:fontcolor=0xff0033:x=40:y=42,` +
    // Title text (bottom third, large)
    `drawtext=text='${titleText}':fontsize=56:fontcolor=white:` +
    `x=(w-text_w)/2:y=h-220:borderw=3:bordercolor=black,` +
    // Hook text (first 4 seconds, mid-screen attention grabber)
    `drawtext=text='${hookText}':fontsize=48:fontcolor=white:` +
    `x=(w-text_w)/2:y=h-150:enable='lt(t,4)':` +
    `box=1:boxcolor=black@0.5:boxborderw=12,` +
    // Brand watermark (bottom right, subtle)
    `drawtext=text='${brandText}':fontsize=18:fontcolor=0x39FF14@0.5:` +
    `x=w-text_w-30:y=h-40:borderw=1:bordercolor=black@0.3` +
    `[outv]`
  );

  const filter = filterParts.join(';\n');

  return [
    'ffmpeg -y',
    inputs.join(' '),
    '-filter_complex',
    `"${filter}"`,
    `-map "[outv]" -map ${audioIdx}:a`,
    '-c:v libx264 -crf 21 -preset medium -tune stillimage',
    '-c:a aac -b:a 192k',
    '-r 30 -shortest',
    `-movflags +faststart "${outputPath}"`,
  ].join(' ');
}

// --- Single image fallback (enhanced version of original) ---
function buildSingleImageCommand(story, imagePath, audioPath, outputPath) {
  const escapeFFmpeg = (text) => {
    return (text || '')
      .replace(/\\/g, '\\\\\\\\')
      .replace(/'/g, "'\\\\\\''")
      .replace(/:/g, '\\\\:')
      .replace(/%/g, '%%');
  };

  const hookText = escapeFFmpeg((story.hook || '').substring(0, 100));
  const titleText = escapeFFmpeg((story.suggested_thumbnail_text || '').substring(0, 50));
  const flairText = escapeFFmpeg((story.flair || 'NEWS').toUpperCase());
  const brandText = escapeFFmpeg('PULSE GAMING');

  return [
    'ffmpeg -y',
    `-loop 1 -i "${imagePath}"`,
    `-i "${audioPath}"`,
    '-filter_complex',
    `"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
    `zoompan=z='min(zoom+0.0005,1.1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
    `d=1:s=1080x1920:fps=30,format=yuv420p,` +
    // Lower third
    `drawbox=x=0:y=ih-280:w=iw:h=280:color=black@0.65:t=fill,` +
    `drawbox=x=0:y=ih-280:w=iw:h=3:color=0x39FF14@0.8:t=fill,` +
    // Flair badge
    `drawbox=x=30:y=30:w=220:h=44:color=0x39FF14@0.2:t=fill,` +
    `drawtext=text='${flairText}':fontsize=20:fontcolor=0x39FF14:` +
    `x=70:y=42:borderw=1:bordercolor=black,` +
    // Title
    `drawtext=text='${titleText}':fontsize=56:fontcolor=white:` +
    `x=(w-text_w)/2:y=h-220:borderw=3:bordercolor=black,` +
    // Hook
    `drawtext=text='${hookText}':fontsize=48:fontcolor=white:` +
    `x=(w-text_w)/2:y=h-150:enable='lt(t,4)':` +
    `box=1:boxcolor=black@0.5:boxborderw=12,` +
    // Brand
    `drawtext=text='${brandText}':fontsize=18:fontcolor=0x39FF14@0.5:` +
    `x=w-text_w-30:y=h-40:borderw=1:bordercolor=black@0.3` +
    `[outv]"`,
    `-map "[outv]" -map 1:a`,
    '-c:v libx264 -crf 21 -preset medium',
    '-c:a aac -b:a 192k',
    '-r 30 -shortest',
    `-movflags +faststart "${outputPath}"`,
  ].join(' ');
}

async function assemble() {
  console.log('[assemble] === Professional Video Assembly v2 ===');

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

    // Get audio duration for segment timing
    const duration = await getAudioDuration(story.audio_path);

    // Collect all available images for this story
    const allImages = [];

    // Main thumbnail image always first
    allImages.push(story.image_path);

    // Add downloaded real images (article heroes, game art, screenshots)
    if (story.downloaded_images && story.downloaded_images.length > 0) {
      for (const img of story.downloaded_images) {
        if (img.path && await fs.pathExists(img.path) && img.type !== 'company_logo') {
          allImages.push(img.path);
        }
      }
    }

    // Remove duplicates
    const uniqueImages = [...new Set(allImages)].slice(0, 6);

    console.log(`[assemble] Rendering ${story.id} with ${uniqueImages.length} images (${Math.round(duration)}s)`);

    const cmd = buildMultiImageCommand(story, uniqueImages, story.audio_path, outputPath, duration);

    try {
      await execAsync(cmd, { timeout: 180000 });
      story.exported_path = outputPath;
      rendered++;

      const stat = await fs.stat(outputPath);
      console.log(`[assemble] Exported: ${outputPath} (${Math.round(stat.size / 1024 / 1024)}MB)`);
    } catch (err) {
      console.log(`[assemble] Multi-image failed for ${story.id}, trying single image...`);

      // Fallback to single image
      try {
        const fallbackCmd = buildSingleImageCommand(story, story.image_path, story.audio_path, outputPath);
        await execAsync(fallbackCmd, { timeout: 120000 });
        story.exported_path = outputPath;
        rendered++;
        console.log(`[assemble] Exported (single-image fallback): ${outputPath}`);
      } catch (err2) {
        console.log(`[assemble] ERROR rendering ${story.id}: ${err2.message}`);
        skipped++;
      }
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
