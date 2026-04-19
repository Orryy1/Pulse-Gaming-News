const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");
const { exec } = require("child_process");
const util = require("util");
const db = require("./lib/db");

const execAsync = util.promisify(exec);

dotenv.config({ override: true });

const brand = require("./brand");

// --- Phonetic replacements for words TTS mispronounces ---
const PHONETIC_MAP = {
  abyss: "uh-biss",
  cache: "cash",
  segue: "seg-way",
  genre: "zhon-ruh",
  niche: "neesh",
  epitome: "eh-pit-oh-mee",
  albeit: "all-bee-it",
  dequeue: "dee-queue",
};

// --- Clean text for TTS - shared logic ---
function cleanForTTS(raw) {
  return (
    (raw || "")
      // 2026-04-19 fix (precedes the other transforms): paragraph /
      // line separators (U+2028, U+2029) must become real spaces BEFORE
      // the invisible-unicode stripper runs, otherwise the stripper
      // consumes them with no replacement and later "rollout.Journalists"
      // runs together. Same class of bug that shipped the Black Flag
      // subtitles with ROLLOUT.JOURNALISTS joined.
      .replace(/[\u2028\u2029]/g, " ")
      .replace(/\[PAUSE\]/gi, ", ")
      .replace(/\[VISUAL:[^\]]*\]/gi, "")
      .replace(/\.{2,}/g, ".")
      // Ensure space after sentence-ending periods (LLM sometimes omits: "2026.The")
      .replace(/\.([A-Z])/g, ". $1")
      // Strip Reddit subreddit paths - TTS mangles "r/PS5"
      .replace(/\br\/(\w+)/g, (_, sub) => `the ${sub} subreddit`)
      .replace(/[*_~`#|]/g, "")
      // Zero-width / invisible unicode: strip silently. U+2028/U+2029 are
      // handled above with a replacement space, so they stay out of the
      // range here now.
      .replace(/[\u200B-\u200F\u202A-\u202F\uFEFF]/g, "")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
      .replace(/[\u2013\u2014]/g, " - ") // only en/em dashes get spaced out
      // Version numbers: "1.03.00" -> "1 point 0 3 point 0 0"
      .replace(/(\d+)\.(\d+)\.(\d+)/g, (_, a, b, c) => {
        const spellDigits = (s) => s.split("").join(" ");
        return `${a} point ${spellDigits(b)} point ${spellDigits(c)}`;
      })
      // Patch versions: "v1.2" or "V2.0"
      .replace(/[vV](\d+)\.(\d+)/g, (_, a, b) => `version ${a} point ${b}`)
      // Game titles and acronyms - spell out for clear TTS pronunciation
      .replace(/\bGTA\s*VI\b/gi, "G T A six")
      .replace(/\bGTA\s*6\b/gi, "G T A six")
      .replace(/\bGTA\b/g, "G T A")
      // Compound hyphenated words: join with space, no dash (prevents TTS pauses)
      .replace(/(\w)-(\w)/g, "$1 $2")
      // Currency
      .replace(
        /\$(\d+(?:\.\d{1,2})?)\s*(billion|million|trillion)/gi,
        (_, n, unit) => `${n} ${unit.toLowerCase()} dollars`,
      )
      .replace(
        /\$(\d+)\.(\d{2})/g,
        (_, whole, cents) => `${whole} dollars ${parseInt(cents)}`,
      )
      .replace(
        /\$(\d+)\.(\d)/g,
        (_, whole, cents) => `${whole} dollars ${parseInt(cents)}0`,
      )
      .replace(
        /\$(\d+)/g,
        (_, n) => `${n} dollar${parseInt(n) === 1 ? "" : "s"}`,
      )
      .replace(
        /£(\d+)\.(\d{1,2})/g,
        (_, whole, pence) => `${whole} pounds ${parseInt(pence)}`,
      )
      .replace(/£(\d+)/g, (_, n) => `${n} pounds`)
      .replace(
        /€(\d+)\.(\d{1,2})/g,
        (_, whole, cents) => `${whole} euros ${parseInt(cents)}`,
      )
      .replace(/€(\d+)/g, (_, n) => `${n} euros`)
      // Years
      .replace(/(\d{4})/g, (match) => {
        const y = parseInt(match);
        if (y >= 2000 && y <= 2009) {
          const ones = [
            "",
            "one",
            "two",
            "three",
            "four",
            "five",
            "six",
            "seven",
            "eight",
            "nine",
          ];
          return y === 2000
            ? "two thousand"
            : `two thousand and ${ones[y - 2000]}`;
        }
        if (y >= 2010 && y <= 2099)
          return `twenty ${match.slice(2, 4).replace(/^0/, "")}`;
        return match;
      })
      // Phonetic replacements for mispronounced words
      .replace(
        new RegExp(`\\b(${Object.keys(PHONETIC_MAP).join("|")})\\b`, "gi"),
        (match) => PHONETIC_MAP[match.toLowerCase()] || match,
      )
      .replace(/[^\x20-\x7E.,'!?;:\-()"/]/g, "")
      .replace(/\s+/g, " ")
      .replace(/\.\s*\./g, ".")
      .replace(/\.\s*,/g, ",")
      .replace(/,\s*,/g, ",")
      .trim()
  );
}

const BUMPER_DURATION = 0; // bumpers removed - audio must hit 61s on its own
const MIN_TOTAL_DURATION = 61; // TikTok Creator Rewards minimum

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

// --- Concatenate multiple MP3 files via ffmpeg ---
async function concatAudioFiles(files, outputPath) {
  const listPath = outputPath.replace(/\.mp3$/, "_concat.txt");
  const listContent = files.map((f) => `file '${path.basename(f)}'`).join("\n");
  await fs.writeFile(listPath, listContent);
  try {
    await execAsync(
      `ffmpeg -y -f concat -safe 0 -i "${listPath.replace(/\\/g, "/")}" -c copy "${outputPath.replace(/\\/g, "/")}"`,
      { timeout: 30000 },
    );
  } finally {
    await fs.remove(listPath).catch(() => {});
  }
}

// --- Generate TTS audio - dispatches between ElevenLabs and local VoxCPM server ---
//
// Set TTS_PROVIDER=local in .env to route to the self-hosted server.
// LOCAL_TTS_URL defaults to http://127.0.0.1:8765
//
// Both providers must return identical JSON:
//   { audio_base64, alignment: { characters, character_start_times_seconds, character_end_times_seconds } }
async function generateTTS(text, outputPath, rateOverride) {
  const provider = (process.env.TTS_PROVIDER || "elevenlabs").toLowerCase();
  const voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID || "default";
  const voiceSettings = Object.assign(
    {},
    brand.voiceSettings || {
      stability: 0.2,
      similarity_boost: 0.8,
      style: 0.75,
      speaking_rate: 1.1,
    },
  );
  if (rateOverride !== undefined) {
    voiceSettings.speaking_rate = rateOverride;
  }

  const baseUrl =
    provider === "local"
      ? process.env.LOCAL_TTS_URL || "http://127.0.0.1:8765"
      : "https://api.elevenlabs.io";

  const headers =
    provider === "local"
      ? { "Content-Type": "application/json" }
      : {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        };

  const data = {
    text,
    voice_settings: voiceSettings,
    output_format: "mp3_44100_128",
  };
  if (provider !== "local") {
    data.model_id = brand.voiceModel || "eleven_multilingual_v2";
  }

  const response = await axios({
    method: "POST",
    url: `${baseUrl}/v1/text-to-speech/${voiceId}/with-timestamps`,
    headers,
    data,
    timeout: provider === "local" ? 120000 : 60000,
  });

  await fs.ensureDir(path.dirname(outputPath));

  const audioBase64 = response.data.audio_base64;
  if (!audioBase64) {
    throw new Error(
      `[audio] ${provider} returned no audio_base64 - check ${baseUrl} health`,
    );
  }
  await fs.writeFile(outputPath, Buffer.from(audioBase64, "base64"));

  const timestampsPath = outputPath.replace(/\.mp3$/, "_timestamps.json");
  const alignment = response.data.alignment || {};
  await fs.writeJson(timestampsPath, alignment, { spaces: 2 });

  return outputPath;
}

async function generateAudio() {
  console.log("[audio] Loading stories from canonical store...");

  // Phase 3C JSON-shrink: the old `fs.pathExists("daily_news.json")`
  // precondition was a JSON-era assumption that wrongly fired in
  // USE_SQLITE=true prod (where daily_news.json may be absent but
  // SQLite has stories). Check the canonical source instead.
  const stories = await db.getStories();
  if (!Array.isArray(stories) || stories.length === 0) {
    console.log(
      "[audio] ERROR: no stories in canonical store. Run processor first.",
    );
    return;
  }

  const toProcess = stories.filter((s) => s.approved === true && !s.audio_path);

  console.log(`[audio] ${toProcess.length} stories need audio generation`);

  for (const story of toProcess) {
    console.log(`[audio] Generating audio for: ${story.title}`);
    let regenAttempts = 0;
    const MAX_REGEN = 2;

    try {
      // Clean TTS script using shared cleaning function
      const rawTTS = story.tts_script || story.full_script;
      const ttsText = cleanForTTS(rawTTS);
      const outputPath = path.join("output", "audio", `${story.id}.mp3`);

      // Dynamic pacing: if story has separate hook/body/cta, generate each
      // segment at a different speaking rate then concatenate
      const baseRate = (brand.voiceSettings || {}).speaking_rate || 1.1;
      if (story.hook && story.body && story.cta) {
        const segments = [
          {
            text: cleanForTTS(story.hook),
            rate: baseRate * 1.05,
            label: "hook",
          },
          {
            text: cleanForTTS(story.body),
            rate: baseRate * 0.95,
            label: "body",
          },
          { text: cleanForTTS(story.cta), rate: baseRate * 1.0, label: "cta" },
        ].filter((s) => s.text.length > 0);

        if (segments.length > 1) {
          console.log(
            `[audio] Dynamic pacing: ${segments.length} segments at rates [${segments.map((s) => s.rate.toFixed(2)).join(", ")}]`,
          );
          const segmentPaths = [];
          for (const seg of segments) {
            const segPath = path.join(
              "output",
              "audio",
              `${story.id}_${seg.label}.mp3`,
            );
            await generateTTS(seg.text, segPath, seg.rate);
            segmentPaths.push(segPath);
          }
          await concatAudioFiles(segmentPaths, outputPath);

          // Merge segment timestamps into a single combined file
          // Each segment's timestamps start from 0, so offset by cumulative duration
          const mergedChars = [];
          const mergedStarts = [];
          const mergedEnds = [];
          let cumulativeOffset = 0;
          for (const sp of segmentPaths) {
            const tsPath = sp.replace(/\.mp3$/, "_timestamps.json");
            if (await fs.pathExists(tsPath)) {
              try {
                const ts = await fs.readJson(tsPath);
                if (
                  ts.characters &&
                  ts.character_start_times_seconds &&
                  ts.character_end_times_seconds
                ) {
                  // Add a space separator between segments (except first)
                  if (mergedChars.length > 0) {
                    mergedChars.push(" ");
                    mergedStarts.push(cumulativeOffset);
                    mergedEnds.push(cumulativeOffset);
                  }
                  for (let i = 0; i < ts.characters.length; i++) {
                    mergedChars.push(ts.characters[i]);
                    mergedStarts.push(
                      ts.character_start_times_seconds[i] + cumulativeOffset,
                    );
                    mergedEnds.push(
                      ts.character_end_times_seconds[i] + cumulativeOffset,
                    );
                  }
                }
              } catch (e) {
                /* skip broken timestamp file */
              }
            }
            // Get segment duration for offset calculation
            const segDuration = await getAudioDuration(sp);
            cumulativeOffset += segDuration;
          }
          if (mergedChars.length > 0) {
            const combinedTsPath = outputPath.replace(
              /\.mp3$/,
              "_timestamps.json",
            );
            await fs.writeJson(
              combinedTsPath,
              {
                characters: mergedChars,
                character_start_times_seconds: mergedStarts,
                character_end_times_seconds: mergedEnds,
              },
              { spaces: 2 },
            );
          }

          // Clean up segment files
          for (const sp of segmentPaths) {
            await fs.remove(sp).catch(() => {});
            await fs
              .remove(sp.replace(/\.mp3$/, "_timestamps.json"))
              .catch(() => {});
          }
        } else {
          // Only one non-empty segment, use single call
          await generateTTS(ttsText, outputPath);
        }
      } else {
        await generateTTS(ttsText, outputPath);
      }

      // Duration enforcement - check if video will clear 61s
      const audioDuration = await getAudioDuration(outputPath);
      const totalDuration = audioDuration + BUMPER_DURATION;
      story.audio_duration = audioDuration;

      if (totalDuration < MIN_TOTAL_DURATION && regenAttempts < MAX_REGEN) {
        regenAttempts++;
        console.log(
          `[audio] WARNING: ${story.id} is ${totalDuration.toFixed(1)}s (need ${MIN_TOTAL_DURATION}s). Regenerating longer script (attempt ${regenAttempts}/${MAX_REGEN})...`,
        );

        // Regenerate with a longer target
        const Anthropic = require("@anthropic-ai/sdk");
        const { getChannel } = require("./channels");
        const channel = getChannel();
        const client = new Anthropic.default({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });
        const basePrompt =
          channel.systemPrompt ||
          (await fs.readFile("system_prompt.txt", "utf-8"));

        const response = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1200,
          system: basePrompt,
          messages: [
            {
              role: "user",
              content: `Rewrite this script to be 180-200 words (it was too short at ${story.word_count} words):\n\n${story.full_script}\n\nStory: ${story.title}\nKeep the same classification: ${story.classification}`,
            },
          ],
        });

        let text = response.content[0].text.trim();
        if (text.startsWith("```")) {
          text = text
            .replace(/^```(?:json)?\s*\n?/, "")
            .replace(/\n?```\s*$/, "");
        }

        try {
          const newScript = JSON.parse(text);
          const newTTS = cleanForTTS(newScript.full_script);

          await generateTTS(newTTS, outputPath);
          const newDuration = await getAudioDuration(outputPath);
          story.audio_duration = newDuration;
          story.full_script = newScript.full_script;
          story.tts_script = newTTS;
          story.word_count = newScript.word_count || story.word_count;
          console.log(
            `[audio] Regenerated: now ${(newDuration + BUMPER_DURATION).toFixed(1)}s`,
          );
        } catch (parseErr) {
          console.log(
            `[audio] Regen parse failed, keeping original: ${parseErr.message}`,
          );
          story.duration_warning = true;
        }
      } else if (totalDuration < MIN_TOTAL_DURATION) {
        console.log(
          `[audio] WARNING: ${story.id} is ${totalDuration.toFixed(1)}s (need ${MIN_TOTAL_DURATION}s) but max regen attempts (${MAX_REGEN}) reached - accepting as-is`,
        );
        story.duration_warning = true;
      } else {
        console.log(`[audio] Duration OK: ${totalDuration.toFixed(1)}s`);
      }

      story.audio_path = outputPath;
      console.log(`[audio] Saved: ${outputPath}`);
    } catch (err) {
      console.log(`[audio] ERROR for ${story.id}: ${err.message}`);
    }
  }

  await db.saveStories(stories);
  console.log("[audio] Stories updated");
}

module.exports = generateAudio;
module.exports.getAudioDuration = getAudioDuration;

if (require.main === module) {
  generateAudio().catch((err) => {
    console.log(`[audio] ERROR: ${err.message}`);
    process.exit(1);
  });
}
