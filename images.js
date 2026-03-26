const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

async function generateImages() {
  console.log('[images] Loading daily_news.json...');

  if (!await fs.pathExists('daily_news.json')) {
    console.log('[images] ERROR: daily_news.json not found. Run processor first.');
    return;
  }

  const stories = await fs.readJson('daily_news.json');
  const toProcess = stories.filter(s => s.approved === true && !s.image_path);

  console.log(`[images] ${toProcess.length} stories need image generation`);

  for (const story of toProcess) {
    console.log(`[images] Generating image for: ${story.title}`);

    const prompt = `Cinematic 8K render, dark atmosphere, dramatic rim lighting, gaming aesthetic, ${story.suggested_thumbnail_text}`;

    try {
      const response = await axios({
        method: 'POST',
        url: 'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
        headers: {
          'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        data: {
          text_prompts: [{ text: prompt, weight: 1 }],
          width: 1080,
          height: 1920,
          steps: 30,
          cfg_scale: 7,
          samples: 1,
        },
      });

      const imageData = response.data.artifacts[0].base64;
      const outputPath = path.join('output', 'images', `${story.id}.png`);
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from(imageData, 'base64'));

      story.image_path = outputPath;
      console.log(`[images] Saved: ${outputPath}`);
    } catch (err) {
      console.log(`[images] ERROR for ${story.id}: ${err.message}`);
    }
  }

  await fs.writeJson('daily_news.json', stories, { spaces: 2 });
  console.log('[images] daily_news.json updated');
}

module.exports = generateImages;

if (require.main === module) {
  generateImages().catch(err => {
    console.log(`[images] ERROR: ${err.message}`);
    process.exit(1);
  });
}
