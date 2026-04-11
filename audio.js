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
  const listContent = files
    .map((f) => `file '${path.basename(f)}'`)
    .join("\n");
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

// --- Generate TTS audio via ElevenLabs (with word-level timestamps) ---
async function generateTTS(text, outputPath, rateOverride) {
  const voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID;
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
  const response = await axios({
    method: "POST",
    url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    data: {
      text,
      model_id: brand.voiceModel || "eleven_multilingual_v2",
      voice_settings: voiceSettings,
      output_format: "mp3_44100_128",
    },
  });

  await fs.ensureDir(path.dirname(outputPath));

  // Response is JSON with base64 audio + word-level alignment
  const audioBase64 = response.data.audio_base64;
  await fs.writeFile(outputPath, Buffer.from(audioBase64, "base64"));

  // Save word timestamps for subtitle sync
  const timestampsPath = outputPath.replace(/\.mp3$/, "_timestamps.json");
  const alignment = response.data.alignment || {};
  await fs.writeJson(timestampsPath, alignment, { spaces: 2 });

  return outputPath;
}

async function generateAudio() {
  console.log("[audio] Loading daily_news.json...");

  if (!(await fs.pathExists("daily_news.json"))) {
    console.log(
      "[audio] ERROR: daily_news.json not found. Run processor first.",
    );
    return;
  }

  const stories = await db.getStories();
  const toProcess = stories.filter((s) => s.approved === true && !s.audio_path);

  console.log(`[audio] ${toProcess.length} stories need audio generation`);

  for (const story of toProcess) {
    console.log(`[audio] Generating audio for: ${story.title}`);
    let regenAttempts = 0;
    const MAX_REGEN = 2;

    try {
      // Clean TTS script - remove markers and punctuation that causes vocal artifacts
      const rawTTS = story.tts_script || story.full_script;
      const ttsText = (rawTTS || "")
        .replace(/\[PAUSE\]/gi, ", ") // comma + space gives a natural pause without artifacts
        .replace(/\[VISUAL:[^\]]*\]/gi, "")
        .replace(/\.{2,}/g, ".") // collapse ellipses to single period
        .replace(/[*_~`#|]/g, "") // strip markdown formatting
        .replace(/[""]/g, '"') // normalize smart quotes
        .replace(/['']/g, "'") // normalize smart apostrophes
        .replace(/[--]/g, " - ") // normalize dashes
        .replace(/(\w)-(\w)/g, "$1 $2") // split compound words (farrell-type, co-lead) to prevent TTS long pauses
        .replace(/\$(\d+(?:\.\d{1,2})?)\s*(billion|million|trillion)/gi, (_, n, unit) => `${n} ${unit.toLowerCase()} dollars`)
        .replace(/\$(\d+(?:\.\d{1,2})?)/g, (_, n) => {
          const num = parseFloat(n);
          if (n.includes('.')) return `${n} dollars`;
          return `${num} dollar${num === 1 ? '' : 's'}`;
        })
        .replace(/£(\d+(?:\.\d{1,2})?)/g, (_, n) => `${n} pounds`)
        .replace(/€(\d+(?:\.\d{1,2})?)/g, (_, n) => `${n} euros`)
        .replace(/(\d{4})/g, (match) => {
          // spell out years to prevent mispronunciation
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
        .replace(/[^\x20-\x7E.,'!?;:\-()"/]/g, "") // strip non-ASCII chars that cause TTS glitches
        .replace(/\s+/g, " ")
        .replace(/\.\s*\./g, ".") // collapse double periods
        .replace(/\.\s*,/g, ",") // collapse period-comma artifacts
        .replace(/,\s*,/g, ",") // collapse double commas
        .trim();
      const outputPath = path.join("output", "audio", `${story.id}.mp3`);

      // Dynamic pacing: if story has separate hook/body/cta, generate each
      // segment at a different speaking rate then concatenate
      const baseRate = (brand.voiceSettings || {}).speaking_rate || 1.1;
      if (story.hook && story.body && story.cta) {
        const cleanSegment = (raw) =>
          (raw || "")
            .replace(/\[PAUSE\]/gi, ", ")
            .replace(/\[VISUAL:[^\]]*\]/gi, "")
            .replace(/\.{2,}/g, ".")
            .replace(/[*_~`#|]/g, "")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u2013\u2014]/g, " - ")
            .replace(/(\w)-(\w)/g, "$1 $2")
            .replace(/\$(\d+(?:\.\d{1,2})?)\s*(billion|million|trillion)/gi, (_, n, unit) => `${n} ${unit.toLowerCase()} dollars`)
            .replace(/\$(\d+(?:\.\d{1,2})?)/g, (_, n) => {
              const num = parseFloat(n);
              if (n.includes('.')) return `${n} dollars`;
              return `${num} dollar${num === 1 ? '' : 's'}`;
            })
            .replace(/£(\d+(?:\.\d{1,2})?)/g, (_, n) => `${n} pounds`)
            .replace(/€(\d+(?:\.\d{1,2})?)/g, (_, n) => `${n} euros`)
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
            .replace(/[^\x20-\x7E.,'!?;:\-()"/]/g, "")
            .replace(/\s+/g, " ")
            .replace(/\.\s*\./g, ".")
            .replace(/\.\s*,/g, ",")
            .replace(/,\s*,/g, ",")
            .trim();

        const segments = [
          {
            text: cleanSegment(story.hook),
            rate: baseRate * 1.05,
            label: "hook",
          },
          {
            text: cleanSegment(story.body),
            rate: baseRate * 0.95,
            label: "body",
          },
          { text: cleanSegment(story.cta), rate: baseRate * 1.0, label: "cta" },
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
          const newTTS = (newScript.full_script || "")
            .replace(/\[PAUSE\]/gi, ", ")
            .replace(/\[VISUAL:[^\]]*\]/gi, "")
            .replace(/[""]/g, '"')
            .replace(/['']/g, "'")
            .replace(/[--]/g, " - ")
            .replace(/(\w)-(\w)/g, "$1 $2")
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
            .replace(/[^\x20-\x7E.,'!?;:\-()"/]/g, "")
            .replace(/\s+/g, " ")
            .trim();

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
