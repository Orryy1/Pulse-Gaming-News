/**
 * Master orchestration script for Orryy YouTube description updates.
 *
 * This runs all steps in order:
 * 1. Resume updating remaining videos (quota-aware)
 * 2. Re-update already-done videos with new artist socials
 *
 * Usage:
 *   node scripts/run_description_pipeline.js           — full pipeline
 *   node scripts/run_description_pipeline.js status     — show progress
 *   node scripts/run_description_pipeline.js preview    — preview next 3 descriptions
 *
 * Run daily until all 585 videos are complete (~200/day due to YouTube quota).
 */
const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

async function showStatus() {
  const allVideos = await fs.readJson(path.join(OUTPUT_DIR, 'all_videos.json'));
  const progress = await fs.readJson(path.join(OUTPUT_DIR, 'update_progress.json'));
  const artistCache = await fs.readJson(path.join(OUTPUT_DIR, 'artist_cache.json'));

  let socialsProgress = { updated: [], failed: [] };
  const socialsPath = path.join(OUTPUT_DIR, 'socials_update_progress.json');
  if (await fs.pathExists(socialsPath)) {
    socialsProgress = await fs.readJson(socialsPath);
  }

  let lyricsCount = 0;
  const lyricsPath = path.join(OUTPUT_DIR, 'lyrics_cache.json');
  if (await fs.pathExists(lyricsPath)) {
    const lyrics = await fs.readJson(lyricsPath);
    lyricsCount = Object.keys(lyrics).filter(k => lyrics[k]).length;
  }

  // Count how many still need the boilerplate
  const boilerplateDone = new Set(progress.updated.map(u => u.videoId));
  const alreadyComplete = allVideos.filter(v => {
    const d = v.description;
    return d.includes('👑Orryy🦁') && d.includes('Follow Orryy') && d.includes('SUBMISSIONS') && d.includes('▪️◽◼️◽▪️');
  });
  const totalDone = new Set([...boilerplateDone, ...alreadyComplete.map(v => v.videoId)]);

  console.log('=== ORRYY DESCRIPTION UPDATE STATUS ===\n');
  console.log(`Total videos:           ${allVideos.length}`);
  console.log(`Already complete:       ${alreadyComplete.length} (had full template before)`);
  console.log(`Updated by script:      ${progress.updated.length}`);
  console.log(`Total done:             ${totalDone.size}`);
  console.log(`Remaining:              ${allVideos.length - totalDone.size}`);
  console.log(`\nArtist cache entries:    ${Object.keys(artistCache).length}`);
  console.log(`Re-updated with socials: ${socialsProgress.updated.length}`);
  console.log(`Lyrics cached:          ${lyricsCount}`);
  console.log(`\nReal failures:          ${progress.failed.filter(f => !f.error.includes('quota')).length}`);
}

async function main() {
  const command = process.argv[2] || 'run';

  if (command === 'status') {
    await showStatus();
    return;
  }

  if (command === 'preview') {
    console.log('Running preview...\n');
    execSync('node scripts/resume_updates.js preview', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
    return;
  }

  if (command === 'run') {
    console.log('=== Step 1: Update remaining videos with boilerplate + socials ===\n');
    try {
      execSync('node scripts/resume_updates.js', { cwd: path.join(__dirname, '..'), stdio: 'inherit', timeout: 600000 });
    } catch (err) {
      // Script may exit with error on quota exceeded
      console.log('Step 1 complete (may have hit quota)\n');
    }

    console.log('\n=== Step 2: Re-update existing videos with artist socials ===\n');
    try {
      execSync('node scripts/re_update_with_socials.js', { cwd: path.join(__dirname, '..'), stdio: 'inherit', timeout: 600000 });
    } catch (err) {
      console.log('Step 2 complete (may have hit quota)\n');
    }

    console.log('\n=== Final Status ===\n');
    await showStatus();
    return;
  }

  console.log('Usage: node scripts/run_description_pipeline.js [status|preview|run]');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
