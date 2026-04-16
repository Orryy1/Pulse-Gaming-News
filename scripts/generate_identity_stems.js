#!/usr/bin/env node
/*
  Generate owned audio identity stems for Phase 9 channel packs.

  For each channel listed in --channels (or all non-default channels by
  default), this script generates role-specific stems via the ElevenLabs
  Music API and writes them into channels/<id>/audio/, then rewrites the
  channel's pack.json `assets` array so the resolver picks them up
  instead of falling through to pulse-v1.

  Roles generated (duration in seconds):

    bed_primary      60s  loopable background bed for standard videos
    bed_breaking     60s  loopable background bed for breaking alerts
    sting_verified   10s  flair=Verified opener hit
    sting_rumour     10s  flair=Rumour opener hit
    sting_breaking   10s  flair=Breaking opener hit

  Usage:
    node scripts/generate_identity_stems.js                 # stacked + the-signal
    node scripts/generate_identity_stems.js --channels stacked
    node scripts/generate_identity_stems.js --force         # re-generate existing files
    node scripts/generate_identity_stems.js --dry-run       # print plan only

  Cost: ~10 API calls per channel (2 beds @ 60s + 3 stings @ 10s).
  Running time: a few minutes per channel (5s rate-limit pause between calls).
*/

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const ROLE_SPECS = {
  stacked: {
    bed_primary: {
      duration: 60,
      filename: "bed_primary.mp3",
      prompt:
        "loopable dark cinematic trap beat, 60 seconds, deep sub bass, " +
        "steady kick, ticking clock tension, stock market atmosphere, " +
        "minimal percussion, warm boardroom ambience, no vocals, " +
        "seamless loop, professional broadcast bed",
    },
    bed_breaking: {
      duration: 60,
      filename: "bed_breaking.mp3",
      prompt:
        "loopable urgent financial news bed, 60 seconds, fast ticking " +
        "percussion, rising tension synths, breaking market alert energy, " +
        "driving sub bass, dramatic pulse, no vocals, seamless loop, " +
        "broadcast grade",
    },
    sting_verified: {
      duration: 10,
      filename: "sting_verified.mp3",
      prompt:
        "10 second short financial news sting, deep brass hit followed " +
        "by a clean confirmation chord, authoritative and composed, " +
        "boardroom confident, ends clean, no vocals",
    },
    sting_rumour: {
      duration: 10,
      filename: "sting_rumour.mp3",
      prompt:
        "10 second short speculative finance sting, uncertain synth " +
        "rise, questioning tonal resolution, hushed boardroom whisper " +
        "aesthetic, dark minor tonality, ends unresolved, no vocals",
    },
    sting_breaking: {
      duration: 10,
      filename: "sting_breaking.mp3",
      prompt:
        "10 second short breaking stock market alert sting, alarm hit, " +
        "fast ticking percussion, urgent rising tension, dramatic " +
        "orchestral stab, news bulletin energy, ends emphatic, no vocals",
    },
  },
  "the-signal": {
    bed_primary: {
      duration: 60,
      filename: "bed_primary.mp3",
      prompt:
        "loopable futuristic synth bed, 60 seconds, subtle sub bass, " +
        "clean digital percussion, cyberpunk minimal, glitch textures " +
        "low in mix, analog warmth, server room ambient, no vocals, " +
        "seamless loop",
    },
    bed_breaking: {
      duration: 60,
      filename: "bed_breaking.mp3",
      prompt:
        "loopable urgent tech news bed, 60 seconds, glitchy fast " +
        "percussion, rising synth arpeggios, data breach tension, " +
        "reese bass, cyberpunk alarm energy, driving pulse, no vocals, " +
        "seamless loop",
    },
    sting_verified: {
      duration: 10,
      filename: "sting_verified.mp3",
      prompt:
        "10 second short tech news confirmation sting, clean synth chord " +
        "rising to a resolved major, bright digital confirmation beep, " +
        "verified signal aesthetic, ends clean, no vocals",
    },
    sting_rumour: {
      duration: 10,
      filename: "sting_rumour.mp3",
      prompt:
        "10 second short speculative tech sting, filtered synth rise, " +
        "granular glitch textures, rumour whisper aesthetic, uncertain " +
        "minor tonality, ends unresolved, no vocals",
    },
    sting_breaking: {
      duration: 10,
      filename: "sting_breaking.mp3",
      prompt:
        "10 second short breaking tech news sting, digital alarm hit, " +
        "data breach alert tones, urgent synth stab, cyberpunk news " +
        "bulletin energy, ends emphatic, no vocals",
    },
  },
};

const REGISTERED_CHANNELS = Object.keys(ROLE_SPECS);

function parseArgs(argv) {
  const args = { channels: null, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--channels") {
      args.channels = (argv[i + 1] || "").split(",").filter(Boolean);
      i++;
    } else if (a === "--force") {
      args.force = true;
    } else if (a === "--dry-run") {
      args.dryRun = true;
    }
  }
  if (!args.channels || !args.channels.length) {
    args.channels = REGISTERED_CHANNELS;
  }
  return args;
}

