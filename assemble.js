const { exec } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");
const util = require("util");
const db = require("./lib/db");

const execAsync = util.promisify(exec);

dotenv.config({ override: true });

const axios = require("axios");
const brand = require("./brand");
const { getChannel } = require("./channels");

// Intro card REMOVED - first 1-2 seconds are critical for Shorts retention,
// a branding card gives swipers a reason to leave before the hook lands
const OUTRO_CARD = path.join(__dirname, "branding", "intro_outro_card.png");
const OUTRO_DURATION = 5; // seconds before end to bring up outro card

const MUSIC_CACHE = path.join("output", "music");
const CUSTOM_MUSIC_DIR = path.join(__dirname, "audio", "mastered");
const MUSIC_VOLUME = 0.08; // 8% volume - quieter background
const MAX_IMAGES = 8; // More images = more visual variety in 60s+ videos
const FFMPEG_THREADS = 2; // Limit FFmpeg threads to stay within container memory

/**
 * Generates a 15-second teaser cut from the full video.
 * Takes the first 13s + 2s "Full story on YouTube" card.
 * Used for TikTok growth strategy - drives traffic to YouTube.
 */
async function generateTeaser(story, fullVideoPath, outputDir) {
  const teaserPath = path.join(outputDir, `${story.id}_teaser.mp4`);

  // Skip if teaser already exists
  if (await fs.pathExists(teaserPath)) {
    const stat = await fs.stat(teaserPath);
    if (stat.size > 50000) return teaserPath;
  }

  const fontOpt =
    process.platform === "win32" ? "font='Arial'" : "font='DejaVu Sans'";

  try {
    // Take first 15s of the full video, overlay "Full story on YouTube" in last 3s
    const cmd =
      `ffmpeg -y -i "${fullVideoPath.replace(/\\/g, "/")}" -t 15 ` +
      `-vf "drawtext=text='Full story on YouTube':${fontOpt}:fontcolor=white:fontsize=48:` +
      `box=1:boxcolor=black@0.7:boxborderw=20:x=(w-tw)/2:y=(h-th)/2:` +
      `enable='between(t,12,15)'" ` +
      `-c:v libx264 -crf 23 -preset fast -c:a aac -b:a 128k ` +
      `-map_metadata -1 -movflags +faststart "${teaserPath.replace(/\\/g, "/")}"`;

    await execAsync(cmd, { timeout: 60000 });

    const stat = await fs.stat(teaserPath);
    if (stat.size < 50000) {
      await fs.remove(teaserPath);
      return null;
    }

    console.log(
      `[assemble] Teaser cut: ${teaserPath} (${Math.round(stat.size / 1024)}KB)`,
    );
    return teaserPath;
  } catch (err) {
    console.log(
      `[assemble] Teaser generation failed (non-fatal): ${err.message}`,
    );
    return null;
  }
}

// --- Music library: use custom distributed tracks, fall back to ElevenLabs generation ---
async function ensureBackgroundMusic(duration, story) {
  const channel = getChannel();
  const channelId = channel.id || "pulse-gaming";

  // Priority 1: Use custom royalty-earning tracks from audio/ directory
  if (await fs.pathExists(CUSTOM_MUSIC_DIR)) {
    const customFiles = (await fs.readdir(CUSTOM_MUSIC_DIR)).filter(
      (f) => f.endsWith(".wav") || f.endsWith(".mp3"),
    );

    const loops = customFiles.filter((f) => /main.*background.*loop/i.test(f));
    const stings = customFiles.filter((f) => /breaking.*sting/i.test(f));

    if (loops.length > 0) {
      const loop = loops[Math.floor(Math.random() * loops.length)];
      const loopPath = path.join(CUSTOM_MUSIC_DIR, loop);

      // For breaking stories, prepend a sting before the background loop
      const isBreaking =
        story &&
        (story.classification === "[BREAKING]" || story.breaking_fast_track);
      if (isBreaking && stings.length > 0) {
        const sting = stings[Math.floor(Math.random() * stings.length)];
        const stingPath = path.join(CUSTOM_MUSIC_DIR, sting);
        const tempDir = path.join("output", "music", "temp");
        await fs.ensureDir(tempDir);
        const concatPath = path.join(tempDir, `breaking_${Date.now()}.wav`);
        const listPath = path.join(tempDir, `concat_${Date.now()}.txt`);
        await fs.writeFile(
          listPath,
          `file '${stingPath.replace(/\\/g, "/")}'\nfile '${loopPath.replace(/\\/g, "/")}'`,
        );
        try {
          await execAsync(
            `ffmpeg -y -f concat -safe 0 -i "${listPath.replace(/\\/g, "/")}" -t ${Math.ceil(duration) + 5} "${concatPath.replace(/\\/g, "/")}"`,
            { timeout: 30000 },
          );
          console.log(
            `[assemble] Breaking music: "${sting}" + "${loop}" (royalty-earning)`,
          );
          return concatPath;
        } catch (err) {
          console.log(
            `[assemble] Sting concat failed, using loop only: ${err.message}`,
          );
        }
      }

      console.log(`[assemble] Custom music: "${loop}" (royalty-earning track)`);
      return loopPath;
    }
  }

  // Priority 2: Fall back to cached ElevenLabs tracks
  await fs.ensureDir(MUSIC_CACHE);
  const cached = (await fs.readdir(MUSIC_CACHE)).filter(
    (f) => f.endsWith(".mp3") && f.startsWith(channelId),
  );
  const suitable = cached.filter((f) => {
    const match = f.match(/_(\d+)s_/);
    return match && Math.abs(parseInt(match[1]) - duration) < 30;
  });

  if (suitable.length > 0) {
    const pick = suitable[Math.floor(Math.random() * suitable.length)];
    console.log(`[assemble] Music cache: picked "${pick}"`);
    return path.join(MUSIC_CACHE, pick);
  }

  // Priority 3: Generate via ElevenLabs API (legacy fallback)
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    const legacy = cached.filter(
      (f) =>
        f.match(/trap_(\d+)s/) &&
        Math.abs(parseInt(f.match(/trap_(\d+)s/)[1]) - duration) < 30,
    );
    if (legacy.length > 0) return path.join(MUSIC_CACHE, legacy[0]);
    return null;
  }

  const prompts = channel.musicPrompts || [
    channel.musicPrompt ||
      "dark minimal trap beat, subtle 808 bass, crisp hi-hats, cinematic, atmospheric, no vocals",
  ];
  const usedIndices = suitable.map((f) => {
    const m = f.match(/_v(\d+)\.mp3$/);
    return m ? parseInt(m[1]) : -1;
  });
  let promptIdx = prompts.findIndex((_, i) => !usedIndices.includes(i));
  if (promptIdx === -1) promptIdx = Math.floor(Math.random() * prompts.length);

  try {
    console.log(
      `[assemble] Generating music track v${promptIdx} for ${channelId} (no custom tracks found)...`,
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
        duration_seconds: Math.min(Math.ceil(duration) + 5, 120),
        force_instrumental: true,
      },
      responseType: "arraybuffer",
      timeout: 60000,
    });

    const musicPath = path.join(
      MUSIC_CACHE,
      `${channelId}_${Math.ceil(duration)}s_v${promptIdx}.mp3`,
    );
    await fs.writeFile(musicPath, Buffer.from(response.data));
    console.log(`[assemble] New track saved: ${musicPath}`);
    return musicPath;
  } catch (err) {
    console.log(
      `[assemble] Music generation failed (non-fatal): ${err.message}`,
    );
    const allCached = (await fs.readdir(MUSIC_CACHE)).filter((f) =>
      f.endsWith(".mp3"),
    );
    const legacy = allCached.filter((f) => {
      const m = f.match(/(\d+)s/);
      return m && Math.abs(parseInt(m[1]) - duration) < 30;
    });
    if (legacy.length > 0) {
      console.log(`[assemble] Using legacy track: ${legacy[0]}`);
      return path.join(MUSIC_CACHE, legacy[0]);
    }
    return null;
  }
}

