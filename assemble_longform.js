const { exec } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const util = require("util");
const dotenv = require("dotenv");

const execAsync = util.promisify(exec);

dotenv.config({ override: true });

const brand = require("./brand");
const { getChannel } = require("./channels");

const MUSIC_VOLUME = 0.12;

// --- Get audio duration via ffprobe ---
async function getAudioDuration(audioPath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`,
      { timeout: 10000 },
    );
    return parseFloat(stdout.trim()) || 600;
  } catch (err) {
    return 600;
  }
}

// --- Format seconds to ASS timestamp (H:MM:SS.cc) ---
function assTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

// --- Format seconds to YouTube chapter timestamp (M:SS or H:MM:SS) ---
function chapterTime(seconds) {
  const totalSec = Math.floor(seconds);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

// --- Sanitize text for FFmpeg drawtext ---
function sanitizeDrawtext(text, maxLen) {
  if (!text) return "";
  let clean = text
    .replace(/'/g, "")
    .replace(/\\/g, "")
    .replace(/;/g, "")
    .replace(/:/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  if (maxLen && clean.length > maxLen) {
    clean = clean.substring(0, maxLen - 3) + "...";
  }
  return clean;
}

// --- Generate ASS subtitles for landscape longform ---
async function generateLongformSubtitles(compilation, outputDir) {
  const fullScript = compilation.fullScript || "";
  const audioPath = compilation.audioPath;

  // Try to load word-level timestamps from ElevenLabs
  const timestampsPath = audioPath
    ? audioPath.replace(/\.mp3$/, "_timestamps.json")
    : null;
  let wordTimestamps = null;
  if (timestampsPath && (await fs.pathExists(timestampsPath))) {
    try {
      wordTimestamps = await fs.readJson(timestampsPath);
    } catch (e) {
      /* fall back to even spacing */
    }
  }

  let events;

  if (
    wordTimestamps &&
    wordTimestamps.characters &&
    wordTimestamps.character_start_times_seconds &&
    wordTimestamps.character_end_times_seconds
  ) {
    const chars = wordTimestamps.characters;
    const starts = wordTimestamps.character_start_times_seconds;
    const ends = wordTimestamps.character_end_times_seconds;

    // Group characters into words
    const words = [];
    let wordStart = null;
    let wordEnd = null;
    let wordChars = "";
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === " " || chars[i] === "\n") {
        if (wordChars.length > 0) {
          words.push({ text: wordChars, start: wordStart, end: wordEnd });
          wordChars = "";
          wordStart = null;
          wordEnd = null;
        }
      } else {
        if (wordStart === null) wordStart = starts[i];
        wordEnd = ends[i];
        wordChars += chars[i];
      }
    }
    if (wordChars.length > 0)
      words.push({ text: wordChars, start: wordStart, end: wordEnd });

    // Group into 4-6 word phrases (longer than shorts - suits landscape)
    const phrases = [];
    let idx = 0;
    while (idx < words.length) {
      const chunkSize = words[idx].text.length > 10 ? 3 : 5;
      const chunk = [];
      for (let j = 0; j < chunkSize && idx + j < words.length; j++) {
        chunk.push(words[idx + j]);
        if (/[.!?]$/.test(words[idx + j].text)) {
          j++;
          break;
        }
      }
      phrases.push({
        text: chunk.map((w) => w.text).join(" "),
        start: chunk[0].start,
        end: chunk[chunk.length - 1].end,
      });
      idx += chunk.length;
    }

    events = phrases
      .map((p, i) => {
        const clean = p.text
          .replace(/\\/g, "")
          .replace(/\{/g, "")
          .replace(/\}/g, "")
          .replace(/\[PAUSE\]/gi, "")
          .replace(/\[VISUAL:[^\]]*\]/gi, "")
          .replace(/[.]{2,}/g, "")
          .toUpperCase()
          .trim();
        if (!clean || /^[^A-Z0-9]*$/.test(clean)) return null;
        const end =
          i < phrases.length - 1
            ? Math.max(p.start + 0.1, p.end - 0.05)
            : p.end;
        return `Dialogue: 0,${assTime(p.start)},${assTime(end)},Caption,,0,0,0,,${clean}`;
      })
      .filter(Boolean)
      .join("\n");

    console.log(
      `[longform] Subtitles: ${phrases.length} phrases synced from word timestamps`,
    );
  } else {
    // Fallback: even spacing
    const words = fullScript
      .replace(/\[PAUSE\]/gi, "")
      .replace(/\[VISUAL:[^\]]*\]/gi, "")
      .split(/\s+/)
      .filter(Boolean);
    const duration = compilation.duration || 600;
    const phraseCount = Math.ceil(words.length / 5);
    const phraseTime = duration / phraseCount;
    const phrases = [];
    for (let i = 0; i < words.length; i += 5) {
      phrases.push(words.slice(i, i + 5).join(" "));
    }

    events = phrases
      .map((phrase, i) => {
        const start = assTime(i * phraseTime);
        const end = assTime((i + 1) * phraseTime);
        const clean = phrase
          .replace(/\\/g, "")
          .replace(/\{/g, "")
          .replace(/\}/g, "")
          .toUpperCase();
        return `Dialogue: 0,${start},${end},Caption,,0,0,0,,${clean}`;
      })
      .join("\n");

    console.log(
      `[longform] Subtitles: ${phrases.length} phrases (evenly spaced - no timestamps file)`,
    );
  }

  // Landscape ASS: bottom-centre, 50px font, no karaoke pop-in
  const ass = `[Script Info]
Title: Weekly Roundup Captions
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,50,&H00FFFFFF,&H001A6BFF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,3,1,2,80,80,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;

  const assPath = path.join(outputDir, "weekly_roundup.ass");
  await fs.writeFile(assPath, ass);
  return assPath;
}

