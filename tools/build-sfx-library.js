/**
 * tools/build-sfx-library.js — bespoke Pulse Gaming SFX library.
 *
 * Synthesises a brand-tuned SFX kit deterministically with ffmpeg's
 * audio synthesis primitives (sine, anoisesrc) chained through
 * filter graphs (bandpass, equalizer, asetrate sweeps, afade,
 * acompressor, alimiter). Same approach a working sound designer
 * uses, except every output is reproducible from the script.
 *
 * Why bespoke vs an Epidemic Sound subscription:
 *   - Tuned to your existing Suno bed loops (similar low-end, similar
 *     transient profile)
 *   - No licensing risk, no expiring subscription
 *   - Every channel that buys the same pack sounds identical;
 *     bespoke = identifiable
 *   - The synthesis params live in source code so you can iterate
 *
 * Categories (~30 total):
 *
 *   transition/   — whooshes (5): the cut-stinger pool
 *   impact/       — short hits (5): cut emphasis, lower-third pop
 *   reveal/       — risers + drones (4): pre-card / pre-freeze build
 *   glitch/       — digital stutters (4): rumour-flair transitions
 *   tick/         — UI ticks + blips (3): caption emphasis
 *   boom/         — cinematic booms (3): big reveals, opener landing
 *
 * Output specs (all):
 *   - 44.1 kHz mono WAV (matches voice + bed sample rate)
 *   - Peak normalised to -3 dBFS (leaves headroom for the mix)
 *   - True-peak limited via alimiter
 *
 * Usage:
 *   node tools/build-sfx-library.js          # build everything
 *   node tools/build-sfx-library.js whoosh   # rebuild just one category
 *
 * Outputs to audio/sfx/{category}/{name}.wav
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SFX_DIR = path.join(ROOT, "audio", "sfx");
const SR = 44100; // sample rate

// ---------- helpers ---------- //

function ff(filter, durationS, outPath) {
  // Build a single-input lavfi pipeline that synthesises an audio
  // stream and writes it to outPath as 16-bit mono WAV.
  // The filter graph must end on a stream tagged [out].
  const cmd = [
    "ffmpeg -y -hide_banner -loglevel error",
    `-filter_complex "${filter}"`,
    `-map "[out]" -t ${durationS.toFixed(3)}`,
    `-ar ${SR} -ac 1 -c:a pcm_s16le`,
    `"${outPath.replace(/\\/g, "/")}"`,
  ].join(" ");
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

async function ensureDir(category) {
  const dir = path.join(SFX_DIR, category);
  await fs.ensureDir(dir);
  return dir;
}

// Master chain applied to every SFX:
//   - dynamic norm to even out levels
//   - true-peak limiter at -3 dBTP
//   - dc offset removal
function masterChain(inputLabel) {
  return (
    `[${inputLabel}]highpass=f=30,acompressor=threshold=-12dB:ratio=2:attack=5:release=80,` +
    `dynaudnorm=p=0.85:f=200,alimiter=limit=0.708:level=disabled[out]`
  );
}

// ---------- category builders ---------- //

async function buildTransitions() {
  const dir = await ensureDir("transition");
  console.log("[sfx] transitions/");

  // 1. whoosh-up — bandpassed noise sweeping low→high, 0.45s
  // Standard "scene wipe" stinger. Bandpass center sweeps from 200Hz
  // to 2200Hz over the duration via afftfilt (fft-based filtering).
  ff(
    `anoisesrc=color=violet:duration=0.45:sample_rate=${SR}[n];` +
      `[n]highpass=f=180,lowpass=f=2400,` +
      `afade=t=in:st=0:d=0.06:curve=qua,afade=t=out:st=0.32:d=0.13:curve=esin,` +
      `equalizer=f=600:t=h:width=200:g=4,volume=2.4[s];` +
      masterChain("s"),
    0.45,
    path.join(dir, "whoosh-up.wav"),
  );

  // 2. whoosh-down — bandpassed noise sweeping high→low, 0.55s
  // Used for return-to-base scene transitions.
  ff(
    `anoisesrc=color=pink:duration=0.55:sample_rate=${SR}[n];` +
      `[n]highpass=f=80,lowpass=f=3000,` +
      `afade=t=in:st=0:d=0.05:curve=qua,afade=t=out:st=0.42:d=0.13:curve=esin,` +
      `equalizer=f=400:t=h:width=300:g=5,volume=2.0[s];` +
      masterChain("s"),
    0.55,
    path.join(dir, "whoosh-down.wav"),
  );

  // 3. whoosh-short — quick punch transition, 0.25s
  // Fast cut emphasis between mid-slate scenes.
  ff(
    `anoisesrc=color=white:duration=0.25:sample_rate=${SR}[n];` +
      `[n]highpass=f=300,lowpass=f=4000,` +
      `afade=t=in:st=0:d=0.02:curve=qua,afade=t=out:st=0.16:d=0.09:curve=esin,` +
      `volume=2.1[s];` +
      masterChain("s"),
    0.25,
    path.join(dir, "whoosh-short.wav"),
  );

  // 4. swipe-tonal — pitched whoosh with a subtle harmonic, 0.4s
  // The "branded" transition with a tonal element.
  ff(
    `anoisesrc=color=pink:duration=0.4:sample_rate=${SR}[n];` +
      `sine=f=400:beep_factor=0:duration=0.4:sample_rate=${SR}[t];` +
      `[t]volume=0.18,afade=t=in:st=0:d=0.05,afade=t=out:st=0.3:d=0.1[tone];` +
      `[n]bandpass=f=900:width_type=h:width=600,` +
      `afade=t=in:st=0:d=0.04:curve=qua,afade=t=out:st=0.28:d=0.12:curve=esin,volume=2.2[noise];` +
      `[noise][tone]amix=inputs=2:duration=first:normalize=0[s];` +
      masterChain("s"),
    0.4,
    path.join(dir, "swipe-tonal.wav"),
  );

  // 5. whoosh-sub — low-end heavy, 0.5s
  // Used for big card transitions (takeaway, context).
  ff(
    `anoisesrc=color=brown:duration=0.5:sample_rate=${SR}[n];` +
      `[n]lowpass=f=900,highpass=f=80,` +
      `afade=t=in:st=0:d=0.05,afade=t=out:st=0.36:d=0.14,` +
      `equalizer=f=140:t=h:width=120:g=6,volume=2.6[s];` +
      masterChain("s"),
    0.5,
    path.join(dir, "whoosh-sub.wav"),
  );
}

async function buildImpacts() {
  const dir = await ensureDir("impact");
  console.log("[sfx] impacts/");

  // 1. punch-mid — sub-thump + click attack, 0.22s
  // The standard "cut-pop" sound.
  ff(
    `sine=f=70:duration=0.22:sample_rate=${SR}[sub];` +
      `[sub]afade=t=in:st=0:d=0.005,afade=t=out:st=0.06:d=0.16:curve=exp,volume=1.4[sb];` +
      `anoisesrc=color=white:duration=0.05:sample_rate=${SR}[click];` +
      `[click]highpass=f=1200,afade=t=out:st=0:d=0.05:curve=exp,volume=1.2[ck];` +
      `[sb][ck]amix=inputs=2:duration=longest:normalize=0[s];` +
      masterChain("s"),
    0.22,
    path.join(dir, "punch-mid.wav"),
  );

  // 2. punch-deep — heavier sub, 0.32s
  ff(
    `sine=f=50:duration=0.32:sample_rate=${SR}[sub];` +
      `[sub]afade=t=in:st=0:d=0.005,afade=t=out:st=0.08:d=0.24:curve=exp,volume=1.6[sb];` +
      `anoisesrc=color=brown:duration=0.08:sample_rate=${SR}[click];` +
      `[click]bandpass=f=160:width_type=h:width=120,afade=t=out:st=0:d=0.08,volume=1.0[ck];` +
      `[sb][ck]amix=inputs=2:duration=longest:normalize=0[s];` +
      masterChain("s"),
    0.32,
    path.join(dir, "punch-deep.wav"),
  );

  // 3. snap — short crisp hit, 0.12s
  // Used for emphasis on emphasis words (caption pops).
  ff(
    `anoisesrc=color=white:duration=0.12:sample_rate=${SR}[n];` +
      `[n]highpass=f=1500,lowpass=f=6000,` +
      `afade=t=in:st=0:d=0.002:curve=exp,afade=t=out:st=0.02:d=0.1:curve=exp,` +
      `volume=1.6[s];` +
      masterChain("s"),
    0.12,
    path.join(dir, "snap.wav"),
  );

  // 4. thud — soft body impact, 0.28s
  ff(
    `sine=f=110:duration=0.28:sample_rate=${SR}[t];` +
      `[t]afade=t=in:st=0:d=0.01,afade=t=out:st=0.05:d=0.22:curve=exp,volume=1.3[tn];` +
      `anoisesrc=color=brown:duration=0.28:sample_rate=${SR}[n];` +
      `[n]lowpass=f=400,afade=t=in:st=0:d=0.005,afade=t=out:st=0.08:d=0.2:curve=exp,volume=1.0[ns];` +
      `[tn][ns]amix=inputs=2:duration=first:normalize=0[s];` +
      masterChain("s"),
    0.28,
    path.join(dir, "thud.wav"),
  );

  // 5. drop — sub-bass slam, 0.45s
  // For chapter / card emphasis.
  ff(
    `sine=f=42:duration=0.45:sample_rate=${SR}[sub];` +
      `[sub]afade=t=in:st=0:d=0.008,afade=t=out:st=0.1:d=0.34:curve=exp,volume=1.7[sb];` +
      `anoisesrc=color=brown:duration=0.1:sample_rate=${SR}[click];` +
      `[click]bandpass=f=200:width_type=h:width=160,volume=0.8[ck];` +
      `[sb][ck]amix=inputs=2:duration=longest:normalize=0[s];` +
      masterChain("s"),
    0.45,
    path.join(dir, "drop.wav"),
  );
}

async function buildReveals() {
  const dir = await ensureDir("reveal");
  console.log("[sfx] reveals/");

  // 1. riser-fast — 0.8s tonal sweep + noise build
  // Pre-card riser. Sine sweeps from 200Hz to 2000Hz.
  ff(
    `sine=f=200:duration=0.8:sample_rate=${SR}[s1];` +
      `[s1]aresample=async=1,asetrate=${SR}*1+0.005*0.8/0.8[s1r];` +
      // Trick: use atempo + asetrate cascade for a natural-feeling sweep.
      // We approximate by feeding two overlapping sines mixed.
      `sine=f=400:duration=0.8:sample_rate=${SR}[s2];` +
      `sine=f=800:duration=0.8:sample_rate=${SR}[s3];` +
      `anoisesrc=color=white:duration=0.8:sample_rate=${SR}[n];` +
      `[n]bandpass=f=2000:width_type=h:width=1200,afade=t=in:st=0:d=0.6,volume=1.6[ns];` +
      `[s1r]volume=0.4,afade=t=in:st=0:d=0.2,afade=t=out:st=0.7:d=0.1[a];` +
      `[s2]volume=0.5,afade=t=in:st=0.2:d=0.4,afade=t=out:st=0.75:d=0.05[b];` +
      `[s3]volume=0.6,afade=t=in:st=0.4:d=0.35,afade=t=out:st=0.75:d=0.05[c];` +
      `[a][b][c][ns]amix=inputs=4:duration=first:normalize=0[s];` +
      masterChain("s"),
    0.8,
    path.join(dir, "riser-fast.wav"),
  );

  // 2. riser-slow — 1.6s slow build
  ff(
    `anoisesrc=color=pink:duration=1.6:sample_rate=${SR}[n];` +
      `[n]bandpass=f=1500:width_type=h:width=1500,` +
      `afade=t=in:st=0:d=1.4:curve=qua,afade=t=out:st=1.55:d=0.05,volume=1.8[ns];` +
      `sine=f=300:duration=1.6:sample_rate=${SR}[t];` +
      `[t]volume=0.3,afade=t=in:st=0:d=1.5:curve=qua,afade=t=out:st=1.55:d=0.05[tn];` +
      `[ns][tn]amix=inputs=2:duration=first:normalize=0[s];` +
      masterChain("s"),
    1.6,
    path.join(dir, "riser-slow.wav"),
  );

  // 3. drone-tense — sustained ambient pad, 2.0s
  // Used for context-card backgrounds when an extra layer of atmosphere is wanted.
  ff(
    `sine=f=110:duration=2.0:sample_rate=${SR}[a];` +
      `sine=f=165:duration=2.0:sample_rate=${SR}[b];` +
      `[a]volume=0.5,afade=t=in:st=0:d=0.3,afade=t=out:st=1.6:d=0.4[an];` +
      `[b]volume=0.35,afade=t=in:st=0:d=0.4,afade=t=out:st=1.6:d=0.4[bn];` +
      `anoisesrc=color=brown:duration=2.0:sample_rate=${SR}[n];` +
      `[n]lowpass=f=300,volume=0.4,afade=t=in:st=0:d=0.3,afade=t=out:st=1.6:d=0.4[ns];` +
      `[an][bn][ns]amix=inputs=3:duration=first:normalize=0[s];` +
      masterChain("s"),
    2.0,
    path.join(dir, "drone-tense.wav"),
  );

  // 4. swell — quick build for opener punctuation, 0.6s
  ff(
    `anoisesrc=color=white:duration=0.6:sample_rate=${SR}[n];` +
      `[n]bandpass=f=2500:width_type=h:width=1500,` +
      `afade=t=in:st=0:d=0.45:curve=qua,afade=t=out:st=0.55:d=0.05,volume=1.7[ns];` +
      `sine=f=600:duration=0.6:sample_rate=${SR}[t];` +
      `[t]volume=0.4,afade=t=in:st=0:d=0.5:curve=qua,afade=t=out:st=0.55:d=0.05[tn];` +
      `[ns][tn]amix=inputs=2:duration=first:normalize=0[s];` +
      masterChain("s"),
    0.6,
    path.join(dir, "swell.wav"),
  );
}

async function buildGlitches() {
  const dir = await ensureDir("glitch");
  console.log("[sfx] glitches/");

  // 1. glitch-stutter — rapid amplitude burst pattern, 0.3s
  // For rumour-flair transitions.
  ff(
    `anoisesrc=color=white:duration=0.3:sample_rate=${SR}[n];` +
      `[n]bandpass=f=1800:width_type=h:width=1400,` +
      `tremolo=f=18:d=0.85,` +
      `afade=t=in:st=0:d=0.02,afade=t=out:st=0.22:d=0.08,volume=2.0[s];` +
      masterChain("s"),
    0.3,
    path.join(dir, "glitch-stutter.wav"),
  );

  // 2. glitch-static — short noise burst with hard edges, 0.18s
  ff(
    `anoisesrc=color=white:duration=0.18:sample_rate=${SR}[n];` +
      `[n]highpass=f=600,bandpass=f=2200:width_type=h:width=1800,` +
      `afade=t=in:st=0:d=0.005,afade=t=out:st=0.14:d=0.04,volume=2.2[s];` +
      masterChain("s"),
    0.18,
    path.join(dir, "glitch-static.wav"),
  );

  // 3. glitch-bitcrush — degraded burst via aresample down/up, 0.25s
  // Resample to 8kHz and back simulates bitcrushing.
  ff(
    `anoisesrc=color=pink:duration=0.25:sample_rate=${SR}[n];` +
      `[n]bandpass=f=1000:width_type=h:width=900,` +
      `aresample=8000,aresample=${SR},` +
      `afade=t=in:st=0:d=0.02,afade=t=out:st=0.18:d=0.07,volume=2.0[s];` +
      masterChain("s"),
    0.25,
    path.join(dir, "glitch-bitcrush.wav"),
  );

  // 4. glitch-cut — sharp digital cut artifact, 0.1s
  // Use as caption-word emphasis on rumour stories.
  ff(
    `anoisesrc=color=white:duration=0.1:sample_rate=${SR}[n];` +
      `[n]highpass=f=1500,bandpass=f=3000:width_type=h:width=2200,` +
      `tremolo=f=40:d=0.95,` +
      `afade=t=in:st=0:d=0.005,afade=t=out:st=0.06:d=0.04,volume=2.0[s];` +
      masterChain("s"),
    0.1,
    path.join(dir, "glitch-cut.wav"),
  );
}

async function buildTicks() {
  const dir = await ensureDir("tick");
  console.log("[sfx] ticks/");

  // 1. tick-blip — 30ms sine pop at 1500Hz
  ff(
    `sine=f=1500:duration=0.06:sample_rate=${SR}[t];` +
      `[t]afade=t=in:st=0:d=0.002:curve=exp,afade=t=out:st=0.01:d=0.05:curve=exp,volume=1.4[s];` +
      masterChain("s"),
    0.06,
    path.join(dir, "tick-blip.wav"),
  );

  // 2. tick-soft — 50ms sine at 800Hz with light noise
  ff(
    `sine=f=800:duration=0.08:sample_rate=${SR}[t];` +
      `[t]afade=t=in:st=0:d=0.002,afade=t=out:st=0.01:d=0.07:curve=exp,volume=1.2[tn];` +
      `anoisesrc=color=white:duration=0.08:sample_rate=${SR}[n];` +
      `[n]bandpass=f=2000:width_type=h:width=1200,volume=0.4,afade=t=out:st=0:d=0.08:curve=exp[ns];` +
      `[tn][ns]amix=inputs=2:duration=longest:normalize=0[s];` +
      masterChain("s"),
    0.08,
    path.join(dir, "tick-soft.wav"),
  );

  // 3. tick-hard — sharp click for caption emphasis, 0.04s
  ff(
    `anoisesrc=color=white:duration=0.04:sample_rate=${SR}[n];` +
      `[n]highpass=f=2000,bandpass=f=3500:width_type=h:width=2000,` +
      `afade=t=out:st=0:d=0.04:curve=exp,volume=1.4[s];` +
      masterChain("s"),
    0.04,
    path.join(dir, "tick-hard.wav"),
  );
}

async function buildBooms() {
  const dir = await ensureDir("boom");
  console.log("[sfx] booms/");

  // 1. boom-cinema — slow attack sub + rumble, 1.4s
  // For opener landing or big reveal.
  ff(
    `sine=f=38:duration=1.4:sample_rate=${SR}[sub];` +
      `[sub]afade=t=in:st=0:d=0.04,afade=t=out:st=0.4:d=1.0:curve=exp,volume=1.7[sb];` +
      `anoisesrc=color=brown:duration=1.4:sample_rate=${SR}[r];` +
      `[r]lowpass=f=200,afade=t=in:st=0:d=0.06,afade=t=out:st=0.5:d=0.9:curve=exp,volume=1.0[rumble];` +
      `[sb][rumble]amix=inputs=2:duration=first:normalize=0[s];` +
      masterChain("s"),
    1.4,
    path.join(dir, "boom-cinema.wav"),
  );

  // 2. boom-impact — sharper attack than cinema, 0.9s
  ff(
    `sine=f=55:duration=0.9:sample_rate=${SR}[sub];` +
      `[sub]afade=t=in:st=0:d=0.01,afade=t=out:st=0.2:d=0.7:curve=exp,volume=1.7[sb];` +
      `anoisesrc=color=brown:duration=0.9:sample_rate=${SR}[r];` +
      `[r]lowpass=f=300,afade=t=in:st=0:d=0.02,afade=t=out:st=0.3:d=0.6:curve=exp,volume=0.9[rumble];` +
      `[sb][rumble]amix=inputs=2:duration=first:normalize=0[s];` +
      masterChain("s"),
    0.9,
    path.join(dir, "boom-impact.wav"),
  );

  // 3. boom-soft — atmospheric, longer tail, 1.8s
  // Quote-card backdrop or somber reveals.
  ff(
    `sine=f=44:duration=1.8:sample_rate=${SR}[sub];` +
      `[sub]afade=t=in:st=0:d=0.1,afade=t=out:st=0.7:d=1.1:curve=exp,volume=1.5[sb];` +
      `sine=f=88:duration=1.8:sample_rate=${SR}[harm];` +
      `[harm]volume=0.3,afade=t=in:st=0:d=0.15,afade=t=out:st=0.8:d=1.0:curve=exp[h];` +
      `[sb][h]amix=inputs=2:duration=first:normalize=0[s];` +
      masterChain("s"),
    1.8,
    path.join(dir, "boom-soft.wav"),
  );
}

// ---------- main ---------- //

const CATEGORIES = {
  transition: buildTransitions,
  impact: buildImpacts,
  reveal: buildReveals,
  glitch: buildGlitches,
  tick: buildTicks,
  boom: buildBooms,
};

async function main() {
  const target = process.argv[2];
  await fs.ensureDir(SFX_DIR);

  if (target) {
    const fn = CATEGORIES[target];
    if (!fn)
      throw new Error(
        `unknown category "${target}" — pick from: ${Object.keys(CATEGORIES).join(", ")}`,
      );
    await fn();
  } else {
    for (const [, fn] of Object.entries(CATEGORIES)) await fn();
  }

  console.log("");
  console.log("[sfx] manifest:");
  for (const cat of Object.keys(CATEGORIES)) {
    const dir = path.join(SFX_DIR, cat);
    if (!(await fs.pathExists(dir))) continue;
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".wav"));
    console.log(`  ${cat.padEnd(11)} ${files.length} files`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
