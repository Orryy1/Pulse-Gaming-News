const cron = require('node-cron');
const sendDiscord = require('./notify');
const dotenv = require('dotenv');

dotenv.config({ override: true });

async function runHunt() {
  console.log('[run] === HUNT MODE ===');

  const hunt = require('./hunter');
  const process_stories = require('./processor');

  console.log('[run] Step 1: Hunting Reddit...');
  const stories = await hunt();

  console.log('[run] Step 2: Processing scripts...');
  await process_stories();

  const titles = stories.map(s => `- ${s.title}`).join('\n');
  await sendDiscord(`**Pulse Gaming Hunt Complete**\n${stories.length} stories found:\n${titles}`);

  console.log('[run] Hunt complete');
}

async function runProduce() {
  console.log('[run] === PRODUCE MODE ===');

  const affiliates = require('./affiliates');
  const audio = require('./audio');
  const images = require('./images');
  const assemble = require('./assemble');

  console.log('[run] Step 1: Affiliates...');
  await affiliates();

  console.log('[run] Step 2: Audio generation...');
  await audio();

  console.log('[run] Step 3: Image generation...');
  await images();

  console.log('[run] Step 4: Assembly...');
  await assemble();

  const fs = require('fs-extra');
  let exportedPaths = [];
  if (await fs.pathExists('daily_news.json')) {
    const stories = await fs.readJson('daily_news.json');
    exportedPaths = stories.filter(s => s.exported_path).map(s => s.exported_path);
  }

  await sendDiscord(`**Pulse Gaming Produce Complete**\n${exportedPaths.length} videos exported:\n${exportedPaths.join('\n')}`);

  console.log('[run] Produce complete');
}

function runSchedule() {
  console.log('[run] === SCHEDULE MODE ===');
  console.log('[run] Scheduler started, next hunt at 6:00 AM');

  cron.schedule('0 6 * * *', async () => {
    console.log('[run] Scheduled hunt triggered');
    try {
      await runHunt();
    } catch (err) {
      console.log(`[run] Scheduled hunt error: ${err.message}`);
      await sendDiscord(`**Pulse Gaming ERROR**\nScheduled hunt failed: ${err.message}`);
    }
  });

  // Keep alive
  console.log('[run] Process will stay alive for scheduled tasks. Press Ctrl+C to exit.');
}

const mode = process.argv[2];

if (!mode) {
  console.log('Pulse Gaming Pipeline');
  console.log('=====================');
  console.log('Usage:');
  console.log('  node run.js hunt      — Fetch Reddit stories and generate scripts');
  console.log('  node run.js produce   — Generate audio, images and assemble videos');
  console.log('  node run.js schedule  — Start cron scheduler (hunt at 6 AM daily)');
  process.exit(0);
}

(async () => {
  try {
    switch (mode) {
      case 'hunt':
        await runHunt();
        break;
      case 'produce':
        await runProduce();
        break;
      case 'schedule':
        runSchedule();
        break;
      default:
        console.log(`[run] Unknown mode: ${mode}`);
        process.exit(1);
    }
  } catch (err) {
    console.log(`[run] FATAL: ${err.message}`);
    process.exit(1);
  }
})();
