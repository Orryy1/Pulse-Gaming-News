const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

dotenv.config({ override: true });

const brand = require('./brand');

const BUMPER_DURATION = 0; // bumpers removed — audio must hit 61s on its own
const MIN_TOTAL_DURATION = 61; // TikTok Creator Rewards minimum

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

// --- Generate TTS audio via ElevenLabs (with word-level timestamps) ---
async function generateTTS(text, outputPath) {
  const voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID;
  const voiceSettings = brand.voiceSettings || { stability: 0.20, similarity_boost: 0.80, style: 0.75, speaking_rate: 1.1 };
  const response = await axios({
    method: 'POST',
    url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    data: {
      text,
      model_id: brand.voiceModel || 'eleven_multilingual_v2',
      voice_settings: voiceSettings,
      output_format: 'mp3_44100_128',
    },
  });

  await fs.ensureDir(path.dirname(outputPath));

  // Response is JSON with base64 audio + word-level alignment
  const audioBase64 = response.data.audio_base64;
  await fs.writeFile(outputPath, Buffer.from(audioBase64, 'base64'));

  // Save word timestamps for subtitle sync
  const timestampsPath = outputPath.replace(/\.mp3$/, '_timestamps.json');
  const alignment = response.data.alignment || {};
  await fs.writeJson(timestampsPath, alignment, { spaces: 2 });

  return outputPath;
}

async function generateAudio() {
  console.log('[audio] Loading daily_news.json...');

  if (!await fs.pathExists('daily_news.json')) {
    console.log('[audio] ERROR: daily_news.json not found. Run processor first.');
    return;
  }

  const stories = await fs.readJson('daily_news.json');
  const toProcess = stories.filter(s => s.approved === true && !s.audio_path);

  console.log(`[audio] ${toProcess.length} stories need audio generation`);

  for (const story of toProcess) {
    console.log(`[audio] Generating audio for: ${story.title}`);

    try {
      // Clean TTS script — remove markers and punctuation that causes vocal artifacts
      const rawTTS = story.tts_script || story.full_script;
      const ttsText = (rawTTS || '')
        .replace(/\[PAUSE\]/gi, ', ')
        .replace(/\[VISUAL:[^\]]*\]/gi, '')
        .replace(/\.{2,}/g, '.')          // collapse ellipses to single period
        .replace(/[*_~`#|]/g, '')         // strip markdown formatting
        .replace(/\s+/g, ' ')
        .trim();
      const outputPath = path.join('output', 'audio', `${story.id}.mp3`);

      await generateTTS(ttsText, outputPath);

      // Duration enforcement — check if video will clear 61s
      const audioDuration = await getAudioDuration(outputPath);
      const totalDuration = audioDuration + BUMPER_DURATION;
      story.audio_duration = audioDuration;

      if (totalDuration < MIN_TOTAL_DURATION) {
        console.log(`[audio] WARNING: ${story.id} is ${totalDuration.toFixed(1)}s (need ${MIN_TOTAL_DURATION}s). Regenerating longer script...`);

        // Regenerate with a longer target
        const Anthropic = require('@anthropic-ai/sdk');
        const { getChannel } = require('./channels');
        const channel = getChannel();
        const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
        const basePrompt = channel.systemPrompt || await fs.readFile('system_prompt.txt', 'utf-8');

        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1200,
          system: basePrompt,
          messages: [{
            role: 'user',
            content: `Rewrite this script to be 180-200 words (it was too short at ${story.word_count} words):\n\n${story.full_script}\n\nStory: ${story.title}\nKeep the same classification: ${story.classification}`,
          }],
        });

        let text = response.content[0].text.trim();
        if (text.startsWith('```')) {
          text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }

        try {
          const newScript = JSON.parse(text);
          const newTTS = (newScript.full_script || '')
            .replace(/\[PAUSE\]/gi, '...')
            .replace(/\[VISUAL:[^\]]*\]/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

          await generateTTS(newTTS, outputPath);
          const newDuration = await getAudioDuration(outputPath);
          story.audio_duration = newDuration;
          story.full_script = newScript.full_script;
          story.tts_script = newTTS;
          story.word_count = newScript.word_count || story.word_count;
          console.log(`[audio] Regenerated: now ${(newDuration + BUMPER_DURATION).toFixed(1)}s`);
        } catch (parseErr) {
          console.log(`[audio] Regen parse failed, keeping original: ${parseErr.message}`);
          story.duration_warning = true;
        }
      } else {
        console.log(`[audio] Duration OK: ${totalDuration.toFixed(1)}s`);
      }

      story.audio_path = outputPath;
      console.log(`[audio] Saved: ${outputPath}`);
    } catch (err) {
      console.log(`[audio] ERROR for ${story.id}: ${err.message}`);
    }
  }

  await fs.writeJson('daily_news.json', stories, { spaces: 2 });
  console.log('[audio] daily_news.json updated');
}

module.exports = generateAudio;
module.exports.getAudioDuration = getAudioDuration;

if (require.main === module) {
  generateAudio().catch(err => {
    console.log(`[audio] ERROR: ${err.message}`);
    process.exit(1);
  });
}