// --- Get audio duration via ffprobe ---
async function getAudioDuration(audioPath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`,
      { timeout: 10000 },
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
    .replace(/\[PAUSE\]/gi, "")
    .replace(/\[VISUAL:[^\]]*\]/gi, "")
    .replace(/\.\.\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  const phrases = [];
  let i = 0;
  while (i < words.length) {
    const chunkSize = words[i].length > 8 ? 1 : words[i].length > 5 ? 2 : 3;
    const chunk = [];
    for (let j = 0; j < chunkSize && i + j < words.length; j++) {
      chunk.push(words[i + j]);
      if (/[.!?]$/.test(words[i + j])) {
        j++;
        break;
      }
    }
    phrases.push(chunk.join(" "));
    i += chunk.length;
  }
  return phrases;
}

// --- Format seconds to ASS timestamp (H:MM:SS.cc) ---
function assTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

// --- Highlight key words in orange (TikTok-style) using ASS override tags ---
// Brand accent in ASS BGR format: #FF6B1A → &H001A6BFF
const HIGHLIGHT_COLOR = "\\c&H001A6BFF&";
const HIGHLIGHT_WORDS = new Set([
  // Numbers and money
  "BILLION",
  "MILLION",
  "THOUSAND",
  "$",
  "£",
  "%",
  // Emphasis words
  "LEAKED",
  "LEAK",
  "CONFIRMED",
  "BREAKING",
  "EXCLUSIVE",
  "REVEALED",
  "SECRET",
  "MASSIVE",
  "HUGE",
  "INSANE",
  "OFFICIAL",
  "BANNED",
  "CANCELLED",
  "DELAYED",
  "FREE",
  "DEAD",
  "KILLED",
  "LAUNCHED",
  "RUMOR",
  "RUMOUR",
  "INSIDER",
  "SOURCES",
  "QUIETLY",
  "ACCIDENTALLY",
  // Brand
  "PULSE",
  "GAMING",
  // Game/tech terms
  "PS5",
  "PS6",
  "XBOX",
  "NINTENDO",
  "SWITCH",
  "STEAM",
  "PC",
  "GPU",
  "CPU",
  "RTX",
  "REMAKE",
  "REMASTER",
  "DLC",
  "UPDATE",
  "GTA",
  "ZELDA",
  "MARIO",
  "HALO",
  "FORTNITE",
  "MINECRAFT",
]);

function highlightKeyWords(text) {
  const words = text.split(" ");
  const result = words.map((word) => {
    const stripped = word.replace(/[^A-Z0-9$£%]/g, "");
    // Highlight if it's a key word, or contains a number/money symbol
    if (
      HIGHLIGHT_WORDS.has(stripped) ||
      /\d/.test(word) ||
      /[$£%]/.test(word)
    ) {
      return `{${HIGHLIGHT_COLOR}}${word}{\\c&H00FFFFFF&}`;
    }
    return word;
  });
  return result.join(" ");
}

// --- Generate ASS subtitle file with karaoke-style captions synced to audio ---
async function generateSubtitles(story, duration, outputDir) {
  // Try to load word-level timestamps from ElevenLabs
  const timestampsPath = story.audio_path
    ? story.audio_path.replace(/\.mp3$/, "_timestamps.json")
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
    // Build word list with precise start/end times from character-level data
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

    // Pre-merge word pairs that must stay together:
    // "twenty" + "26" → "2026", "Pulse" + "Gaming" → "Pulse Gaming"
    const mergedWords = [];
    for (let mi = 0; mi < words.length; mi++) {
      const stripped = words[mi].text.replace(/[^a-zA-Z]/g, "").toLowerCase();
      if (
        stripped === "twenty" &&
        mi + 1 < words.length &&
        /^\d{1,2}$/.test(words[mi + 1].text.replace(/[^0-9]/g, ""))
      ) {
        // Merge "twenty" + "26" → "2026" (keep any trailing punctuation from second word)
        const digits = words[mi + 1].text.replace(/[^0-9]/g, "");
        const trailing = words[mi + 1].text.replace(/[0-9]/g, "");
        mergedWords.push({
          text: `20${digits.padStart(2, "0")}${trailing}`,
          start: words[mi].start,
          end: words[mi + 1].end,
        });
        mi++; // skip next word
      } else if (
        stripped === "pulse" &&
        mi + 1 < words.length &&
        /^gaming/i.test(words[mi + 1].text.replace(/[^a-zA-Z]/g, ""))
      ) {
        // Merge "Pulse" + "Gaming" into single token
        mergedWords.push({
          text: words[mi].text + " " + words[mi + 1].text,
          start: words[mi].start,
          end: words[mi + 1].end,
        });
        mi++; // skip next word
      } else {
        mergedWords.push(words[mi]);
      }
    }

    // Group words into 1-3 word karaoke phrases - break at sentence endings
    const phrases = [];
    let i = 0;
    while (i < mergedWords.length) {
      const chunkSize =
        mergedWords[i].text.length > 8
          ? 1
          : mergedWords[i].text.length > 5
            ? 2
            : 3;
      const chunk = [];
      for (let j = 0; j < chunkSize && i + j < mergedWords.length; j++) {
        chunk.push(mergedWords[i + j]);
        // If this word ends a sentence, stop the phrase here
        if (/[.!?]$/.test(mergedWords[i + j].text)) {
          j++;
          break;
        }
      }
      phrases.push({
        text: chunk.map((w) => w.text).join(" "),
        start: chunk[0].start,
        end: chunk[chunk.length - 1].end,
      });
      i += chunk.length;
    }

    // Find when CTA starts (last "follow" in the text) for top-aligned subtitles
    const fullText = phrases
      .map((p) => p.text)
      .join(" ")
      .toLowerCase();
    const ctaWordIdx = fullText.lastIndexOf("follow");
    let ctaStartTime = duration - OUTRO_DURATION;
    if (ctaWordIdx >= 0) {
      // Find which phrase contains the CTA
      let charCount = 0;
      for (const p of phrases) {
        charCount += p.text.length + 1;
        if (charCount > ctaWordIdx) {
          ctaStartTime = p.start;
          break;
        }
      }
    }

    events = phrases
      .map((p, idx) => {
        const clean = p.text
          .replace(/\\/g, "")
          .replace(/\{/g, "")
          .replace(/\}/g, "")
          .replace(/\[PAUSE\]/gi, "")
          .replace(/\[VISUAL:[^\]]*\]/gi, "")
          .replace(/[.]{2,}/g, "") // remove ellipses that show as subtitle text
          .replace(/^[,;:\s]+/, "") // strip leading commas/punctuation from phrase
          .replace(/[,.!?;:]+$/, "") // strip trailing punctuation artifacts (.,  ,. etc)
          .toUpperCase()
          .trim();
        if (!clean || /^[^A-Z0-9]*$/.test(clean)) return null; // skip punctuation-only phrases
        // End each phrase slightly early to prevent overlap flicker with next phrase
        const end =
          idx < phrases.length - 1
            ? Math.max(p.start + 0.1, p.end - 0.08)
            : p.end;
        // Highlight key words in orange (brand accent) - like TikTok style
        const highlighted = highlightKeyWords(clean);
        // Use top-aligned style during outro (when brand card is showing)
        const style = p.start >= ctaStartTime ? "CaptionTop" : "Caption";
        return `Dialogue: 0,${assTime(p.start)},${assTime(end)},${style},,0,0,0,,${highlighted}`;
      })
      .filter(Boolean)
      .join("\n");

    console.log(
      `[assemble] Subtitles: ${phrases.length} phrases synced from word timestamps`,
    );
  } else {
    // Fallback: even spacing
    const phrases = splitIntoPhrases(story.full_script || story.hook || "");
    if (phrases.length === 0) return null;
    const phraseTime = duration / phrases.length;

    events = phrases
      .map((phrase, i) => {
        const start = assTime(i * phraseTime);
        const end = assTime((i + 1) * phraseTime);
        const clean = phrase
          .replace(/\\/g, "")
          .replace(/\{/g, "")
          .replace(/\}/g, "")
          .replace(/^[,;:\s]+/, "") // strip leading commas/punctuation from phrase
          .replace(/[,.!?;:]+$/, "") // strip trailing punctuation artifacts
          .toUpperCase();
        const highlighted = highlightKeyWords(clean);
        return `Dialogue: 0,${start},${end},Caption,,0,0,0,,${highlighted}`;
      })
      .join("\n");

    console.log(
      `[assemble] Subtitles: ${phrases.length} phrases (evenly spaced - no timestamps file)`,
    );
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
Style: Caption,Impact,90,&H00FFFFFF,&H001A6BFF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,5,2,2,40,40,250,1
Style: CaptionTop,Impact,90,&H00FFFFFF,&H001A6BFF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,5,2,8,40,40,120,1

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

// --- Classification badge colour ---
function getFlairColor(classification) {
  return brand.classificationColour(classification).ffm;
}

// --- Build filter graph and command with broadcast overlays ---
function buildVideoCommand(
  story,
  images,
  audioPath,
  assPath,
  filterScriptPath,
  outputPath,
  duration,
  musicPath,
) {
  // Cap image count to prevent memory exhaustion on constrained containers
  if (images.length > MAX_IMAGES) {
    console.log(
      `[assemble] Capping images from ${images.length} to ${MAX_IMAGES} (memory guard)`,
    );
    images = images.slice(0, MAX_IMAGES);
  }

  // Merge video clips into the visual sequence - hook-first strategy
  // First clip goes to slot 0 (hook visual), second to middle for pattern interrupt
  const videoClips = (story.video_clips || []).filter((p) =>
    fs.pathExistsSync(p),
  );
  const isVideoSlot = new Array(images.length).fill(false);
  const visualPaths = [...images];
  if (videoClips.length > 0 && images.length >= 2) {
    // First video clip = slot 0 (hook-first: start with gameplay, not a static image)
    visualPaths[0] = videoClips[0];
    isVideoSlot[0] = true;
    console.log(`[assemble] Slot 0: using Steam trailer for hook-first visual`);
    // Second clip (if available) goes to middle for pattern interrupt
    if (videoClips.length > 1 && images.length >= 4) {
      const midSlot = Math.floor(images.length / 2);
      visualPaths[midSlot] = videoClips[1];
      isVideoSlot[midSlot] = true;
      console.log(
        `[assemble] Slot ${midSlot}: using second clip for mid-roll pattern interrupt`,
      );
    }
  }

  const inputs = [];
  const fontOpt =
    process.platform === "win32" ? "font='Arial'" : "font='DejaVu Sans'";
  const segmentDuration = Math.max(
    4,
    Math.floor(duration / visualPaths.length),
  );

  // --- Inputs: background images + video clips ---
  for (let i = 0; i < visualPaths.length; i++) {
    if (isVideoSlot[i]) {
      // Video clip input - take first segmentDuration seconds
      inputs.push(
        `-t ${segmentDuration} -i "${visualPaths[i].replace(/\\/g, "/")}"`,
      );
    } else {
      inputs.push(
        `-loop 1 -t ${segmentDuration} -i "${visualPaths[i].replace(/\\/g, "/")}"`,
      );
    }
  }

  // Audio inputs
  const audioIdx = visualPaths.length;
  inputs.push(`-i "${audioPath.replace(/\\/g, "/")}"`);
  let musicIdx = -1;
  if (musicPath) {
    musicIdx = audioIdx + 1;
    inputs.push(`-i "${musicPath.replace(/\\/g, "/")}"`);
  }

  // Outro card input - must span full duration so overlay has frames available
  let outroIdx = -1;
  const hasOutroCard = fs.pathExistsSync(OUTRO_CARD);
  const fullDur = Math.ceil(duration) + 2;
  if (hasOutroCard) {
    outroIdx = inputs.length;
    inputs.push(`-loop 1 -t ${fullDur} -i "${OUTRO_CARD.replace(/\\/g, "/")}"`);
  }

  // --- Filter graph ---
  const filterParts = [];

  // Ken Burns zoom/pan per background image, or scale+crop for video clips
  for (let i = 0; i < visualPaths.length; i++) {
    if (isVideoSlot[i]) {
      // Video clip: scale to fill 1080x1920, trim to segment duration, no zoompan
      filterParts.push(
        `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
          `crop=1080:1920:(iw-1080)/2:(ih-1920)/2,` +
          `trim=duration=${segmentDuration},setpts=PTS-STARTPTS,` +
          `fps=30,format=yuv420p,setsar=1[v${i}]`,
      );
    } else {
      const zoomIn = i % 2 === 0;
      // Scale zoom increment based on segment duration: reach 15% zoom over the segment's frames
      const zoomIncrement =
        Math.round(10000 * (0.15 / (segmentDuration * 30))) / 10000;
      const zoomExpr = zoomIn
        ? `z=min(zoom+${zoomIncrement}\\,1.15)`
        : `z=if(eq(on\\,1)\\,1.15\\,max(zoom-${zoomIncrement}\\,1.0))`;
      // Vary crop focus: top, centre, bottom - so same-ish images still look different
      const xPan =
        i % 3 === 0
          ? `x=iw/2-(iw/zoom/2)`
          : i % 3 === 1
            ? `x=(iw-iw/zoom)*on/${segmentDuration * 30}`
            : `x=(iw-iw/zoom)*(1-on/${segmentDuration * 30})`;
      filterParts.push(
        `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
          `crop=1080:1920:0:${i % 3 === 0 ? "0" : i % 3 === 1 ? "(ih-oh)/2" : "ih-oh"},` +
          `zoompan=${zoomExpr}:${xPan}:y=ih/2-(ih/zoom/2):` +
          `d=${segmentDuration * 30}:s=1080x1920:fps=30,` +
          `trim=duration=${segmentDuration},setpts=PTS-STARTPTS,` +
          `format=yuv420p,setsar=1[v${i}]`,
      );
    }
  }

  // Concatenate backgrounds with crossfade transitions between segments
  if (visualPaths.length > 1) {
    // Use xfade for smooth transitions between image/video segments
    let prevLabel = "v0";
    for (let i = 1; i < visualPaths.length; i++) {
      const offset = i * segmentDuration - 0.5; // 0.5s crossfade
      const outLabel = i === visualPaths.length - 1 ? "base" : `xf${i}`;
      filterParts.push(
        `[${prevLabel}][v${i}]xfade=transition=fadeblack:duration=0.5:offset=${offset}[${outLabel}]`,
      );
      prevLabel = outLabel;
    }
  } else {
    filterParts.push(`[v0]copy[base]`);
  }

  let currentLabel = "base";

  // --- Final chain: brightness + captions + broadcast overlays ---
  const assPathFixed = assPath.replace(/\\/g, "/").replace(/:/g, "\\\\:");
  const classInfo = brand.classificationColour(
    story.classification || story.flair,
  );
  const flair = sanitizeDrawtext(classInfo.label, 20);
  const flairColor = classInfo.ffm;
  const source = sanitizeDrawtext(
    story.subreddit ? `r/${story.subreddit}` : story.source_type || "News",
    35,
  );

  const chain = [];

  // Dark overlay for readability
  chain.push("eq=brightness=-0.08:saturation=1.2");

  // Semi-transparent gradient bar at bottom for channel branding visibility
  chain.push(`drawbox=x=0:y=ih-200:w=iw:h=200:color=black@0.45:t=fill`);

  // Flair badge - top left with coloured pill
  chain.push(
    `drawtext=text='  ${flair}  ':${fontOpt}:fontcolor=white:fontsize=38:` +
      `box=1:boxcolor=${flairColor}@0.85:boxborderw=14:x=40:y=60`,
  );

  // Source badge - below flair pill with visible gap
  chain.push(
    `drawtext=text='  ${source}  ':${fontOpt}:fontcolor=white@0.85:fontsize=26:` +
      `box=1:boxcolor=${brand.MUTED_FFM}@0.6:boxborderw=8:x=40:y=130`,
  );

  // Brand bar removed - intro/outro cards handle branding

  // Stat card overlay - Steam review score and player count (if available)
  if (story.steam_review_score || story.steam_player_count) {
    const stats = [];
    if (story.steam_review_score)
      stats.push(`${story.steam_review_score}% Positive`);
    if (story.steam_player_count)
      stats.push(
        `${Number(story.steam_player_count).toLocaleString()} Playing`,
      );
    const statText = sanitizeDrawtext(stats.join("  |  "), 50);

    // Show stat card from 3s to 8s (during early body section)
    chain.push(
      `drawtext=text='  ${statText}  ':${fontOpt}:fontcolor=white:fontsize=24:` +
        `box=1:boxcolor=0x0D0D0F@0.75:boxborderw=10:x=w-tw-40:y=130:` +
        `enable='between(t\\,3\\,8)'`,
    );
  }

  // Source attribution overlay for video clips (strengthens fair use as news commentary)
  if (videoClips.length > 0) {
    const company = sanitizeDrawtext(story.company_name || "Steam Store", 40);
    // Show "Footage: [Source]" in bottom-left during video clip segments
    for (let i = 0; i < visualPaths.length; i++) {
      if (!isVideoSlot[i]) continue;
      const clipStart = i * segmentDuration;
      const clipEnd = clipStart + segmentDuration;
      chain.push(
        `drawtext=text='  Footage: ${company}  ':${fontOpt}:fontcolor=white@0.6:fontsize=20:` +
          `box=1:boxcolor=black@0.4:boxborderw=6:x=40:y=ih-230:` +
          `enable='between(t\\,${clipStart}\\,${clipEnd})'`,
      );
    }
  }

  // Reddit comments - scattered throughout the video as semi-transparent overlays
  const comments =
    story.reddit_comments ||
    (story.top_comment
      ? [{ body: story.top_comment, author: "Redditor", score: 0 }]
      : []);
  if (comments.length > 0) {
    // Spread comments evenly across the video (skip first/last 10%)
    const count = Math.min(comments.length, 8);
    const usable = 0.8; // 10%-90% of duration
    const gap = usable / count;

    // All comments in top zone only (y=150-380) to avoid overlapping subtitles at bottom
    const ySlots = [160, 200, 240, 280, 180, 220, 260, 300];

    comments.slice(0, count).forEach((comment, ci) => {
      const text = sanitizeDrawtext(comment.body, 500);
      if (text.length < 10) return;
      const author = sanitizeDrawtext(comment.author || "Redditor", 25);
      const score = comment.score || 0;
      const ct = Math.floor(duration * (0.1 + ci * gap));
      const showDur = 8;
      const fadeDur = 0.4;
      const yBase = ySlots[ci % ySlots.length];

      // Fade + slide expressions:
      // alpha: fade in over 0.4s, hold, fade out over 0.4s
      // x: slide in from -20 to 40 over 0.4s then hold at 40
      const alphaExpr = `if(lt(t-${ct}\\,${fadeDur})\\,(t-${ct})/${fadeDur}\\,if(gt(t-${ct}\\,${showDur - fadeDur})\\,(${showDur}-(t-${ct}))/${fadeDur}\\,1))`;
      const slideX = `if(lt(t-${ct}\\,${fadeDur})\\,(-20+60*(t-${ct})/${fadeDur})\\,40)`;
      const enableExpr = `between(t\\,${ct}\\,${ct + showDur})`;

      // Word wrap into lines of ~30 chars - show ALL lines, no truncation
      const words = text.split(" ");
      const lines = [];
      let current = "";
      for (const word of words) {
        if ((current + " " + word).length > 30 && current) {
          lines.push(current);
          current = word;
        } else {
          current = current ? current + " " + word : word;
        }
      }
      if (current) lines.push(current);

      // Username + score header with fade + slide
      const upvotes = score > 0 ? `  ${score} pts` : "";
      chain.push(
        `drawtext=text='  u/${author}${upvotes}  ':${fontOpt}:fontcolor=${brand.PRIMARY_FFM}:fontsize=26:` +
          `box=1:boxcolor=0x0D0D0F@0.70:boxborderw=10:` +
          `alpha='${alphaExpr}':x='${slideX}':y=${yBase}:enable='${enableExpr}'`,
      );
      // All comment text lines with same fade + slide
      lines.forEach((line, li) => {
        chain.push(
          `drawtext=text='  ${line}  ':${fontOpt}:fontcolor=white:fontsize=24:` +
            `box=1:boxcolor=0x0D0D0F@0.60:boxborderw=8:` +
            `alpha='${alphaExpr}':x='${slideX}':y=${yBase + 40 + li * 40}:enable='${enableExpr}'`,
        );
      });
    });
  }

  if (chain.length > 0) {
    filterParts.push(`[${currentLabel}]${chain.join(",\n")}[mainv]`);
  } else {
    filterParts.push(`[${currentLabel}]copy[mainv]`);
  }

  // --- Outro card overlay: fades in via alpha over ~1.2s ---
  const outroStart = Math.max(0, duration - OUTRO_DURATION);
  let videoLabel = "mainv";
  if (outroIdx >= 0) {
    filterParts.push(
      `[${outroIdx}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x0D0D0F,` +
        `format=yuva420p,` +
        `fade=t=in:st=${outroStart}:d=1.2:alpha=1[outrocard]`,
    );
    filterParts.push(`[mainv][outrocard]overlay=0:0:format=auto[afteroutro]`);
    videoLabel = "afteroutro";
  }

  // --- Bottom brand text: channel name + tagline (hidden during outro) ---
  const brandEnable = `lt(t\\,${outroStart})`;
  const channelName = sanitizeDrawtext(brand.name || "PULSE GAMING", 30);
  const channelTagline = sanitizeDrawtext(
    brand.tagline || "Never miss a beat",
    40,
  );
  filterParts.push(
    `[${videoLabel}]` +
      `drawtext=text='${channelName}':${fontOpt}:fontcolor=${brand.PRIMARY_FFM}@0.7:fontsize=28:` +
      `x=(w-tw)/2:y=h-80:enable='${brandEnable}',` +
      `drawtext=text='${channelTagline}':${fontOpt}:fontcolor=${brand.MUTED_FFM}@0.5:fontsize=18:` +
      `x=(w-tw)/2:y=h-48:enable='${brandEnable}'[afterlogo]`,
  );
  videoLabel = "afterlogo";

  // --- ASS subtitles ---
  filterParts.push(`[${videoLabel}]ass=${assPathFixed}[afterass]`);
  filterParts.push(`[afterass]copy[outv]`);

  // Audio mixing: narration at full volume + music at low volume
  let audioMapping;
  if (musicIdx >= 0) {
    filterParts.push(`[${audioIdx}:a]volume=1.0[voice]`);
    filterParts.push(`[${musicIdx}:a]volume=${MUSIC_VOLUME}[bgm]`);
    filterParts.push(`[voice][bgm]amix=inputs=2:duration=first[outa]`);
    audioMapping = `-map "[outv]" -map "[outa]"`;
  } else {
    audioMapping = `-map "[outv]" -map ${audioIdx}:a`;
  }

  const filterGraph = filterParts.join(";\n");
  const filterScriptFixed = filterScriptPath.replace(/\\/g, "/");

  const command = [
    `ffmpeg -y -threads ${FFMPEG_THREADS}`,
    inputs.join(" "),
    `-filter_complex_script "${filterScriptFixed}"`,
    audioMapping,
    `-c:v libx264 -crf 21 -preset medium -threads ${FFMPEG_THREADS}`,
    "-c:a aac -b:a 192k",
    "-r 30 -shortest",
    "-map_metadata -1",
    `-movflags +faststart "${outputPath}"`,
  ].join(" ");

  return { filterGraph, command };
}

async function assemble() {
  console.log("[assemble] === Professional Video Assembly v5 ===");

  const stories = await db.getStories();
  if (!stories.length) {
    console.log("[assemble] No stories found.");
    return;
  }
  // Re-render if exported file is suspiciously small (< 500KB = likely broken bumper-only)
  for (const s of stories) {
    if (s.exported_path && (await fs.pathExists(s.exported_path))) {
      const stat = await fs.stat(s.exported_path);
      if (stat.size < 500 * 1024) {
        console.log(
          `[assemble] ${s.id}: exported file only ${Math.round(stat.size / 1024)}KB - re-rendering`,
        );
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

  const toProcess = stories.filter(
    (s) =>
      s.approved === true && s.audio_path && s.image_path && !s.exported_path,
  );

  console.log(`[assemble] ${toProcess.length} stories ready for assembly`);

  let rendered = 0;
  let skipped = 0;

  for (const story of toProcess) {
    if (!(await fs.pathExists(story.audio_path))) {
      console.log(
        `[assemble] WARNING: Audio missing for ${story.id}, skipping`,
      );
      skipped++;
      continue;
    }

    const outputPath = path.join("output", "final", `${story.id}.mp4`);
    await fs.ensureDir(path.dirname(outputPath));

    const audioDuration = await getAudioDuration(story.audio_path);
    const duration = audioDuration + 1; // 1s breathing room so CTA doesn't cut off abruptly

    // Collect real downloaded images (NOT the composite thumbnail)
    // NOTE: Platform-specific thumbnails (story.tiktok_thumbnail_path,
    // story.instagram_thumbnail_path) are generated by images.js and stored
    // on the story object. When per-platform video assembly is implemented,
    // use those paths as the base image instead of story.image_path.
    let realImages = [];
    if (story.downloaded_images && story.downloaded_images.length > 0) {
      for (const img of story.downloaded_images) {
        if (
          img.path &&
          (await fs.pathExists(img.path)) &&
          img.type !== "company_logo"
        ) {
          realImages.push(img.path);
        }
      }
    }

    // If cached image files are missing (e.g. container restarted) or never downloaded, fetch them now
    if (
      realImages.length === 0 &&
      (story.article_image ||
        (story.game_images && story.game_images.length > 0) ||
        story.thumbnail_url)
    ) {
      console.log(
        `[assemble] ${story.id}: cached images missing on disk, re-downloading...`,
      );
      try {
        const getBestImage = require("./images_download");
        const result = await getBestImage(story);
        const freshImages = result.images || result;
        const freshClips = result.videoClips || [];
        story.downloaded_images = freshImages.map((i) => ({
          path: i.path,
          type: i.type,
        }));
        for (const img of freshImages) {
          if (
            img.path &&
            (await fs.pathExists(img.path)) &&
            img.type !== "company_logo"
          ) {
            realImages.push(img.path);
          }
        }
        // Store video clips for use in assembly
        if (freshClips.length > 0) {
          story.video_clips = freshClips.map((c) => c.path);
        }
        if (realImages.length > 0) {
          console.log(
            `[assemble] ${story.id}: re-downloaded ${realImages.length} images`,
          );
        }
      } catch (dlErr) {
        console.log(
          `[assemble] ${story.id}: re-download failed: ${dlErr.message}`,
        );
      }
    }

    if (realImages.length === 0) {
      console.log(
        `[assemble] ${story.id}: using composite thumbnail (no real images available)`,
      );
    } else {
      console.log(
        `[assemble] ${story.id}: using ${realImages.length} real images`,
      );
    }
    const images =
      realImages.length > 0
        ? realImages
        : (await fs.pathExists(story.image_path))
          ? [story.image_path]
          : [];

    if (images.length === 0) {
      console.log(`[assemble] WARNING: No images for ${story.id}, skipping`);
      skipped++;
      continue;
    }

    // Generate ASS subtitle file
    const subsDir = path.join("output", "subs");
    await fs.ensureDir(subsDir);
    const assPath = await generateSubtitles(story, duration, subsDir);

    // Generate or reuse background music
    const musicPath = await ensureBackgroundMusic(duration, story);

    console.log(
      `[assemble] Rendering ${story.id}: ${images.length} images + captions (${Math.round(duration)}s)${musicPath ? " + music" : ""}`,
    );

    // Write filter graph to file to avoid shell quoting issues
    const filterScriptPath = path.join(
      "output",
      "subs",
      `${story.id}_filter.txt`,
    );
    const { filterGraph, command: cmd } = buildVideoCommand(
      story,
      images,
      story.audio_path,
      assPath,
      filterScriptPath,
      outputPath,
      duration,
      musicPath,
    );
    await fs.writeFile(filterScriptPath, filterGraph);

    try {
      await execAsync(cmd, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 });

      story.exported_path = outputPath;
      rendered++;

      const stat = await fs.stat(outputPath);
      console.log(
        `[assemble] Exported: ${outputPath} (${Math.round(stat.size / 1024 / 1024)}MB)`,
      );

      // Generate 15s teaser cut for TikTok growth
      try {
        const teaserPath = await generateTeaser(
          story,
          outputPath,
          path.dirname(outputPath),
        );
        if (teaserPath) story.teaser_path = teaserPath;
      } catch (err) {
        console.log(`[assemble] Teaser error (non-fatal): ${err.message}`);
      }

      // Clean up temp files after successful assembly
      const tempFiles = [filterScriptPath, assPath].filter(Boolean);
      for (const f of tempFiles) {
        try {
          await fs.remove(f);
        } catch (e) {
          /* ignore */
        }
      }
    } catch (err) {
      const errDetail =
        err.stderr?.substring(err.stderr.length - 500) ||
        err.message.substring(0, 500);
      console.log(
        `[assemble] ⚠ Multi-image render FAILED for ${story.id} (${images.length} images, ${Math.round(duration)}s):\n${errDetail}`,
      );
      console.log(
        `[assemble] ⚠ Falling back to SINGLE IMAGE - video will be less engaging`,
      );

      // Fallback: single image but with ALL overlays (subtitles, branding, comments, music)
      try {
        const fbFilterParts = [];
        const fbInputs = [];
        const totalFrames = Math.ceil(duration) * 30;

        // Single image with proper Ken Burns zoom - scale increment to reach 15% over full duration
        const fbZoomIncrement =
          Math.round(10000 * (0.15 / totalFrames)) / 10000;
        fbInputs.push(
          `-loop 1 -t ${Math.ceil(duration) + 2} -i "${images[0].replace(/\\/g, "/")}"`,
        );
        fbFilterParts.push(
          `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
            `crop=1080:1920,` +
            `zoompan=z=min(zoom+${fbZoomIncrement}\\,1.15):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):` +
            `d=${totalFrames}:s=1080x1920:fps=30,` +
            `trim=duration=${Math.ceil(duration)},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[base]`,
        );

        // Audio input
        const fbAudioIdx = 1;
        fbInputs.push(`-i "${story.audio_path.replace(/\\/g, "/")}"`);

        // Music input (if available)
        let fbMusicIdx = -1;
        if (musicPath && (await fs.pathExists(musicPath))) {
          fbMusicIdx = 2;
          fbInputs.push(`-i "${musicPath.replace(/\\/g, "/")}"`);
        }

        // Build the same overlay chain as the main render
        const fbChain = [];
        const fontOpt =
          process.platform === "win32" ? "font='Arial'" : "font='DejaVu Sans'";
        const classInfo = brand.classificationColour(
          story.classification || story.flair,
        );
        const flair = sanitizeDrawtext(classInfo.label, 20);
        const flairColor = classInfo.ffm;
        const source = sanitizeDrawtext(
          story.subreddit
            ? `r/${story.subreddit}`
            : story.source_type || "News",
          35,
        );

        // Dark overlay
        fbChain.push("eq=brightness=-0.08:saturation=1.2");

        // Semi-transparent bar at bottom for channel branding visibility
        fbChain.push(`drawbox=x=0:y=ih-200:w=iw:h=200:color=black@0.45:t=fill`);
        // ASS subtitles applied after overlays (see below)

        // Flair badge - moved higher
        fbChain.push(
          `drawtext=text='  ${flair}  ':${fontOpt}:fontcolor=white:fontsize=38:` +
            `box=1:boxcolor=${flairColor}@0.85:boxborderw=14:x=40:y=60`,
        );
        // Source badge - below flair with visible gap
        fbChain.push(
          `drawtext=text='  ${source}  ':${fontOpt}:fontcolor=white@0.85:fontsize=26:` +
            `box=1:boxcolor=${brand.MUTED_FFM}@0.6:boxborderw=8:x=40:y=130`,
        );
        // Brand bar removed - intro/outro cards handle branding

        // Stat card overlay - Steam review score and player count (if available)
        if (story.steam_review_score || story.steam_player_count) {
          const stats = [];
          if (story.steam_review_score)
            stats.push(`${story.steam_review_score}% Positive`);
          if (story.steam_player_count)
            stats.push(
              `${Number(story.steam_player_count).toLocaleString()} Playing`,
            );
          const statText = sanitizeDrawtext(stats.join("  |  "), 50);

          fbChain.push(
            `drawtext=text='  ${statText}  ':${fontOpt}:fontcolor=white:fontsize=24:` +
              `box=1:boxcolor=0x0D0D0F@0.75:boxborderw=10:x=w-tw-40:y=130:` +
              `enable='between(t\\,3\\,8)'`,
          );
        }

        // Reddit comments with fade animations
        const comments =
          story.reddit_comments ||
          (story.top_comment
            ? [{ body: story.top_comment, author: "Redditor", score: 0 }]
            : []);
        if (comments.length > 0) {
          const count = Math.min(comments.length, 6);
          const usable = 0.8;
          const gap = usable / count;
          const ySlots = [160, 200, 240, 280, 180, 220];

          comments.slice(0, count).forEach((comment, ci) => {
            const text = sanitizeDrawtext(comment.body, 500);
            if (text.length < 10) return;
            const author = sanitizeDrawtext(comment.author || "Redditor", 25);
            const score = comment.score || 0;
            const ct = Math.floor(duration * (0.1 + ci * gap));
            const showDur = 8;
            const fadeDur = 0.4;
            const yBase = ySlots[ci % ySlots.length];

            const alphaExpr = `if(lt(t-${ct}\\,${fadeDur})\\,(t-${ct})/${fadeDur}\\,if(gt(t-${ct}\\,${showDur - fadeDur})\\,(${showDur}-(t-${ct}))/${fadeDur}\\,1))`;
            const slideX = `if(lt(t-${ct}\\,${fadeDur})\\,(-20+60*(t-${ct})/${fadeDur})\\,40)`;
            const enableExpr = `between(t\\,${ct}\\,${ct + showDur})`;

            const words = text.split(" ");
            const lines = [];
            let current = "";
            for (const word of words) {
              if ((current + " " + word).length > 30 && current) {
                lines.push(current);
                current = word;
              } else {
                current = current ? current + " " + word : word;
              }
            }
            if (current) lines.push(current);

            const upvotes = score > 0 ? `  ${score} pts` : "";
            fbChain.push(
              `drawtext=text='  u/${author}${upvotes}  ':${fontOpt}:fontcolor=${brand.PRIMARY_FFM}:fontsize=26:` +
                `box=1:boxcolor=0x0D0D0F@0.70:boxborderw=10:` +
                `alpha='${alphaExpr}':x='${slideX}':y=${yBase}:enable='${enableExpr}'`,
            );
            lines.forEach((line, li) => {
              fbChain.push(
                `drawtext=text='  ${line}  ':${fontOpt}:fontcolor=white:fontsize=24:` +
                  `box=1:boxcolor=0x0D0D0F@0.60:boxborderw=8:` +
                  `alpha='${alphaExpr}':x='${slideX}':y=${yBase + 40 + li * 40}:enable='${enableExpr}'`,
              );
            });
          });
        }

        fbFilterParts.push(`[base]${fbChain.join(",\n")}[mainv]`);

        // Outro card overlay for fallback path (intro card removed for retention)
        const fbFullDur = Math.ceil(duration) + 2;
        let fbVideoLabel = "mainv";
        const fbOutroStart = Math.max(0, duration - OUTRO_DURATION);
        if (await fs.pathExists(OUTRO_CARD)) {
          const fbOutroIdx = fbInputs.length;
          fbInputs.push(
            `-loop 1 -t ${fbFullDur} -i "${OUTRO_CARD.replace(/\\/g, "/")}"`,
          );
          fbFilterParts.push(
            `[${fbOutroIdx}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
              `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x0D0D0F,` +
              `format=yuva420p,colorchannelmixer=aa=0,` +
              `fade=t=in:st=${fbOutroStart}:d=1.2:alpha=1[fboutro]`,
          );
          fbFilterParts.push(
            `[${fbVideoLabel}][fboutro]overlay=0:0:format=auto[aftercards]`,
          );
          fbVideoLabel = "aftercards";
        }
        // Logo watermark (hidden during outro)
        if (
          await fs.pathExists(
            path.join(__dirname, "branding", "profile_picture.png"),
          )
        ) {
          const fbLogoIdx = fbInputs.length;
          fbInputs.push(
            `-loop 1 -t ${fbFullDur} -i "${path.join(__dirname, "branding", "profile_picture.png").replace(/\\/g, "/")}"`,
          );
          fbFilterParts.push(
            `[${fbLogoIdx}:v]scale=80:80,format=yuva420p,colorchannelmixer=aa=0.4[fblogo]`,
          );
          fbFilterParts.push(
            `[${fbVideoLabel}][fblogo]overlay=(W-w)/2:H-100:format=auto:enable='lt(t\\,${fbOutroStart})'[afterlogo]`,
          );
          fbVideoLabel = "afterlogo";
        }
        // ASS subtitles LAST - on top of everything
        if (assPath && (await fs.pathExists(assPath))) {
          const assFixed = assPath.replace(/\\/g, "/").replace(/:/g, "\\\\:");
          fbFilterParts.push(`[${fbVideoLabel}]ass=${assFixed}[outv]`);
        } else {
          fbFilterParts.push(`[${fbVideoLabel}]copy[outv]`);
        }

        // Audio mixing
        let fbAudioMapping;
        if (fbMusicIdx >= 0) {
          fbFilterParts.push(`[${fbAudioIdx}:a]volume=1.0[voice]`);
          fbFilterParts.push(`[${fbMusicIdx}:a]volume=${MUSIC_VOLUME}[bgm]`);
          fbFilterParts.push(`[voice][bgm]amix=inputs=2:duration=first[outa]`);
          fbAudioMapping = `-map "[outv]" -map "[outa]"`;
        } else {
          fbAudioMapping = `-map "[outv]" -map ${fbAudioIdx}:a`;
        }

        const fbFilterGraph = fbFilterParts.join(";\n");
        const fallbackFilterPath = path.join(
          "output",
          "subs",
          `${story.id}_fallback_filter.txt`,
        );
        await fs.writeFile(fallbackFilterPath, fbFilterGraph);

        const simpleCmd = [
          `ffmpeg -y -threads ${FFMPEG_THREADS}`,
          fbInputs.join(" "),
          `-filter_complex_script "${fallbackFilterPath.replace(/\\/g, "/")}"`,
          fbAudioMapping,
          `-c:v libx264 -crf 21 -preset medium -threads ${FFMPEG_THREADS}`,
          "-c:a aac -b:a 192k -r 30 -shortest",
          `-movflags +faststart "${outputPath}"`,
        ].join(" ");
        await execAsync(simpleCmd, {
          timeout: 600000,
          maxBuffer: 10 * 1024 * 1024,
        });

        // Add intro/outro bumpers
        await concatWithBumpers(outputPath, story.id);

        story.exported_path = outputPath;
        rendered++;
        console.log(
          `[assemble] Exported (single-image fallback with overlays): ${outputPath}`,
        );

        // Generate 15s teaser cut for TikTok growth
        try {
          const teaserPath = await generateTeaser(
            story,
            outputPath,
            path.dirname(outputPath),
          );
          if (teaserPath) story.teaser_path = teaserPath;
        } catch (teaserErr) {
          console.log(
            `[assemble] Teaser error (non-fatal): ${teaserErr.message}`,
          );
        }
      } catch (err2) {
        console.log(
          `[assemble] Fallback also failed for ${story.id}: ${err2.stderr?.substring(err2.stderr.length - 300) || err2.message.substring(0, 200)}`,
        );
        skipped++;
      }
    }
  }

  await db.saveStories(stories);
  console.log(`[assemble] Summary: ${rendered} rendered, ${skipped} skipped`);
}

module.exports = assemble;

if (require.main === module) {
  assemble().catch((err) => {
    console.log(`[assemble] ERROR: ${err.message}`);
    process.exit(1);
  });
}
