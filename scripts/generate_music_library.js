#!/usr/bin/env node
/*
  Generate Music Library - pre-generates a pool of varied background tracks
  per channel so each video sounds different.

  Usage:
    node scripts/generate_music_library.js              # current channel
    node scripts/generate_music_library.js --all        # all channels
    node scripts/generate_music_library.js --count 5    # generate 5 tracks (default: all prompts)
*/

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const MUSIC_CACHE = path.join(__dirname, '..', 'output', 'music');
const TARGET_DURATION = 70; // ~65s video + 5s buffer

async function generateTrack(apiKey, channelId, promptIdx, prompt, duration) {
  const filename = `${channelId}_${duration}s_v${promptIdx}.mp3`;
  const filepath = path.join(MUSIC_CACHE, filename);

  if (await fs.pathExists(filepath)) {
    console.log(`  [skip] ${filename} already exists`);
    return filepath;
  }

  console.log(`  [gen] v${promptIdx}: "${prompt.substring(0, 60)}..."`);

  const response = await axios({
    method: 'POST',
    url: 'https://api.elevenlabs.io/v1/music',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    data: {
      prompt,
      duration_seconds: Math.min(duration + 5, 120),
      force_instrumental: true,
    },
    responseType: 'arraybuffer',
    timeout: 120000,
  });

  await fs.writeFile(filepath, Buffer.from(response.data));
  const sizeKB = Math.round(response.data.byteLength / 1024);
  console.log(`  [done] ${filename} (${sizeKB}KB)`);
  return filepath;
}

async function generateForChannel(channel, apiKey, maxCount) {
  const prompts = channel.musicPrompts || [channel.musicPrompt];
  const count = maxCount || prompts.length;

  console.log(`\n[music-library] ${channel.name} - generating ${count} tracks`);

  let generated = 0;
  for (let i = 0; i < count && i < prompts.length; i++) {
    try {
      await generateTrack(apiKey, channel.id, i, prompts[i], TARGET_DURATION);
      generated++;
      // Rate limit - ElevenLabs can be touchy with rapid music generation
      if (i < count - 1) {
        console.log('  [wait] 5s rate limit pause...');
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (err) {
      console.log(`  [error] v${i} failed: ${err.message}`);
    }
  }

  console.log(`[music-library] ${channel.name}: ${generated}/${count} tracks generated`);
  return generated;
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.log('[music-library] ERROR: ELEVENLABS_API_KEY not set');
    process.exit(1);
  }

  await fs.ensureDir(MUSIC_CACHE);

  const args = process.argv.slice(2);
  const doAll = args.includes('--all');
  const countIdx = args.indexOf('--count');
  const maxCount = countIdx !== -1 ? parseInt(args[countIdx + 1]) : null;

  const channelRegistry = require('../channels');
  let channels;

  if (doAll) {
    channels = Object.values(channelRegistry.channels || {});
    if (channels.length === 0) {
      // Fallback: load individually
      channels = [
        require('../channels/pulse-gaming'),
        require('../channels/stacked'),
        require('../channels/the-signal'),
      ];
    }
  } else {
    channels = [channelRegistry.getChannel()];
  }

  let totalGenerated = 0;
  for (const channel of channels) {
    totalGenerated += await generateForChannel(channel, apiKey, maxCount);
  }

  // Summary
  const allFiles = (await fs.readdir(MUSIC_CACHE)).filter(f => f.endsWith('.mp3'));
  console.log(`\n[music-library] Library complete: ${allFiles.length} total tracks in output/music/`);

  // Group by channel
  const byChannel = {};
  for (const f of allFiles) {
    const ch = f.split('_')[0] || 'legacy';
    byChannel[ch] = (byChannel[ch] || 0) + 1;
  }
  for (const [ch, count] of Object.entries(byChannel)) {
    console.log(`  ${ch}: ${count} tracks`);
  }
}

main().catch(err => {
  console.error(`[music-library] FATAL: ${err.message}`);
  process.exit(1);
});