// --- Generate background music for longform ---
async function ensureLongformMusic(duration) {
  const MUSIC_CACHE = path.join("output", "music");
  await fs.ensureDir(MUSIC_CACHE);

  const channel = getChannel();
  const channelId = channel.id || "pulse-gaming";

  // Phase 9: prefer the per-channel audio identity pack's bed_primary
  // for longform. Looping is handled by ffmpeg -stream_loop so a short
  // bed stem stretches across the whole 10-12 min roundup naturally.
  if (process.env.USE_SQLITE === "true") {
    try {
      const audioIdentity = require("./lib/audio-identity");
      const repos = require("./lib/repositories").getRepos();
      const bed = audioIdentity.resolve({
        repos,
        channelId,
        role: "bed",
        breaking: false,
      });
      if (bed && bed.abs_path) {
        console.log(
          `[longform] Pack music: pack=${bed.pack_id} bed=${bed.filename} (${channelId}, loops to ${Math.round(duration)}s)`,
        );
        return bed.abs_path;
      }
    } catch (err) {
      console.log(
        `[longform] audio-identity resolve failed, using legacy: ${err.message}`,
      );
    }
  }

  // Look for a longer cached track
  const cached = (await fs.readdir(MUSIC_CACHE)).filter(
    (f) => f.endsWith(".mp3") && f.startsWith(channelId),
  );
  const suitable = cached.filter((f) => {
    const match = f.match(/_(\d+)s_/);
    return match && parseInt(match[1]) >= 60;
  });

  if (suitable.length > 0) {
    const pick = suitable[Math.floor(Math.random() * suitable.length)];
    console.log(
      `[longform] Music: using "${pick}" (will loop for ${Math.round(duration)}s)`,
    );
    return path.join(MUSIC_CACHE, pick);
  }

  // Generate a 120s track (we will loop it in FFmpeg)
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    // Try any existing track
    const allCached = (await fs.readdir(MUSIC_CACHE)).filter((f) =>
      f.endsWith(".mp3"),
    );
    if (allCached.length > 0) return path.join(MUSIC_CACHE, allCached[0]);
    return null;
  }

  const prompts = channel.musicPrompts || [
    channel.musicPrompt ||
      "dark minimal trap beat, subtle 808 bass, crisp hi-hats, cinematic, atmospheric, no vocals",
  ];
  const promptIdx = Math.floor(Math.random() * prompts.length);

  try {
    const axios = require("axios");
    console.log(
      `[longform] Generating music track for longform compilation...`,
    );
    const response = await axios({
      method: "POST",
      url: "https://api.elevenlabs.io/v1/music",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      data: {
        prompt: prompts[promptIdx],
        duration_seconds: 120,
        force_instrumental: true,
      },
      responseType: "arraybuffer",
      timeout: 60000,
    });

    const musicPath = path.join(
      MUSIC_CACHE,
      `${channelId}_120s_v${promptIdx}.mp3`,
    );
    await fs.writeFile(musicPath, Buffer.from(response.data));
    console.log(`[longform] New music track saved: ${musicPath}`);
    return musicPath;
  } catch (err) {
    console.log(
      `[longform] Music generation failed (non-fatal): ${err.message}`,
    );
    const allCached = (await fs.readdir(MUSIC_CACHE)).filter((f) =>
      f.endsWith(".mp3"),
    );
    if (allCached.length > 0) return path.join(MUSIC_CACHE, allCached[0]);
    return null;
  }
}

