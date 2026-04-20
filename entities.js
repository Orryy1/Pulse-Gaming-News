/*
  entities.js — extract named entities from a story script, fetch a
  headshot/thumbnail for each, and compute the exact time window in the
  narration audio when that entity is spoken. Consumed by assemble.js
  which uses the (name, image_path, start_time, end_time) tuples to
  overlay a small portrait in the corner of the video at the moment the
  narrator says the name.

  Flow per story:
    1. extractEntities(script) → [{ name, type }]  (Claude pass)
    2. fetchEntityImage(name, type)              → cached local path
    3. computeMentionWindows(script, timestamps) → start/end seconds
    4. store as story.mentions = [...]

  Kept self-contained so assemble.js can consume the mentions array
  without reaching back into Anthropic SDK / Wikipedia / etc.
*/

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const Anthropic = require("@anthropic-ai/sdk");
const db = require("./lib/db");

const CACHE_DIR = path.join("output", "entity_cache");

const USER_AGENT =
  "PulseGamingBot/1.0 (https://pulse-gaming.example; contact via GitHub)";

// --- Claude entity extraction --------------------------------------------
async function extractEntities(script) {
  if (!script) return [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const client = new Anthropic.default({ apiKey });
  const prompt = `Extract named entities from this video script that would benefit from showing the person or subject on screen when their name is spoken.

Return a JSON array. Each entry:
{ "name": "exact name as written in the script", "type": "person" | "game" | "studio" }

Only include:
- PEOPLE: actors, directors, journalists, game devs, analysts, CEOs, voice actors
- GAMES: specific game titles (not franchise names)
- STUDIOS: development studios or publishers (not platform holders like "Sony" or "Xbox")

Skip: generic terms, platforms (PS5, Xbox), and anything you can't confidently identify as a real person/game/studio.

Return ONLY the JSON array — no prose, no code fences.

Script:
"""
${script.substring(0, 4000)}
"""`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content?.[0]?.text || "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e) =>
          e &&
          typeof e.name === "string" &&
          e.name.length > 2 &&
          ["person", "game", "studio"].includes(e.type),
      )
      .slice(0, 8);
  } catch (err) {
    console.log(`[entities] Extraction failed: ${err.message}`);
    return [];
  }
}

// --- Image fetch ---------------------------------------------------------
async function downloadToCache(url, filename) {
  const dest = path.join(CACHE_DIR, filename);
  if (await fs.pathExists(dest)) {
    const stat = await fs.stat(dest);
    if (stat.size > 5000) return dest;
  }
  try {
    const resp = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      maxRedirects: 5,
      headers: { "User-Agent": USER_AGENT },
    });
    await fs.ensureDir(CACHE_DIR);
    await fs.writeFile(dest, Buffer.from(resp.data));
    const stat = await fs.stat(dest);
    if (stat.size < 5000) {
      await fs.remove(dest);
      return null;
    }
    return dest;
  } catch (err) {
    return null;
  }
}

