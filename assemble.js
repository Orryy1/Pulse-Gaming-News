const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');
const util = require('util');

const execAsync = util.promisify(exec);

dotenv.config({ override: true });

const brand = require('./brand');

// --- Get audio duration via ffprobe ---
async function getAudioDuration(audioPath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`,
      { timeout: 10000 }
    );
    return parseFloat(stdout.trim()) || 50;
  } catch (err) {
    return 50;
  }
}

// --- Split script into TikTok-style caption phrases (2-4 words each) ---
function splitIntoPhrases(script) {
  if (!script) return [];
  const words = script.split(/\s+/).filter(w => w.length > 0);
  const phrases = [];
  let i = 0;
  while (i < words.length) {
    const chunkSize = words[i].length > 8 ? 2 : (words[i].length > 5 ? 3 : 4);
    const phrase = words.slice(i, i + chunkSize).join(' ');
    phrases.push(phrase);
    i += chunkSize;
  }
  return phrases;
}

// --- Format seconds to ASS timestamp (H:MM:SS.cc) ---
function assTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

// --- Generate ASS subtitle file with TikTok-style captions ---
async function generateSubtitles(story, duration, outputDir) {
  const phrases = splitIntoPhrases(story.full_script || story.hook || '');
  if (phrases.length === 0) return null;

  const phraseTime = duration / phrases.length;

  const events = phrases.map((phrase, i) => {
    const start = assTime(i * phraseTime);
    const end = assTime((i + 1) * phraseTime);
    // Clean text for ASS format
    const clean = phrase.replace(/\\/g, '').replace(/\{/g, '').replace(/\}/g, '');
    return `Dialogue: 0,${start},${end},Caption,,0,0,0,,${clean}`;
  }).join('\n');

  const ass = `[Script Info]
Title: Pulse Gaming Captions
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,72,&H00F0F0F0,&H001A6BFF,&H00000000,&HB40D0D0F,-1,0,0,0,100,100,0,0,3,4,0,5,60,60,460,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;

  const assPath = path.join(outputDir, `${story.id}.ass`);
  await fs.writeFile(assPath, ass);
  return assPath;
}

