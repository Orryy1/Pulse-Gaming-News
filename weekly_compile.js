const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const dotenv = require('dotenv');
const db = require('./lib/db');

const execAsync = util.promisify(exec);

dotenv.config({ override: true });

const brand = require('./brand');
const { getChannel } = require('./channels');
const { assembleLongform, chapterTime } = require('./assemble_longform');
const sendDiscord = require('./notify');

const DAILY_NEWS_PATH = path.join(__dirname, 'daily_news.json');
const HISTORY_PATH = path.join(__dirname, 'analytics_history.json');
const COMPILATION_PATH = path.join(__dirname, 'weekly_compilation.json');

const MIN_STORIES = 8;
const MAX_STORIES = 12;

// --- Load helpers (delegated to db layer, feature-flagged) ---

async function loadDailyNews() {
  return db.getStories();
}

async function loadAnalyticsHistory() {
  return db.getAnalyticsHistory();
}

// --- Get audio duration via ffprobe ---
async function getAudioDuration(audioPath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`,
      { timeout: 10000 }
    );
    return parseFloat(stdout.trim()) || 600;
  } catch (err) {
    return 600;
  }
}

// --- Date formatting ---

function formatDateRange() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return {
    display: `${weekAgo.getDate()} ${months[weekAgo.getMonth()]} - ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`,
    titleDate: `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`,
    iso: now.toISOString(),
    weekAgo: weekAgo.toISOString(),
  };
}

// --- Select the week's best stories ---

function selectTopStories(stories, history) {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  // Filter to published stories from the last 7 days
  const candidates = stories.filter(s => {
    if (!s.youtube_post_id) return false;
    const publishedAt = s.youtube_published_at || s.approved_at || s.timestamp;
    if (!publishedAt) return false;
    const age = now - new Date(publishedAt).getTime();
    return age <= weekMs;
  });

  console.log(`[weekly] Found ${candidates.length} published stories from the last 7 days`);

  if (candidates.length < 3) {
    console.log('[weekly] Not enough published stories for a compilation (need at least 3)');
    return [];
  }

  // Build a virality lookup from analytics history
  const viralityMap = {};
  if (history && history.entries) {
    for (const entry of history.entries) {
      if (entry.virality_score) {
        viralityMap[entry.id] = entry.virality_score;
      }
    }
  }

  // Rank by virality_score (from analytics), falling back to breaking_score
  const ranked = candidates.map(s => ({
    ...s,
    rank_score: s.virality_score || viralityMap[s.id] || s.breaking_score || 0,
  }));

  ranked.sort((a, b) => b.rank_score - a.rank_score);

  const count = Math.min(MAX_STORIES, Math.max(MIN_STORIES, ranked.length));
  const selected = ranked.slice(0, count);

  console.log(`[weekly] Selected top ${selected.length} stories:`);
  for (const s of selected) {
    console.log(`  - [${s.rank_score}] ${s.title.substring(0, 60)}...`);
  }

  return selected;
}

// --- Generate compilation script via Claude ---

async function generateCompilationScript(selectedStories, dateRange) {
  const channel = getChannel();

  const client = new Anthropic.default({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const storySummaries = selectedStories.map((s, i) => (
    `${i + 1}. [${s.classification || s.flair || 'NEWS'}] "${s.title}" - ${(s.full_script || s.body || '').substring(0, 200)}`
  )).join('\n');

  const prompt = `You are the scriptwriter for ${channel.name}, a gaming news channel. Write a 10-15 minute compilation script that weaves these ${selectedStories.length} stories together into a cohesive weekly roundup.

DATE RANGE: ${dateRange.display}

STORIES (ranked by performance):
${storySummaries}

RULES:
- British English, no serial comma
- Documentary tone - measured, authoritative, conversational
- Target 1500-2000 words total (approx 10-14 minutes at 140 WPM)
- Each story segment should be 100-180 words (expanded from the original short)
- Include smooth transition phrases between segments
- Intro: Welcome viewers, set the scene for the week
- Outro: Wrap up, tease next week, CTA to subscribe
- Generate chapter timestamps (format: "M:SS Title") - the intro starts at 0:00
- Each chapter starts roughly where that story's segment begins
- Estimate segment timing: intro ~30s, each story ~60-90s, outro ~20s

Output ONLY valid JSON with no preamble and no markdown backticks:
{
  "intro": "string - the opening 2-3 sentences",
  "segments": [
    {
      "story_id": "string - the story id",
      "transition": "string - 1-2 sentence transition into this story",
      "expanded_body": "string - 100-180 word expanded coverage of this story"
    }
  ],
  "outro": "string - closing 2-3 sentences with subscribe CTA",
  "chapter_timestamps": [
    { "time": "0:00", "title": "Intro" },
    { "time": "0:30", "title": "Story Title 1" }
  ],
  "full_script": "string - the complete narration text from intro through outro, all segments joined",
  "word_count": 0
}`;

  console.log('[weekly] Generating compilation script via Claude...');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: `You are a professional scriptwriter for ${channel.name}, a ${channel.niche} news YouTube channel. You write longform compilation scripts that are engaging, well-paced and factually grounded. British English throughout.`,
    messages: [{ role: 'user', content: prompt }],
  });

  let text = response.content[0].text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  const script = JSON.parse(text);
  console.log(`[weekly] Script generated: ${script.word_count} words, ${script.segments.length} segments, ${script.chapter_timestamps.length} chapters`);

  return script;
}

// --- Generate TTS audio via ElevenLabs (with-timestamps endpoint) ---

async function generateCompilationAudio(fullScript, outputPath) {
  const voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID;
  const voiceSettings = brand.voiceSettings || { stability: 0.20, similarity_boost: 0.80, style: 0.75, speaking_rate: 1.1 };

  // Clean the script for TTS
  const ttsText = (fullScript || '')
    .replace(/\[PAUSE\]/gi, '. ')
    .replace(/\[VISUAL:[^\]]*\]/gi, '')
    .replace(/\.{2,}/g, '.')
    .replace(/[*_~`#|]/g, '')
    .replace(/[^\x20-\x7E.,'!?;:\-()]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();

  console.log(`[weekly] Generating TTS audio (${ttsText.length} chars)...`);

  const response = await axios({
    method: 'POST',
    url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    data: {
      text: ttsText,
      model_id: brand.voiceModel || 'eleven_multilingual_v2',
      voice_settings: voiceSettings,
      output_format: 'mp3_44100_128',
    },
    timeout: 120000,
  });

  await fs.ensureDir(path.dirname(outputPath));

  const audioBase64 = response.data.audio_base64;
  await fs.writeFile(outputPath, Buffer.from(audioBase64, 'base64'));

  // Save word timestamps for subtitle sync
  const timestampsPath = outputPath.replace(/\.mp3$/, '_timestamps.json');
  const alignment = response.data.alignment || {};
  await fs.writeJson(timestampsPath, alignment, { spaces: 2 });

  console.log(`[weekly] TTS audio saved: ${outputPath}`);
  return outputPath;
}

// --- Main compilation orchestrator ---

async function compileWeekly() {
  console.log('[weekly] === WEEKLY COMPILATION ===');

  const channel = getChannel();
  const dateRange = formatDateRange();

  // 1. Load data sources
  const [stories, history] = await Promise.all([
    loadDailyNews(),
    loadAnalyticsHistory(),
  ]);

  // 2. Select top stories
  const selectedStories = selectTopStories(stories, history);
  if (selectedStories.length < 3) {
    console.log('[weekly] Aborting - not enough stories for a compilation');
    await sendDiscord('**Weekly Roundup** - Not enough published stories this week. Skipping compilation.');
    return null;
  }

  // 3. Generate compilation script
  const script = await generateCompilationScript(selectedStories, dateRange);

  // 4. Generate TTS audio
  const audioDir = path.join('output', 'audio');
  await fs.ensureDir(audioDir);
  const audioPath = path.join(audioDir, 'weekly_roundup.mp3');
  await generateCompilationAudio(script.full_script, audioPath);

  // 5. Get audio duration
  const duration = await getAudioDuration(audioPath);
  console.log(`[weekly] Audio duration: ${Math.round(duration)}s (~${Math.round(duration / 60)} minutes)`);

  // 6. Build segments with image data for the assembler
  const segments = script.segments.map(seg => {
    const storyObj = selectedStories.find(s => s.id === seg.story_id);
    return {
      story_id: seg.story_id,
      title: storyObj?.title || seg.story_id,
      classification: storyObj?.classification || storyObj?.flair || 'NEWS',
      transition: seg.transition,
      expanded_body: seg.expanded_body,
      images: storyObj?.downloaded_images || [],
    };
  });

  // 7. Assemble the video
  const outputDir = path.join('output', 'weekly');
  await fs.ensureDir(outputDir);
  const outputPath = path.join(outputDir, `weekly_roundup_${new Date().toISOString().slice(0, 10)}.mp4`);

  const compilation = {
    stories: selectedStories,
    audioPath,
    outputPath,
    duration,
    fullScript: script.full_script,
    segments,
    dateRange: dateRange.display,
    channelName: channel.name,
    intro: script.intro,
    outro: script.outro,
  };

  await assembleLongform(compilation);

  // 8. Upload as regular YouTube video (not Short)
  let uploadResult = null;
  if (process.env.AUTO_PUBLISH === 'true') {
    try {
      const { uploadLongform } = require('./upload_youtube');
      uploadResult = await uploadLongform({
        ...compilation,
        chapter_timestamps: script.chapter_timestamps,
        word_count: script.word_count,
        title_date: dateRange.titleDate,
      });
      console.log(`[weekly] Uploaded to YouTube: ${uploadResult.url}`);
    } catch (err) {
      console.log(`[weekly] YouTube upload failed: ${err.message}`);
    }
  } else {
    console.log('[weekly] AUTO_PUBLISH is off - skipping YouTube upload');
  }

  // 9. Save compilation data
  const compilationData = {
    compiled_at: new Date().toISOString(),
    date_range: dateRange,
    story_count: selectedStories.length,
    story_ids: selectedStories.map(s => s.id),
    word_count: script.word_count,
    duration_seconds: duration,
    audio_path: audioPath,
    output_path: outputPath,
    chapter_timestamps: script.chapter_timestamps,
    youtube_video_id: uploadResult?.videoId || null,
    youtube_url: uploadResult?.url || null,
  };

  await fs.writeJson(COMPILATION_PATH, compilationData, { spaces: 2 });
  console.log(`[weekly] Compilation data saved to ${COMPILATION_PATH}`);

  await sendDiscord(
    `**Weekly Roundup Compiled**\n` +
    `${selectedStories.length} stories, ${Math.round(duration / 60)} minutes\n` +
    `${uploadResult ? `YouTube: ${uploadResult.url}` : 'Not uploaded (AUTO_PUBLISH off)'}`
  );

  console.log('[weekly] === WEEKLY COMPILATION COMPLETE ===');
  return compilationData;
}

// --- Topic-based compilation functions ---

/**
 * Scan analytics_history.json for keywords that appear 4+ times in the last 30 days.
 * Returns topic candidates sorted by count descending, each with keyword, count and avgVirality.
 */
async function identifyCompilableTopics(days = 30) {
  const history = await loadAnalyticsHistory();
  const entries = history.entries || [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  // Filter entries to the time window
  const recent = entries.filter(e => {
    const ts = e.published_at || e.updated_at;
    return ts && new Date(ts).getTime() >= cutoff;
  });

  // Count keyword occurrences across recent titles
  const { extractKeywords } = require('./analytics');
  const kwCounts = {};

  for (const entry of recent) {
    if (!entry.title) continue;
    const keywords = extractKeywords(entry.title);
    // Deduplicate per entry so one title doesn't inflate a keyword
    const unique = [...new Set(keywords)];
    for (const kw of unique) {
      if (!kwCounts[kw]) {
        kwCounts[kw] = { count: 0, totalVirality: 0, storyIds: [] };
      }
      kwCounts[kw].count += 1;
      kwCounts[kw].totalVirality += entry.virality_score || 0;
      kwCounts[kw].storyIds.push(entry.id);
    }
  }

  // Filter to 4+ occurrences and compute average virality
  const candidates = [];
  for (const [keyword, data] of Object.entries(kwCounts)) {
    if (data.count >= 4) {
      candidates.push({
        keyword,
        count: data.count,
        avgVirality: data.count > 0 ? Math.round((data.totalVirality / data.count) * 10) / 10 : 0,
        storyIds: data.storyIds,
      });
    }
  }

  candidates.sort((a, b) => b.count - a.count || b.avgVirality - a.avgVirality);
  console.log(`[topic-compile] Found ${candidates.length} compilable topics (4+ mentions in ${days} days)`);
  return candidates;
}

/**
 * Filter stories where title contains the topic keyword.
 * Returns sorted by virality score descending.
 */
function selectTopicStories(stories, history, topic, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const topicLower = topic.toLowerCase();

  // Build virality lookup from history
  const viralityMap = {};
  if (history && history.entries) {
    for (const entry of history.entries) {
      if (entry.virality_score) {
        viralityMap[entry.id] = entry.virality_score;
      }
    }
  }

  // Filter to published stories matching the topic keyword within the time window
  const matches = stories.filter(s => {
    if (!s.youtube_post_id) return false;
    if (!s.title || !s.title.toLowerCase().includes(topicLower)) return false;
    const publishedAt = s.youtube_published_at || s.approved_at || s.timestamp;
    if (!publishedAt) return false;
    return new Date(publishedAt).getTime() >= cutoff;
  });

  // Rank by virality
  const ranked = matches.map(s => ({
    ...s,
    rank_score: s.virality_score || viralityMap[s.id] || s.breaking_score || 0,
  }));

  ranked.sort((a, b) => b.rank_score - a.rank_score);

  console.log(`[topic-compile] Topic "${topic}": ${ranked.length} matching stories in last ${days} days`);
  return ranked;
}

/**
 * Full topic compilation pipeline: select stories by topic, generate a topic-focused
 * compilation script via Claude, then assemble the longform video.
 */
async function compileByTopic(topicName) {
  console.log(`[topic-compile] === TOPIC COMPILATION: "${topicName}" ===`);

  const channel = getChannel();
  const dateRange = formatDateRange();

  // 1. Load data sources
  const [stories, history] = await Promise.all([
    loadDailyNews(),
    loadAnalyticsHistory(),
  ]);

  // 2. Select stories matching the topic
  const topicStories = selectTopicStories(stories, history, topicName);
  if (topicStories.length < 3) {
    console.log(`[topic-compile] Aborting - only ${topicStories.length} stories for "${topicName}" (need at least 3)`);
    await sendDiscord(`**Topic Compilation** - Not enough stories for "${topicName}" (${topicStories.length} found). Skipping.`);
    return null;
  }

  // Cap at MAX_STORIES
  const selected = topicStories.slice(0, MAX_STORIES);

  // 3. Generate topic-specific compilation script
  const script = await generateTopicCompilationScript(selected, topicName, dateRange, channel);

  // 4. Generate TTS audio
  const audioDir = path.join('output', 'audio');
  await fs.ensureDir(audioDir);
  const slug = topicName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const audioPath = path.join(audioDir, `topic_${slug}.mp3`);
  await generateCompilationAudio(script.full_script, audioPath);

  // 5. Get audio duration
  const duration = await getAudioDuration(audioPath);
  console.log(`[topic-compile] Audio duration: ${Math.round(duration)}s (~${Math.round(duration / 60)} minutes)`);

  // 6. Build segments with image data
  const segments = script.segments.map(seg => {
    const storyObj = selected.find(s => s.id === seg.story_id);
    return {
      story_id: seg.story_id,
      title: storyObj?.title || seg.story_id,
      classification: storyObj?.classification || storyObj?.flair || 'NEWS',
      transition: seg.transition,
      expanded_body: seg.expanded_body,
      images: storyObj?.downloaded_images || [],
    };
  });

  // 7. Assemble the video
  const outputDir = path.join('output', 'topics');
  await fs.ensureDir(outputDir);
  const outputPath = path.join(outputDir, `topic_${slug}_${new Date().toISOString().slice(0, 10)}.mp4`);

  const compilation = {
    stories: selected,
    audioPath,
    outputPath,
    duration,
    fullScript: script.full_script,
    segments,
    dateRange: dateRange.display,
    channelName: channel.name,
    intro: script.intro,
    outro: script.outro,
  };

  await assembleLongform(compilation);

  // 8. Upload if AUTO_PUBLISH is on
  let uploadResult = null;
  if (process.env.AUTO_PUBLISH === 'true') {
    try {
      const { uploadLongform } = require('./upload_youtube');
      uploadResult = await uploadLongform({
        ...compilation,
        chapter_timestamps: script.chapter_timestamps,
        word_count: script.word_count,
        title_date: dateRange.titleDate,
        topic: topicName,
      });
      console.log(`[topic-compile] Uploaded to YouTube: ${uploadResult.url}`);
    } catch (err) {
      console.log(`[topic-compile] YouTube upload failed: ${err.message}`);
    }
  }

  // 9. Save compilation data
  const compilationData = {
    compiled_at: new Date().toISOString(),
    topic: topicName,
    date_range: dateRange,
    story_count: selected.length,
    story_ids: selected.map(s => s.id),
    word_count: script.word_count,
    duration_seconds: duration,
    audio_path: audioPath,
    output_path: outputPath,
    chapter_timestamps: script.chapter_timestamps,
    youtube_video_id: uploadResult?.videoId || null,
    youtube_url: uploadResult?.url || null,
  };

  // Append to topic_compilations.json log
  const topicCompilationsPath = path.join(__dirname, 'topic_compilations.json');
  let existing = [];
  if (await fs.pathExists(topicCompilationsPath)) {
    existing = await fs.readJson(topicCompilationsPath);
  }
  existing.push(compilationData);
  await fs.writeJson(topicCompilationsPath, existing, { spaces: 2 });

  await sendDiscord(
    `**Topic Compilation: "${topicName}"**\n` +
    `${selected.length} stories, ${Math.round(duration / 60)} minutes\n` +
    `${uploadResult ? `YouTube: ${uploadResult.url}` : 'Not uploaded (AUTO_PUBLISH off)'}`
  );

  console.log(`[topic-compile] === TOPIC COMPILATION COMPLETE: "${topicName}" ===`);
  return compilationData;
}

/**
 * Generate a topic-specific compilation script via Claude.
 * Uses a prompt tailored to the topic rather than a generic weekly roundup.
 */
async function generateTopicCompilationScript(selectedStories, topicName, dateRange, channel) {
  const client = new Anthropic.default({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const storySummaries = selectedStories.map((s, i) => (
    `${i + 1}. [${s.classification || s.flair || 'NEWS'}] "${s.title}" - ${(s.full_script || s.body || '').substring(0, 200)}`
  )).join('\n');

  const prompt = `You are the scriptwriter for ${channel.name}, a gaming news channel. Write a 10-15 minute topic compilation script focused specifically on "${topicName}". This is a deep-dive roundup covering everything that happened with "${topicName}" recently.

DATE RANGE: ${dateRange.display}
TOPIC FOCUS: ${topicName}

STORIES (ranked by performance):
${storySummaries}

RULES:
- British English, no serial comma
- Documentary tone - measured, authoritative, conversational
- Target 1500-2000 words total (approx 10-14 minutes at 140 WPM)
- Frame this as a dedicated "${topicName}" roundup - not a general weekly recap
- Open with why "${topicName}" has been dominating the news cycle
- Each story segment should be 100-180 words (expanded from the original short)
- Include smooth transition phrases that connect the stories thematically around "${topicName}"
- Outro: summarise the state of "${topicName}" right now, what to watch for next, CTA to subscribe
- Generate chapter timestamps (format: "M:SS Title") - the intro starts at 0:00
- Estimate segment timing: intro ~30s, each story ~60-90s, outro ~20s

Output ONLY valid JSON with no preamble and no markdown backticks:
{
  "intro": "string - the opening 2-3 sentences framing the ${topicName} deep-dive",
  "segments": [
    {
      "story_id": "string - the story id",
      "transition": "string - 1-2 sentence transition into this story",
      "expanded_body": "string - 100-180 word expanded coverage of this story"
    }
  ],
  "outro": "string - closing 2-3 sentences summarising ${topicName} outlook with subscribe CTA",
  "chapter_timestamps": [
    { "time": "0:00", "title": "Intro" },
    { "time": "0:30", "title": "Story Title 1" }
  ],
  "full_script": "string - the complete narration text from intro through outro, all segments joined",
  "word_count": 0
}`;

  console.log(`[topic-compile] Generating "${topicName}" compilation script via Claude...`);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: `You are a professional scriptwriter for ${channel.name}, a ${channel.niche} news YouTube channel. You write topic-focused compilation scripts that provide deep, cohesive coverage of a single subject. British English throughout.`,
    messages: [{ role: 'user', content: prompt }],
  });

  let text = response.content[0].text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  const script = JSON.parse(text);
  console.log(`[topic-compile] Script generated: ${script.word_count} words, ${script.segments.length} segments`);

  return script;
}

module.exports = { compileWeekly, identifyCompilableTopics, selectTopicStories, compileByTopic };

if (require.main === module) {
  compileWeekly().catch(err => {
    console.log(`[weekly] FATAL: ${err.message}`);
    process.exit(1);
  });
}
