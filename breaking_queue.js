// Pulse Gaming — Breaking News Priority Queue
// Accepts stories from the watcher, deduplicates against daily_news.json,
// and runs the fast pipeline: processor -> audio -> images -> assemble -> publish.
// Enforces a 2-hour cooldown between breaking publishes.

const fs = require('fs-extra');
const path = require('path');
const { similarity } = require('./hunter');

const COOLDOWN_MS = 2 * 60 * 60 * 1000;   // 2 hours between breaking publishes
const BREAKING_LOG = path.join(__dirname, 'breaking_log.json');
const DATA_FILE = path.join(__dirname, 'daily_news.json');

let lastPublishTime = 0;
let processing = false;
const queue = [];

// --- Read the breaking log from disk ---
async function readBreakingLog() {
  if (await fs.pathExists(BREAKING_LOG)) {
    return fs.readJson(BREAKING_LOG);
  }
  return [];
}

// --- Append to the breaking log ---
async function appendBreakingLog(entry) {
  const log = await readBreakingLog();
  log.push(entry);
  // Keep only the last 100 entries
  const trimmed = log.slice(-100);
  await fs.writeJson(BREAKING_LOG, trimmed, { spaces: 2 });
}

// --- Check whether a story is a duplicate of something already in daily_news.json ---
async function isDuplicate(story) {
  if (!await fs.pathExists(DATA_FILE)) return false;

  try {
    const existing = await fs.readJson(DATA_FILE);
    const stories = Array.isArray(existing) ? existing : [];
    return stories.some(s => similarity(s.title, story.title) > 0.5);
  } catch (err) {
    console.log(`[breaking] Dedup check failed: ${err.message}`);
    return false;
  }
}

// --- Fast pipeline: process a single breaking story end-to-end ---
async function runFastPipeline(story) {
  const startTime = Date.now();
  console.log('[breaking] === FAST PIPELINE START ===');
  console.log(`[breaking] Story: ${story.title}`);
  console.log(`[breaking] Score: ${story.breaking_score} | Trigger: ${story.breaking_trigger}`);

  try {
    // Step 1: Write to pending_news.json for the processor
    await fs.writeJson('pending_news.json', {
      timestamp: new Date().toISOString(),
      stories: [story],
    }, { spaces: 2 });

    // Step 2: Script generation via processor
    console.log('[breaking] Step 1/5: Generating script...');
    const process_stories = require('./processor');
    await process_stories();

    // Step 3: Merge the new story into daily_news.json (append, don't overwrite)
    const processed = await fs.readJson(DATA_FILE).catch(() => []);
    const newStory = processed.find(s => s.id === story.id);
    if (!newStory) {
      console.log('[breaking] Processor did not produce a story — aborting');
      return null;
    }

    // Mark it as approved and breaking
    newStory.approved = true;
    newStory.auto_approved = true;
    newStory.approved_at = new Date().toISOString();
    newStory.breaking_fast_track = true;

    // Re-read daily_news in case other processes modified it, then merge
    const allStories = await fs.readJson(DATA_FILE).catch(() => []);
    const existingIdx = allStories.findIndex(s => s.id === newStory.id);
    if (existingIdx >= 0) {
      allStories[existingIdx] = newStory;
    } else {
      allStories.unshift(newStory);
    }
    await fs.writeJson(DATA_FILE, allStories, { spaces: 2 });

    // Step 4: Audio generation
    console.log('[breaking] Step 2/5: Generating audio...');
    const audio = require('./audio');
    await audio();

    // Step 5: Image generation
    console.log('[breaking] Step 3/5: Generating images...');
    const images = require('./images');
    await images();

    // Step 6: Video assembly
    console.log('[breaking] Step 4/5: Assembling video...');
    const assemble = require('./assemble');
    await assemble();

    // Step 7: Publish (if AUTO_PUBLISH is on)
    if (process.env.AUTO_PUBLISH === 'true') {
      console.log('[breaking] Step 5/5: Publishing to all platforms...');
      const { publishNextStory } = require('./publisher');
      const result = await publishNextStory();
      if (result) {
        console.log(`[breaking] Published: YT=${result.youtube} TT=${result.tiktok} IG=${result.instagram}`);
      }
    } else {
      console.log('[breaking] Step 5/5: AUTO_PUBLISH off — skipping upload');
    }

    const elapsedMs = Date.now() - startTime;
    const elapsedSec = Math.round(elapsedMs / 1000);
    console.log(`[breaking] === FAST PIPELINE COMPLETE in ${elapsedSec}s ===`);

    // Discord notification
    try {
      const sendDiscord = require('./notify');
      await sendDiscord(
        `**BREAKING NEWS — Fast Pipeline**\n` +
        `"${story.title}"\n` +
        `Score: ${story.breaking_score} | Trigger: ${story.breaking_trigger}\n` +
        `Time to publish: ${elapsedSec}s`
      );
    } catch (err) { /* Discord notification is non-critical */ }

    return { story: newStory, timeToPublish: elapsedMs };
  } catch (err) {
    console.log(`[breaking] Fast pipeline error: ${err.message}`);
    try {
      const sendDiscord = require('./notify');
      await sendDiscord(`**BREAKING PIPELINE ERROR**: ${err.message}\nStory: ${story.title}`);
    } catch (e) { /* silent */ }
    return null;
  }
}

