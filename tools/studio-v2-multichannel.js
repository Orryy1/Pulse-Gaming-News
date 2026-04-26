/**
 * tools/studio-v2-multichannel.js — render the v2 prototype across
 * all 3 channels (Pulse Gaming amber, The Signal purple, Stacked
 * green) and build a 3-up side-by-side comparison MP4.
 *
 * Pipeline per channel:
 *   1. Build all 4 per-story per-channel HF cards
 *      (hf_<kind>_card_<id>__<channel>.mp4)
 *   2. Render the v2 prototype with the channel theme applied
 *      (studio_v2_<id>__<channel>.mp4)
 *
 * Then:
 *   3. Stack all 3 channel renders horizontally into
 *      studio_v2_<id>_multichannel.mp4 (3240 x 1920)
 *   4. Build a 3-up channel contact sheet
 *
 * Usage:
 *   node tools/studio-v2-multichannel.js [storyId]
 *
 * Default storyId: 1sn9xhe
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");

const CHANNELS = ["pulse-gaming", "stacked", "the-signal"];
const STORY_ID = process.argv[2] || "1sn9xhe";

const FONT_OPT =
  process.platform === "win32"
    ? "fontfile='C\\:/Windows/Fonts/arial.ttf'"
    : "font='DejaVu Sans'";

function loadStoryRow(storyId) {
  const Database = require("better-sqlite3");
  const db = new Database(path.join(ROOT, "data", "pulse.db"), {
    readonly: true,
  });
  const row = db
    .prepare(
      `SELECT id, title, hook, body, full_script, classification,
              flair, subreddit, source_type, top_comment
       FROM stories WHERE id = ?`,
    )
    .get(storyId);
  db.close();
  if (!row) throw new Error(`no story row found for ${storyId}`);
  return row;
}

function runNode(scriptArgs, env) {
  const result = spawnSync("node", scriptArgs, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `Subprocess failed: node ${scriptArgs.join(" ")} (status ${result.status})`,
    );
  }
}

async function buildCardsForChannel(channelId) {
  console.log("");
  console.log("=========================================");
  console.log(`  Channel: ${channelId} — building cards`);
  console.log("=========================================");

  const {
    buildAllStoryCards,
    deriveCardContent,
  } = require("../lib/studio/v2/hf-card-builders");
  const { buildStoryPackage } = require("../lib/studio/v2/story-package");

  const story = loadStoryRow(STORY_ID);
  const { pkg } = await buildStoryPackage(STORY_ID, { skipLlm: true });
  const content = deriveCardContent({ story, pkg });
  console.log(
    `       hook: "${pkg.hook.chosen.text.slice(0, 60)}..." (${pkg.hook.chosen.wordCount}w)`,
  );
  console.log(
    `       context: ${content.context.number} / ${content.context.sub}`,
  );
  console.log(`       takeaway: ${content.takeaway.headlineWords.join(" ")}`);

  const manifest = await buildAllStoryCards({ story, pkg, channelId });
  return manifest;
}

async function renderForChannel(channelId) {
  console.log("");
  console.log("=========================================");
  console.log(`  Channel: ${channelId} — rendering v2`);
  console.log("=========================================");

  // Pass CHANNEL env so the orchestrator picks the right channel-themed cards.
  const isDefault = channelId === "pulse-gaming";
  const suffix = isDefault ? "" : `__${channelId}`;
  runNode([path.join(ROOT, "tools", "studio-v2-render.js"), STORY_ID], {
    CHANNEL: channelId,
    STUDIO_V2_VOICE: "production",
    STUDIO_V2_SKIP_LLM: "true",
    STUDIO_V2_ALLOW_VOICE_FALLBACK: "true",
    STUDIO_V2_OUTPUT_SUFFIX: suffix,
  });

  const outputPath = path.join(TEST_OUT, `studio_v2_${STORY_ID}${suffix}.mp4`);
  if (!(await fs.pathExists(outputPath))) {
    throw new Error(`expected v2 render not found: ${outputPath}`);
  }
  return outputPath;
}

async function buildThreeUpComparison(channelOutputs) {
  console.log("");
  console.log("=========================================");
  console.log("  Building 3-up channel comparison");
  console.log("=========================================");

  const outPath = path.join(TEST_OUT, `studio_v2_${STORY_ID}_multichannel.mp4`);

  // Stack horizontally with brand-coloured top labels.
  // Pulse Gaming = amber, Stacked = green, The Signal = purple.
  const labels = {
    "pulse-gaming": { text: "PULSE GAMING", colour: "0xFF6B1A" },
    stacked: { text: "STACKED", colour: "0x00C853" },
    "the-signal": { text: "THE SIGNAL", colour: "0xA855F7" },
  };

  const filterParts = [];
  let inputIdx = 0;
  for (const ch of CHANNELS) {
    const lbl = labels[ch];
    filterParts.push(
      `[${inputIdx}:v]setpts=PTS-STARTPTS,scale=1080:1920,fps=30,format=yuv420p[c${inputIdx}raw]`,
    );
    filterParts.push(
      `[c${inputIdx}raw]drawbox=x=0:y=0:w=iw:h=86:color=black@0.78:t=fill,drawbox=x=0:y=84:w=iw:h=4:color=${lbl.colour}@0.95:t=fill,drawtext=text='${lbl.text}':${FONT_OPT}:fontcolor=${lbl.colour}:fontsize=44:x=(w-tw)/2:y=18[c${inputIdx}]`,
    );
    inputIdx++;
  }
  filterParts.push(`[c0][c1][c2]hstack=inputs=3[outv]`);
  // Use the Pulse Gaming audio (channels render the same audio mix per the v2 pipeline)
  filterParts.push(`[0:a]anull[outa]`);

  const filterPath = path.join(
    TEST_OUT,
    `studio_v2_${STORY_ID}_multichannel_filter.txt`,
  );
  await fs.writeFile(filterPath, filterParts.join(";\n"));

  const inputArgs = channelOutputs
    .map((p) => `-i "${p.replace(/\\/g, "/")}"`)
    .join(" ");

  const cmd = [
    "ffmpeg -y -hide_banner -loglevel warning",
    inputArgs,
    `-filter_complex_script "${filterPath.replace(/\\/g, "/")}"`,
    `-map "[outv]" -map "[outa]"`,
    "-c:v libx264 -crf 22 -preset medium",
    "-pix_fmt yuv420p -profile:v high -level:v 5.1",
    "-c:a aac -b:a 192k",
    "-r 30 -shortest",
    `-movflags +faststart "${outPath.replace(/\\/g, "/")}"`,
  ].join(" ");

  console.log(`[multichannel] rendering 3-up comparison…`);
  const start = Date.now();
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
  console.log(
    `[multichannel] done in ${Date.now() - start}ms → ${path.relative(ROOT, outPath)}`,
  );
  return outPath;
}

async function buildChannelContactSheets(channelOutputs) {
  console.log("");
  console.log("[contact-sheets] building per-channel contact sheets");

  const sheets = [];
  for (let i = 0; i < CHANNELS.length; i++) {
    const ch = CHANNELS[i];
    const src = channelOutputs[i];
    const out = path.join(TEST_OUT, `studio_v2_${STORY_ID}__${ch}_contact.jpg`);
    execSync(
      `ffmpeg -y -hide_banner -loglevel error -i "${src.replace(/\\/g, "/")}" -vf "fps=1/1.5,scale=320:568:force_original_aspect_ratio=decrease,pad=320:568:(ow-iw)/2:(oh-ih)/2:0x0D0D0F,tile=8x4:padding=8:margin=12:color=0x0D0D0F" -frames:v 1 -q:v 2 "${out.replace(/\\/g, "/")}"`,
      { cwd: ROOT, stdio: "inherit" },
    );
    sheets.push(out);
  }

  // Combine all 3 contact sheets into a single 3-row image
  const combined = path.join(
    TEST_OUT,
    `studio_v2_${STORY_ID}_multichannel_contact.jpg`,
  );
  const labels = ["pulse-gaming", "stacked", "the-signal"];
  const filterArgs = sheets
    .map(
      (_, i) =>
        `[${i}:v]drawbox=x=0:y=0:w=iw:h=44:color=black@0.78:t=fill,drawtext=text='${labels[i].toUpperCase()}':${FONT_OPT}:fontcolor=white:fontsize=22:x=24:y=14[r${i}]`,
    )
    .join(";");
  const stack = `[r0][r1][r2]vstack=inputs=3[v]`;
  const inputs = sheets.map((p) => `-i "${p.replace(/\\/g, "/")}"`).join(" ");
  execSync(
    `ffmpeg -y -hide_banner -loglevel error ${inputs} -filter_complex "${filterArgs};${stack}" -map "[v]" -frames:v 1 -q:v 2 "${combined.replace(/\\/g, "/")}"`,
    { cwd: ROOT, stdio: "inherit" },
  );
  console.log(
    `[contact-sheets] combined sheet → ${path.relative(ROOT, combined)}`,
  );
  return { sheets, combined };
}

async function main() {
  console.log("");
  console.log("================================================");
  console.log(`  Studio v2 multi-channel render — ${STORY_ID}`);
  console.log(`  Channels: ${CHANNELS.join(", ")}`);
  console.log("================================================");

  const channelOutputs = [];
  const cardManifests = [];

  for (const ch of CHANNELS) {
    cardManifests.push(await buildCardsForChannel(ch));
    channelOutputs.push(await renderForChannel(ch));
  }

  const compareOut = await buildThreeUpComparison(channelOutputs);
  const contactSheets = await buildChannelContactSheets(channelOutputs);

  // Write manifest
  const manifest = {
    storyId: STORY_ID,
    generatedAt: new Date().toISOString(),
    channels: CHANNELS.map((ch, i) => ({
      channelId: ch,
      v2Render: path.relative(ROOT, channelOutputs[i]).replace(/\\/g, "/"),
      cards: Object.fromEntries(
        Object.entries(cardManifests[i].cards || {}).map(([k, v]) => [
          k,
          path.relative(ROOT, v.outPath).replace(/\\/g, "/"),
        ]),
      ),
    })),
    multichannelMp4: path.relative(ROOT, compareOut).replace(/\\/g, "/"),
    contactSheet: path
      .relative(ROOT, contactSheets.combined)
      .replace(/\\/g, "/"),
  };
  const manifestPath = path.join(
    TEST_OUT,
    `studio_v2_${STORY_ID}_multichannel_manifest.json`,
  );
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  console.log("");
  console.log("================================================");
  console.log("  Multi-channel render complete");
  console.log("================================================");
  console.log("");
  for (const ch of CHANNELS) {
    const entry = manifest.channels.find((c) => c.channelId === ch);
    console.log(`  ${ch}:`);
    console.log(`    v2 render: ${entry.v2Render}`);
    for (const [k, v] of Object.entries(entry.cards)) {
      console.log(`    card.${k}: ${v}`);
    }
  }
  console.log("");
  console.log(`  3-up MP4: ${manifest.multichannelMp4}`);
  console.log(`  Contact sheet: ${manifest.contactSheet}`);
  console.log(`  Manifest: ${path.relative(ROOT, manifestPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