/**
 * Assemble a longform landscape compilation video.
 *
 * @param {Object} compilation
 *   { stories: [...], audioPath, outputPath, duration, fullScript,
 *     segments: [{ story_id, title, classification, images, startTime }],
 *     intro, outro, dateRange, channelName }
 */
async function assembleLongform(compilation) {
  console.log("[longform] === Longform Video Assembly ===");

  const { stories, audioPath, outputPath, duration, segments, dateRange } =
    compilation;

  const channel = getChannel();
  const channelName = sanitizeDrawtext(channel.name || "PULSE GAMING", 30);
  const fontOpt =
    process.platform === "win32" ? "font='Arial'" : "font='DejaVu Sans'";
  const primaryFFM = channel.colours.PRIMARY_FFM || "0xFF6B1A";
  const secondaryFFM = channel.colours.SECONDARY
    ? channel.colours.SECONDARY.replace("#", "0x")
    : "0x0D0D0F";
  const textFFM = channel.colours.TEXT_FFM || "0xF0F0F0";

  await fs.ensureDir(path.dirname(outputPath));
  const subsDir = path.join("output", "subs");
  await fs.ensureDir(subsDir);

  // Generate ASS subtitles
  const assPath = await generateLongformSubtitles(compilation, subsDir);

  // Get or generate background music
  const musicPath = await ensureLongformMusic(duration);

  // --- Build FFmpeg filter graph ---
  // Strategy: generate intro card, chapter title cards and outro card as colour sources,
  // then interleave with Ken Burns story images, concatenate, overlay subtitles.

  const inputs = [];
  const filterParts = [];
  let inputIdx = 0;

  // Timings
  const INTRO_DUR = 5;
  const CHAPTER_CARD_DUR = 2;
  const OUTRO_DUR = 5;

  // --- Intro card (colour source with drawtext) ---
  inputs.push(
    `-f lavfi -t ${INTRO_DUR} -i "color=c=0x0D0D0F:s=1920x1080:r=30"`,
  );
  const introIdx = inputIdx++;

  const dateRangeClean = sanitizeDrawtext(dateRange || "This Week", 40);
  filterParts.push(
    `[${introIdx}:v]` +
      `drawbox=x=0:y=ih/2-2:w=iw:h=4:color=${primaryFFM}@0.8:t=fill,` +
      `drawtext=text='${channelName}':${fontOpt}:fontcolor=${textFFM}:fontsize=72:x=(w-tw)/2:y=(h-th)/2-80,` +
      `drawtext=text='WEEKLY ROUNDUP':${fontOpt}:fontcolor=${primaryFFM}:fontsize=48:x=(w-tw)/2:y=(h-th)/2+10,` +
      `drawtext=text='${dateRangeClean}':${fontOpt}:fontcolor=${textFFM}@0.7:fontsize=32:x=(w-tw)/2:y=(h-th)/2+80` +
      `[intro]`,
  );

  // --- Story segments with chapter title cards ---
  const segLabels = [];
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const storyObj = stories.find((s) => s.id === seg.story_id);

    // Chapter title card
    inputs.push(
      `-f lavfi -t ${CHAPTER_CARD_DUR} -i "color=c=0x0D0D0F:s=1920x1080:r=30"`,
    );
    const cardIdx = inputIdx++;

    const classInfo = channel.classificationColour
      ? channel.classificationColour(
          storyObj?.classification || storyObj?.flair || "News",
        )
      : { ffm: "0x6B7280", label: "NEWS" };
    const chTitle = sanitizeDrawtext(
      storyObj?.title || seg.title || `Story ${si + 1}`,
      60,
    );
    const badgeLabel = sanitizeDrawtext(classInfo.label, 20);
    const badgeFFM = classInfo.ffm;

    filterParts.push(
      `[${cardIdx}:v]` +
        `drawbox=x=0:y=ih/2+30:w=300:h=3:color=${primaryFFM}@0.8:t=fill,` +
        `drawtext=text='  ${badgeLabel}  ':${fontOpt}:fontcolor=white:fontsize=28:` +
        `box=1:boxcolor=${badgeFFM}@0.85:boxborderw=10:x=60:y=(h-th)/2-50,` +
        `drawtext=text='${chTitle}':${fontOpt}:fontcolor=${textFFM}:fontsize=44:x=60:y=(h-th)/2+10` +
        `[card${si}]`,
    );

    // Ken Burns image segments for this story
    let storyImages = [];
    if (
      storyObj &&
      storyObj.downloaded_images &&
      storyObj.downloaded_images.length > 0
    ) {
      for (const img of storyObj.downloaded_images) {
        if (
          img.path &&
          (await fs.pathExists(img.path)) &&
          img.type !== "company_logo"
        ) {
          storyImages.push(img.path);
        }
      }
    }
    if (
      storyImages.length === 0 &&
      storyObj &&
      storyObj.image_path &&
      (await fs.pathExists(storyObj.image_path))
    ) {
      storyImages.push(storyObj.image_path);
    }

    // Calculate how long this segment's images should play
    // We distribute the remaining time (total - intro - outro - chapter cards) proportionally
    const totalCardTime = segments.length * CHAPTER_CARD_DUR;
    const contentTime = duration - INTRO_DUR - OUTRO_DUR - totalCardTime;
    const segDuration = Math.max(5, Math.floor(contentTime / segments.length));

    if (storyImages.length === 0) {
      // No images - use a dark background with title text
      inputs.push(
        `-f lavfi -t ${segDuration} -i "color=c=0x0D0D0F:s=1920x1080:r=30"`,
      );
      const bgIdx = inputIdx++;
      filterParts.push(
        `[${bgIdx}:v]` +
          `drawtext=text='${chTitle}':${fontOpt}:fontcolor=${textFFM}@0.5:fontsize=36:x=(w-tw)/2:y=(h-th)/2` +
          `[seg${si}]`,
      );
    } else {
      // Ken Burns on each image, then concatenate
      const imgSegDur = Math.max(
        3,
        Math.floor(segDuration / storyImages.length),
      );
      const imgLabels = [];

      for (let ii = 0; ii < storyImages.length; ii++) {
        inputs.push(
          `-loop 1 -t ${imgSegDur} -i "${storyImages[ii].replace(/\\/g, "/")}"`,
        );
        const imgIdx = inputIdx++;

        const zoomIn = ii % 2 === 0;
        const zoomExpr = zoomIn
          ? `z=min(zoom+0.0005\\,1.1)`
          : `z=if(eq(on\\,1)\\,1.1\\,max(zoom-0.0005\\,1.0))`;
        const xPan =
          ii % 2 === 0
            ? `x=iw/2-(iw/zoom/2)`
            : `x=(iw-iw/zoom)*on/${imgSegDur * 30}`;

        filterParts.push(
          `[${imgIdx}:v]scale=1920:1080:force_original_aspect_ratio=increase,` +
            `crop=1920:1080,` +
            `zoompan=${zoomExpr}:${xPan}:y=ih/2-(ih/zoom/2):` +
            `d=${imgSegDur * 30}:s=1920x1080:fps=30,` +
            `format=yuv420p,setsar=1[img${si}_${ii}]`,
        );
        imgLabels.push(`img${si}_${ii}`);
      }

      // Concatenate images within this segment
      if (imgLabels.length > 1) {
        let prevLabel = imgLabels[0];
        for (let k = 1; k < imgLabels.length; k++) {
          const offset = k * imgSegDur - 0.5;
          const outLabel =
            k === imgLabels.length - 1 ? `seg${si}` : `segxf${si}_${k}`;
          filterParts.push(
            `[${prevLabel}][${imgLabels[k]}]xfade=transition=fadeblack:duration=0.5:offset=${offset}[${outLabel}]`,
          );
          prevLabel = outLabel;
        }
      } else {
        filterParts.push(`[${imgLabels[0]}]copy[seg${si}]`);
      }
    }

    // Push both card and segment labels in order
    segLabels.push(`card${si}`);
    segLabels.push(`seg${si}`);
  }

  // --- Outro card ---
  inputs.push(
    `-f lavfi -t ${OUTRO_DUR} -i "color=c=0x0D0D0F:s=1920x1080:r=30"`,
  );
  const outroIdx = inputIdx++;

  filterParts.push(
    `[${outroIdx}:v]` +
      `drawbox=x=0:y=ih/2-2:w=iw:h=4:color=${primaryFFM}@0.8:t=fill,` +
      `drawtext=text='SUBSCRIBE':${fontOpt}:fontcolor=${primaryFFM}:fontsize=64:x=(w-tw)/2:y=(h-th)/2-40,` +
      `drawtext=text='${channelName}':${fontOpt}:fontcolor=${textFFM}:fontsize=36:x=(w-tw)/2:y=(h-th)/2+40` +
      `[outro]`,
  );

  // --- Concatenate all: intro + (card + segment) * N + outro ---
  const concatLabels = ["intro", ...segLabels, "outro"];
  const concatCount = concatLabels.length;
  const concatInput = concatLabels.map((l) => `[${l}]`).join("");
  filterParts.push(`${concatInput}concat=n=${concatCount}:v=1:a=0[rawvid]`);

  // --- Overlay: slight brightness + ASS subtitles ---
  const assPathFixed = assPath.replace(/\\/g, "/").replace(/:/g, "\\\\:");
  filterParts.push(
    `[rawvid]eq=brightness=-0.03:saturation=1.1,` + `ass=${assPathFixed}[outv]`,
  );

  // --- Audio inputs ---
  const audioInputIdx = inputIdx;
  inputs.push(`-i "${audioPath.replace(/\\/g, "/")}"`);
  inputIdx++;

  let musicInputIdx = -1;
  if (musicPath && (await fs.pathExists(musicPath))) {
    musicInputIdx = inputIdx;
    // Loop the music track to cover the full duration
    inputs.push(
      `-stream_loop -1 -t ${Math.ceil(duration) + 5} -i "${musicPath.replace(/\\/g, "/")}"`,
    );
    inputIdx++;
  }

  // Audio mixing
  let audioMapping;
  if (musicInputIdx >= 0) {
    filterParts.push(`[${audioInputIdx}:a]volume=1.0[voice]`);
    filterParts.push(`[${musicInputIdx}:a]volume=${MUSIC_VOLUME}[bgm]`);
    filterParts.push(`[voice][bgm]amix=inputs=2:duration=first[outa]`);
    audioMapping = `-map "[outv]" -map "[outa]"`;
  } else {
    audioMapping = `-map "[outv]" -map ${audioInputIdx}:a`;
  }

  // --- Write filter graph to file (avoid shell quoting) ---
  const filterGraph = filterParts.join(";\n");
  const filterScriptPath = path.join(subsDir, "weekly_filter.txt");
  await fs.writeFile(filterScriptPath, filterGraph);

  const command = [
    "ffmpeg -y",
    inputs.join(" "),
    `-filter_complex_script "${filterScriptPath.replace(/\\/g, "/")}"`,
    audioMapping,
    "-c:v libx264 -crf 21 -preset medium",
    "-c:a aac -b:a 192k",
    "-r 30 -shortest",
    `-movflags +faststart "${outputPath}"`,
  ].join(" ");

  console.log(
    `[longform] Rendering ${segments.length} segments, ~${Math.round(duration / 60)} minutes...`,
  );

  try {
    await execAsync(command, { timeout: 600000, maxBuffer: 20 * 1024 * 1024 });
    const stat = await fs.stat(outputPath);
    console.log(
      `[longform] Exported: ${outputPath} (${Math.round(stat.size / 1024 / 1024)}MB)`,
    );
    return outputPath;
  } catch (err) {
    const errDetail =
      err.stderr?.substring(err.stderr.length - 500) ||
      err.message.substring(0, 500);
    console.log(`[longform] Render failed:\n${errDetail}`);
    throw new Error(`Longform render failed: ${errDetail}`);
  }
}

module.exports = { assembleLongform, chapterTime };

if (require.main === module) {
  console.log("[longform] This module is not meant to be run directly.");
  console.log("[longform] Use: node weekly_compile.js");
}