// --- Process the next item in the queue ---
async function processQueue() {
  if (processing || queue.length === 0) return;

  // Cooldown check
  const sinceLastPublish = Date.now() - lastPublishTime;
  if (sinceLastPublish < COOLDOWN_MS && lastPublishTime > 0) {
    const waitMin = Math.round((COOLDOWN_MS - sinceLastPublish) / 60000);
    console.log(`[breaking] Cooldown active — ${waitMin} min remaining. Queue size: ${queue.length}`);
    return;
  }

  processing = true;
  const story = queue.shift();

  try {
    const result = await runFastPipeline(story);
    if (result) {
      lastPublishTime = Date.now();
      await appendBreakingLog({
        timestamp: new Date().toISOString(),
        storyTitle: story.title,
        storyId: story.id,
        breakingScore: story.breaking_score,
        breakingTrigger: story.breaking_trigger,
        timeToPublish: result.timeToPublish,
      });
    }
  } catch (err) {
    console.log(`[breaking] Queue processing error: ${err.message}`);
  } finally {
    processing = false;
  }

  // Check if there are more items waiting
  if (queue.length > 0) {
    // Defer to next tick so we don't block
    setTimeout(() => processQueue(), 1000);
  }
}

// --- Public API ---

async function queueBreaking(story) {
  console.log(`[breaking] Received breaking story: ${story.title} (score: ${story.breaking_score})`);

  // Deduplicate against existing stories
  const isDupe = await isDuplicate(story);
  if (isDupe) {
    console.log('[breaking] Story is a duplicate of existing coverage — skipping');
    return { queued: false, reason: 'duplicate' };
  }

  // Deduplicate against items already in the queue
  const inQueue = queue.some(s => similarity(s.title, story.title) > 0.5);
  if (inQueue) {
    console.log('[breaking] Story is already queued — skipping');
    return { queued: false, reason: 'already_queued' };
  }

  queue.push(story);
  console.log(`[breaking] Queued. Position: ${queue.length}. Processing...`);

  // Trigger processing (non-blocking)
  processQueue();

  return { queued: true, position: queue.length };
}

function getQueueStatus() {
  const sinceLastPublish = Date.now() - lastPublishTime;
  const cooldownRemaining = lastPublishTime > 0 ? Math.max(0, COOLDOWN_MS - sinceLastPublish) : 0;

  return {
    queueLength: queue.length,
    processing,
    lastPublishTime: lastPublishTime > 0 ? new Date(lastPublishTime).toISOString() : null,
    cooldownRemainingMs: cooldownRemaining,
    cooldownRemainingMin: Math.round(cooldownRemaining / 60000),
    queuedStories: queue.map(s => ({ id: s.id, title: s.title, score: s.breaking_score })),
  };
}

module.exports = { queueBreaking, getQueueStatus };
