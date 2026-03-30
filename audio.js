const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ override: true });

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
      const response = await axios({
        method: 'POST',
        url: `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        data: {
          text: story.full_script,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.25,
            similarity_boost: 0.85,
            style: 0.65,
            speaking_rate: 1.2,
          },
        },
        responseType: 'arraybuffer',
      });

      const outputPath = path.join('output', 'audio', `${story.id}.mp3`);
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from(response.data));

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

if (require.main === module) {
  generateAudio().catch(err => {
    console.log(`[audio] ERROR: ${err.message}`);
    process.exit(1);
  });
}