async function generateStem({ apiKey, channelId, role, spec, outPath, force }) {
  if (!force && (await fs.pathExists(outPath))) {
    const size = (await fs.stat(outPath)).size;
    console.log(
      `  [skip] ${channelId}/${role} exists (${Math.round(size / 1024)}KB)`,
    );
    return { ok: true, skipped: true };
  }
  console.log(
    `  [gen ] ${channelId}/${role} ${spec.duration}s :: ` +
      `"${spec.prompt.slice(0, 70)}..."`,
  );
  try {
    const response = await axios({
      method: "POST",
      url: "https://api.elevenlabs.io/v1/music",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      data: {
        prompt: spec.prompt,
        duration_seconds: Math.min(Math.max(spec.duration, 10), 120),
        force_instrumental: true,
      },
      responseType: "arraybuffer",
      timeout: 180000,
    });
    await fs.ensureDir(path.dirname(outPath));
    await fs.writeFile(outPath, Buffer.from(response.data));
    const kb = Math.round(response.data.byteLength / 1024);
    console.log(`  [done] ${channelId}/${role} saved ${kb}KB`);
    return { ok: true, bytes: response.data.byteLength };
  } catch (err) {
    const detail = err.response
      ? `${err.response.status} ${JSON.stringify(err.response.data).slice(0, 160)}`
      : err.message;
    console.log(`  [fail] ${channelId}/${role}: ${detail}`);
    return { ok: false, error: detail };
  }
}

async function updatePackJson(channelId, specs) {
  const packPath = path.join(
    __dirname,
    "..",
    "channels",
    channelId,
    "audio",
    "pack.json",
  );
  if (!(await fs.pathExists(packPath))) {
    console.log(`  [warn] ${packPath} missing; skipping pack registration`);
    return;
  }
  const pack = await fs.readJson(packPath);
  const audioDir = path.dirname(packPath);

  const existingByRole = new Map((pack.assets || []).map((a) => [a.role, a]));
  for (const [role, spec] of Object.entries(specs)) {
    const onDisk = path.join(audioDir, spec.filename);
    if (!(await fs.pathExists(onDisk))) continue;
    const bytes = (await fs.stat(onDisk)).size;
    existingByRole.set(role, {
      role,
      filename: spec.filename,
      duration_ms: Math.round(spec.duration * 1000),
      bytes,
      license: pack.license || "owned",
    });
  }
  pack.assets = Array.from(existingByRole.values()).sort((a, b) =>
    a.role.localeCompare(b.role),
  );
  // Swap the deferred-production note for a real one.
  if (
    typeof pack._note === "string" &&
    pack._note.startsWith("Owned stems pending")
  ) {
    pack._note =
      "Stems generated via ElevenLabs Music API. Regenerate with " +
      "scripts/generate_identity_stems.js --force --channels " +
      channelId;
  }
  await fs.writeJson(packPath, pack, { spaces: 2 });
  console.log(
    `  [pack] ${channelId}/pack.json now lists ${pack.assets.length} asset(s)`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey && !args.dryRun) {
    console.error("[stems] ERROR: ELEVENLABS_API_KEY not set");
    process.exit(1);
  }

  const plan = [];
  for (const channelId of args.channels) {
    const specs = ROLE_SPECS[channelId];
    if (!specs) {
      console.log(`[stems] no identity spec defined for ${channelId}; skip`);
      continue;
    }
    for (const [role, spec] of Object.entries(specs)) {
      const outPath = path.join(
        __dirname,
        "..",
        "channels",
        channelId,
        "audio",
        spec.filename,
      );
      plan.push({ channelId, role, spec, outPath });
    }
  }
  if (!plan.length) {
    console.log("[stems] nothing to generate");
    return;
  }
  console.log(
    `[stems] plan: ${plan.length} stem(s) across ` +
      `${args.channels.length} channel(s) (force=${args.force})`,
  );
  if (args.dryRun) {
    for (const p of plan) {
      console.log(`  would gen ${p.channelId}/${p.role} -> ${p.outPath}`);
    }
    return;
  }

  const results = [];
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const r = await generateStem({ apiKey, ...p, force: args.force });
    results.push({ ...p, ...r });
    if (!r.skipped && i < plan.length - 1) {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  for (const channelId of args.channels) {
    if (!ROLE_SPECS[channelId]) continue;
    await updatePackJson(channelId, ROLE_SPECS[channelId]);
  }

  const generated = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `[stems] done: ${generated} generated, ${skipped} skipped, ${failed} failed`,
  );

  // Re-sync DB packs so audioIdentity.resolve() immediately picks up the
  // new assets without waiting for the next cron-driven syncPacks call.
  if (process.env.USE_SQLITE === "true") {
    try {
      const audioIdentity = require("../lib/audio-identity");
      audioIdentity.syncPacks({ log: console });
      console.log("[stems] audio_packs re-synced in SQLite");
    } catch (err) {
      console.log(`[stems] pack re-sync skipped: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(`[stems] FATAL: ${err.message}`);
  process.exit(1);
});