async function fetchWikipediaImage(name) {
  // Wikipedia REST API returns the page's lead image (infobox headshot
  // for people, key art for games). We resolve via the summary endpoint
  // so redirects and disambiguation are handled server-side.
  try {
    const title = encodeURIComponent(name.replace(/\s+/g, "_"));
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`;
    const resp = await axios.get(summaryUrl, {
      timeout: 8000,
      headers: { "User-Agent": USER_AGENT },
      validateStatus: (s) => s < 500, // treat 404 as non-fatal
    });
    if (resp.status !== 200) return null;
    const img =
      resp.data?.originalimage?.source || resp.data?.thumbnail?.source;
    if (!img) return null;
    const ext = img.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || "jpg";
    const safeName = name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    return await downloadToCache(img, `wiki_${safeName}.${ext}`);
  } catch (err) {
    return null;
  }
}

async function fetchEntityImage(name, type) {
  // Wikipedia first — works for most notable people, games, and
  // studios. Could layer TMDB/IGDB fallbacks here but Wikipedia alone
  // covers ~90% of gaming-news mentions.
  const wiki = await fetchWikipediaImage(name);
  if (wiki) return wiki;
  return null;
}

// --- Word-timestamp matching ---------------------------------------------
// Reconstruct a words[] array from the ElevenLabs character-level
// timestamps format the audio module writes alongside each mp3. Same
// grouping logic as generateSubtitles() in assemble.js — duplicated
// here so we don't couple the two modules.
function wordsFromCharacterTimestamps(ts) {
  if (!ts || !Array.isArray(ts.characters)) return [];
  const chars = ts.characters;
  const starts = ts.character_start_times_seconds || [];
  const ends = ts.character_end_times_seconds || [];
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
  if (wordChars.length > 0) {
    words.push({ text: wordChars, start: wordStart, end: wordEnd });
  }
  return words;
}

function normalise(word) {
  return word.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

// Find every contiguous run of words that matches the normalised entity
// name (e.g. "Alex Garland" → find words [alex, garland] in sequence).
// Returns all occurrences so we can overlay on every mention, not just
// the first.
function findMentionWindows(words, entityName) {
  if (!entityName || words.length === 0) return [];
  const needleTokens = entityName
    .split(/\s+/)
    .map(normalise)
    .filter((t) => t.length > 0);
  if (needleTokens.length === 0) return [];

  const windows = [];
  for (let i = 0; i + needleTokens.length <= words.length; i++) {
    let match = true;
    for (let j = 0; j < needleTokens.length; j++) {
      if (normalise(words[i + j].text) !== needleTokens[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      const start = words[i].start;
      const end = words[i + needleTokens.length - 1].end;
      if (typeof start === "number" && typeof end === "number") {
        windows.push({ start, end });
      }
    }
  }
  return windows;
}

// --- Public entry point --------------------------------------------------
async function generateEntityMentions() {
  console.log("[entities] === Entity Mention Extraction ===");

  const stories = await db.getStories();
  if (!Array.isArray(stories) || stories.length === 0) {
    console.log("[entities] No stories in canonical store");
    return;
  }

  const toProcess = stories.filter(
    (s) =>
      s.approved === true &&
      s.audio_path &&
      s.full_script &&
      !s.mentions_computed,
  );

  console.log(`[entities] ${toProcess.length} stories need entity extraction`);

  await fs.ensureDir(CACHE_DIR);

  for (const story of toProcess) {
    try {
      // Load word timestamps. Without them we can't sync overlays to the
      // moment the name is spoken, so we skip — a no-op is fine, the
      // video will still assemble without face overlays.
      const timestampsPath = story.audio_path.replace(
        /\.mp3$/,
        "_timestamps.json",
      );
      if (!(await fs.pathExists(timestampsPath))) {
        console.log(
          `[entities] ${story.id}: no timestamps file, skipping mentions`,
        );
        story.mentions = [];
        story.mentions_computed = true;
        continue;
      }

      const timestamps = await fs.readJson(timestampsPath).catch(() => null);
      const words = wordsFromCharacterTimestamps(timestamps);
      if (words.length === 0) {
        console.log(`[entities] ${story.id}: empty word list, skipping`);
        story.mentions = [];
        story.mentions_computed = true;
        continue;
      }

      const entities = await extractEntities(story.full_script);
      console.log(
        `[entities] ${story.id}: Claude found ${entities.length} entities`,
      );

      const mentions = [];
      for (const ent of entities) {
        const windows = findMentionWindows(words, ent.name);
        if (windows.length === 0) continue; // name didn't actually appear in audio

        const imagePath = await fetchEntityImage(ent.name, ent.type);
        if (!imagePath) {
          console.log(`[entities] ${story.id}: no image for "${ent.name}"`);
          continue;
        }

        for (const w of windows) {
          mentions.push({
            name: ent.name,
            type: ent.type,
            image_path: imagePath,
            start: w.start,
            end: w.end,
          });
        }
        console.log(
          `[entities] ${story.id}: "${ent.name}" (${ent.type}) — ${windows.length} mention(s)`,
        );
      }

      // Sort chronologically and collapse overlapping windows for the
      // same entity. Overlapping portraits for *different* entities are
      // allowed (rare; in the hook cold open).
      mentions.sort((a, b) => a.start - b.start);

      story.mentions = mentions;
      story.mentions_computed = true;
      console.log(
        `[entities] ${story.id}: ${mentions.length} mention window(s) captured`,
      );
    } catch (err) {
      console.log(`[entities] ${story.id}: error — ${err.message}`);
      story.mentions = [];
      story.mentions_computed = true;
    }
  }

  await db.saveStories(stories);
}

module.exports = {
  generateEntityMentions,
  extractEntities,
  fetchEntityImage,
  wordsFromCharacterTimestamps,
  findMentionWindows,
};

if (require.main === module) {
  generateEntityMentions().catch((err) => {
    console.log(`[entities] ERROR: ${err.message}`);
    process.exit(1);
  });
}
