const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');
const util = require('util');

const execAsync = util.promisify(exec);

dotenv.config({ override: true });

const axios = require('axios');
const brand = require('./brand');
const { getChannel } = require('./channels');

const MUSIC_CACHE = path.join('output', 'music');
const MUSIC_VOLUME = 0.12; // 12% volume — subtle background

// --- Generate or reuse background music via ElevenLabs ---
async function ensureBackgroundMusic(duration) {
  await fs.ensureDir(MUSIC_CACHE);

  // Reuse cached music if within 30s of needed duration
  const cached = (await fs.readdir(MUSIC_CACHE)).filter(f => f.endsWith('.mp3'));
  for (const file of cached) {
    const match = file.match(/trap_(\d+)s/);
    if (match && Math.abs(parseInt(match[1]) - duration) < 30) {
      return path.join(MUSIC_CACHE, file);
    }
  }

  // Generate via ElevenLabs Music API
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  try {
    console.log('[assemble] Generating background music via ElevenLabs...');
    const response = await axios({
      method: 'POST',
      url: 'https://api.elevenlabs.io/v1/music',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      data: {
        prompt: getChannel().musicPrompt || 'dark minimal trap beat, subtle 808 bass, crisp hi-hats, cinematic, atmospheric, no vocals',
        duration_seconds: Math.min(Math.ceil(duration) + 5, 120),
        force_instrumental: true,
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    });

    const musicPath = path.join(MUSIC_CACHE, `trap_${Math.ceil(duration)}s.mp3`);
    await fs.writeFile(musicPath, Buffer.from(response.data));
    console.log(`[assemble] Background music saved: ${musicPath}`);
    return musicPath;
  } catch (err) {
    console.log(`[assemble] Music generation failed (non-fatal): ${err.message}`);
    return null;
  }
}

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

// --- Split script into punchy karaoke phrases (1-3 words max) ---
function splitIntoPhrases(script) {
  if (!script) return [];
  // Strip [PAUSE], [VISUAL:...] and similar markers before splitting
  const cleaned = script
    .replace(/\[PAUSE\]/gi, '')
    .replace(/\[VISUAL:[^\]]*\]/gi, '')
    .replace(/\.\.\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  const phrases = [];
  let i = 0;
  while (i < words.length) {
    const chunkSize = words[i].length > 8 ? 1 : (words[i].length > 5 ? 2 : 3);
    const chunk = [];
    for (let j = 0; j < chunkSize && i + j < words.length; j++) {
      chunk.push(words[i + j]);
      if (/[.!?]$/.test(words[i + j])) { j++; break; }
    }
    phrases.push(chunk.join(' '));
    i += chunk.length;
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

// --- Generate ASS subtitle file with karaoke-style captions synced to audio ---
async function generateSubtitles(story, duration, outputDir) {
  // Try to load word-level timestamps from ElevenLabs
  const timestampsPath = story.audio_path ? story.audio_path.replace(/\.mp3$/, '_timestamps.json') : null;
  let wordTimestamps = null;
  if (timestampsPath && await fs.pathExists(timestampsPath)) {
    try {
      wordTimestamps = await fs.readJson(timestampsPath);
    } catch (e) { /* fall back to even spacing */ }
  }

  let events;

  if (wordTimestamps && wordTimestamps.characters && wordTimestamps.character_start_times_seconds && wordTimestamps.character_end_times_seconds) {
    // Build word list with precise start/end times from character-level data
    const chars = wordTimestamps.characters;
    const starts = wordTimestamps.character_start_times_seconds;
    const ends = wordTimestamps.character_end_times_seconds;

    // Group characters into words
    const words = [];
    let wordStart = null;
    let wordEnd = null;
    let wordChars = '';
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === ' ' || chars[i] === '\n') {
        if (wordChars.length > 0) {
          words.push({ text: wordChars, start: wordStart, end: wordEnd });
          wordChars = '';
          wordStart = null;
          wordEnd = null;
        }
      } else {
        if (wordStart === null) wordStart = starts[i];
        wordEnd = ends[i];
        wordChars += chars[i];
      }
    }
    if (wordChars.length > 0) words.push({ text: wordChars, start: wordStart, end: wordEnd });

    // Group words into 1-3 word karaoke phrases — break at sentence endings
    const phrases = [];
    let i = 0;
    while (i < words.length) {
      const chunkSize = words[i].text.length > 8 ? 1 : (words[i].text.length > 5 ? 2 : 3);
      const chunk = [];
      for (let j = 0; j < chunkSize && i + j < words.length; j++) {
        chunk.push(words[i + j]);
        // If this word ends a sentence, stop the phrase here
        if (/[.!?]$/.test(words[i + j].text)) { j++; break; }
      }
      phrases.push({
        text: chunk.map(w => w.text).join(' '),
        start: chunk[0].start,
        end: chunk[chunk.length - 1].end,
      });
      i += chunk.length;
    }

    events = phrases.map(p => {
      const clean = p.text
        .replace(/\\/g, '').replace(/\{/g, '').replace(/\}/g, '')
        .replace(/\[PAUSE\]/gi, '').replace(/\[VISUAL:[^\]]*\]/gi, '')
        .toUpperCase().trim();
      if (!clean) return null;
      return `Dialogue: 0,${assTime(p.start)},${assTime(p.end)},Caption,,0,0,0,,{\\fscx120\\fscy120\\t(0,80,\\fscx100\\fscy100)}${clean}`;
    }).filter(Boolean).join('\n');

    console.log(`[assemble] Subtitles: ${phrases.length} phrases synced from word timestamps`);
  } else {
    // Fallback: even spacing
    const phrases = splitIntoPhrases(story.full_script || story.hook || '');
    if (phrases.length === 0) return null;
    const phraseTime = duration / phrases.length;

    events = phrases.map((phrase, i) => {
      const start = assTime(i * phraseTime);
      const end = assTime((i + 1) * phraseTime);
      const clean = phrase
        .replace(/\\/g, '').replace(/\{/g, '').replace(/\}/g, '')
        .toUpperCase();
      return `Dialogue: 0,${start},${end},Caption,,0,0,0,,{\\fscx120\\fscy120\\t(0,80,\\fscx100\\fscy100)}${clean}`;
    }).join('\n');

    console.log(`[assemble] Subtitles: ${phrases.length} phrases (evenly spaced — no timestamps file)`);
  }

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
Style: Caption,Impact,90,&H00FFFFFF,&H001A6BFF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,5,2,5,40,40,380,1

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
function buildVideoCommand(story, images, audioPath, assPath, filterScriptPath, outputPath, duration, musicPath) {
  const inputs = [];
  const fontOpt = process.platform === 'win32' ? "font='Arial'" : "font='DejaVu Sans'";
  const segmentDuration = Math.max(4, Math.floor(duration / images.length));

  // --- Inputs: background images ---
  for (let i = 0; i < images.length; i++) {
    inputs.push(`-loop 1 -t ${segmentDuration} -i "${images[i].replace(/\\/g, '/')}"`);
  }

  // Audio inputs
  const audioIdx = images.length;
  inputs.push(`-i "${audioPath.replace(/\\/g, '/')}"`);
  let musicIdx = -1;
  if (musicPath) {
    musicIdx = images.length + 1;
    inputs.push(`-i "${musicPath.replace(/\\/g, '/')}"`);
  }

  // --- Filter graph ---
  const filterParts = [];

  // Ken Burns zoom/pan per background image — vary crop position for visual variety
  for (let i = 0; i < images.length; i++) {
    const zoomIn = i % 2 === 0;
    const zoomExpr = zoomIn
      ? `z=min(zoom+0.0008\\,1.15)`
      : `z=if(eq(on\\,1)\\,1.15\\,max(zoom-0.0008\\,1.0))`;
    // Vary crop focus: top, centre, bottom — so same-ish images still look different
    const yPos = i % 3 === 0 ? `y=0` :
                 i % 3 === 1 ? `y=(ih-oh)/2` :
                               `y=ih-oh`;
    const xPan = i % 3 === 0 ? `x=iw/2-(iw/zoom/2)` :
                 i % 3 === 1 ? `x=(iw-iw/zoom)*on/${segmentDuration * 30}` :
                               `x=(iw-iw/zoom)*(1-on/${segmentDuration * 30})`;
    filterParts.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920:0:${i % 3 === 0 ? '0' : i % 3 === 1 ? '(ih-oh)/2' : 'ih-oh'},` +
      `zoompan=${zoomExpr}:${xPan}:y=ih/2-(ih/zoom/2):` +
      `d=${segmentDuration * 30}:s=1080x1920:fps=30,` +
      `format=yuv420p,setsar=1[v${i}]`
    );
  }

  // Concatenate backgrounds with crossfade transitions between segments
  if (images.length > 1) {
    // Use xfade for smooth transitions between image segments
    let prevLabel = 'v0';
    for (let i = 1; i < images.length; i++) {
      const offset = i * segmentDuration - 0.5; // 0.5s crossfade
      const outLabel = i === images.length - 1 ? 'base' : `xf${i}`;
      filterParts.push(
        `[${prevLabel}][v${i}]xfade=transition=fadeblack:duration=0.5:offset=${offset}[${outLabel}]`
      );
      prevLabel = outLabel;
    }
  } else {
    filterParts.push(`[v0]copy[base]`);
  }

  let currentLabel = 'base';

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

  // Reddit comments — scattered throughout the video as semi-transparent overlays
  const comments = story.reddit_comments || (story.top_comment ? [{ body: story.top_comment, author: 'Redditor', score: 0 }] : []);
  if (comments.length > 0) {
    // Spread comments evenly across the video (skip first/last 10%)
    const count = Math.min(comments.length, 8);
    const usable = 0.8; // 10%-90% of duration
    const gap = usable / count;

    // Alternate Y positions: top zone (above captions) and bottom zone (below captions, above brand bar)
    // Captions sit at ~y=700-1000, so comments go y=180-350 (top) or y=1300-1550 (bottom)
    const ySlots = [190, 1300, 240, 1350, 200, 1320, 250, 1370];

    comments.slice(0, count).forEach((comment, ci) => {
      const text = sanitizeDrawtext(comment.body, 500);
      if (text.length < 10) return;
      const author = sanitizeDrawtext(comment.author || 'Redditor', 25);
      const score = comment.score || 0;
      const ct = Math.floor(duration * (0.10 + ci * gap));
      const showDur = 5;
      const fadeDur = 0.4;
      const yBase = ySlots[ci % ySlots.length];

      // Fade + slide expressions:
      // alpha: fade in over 0.4s, hold, fade out over 0.4s
      // x: slide in from -20 to 40 over 0.4s then hold at 40
      const alphaExpr = `if(lt(t-${ct}\\,${fadeDur})\\,(t-${ct})/${fadeDur}\\,if(gt(t-${ct}\\,${showDur - fadeDur})\\,(${showDur}-(t-${ct}))/${fadeDur}\\,1))`;
      const slideX = `if(lt(t-${ct}\\,${fadeDur})\\,(-20+60*(t-${ct})/${fadeDur})\\,40)`;
      const enableExpr = `between(t\\,${ct}\\,${ct + showDur})`;

      // Word wrap into lines of ~30 chars — show ALL lines, no truncation
      const words = text.split(' ');
      const lines = [];
      let current = '';
      for (const word of words) {
        if ((current + ' ' + word).length > 30 && current) {
          lines.push(current);
          current = word;
        } else {
          current = current ? current + ' ' + word : word;
        }
      }
      if (current) lines.push(current);

      // Username + score header with fade + slide
      const upvotes = score > 0 ? `  ${score} pts` : '';
      chain.push(
        `drawtext=text='  u/${author}${upvotes}  ':${fontOpt}:fontcolor=${brand.PRIMARY_FFM}:fontsize=26:` +
        `box=1:boxcolor=0x0D0D0F@0.70:boxborderw=10:` +
        `alpha='${alphaExpr}':x='${slideX}':y=${yBase}:enable='${enableExpr}'`
      );
      // All comment text lines with same fade + slide
      lines.forEach((line, li) => {
        chain.push(
          `drawtext=text='  ${line}  ':${fontOpt}:fontcolor=white:fontsize=24:` +
          `box=1:boxcolor=0x0D0D0F@0.60:boxborderw=8:` +
          `alpha='${alphaExpr}':x='${slideX}':y=${yBase + 40 + li * 40}:enable='${enableExpr}'`
        );
      });
    });
  }

  filterParts.push(`[${currentLabel}]${chain.join(',\n')}[outv]`);

  // Audio mixing: narration at full volume + music at low volume
  let audioMapping;
  if (musicIdx >= 0) {
    filterParts.push(
      `[${audioIdx}:a]volume=1.0[voice]`
    );
    filterParts.push(
      `[${musicIdx}:a]volume=${MUSIC_VOLUME}[bgm]`
    );
    filterParts.push(
      `[voice][bgm]amix=inputs=2:duration=shortest[outa]`
    );
    audioMapping = `-map "[outv]" -map "[outa]"`;
  } else {
    audioMapping = `-map "[outv]" -map ${audioIdx}:a`;
  }

  const filterGraph = filterParts.join(';\n');
  const filterScriptFixed = filterScriptPath.replace(/\\/g, '/');

  const command = [
    'ffmpeg -y',
    inputs.join(' '),
    `-filter_complex_script "${filterScriptFixed}"`,
    audioMapping,
    '-c:v libx264 -crf 21 -preset medium',
    '-c:a aac -b:a 192k',
    '-r 30 -shortest',
    `-movflags +faststart "${outputPath}"`,
  ].join(' ');

  return { filterGraph, command };
}

async function assemble() {
  console.log('[assemble] === Professional Video Assembly v5 ===');

  if (!await fs.pathExists('daily_news.json')) {
    console.log('[assemble] ERROR: daily_news.json not found.');
    return;
  }

  const stories = await fs.readJson('daily_news.json');
  // Re-render if exported file is suspiciously small (< 500KB = likely broken bumper-only)
  for (const s of stories) {
    if (s.exported_path && await fs.pathExists(s.exported_path)) {
      const stat = await fs.stat(s.exported_path);
      if (stat.size < 500 * 1024) {
        console.log(`[assemble] ${s.id}: exported file only ${Math.round(stat.size / 1024)}KB — re-rendering`);
        await fs.remove(s.exported_path);
        delete s.exported_path;
        // Clear image paths too so images.js re-downloads fresh copies
        delete s.image_path;
        delete s.downloaded_images;
        // Clear publish IDs so the re-rendered video gets uploaded fresh
        delete s.youtube_post_id;
        delete s.youtube_url;
        delete s.tiktok_post_id;
        delete s.instagram_media_id;
        delete s.facebook_post_id;
        delete s.twitter_post_id;
        delete s.publish_status;
      }
    }
  }

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
    let realImages = [];
    if (story.downloaded_images && story.downloaded_images.length > 0) {
      for (const img of story.downloaded_images) {
        if (img.path && await fs.pathExists(img.path) && img.type !== 'company_logo') {
          realImages.push(img.path);
        }
      }
    }

    // If cached image files are missing (e.g. container restarted) or never downloaded, fetch them now
    if (realImages.length === 0 && (story.article_image || (story.game_images && story.game_images.length > 0) || story.thumbnail_url)) {
      console.log(`[assemble] ${story.id}: cached images missing on disk, re-downloading...`);
      try {
        const getBestImage = require('./images_download');
        const freshImages = await getBestImage(story);
        story.downloaded_images = freshImages.map(i => ({ path: i.path, type: i.type }));
        for (const img of freshImages) {
          if (img.path && await fs.pathExists(img.path) && img.type !== 'company_logo') {
            realImages.push(img.path);
          }
        }
        if (realImages.length > 0) {
          console.log(`[assemble] ${story.id}: re-downloaded ${realImages.length} images`);
        }
      } catch (dlErr) {
        console.log(`[assemble] ${story.id}: re-download failed: ${dlErr.message}`);
      }
    }

    if (realImages.length === 0) {
      console.log(`[assemble] ${story.id}: using composite thumbnail (no real images available)`);
    } else {
      console.log(`[assemble] ${story.id}: using ${realImages.length} real images`);
    }
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

    // Generate or reuse background music
    const musicPath = await ensureBackgroundMusic(duration);

    console.log(`[assemble] Rendering ${story.id}: ${images.length} images + captions (${Math.round(duration)}s)${musicPath ? ' + music' : ''}`);

    // Write filter graph to file to avoid shell quoting issues
    const filterScriptPath = path.join('output', 'subs', `${story.id}_filter.txt`);
    const { filterGraph, command: cmd } = buildVideoCommand(
      story, images, story.audio_path, assPath, filterScriptPath, outputPath, duration, musicPath
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