// --- Sanitize text for FFmpeg drawtext ---
function sanitizeDrawtext(text, maxLen) {
  if (!text) return '';
  let clean = text
    .replace(/'/g, '')
    .replace(/\\/g, '')
    .replace(/;/g, '')
    .replace(/:/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
  if (maxLen && clean.length > maxLen) {
    clean = clean.substring(0, maxLen - 3) + '...';
  }
  return clean;
}

// --- Classification badge colour ---
function getFlairColor(classification) {
  return brand.classificationColour(classification).ffm;
}

// --- Build filter graph and command with broadcast overlays ---
function buildVideoCommand(story, images, audioPath, assPath, filterScriptPath, outputPath, duration) {
  const inputs = [];
  const fontOpt = process.platform === 'win32' ? "font='Arial'" : "font='DejaVu Sans'";
  const segmentDuration = Math.max(4, Math.floor(duration / images.length));

  // --- Inputs: background images ---
  for (let i = 0; i < images.length; i++) {
    inputs.push(`-loop 1 -t ${segmentDuration} -i "${images[i].replace(/\\/g, '/')}"`);
  }

  // PIP flash images (reuse 1-2 non-primary images as floating cards)
  const pipImages = images.length >= 3 ? [images[1], images[2]] :
                    images.length === 2 ? [images[1]] : [];
  const pipStartIdx = images.length;
  for (const img of pipImages) {
    inputs.push(`-loop 1 -t 4 -i "${img.replace(/\\/g, '/')}"`);
  }

  // Audio (last input)
  const audioIdx = images.length + pipImages.length;
  inputs.push(`-i "${audioPath.replace(/\\/g, '/')}"`);

  // --- Filter graph ---
  const filterParts = [];

  // Ken Burns zoom/pan per background image
  for (let i = 0; i < images.length; i++) {
    const zoomIn = i % 2 === 0;
    const zoomExpr = zoomIn
      ? `z=min(zoom+0.0006\\,1.12)`
      : `z=if(eq(on\\,1)\\,1.12\\,max(zoom-0.0006\\,1.0))`;
    const xPan = i % 3 === 0 ? `x=iw/2-(iw/zoom/2)` :
                 i % 3 === 1 ? `x=(iw-iw/zoom)*on/${segmentDuration * 30}` :
                               `x=(iw-iw/zoom)*(1-on/${segmentDuration * 30})`;
    filterParts.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920,` +
      `zoompan=${zoomExpr}:${xPan}:y=ih/2-(ih/zoom/2):` +
      `d=${segmentDuration * 30}:s=1080x1920:fps=30,` +
      `format=yuv420p,setsar=1[v${i}]`
    );
  }

  // Concatenate backgrounds
  if (images.length > 1) {
    filterParts.push(`${images.map((_, i) => `[v${i}]`).join('')}concat=n=${images.length}:v=1:a=0[base]`);
  } else {
    filterParts.push(`[v0]copy[base]`);
  }

  // --- PIP image cards (floating game art that pops in briefly) ---
  let currentLabel = 'base';
  if (pipImages.length > 0) {
    for (let i = 0; i < pipImages.length; i++) {
      filterParts.push(
        `[${pipStartIdx + i}:v]scale=260:360:force_original_aspect_ratio=decrease,` +
        `pad=280:380:10:10:color=white[pip${i}]`
      );
    }
    const pipTimes = [
      Math.max(3, Math.floor(duration * 0.2)),
      Math.max(6, Math.floor(duration * 0.55)),
    ];
    for (let i = 0; i < pipImages.length; i++) {
      const t = pipTimes[i];
      const nextLabel = `ov${i}`;
      const xPos = i % 2 === 0 ? 740 : 50;
      const yPos = i % 2 === 0 ? 200 : 1350;
      filterParts.push(
        `[${currentLabel}][pip${i}]overlay=x=${xPos}:y=${yPos}:` +
        `enable='between(t\\,${t}\\,${t + 3})'[${nextLabel}]`
      );
      currentLabel = nextLabel;
    }
  }

  // --- Final chain: brightness + captions + broadcast overlays ---
  const assPathFixed = assPath.replace(/\\/g, '/').replace(/:/g, '\\\\:');
  const classInfo = brand.classificationColour(story.classification || story.flair);
  const flair = sanitizeDrawtext(classInfo.label, 20);
  const flairColor = classInfo.ffm;
  const source = sanitizeDrawtext(
    story.subreddit ? `r/${story.subreddit}` : (story.source_type || 'News'), 35
  );

  const chain = [];

  // Dark overlay + amber bottom gradient for readability
  chain.push('eq=brightness=-0.08:saturation=1.2');

  // Bottom amber gradient (15% opacity at bottom edge)
  chain.push(
    `drawbox=x=0:y=ih-300:w=iw:h=300:color=${brand.PRIMARY_FFM}@0.08:t=fill`
  );

  // ASS captions (TikTok-style animated text)
  chain.push(`ass=${assPathFixed}`);

  // Flair badge — top left with coloured pill
  chain.push(
    `drawtext=text='  ${flair}  ':${fontOpt}:fontcolor=white:fontsize=38:` +
    `box=1:boxcolor=${flairColor}@0.85:boxborderw=14:x=40:y=100`
  );

  // Source badge — beside flair pill
  chain.push(
    `drawtext=text='  ${source}  ':${fontOpt}:fontcolor=white@0.85:fontsize=26:` +
    `box=1:boxcolor=${brand.MUTED_FFM}@0.6:boxborderw=8:x=40:y=155`
  );

  // Lower brand bar — full width, charcoal at 85% opacity
  chain.push(
    `drawbox=x=0:y=ih-100:w=iw:h=100:color=0x0D0D0F@0.85:t=fill`
  );
  // Amber accent line at top of lower bar
  chain.push(
    `drawbox=x=0:y=ih-100:w=iw:h=2:color=${brand.PRIMARY_FFM}@0.7:t=fill`
  );
  // PULSE GAMING text — left side of lower bar
  chain.push(
    `drawtext=text='PULSE GAMING':${fontOpt}:fontcolor=${brand.TEXT_FFM}@0.9:fontsize=28:` +
    `x=60:y=h-65`
  );
  // Follow CTA — right side of lower bar
  chain.push(
    `drawtext=text='FOLLOW FOR DAILY LEAKS':${fontOpt}:fontcolor=${brand.MUTED_FFM}@0.6:fontsize=20:` +
    `x=w-tw-60:y=h-58`
  );

  // Reddit top comment flash — appears for 5s mid-video
  if (story.top_comment) {
    const comment = sanitizeDrawtext(story.top_comment, 80);
    if (comment.length > 10) {
      const ct = Math.floor(duration * 0.4);
      let line1 = comment;
      let line2 = '';
      if (comment.length > 40) {
        const sp = comment.lastIndexOf(' ', 40);
        line1 = comment.substring(0, sp > 0 ? sp : 40);
        line2 = comment.substring(sp > 0 ? sp + 1 : 40);
      }
      // Header
      chain.push(
        `drawtext=text='  Top Comment  ':${fontOpt}:fontcolor=white:fontsize=24:` +
        `box=1:boxcolor=${brand.PRIMARY_FFM}@0.75:boxborderw=10:` +
        `x=60:y=260:enable='between(t\\,${ct}\\,${ct + 5})'`
      );
      // Line 1
      chain.push(
        `drawtext=text='  ${line1}  ':${fontOpt}:fontcolor=white@0.9:fontsize=22:` +
        `box=1:boxcolor=black@0.55:boxborderw=8:` +
        `x=60:y=310:enable='between(t\\,${ct}\\,${ct + 5})'`
      );
      // Line 2 (if needed)
      if (line2) {
        chain.push(
          `drawtext=text='  ${line2}  ':${fontOpt}:fontcolor=white@0.9:fontsize=22:` +
          `box=1:boxcolor=black@0.55:boxborderw=8:` +
          `x=60:y=352:enable='between(t\\,${ct}\\,${ct + 5})'`
        );
      }
    }
  }

  filterParts.push(`[${currentLabel}]${chain.join(',\n')}[outv]`);

  const filterGraph = filterParts.join(';\n');
  const filterScriptFixed = filterScriptPath.replace(/\\/g, '/');

  const command = [
    'ffmpeg -y',
    inputs.join(' '),
    `-filter_complex_script "${filterScriptFixed}"`,
    `-map "[outv]" -map ${audioIdx}:a`,
    '-c:v libx264 -crf 21 -preset medium',
    '-c:a aac -b:a 192k',
    '-r 30 -shortest',
    `-movflags +faststart "${outputPath}"`,
  ].join(' ');

  return { filterGraph, command };
}

async function assemble() {
  console.log('[assemble] === Professional Video Assembly v3 ===');

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

    const outputPath = path.join('output', 'final', `${story.id}.mp4`);
    await fs.ensureDir(path.dirname(outputPath));

    const duration = await getAudioDuration(story.audio_path);

    // Collect real downloaded images (NOT the composite thumbnail)
    const realImages = [];
    if (story.downloaded_images && story.downloaded_images.length > 0) {
      for (const img of story.downloaded_images) {
        if (img.path && await fs.pathExists(img.path) && img.type !== 'company_logo') {
          realImages.push(img.path);
        }
      }
    }

    // If no real images, use composite thumbnail
    const images = realImages.length > 0 ? realImages :
                   (await fs.pathExists(story.image_path) ? [story.image_path] : []);

    if (images.length === 0) {
      console.log(`[assemble] WARNING: No images for ${story.id}, skipping`);
      skipped++;
      continue;
    }

    // Generate ASS subtitle file
    const subsDir = path.join('output', 'subs');
    await fs.ensureDir(subsDir);
    const assPath = await generateSubtitles(story, duration, subsDir);

    console.log(`[assemble] Rendering ${story.id}: ${images.length} images + captions (${Math.round(duration)}s)`);

    // Write filter graph to file to avoid shell quoting issues
    const filterScriptPath = path.join('output', 'subs', `${story.id}_filter.txt`);
    const { filterGraph, command: cmd } = buildVideoCommand(
      story, images, story.audio_path, assPath, filterScriptPath, outputPath, duration
    );
    await fs.writeFile(filterScriptPath, filterGraph);

    try {
      await execAsync(cmd, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
      story.exported_path = outputPath;
      rendered++;

      const stat = await fs.stat(outputPath);
      console.log(`[assemble] Exported: ${outputPath} (${Math.round(stat.size / 1024 / 1024)}MB)`);
    } catch (err) {
      console.log(`[assemble] ASS render failed for ${story.id}: ${err.stderr?.substring(err.stderr.length - 300) || err.message.substring(0, 300)}`);
      console.log(`[assemble] Trying drawtext fallback...`);

      // Fallback: simple video without captions using filter_complex_script
      try {
        const fallbackFilter =
          `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
          `crop=1080:1920,` +
          `zoompan=z=min(zoom+0.0005\\,1.1):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):` +
          `d=1:s=1080x1920:fps=30,format=yuv420p[outv]`;
        const fallbackFilterPath = path.join('output', 'subs', `${story.id}_fallback_filter.txt`);
        await fs.writeFile(fallbackFilterPath, fallbackFilter);
        const simpleCmd = [
          'ffmpeg -y',
          `-loop 1 -i "${images[0].replace(/\\/g, '/')}"`,
          `-i "${story.audio_path.replace(/\\/g, '/')}"`,
          `-filter_complex_script "${fallbackFilterPath.replace(/\\/g, '/')}"`,
          `-map "[outv]" -map 1:a`,
          '-c:v libx264 -crf 21 -preset medium',
          '-c:a aac -b:a 192k -r 30 -shortest',
          `-movflags +faststart "${outputPath}"`,
        ].join(' ');
        await execAsync(simpleCmd, { timeout: 180000 });
        story.exported_path = outputPath;
        rendered++;
        console.log(`[assemble] Exported (no captions fallback): ${outputPath}`);
      } catch (err2) {
        console.log(`[assemble] ERROR rendering ${story.id}: ${err2.message.substring(0, 200)}`);
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
