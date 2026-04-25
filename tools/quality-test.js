/**
 * tools/quality-test.js — orchestrator for `npm run quality:test`.
 *
 * Renders 3 representative local stories TWICE through the
 * redesigned pipeline:
 *
 *   1. v1 (basic redesign):     test/output/after_<id>.mp4
 *   2. v2 (Premium Render Layer): test/output/prl_<id>.mp4
 *
 * Then ffprobes both + the legacy production baseline at
 * `output/final/<id>.mp4` and writes a 3-way Markdown comparison
 * report at `test/output/REPORT.md`.
 *
 * Purely local — no network, no DB writes, no production touch.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");
const { renderOne } = require("./quality-render");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");

const SAMPLES = ["1smsr12", "1sn9xhe", "1s4denn"];

function ffprobeOrNull(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${file.replace(/\\/g, "/")}"`,
      { encoding: "utf8" },
    );
    const j = JSON.parse(out);
    const v = j.streams.find((s) => s.codec_type === "video");
    return {
      duration: parseFloat(j.format.duration),
      width: v?.width,
      height: v?.height,
      vcodec: v?.codec_name,
      profile: v?.profile,
      pix_fmt: v?.pix_fmt,
      bitrate: parseInt(j.format.bit_rate, 10),
      sizeBytes: parseInt(j.format.size, 10),
    };
  } catch {
    return null;
  }
}

function summariseTransitions(transitions) {
  if (!Array.isArray(transitions) || transitions.length === 0) return "—";
  const counts = {};
  for (const t of transitions) {
    counts[t.type] = (counts[t.type] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([k, v]) => `${v}× ${k}`)
    .join(", ");
}

function fmtMB(bytes) {
  if (!bytes) return "—";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtKbps(bps) {
  if (!bps) return "—";
  return `${Math.round(bps / 1000)} kbps`;
}

async function renderSafely(id, opts) {
  try {
    return await renderOne(id, opts);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function main() {
  await fs.ensureDir(TEST_OUT);

  console.log(`\n=== Pulse Gaming quality:test ===`);
  console.log(`Output: ${TEST_OUT}\n`);

  const results = [];
  for (const id of SAMPLES) {
    console.log(`\n--- ${id} ---`);
    const basic = await renderSafely(id, { prl: false });
    const prl = await renderSafely(id, { prl: true });
    const baselinePath = path.join(ROOT, "output", "final", `${id}.mp4`);
    const baseline = ffprobeOrNull(baselinePath);
    const basicProbe = basic?.ok ? ffprobeOrNull(basic.outputPath) : null;
    const prlProbe = prl?.ok ? ffprobeOrNull(prl.outputPath) : null;
    results.push({ id, baseline, basic, basicProbe, prl, prlProbe });

    if (basic?.ok) {
      console.log(
        `  ✓ basic: ${basicProbe?.duration?.toFixed(1)}s, ${fmtMB(basicProbe?.sizeBytes)}, ${basic.finalCount} segments`,
      );
    } else {
      console.log(`  ✗ basic: ${basic?.error || "render failed"}`);
    }
    if (prl?.ok) {
      console.log(
        `  ✓ PRL:   ${prlProbe?.duration?.toFixed(1)}s, ${fmtMB(prlProbe?.sizeBytes)}, ${prl.finalCount} segments, ${summariseTransitions(prl.transitions)}`,
      );
    } else {
      console.log(`  ✗ PRL:   ${prl?.error || "render failed"}`);
    }
  }

  // Build the 3-way report.
  const lines = [];
  lines.push(`# Pulse Gaming quality:test report`);
  lines.push(``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Branch: \`quality-redesign\``);
  lines.push(``);
  lines.push(`Samples: ${SAMPLES.map((s) => `\`${s}\``).join(", ")}`);
  lines.push(``);
  lines.push(`Three columns per story:`);
  lines.push(``);
  lines.push(
    `- **Legacy** = \`output/final/<id>.mp4\` (production baseline, pre-545c622)`,
  );
  lines.push(
    `- **v1 redesign** = \`test/output/after_<id>.mp4\` (basic redesign: smart-crop + motion presets + mixed transitions + hook overlay + caption emphasis)`,
  );
  lines.push(
    `- **PRL** = \`test/output/prl_<id>.mp4\` (Premium Render Layer: tighter pacing, multi-strategy crops, badge with pulse, source bug, lower third with amber accent line, stat card, comment swoop, hot-take card)`,
  );
  lines.push(``);

  for (const r of results) {
    lines.push(`## ${r.id}`);
    lines.push(``);
    if (r.basic?.ok) {
      lines.push(
        `**v1 render: OK** (${r.basic.elapsedMs} ms, ${r.basic.finalCount} segments at ~${r.basic.finalDuration.toFixed(2)}s)`,
      );
    } else {
      lines.push(`**v1 render: FAILED** — ${r.basic?.error}`);
    }
    if (r.prl?.ok) {
      lines.push(
        `**PRL render: OK** (${r.prl.elapsedMs} ms, ${r.prl.finalCount} segments at ~${r.prl.finalDuration.toFixed(2)}s)`,
      );
    } else {
      lines.push(`**PRL render: FAILED** — ${r.prl?.error}`);
    }
    lines.push(``);

    lines.push(`| Metric | Legacy | v1 | PRL |`);
    lines.push(`| ------ | ------ | -- | --- |`);
    const row = (label, bv, v1v, prlv, fmt = (x) => String(x ?? "—")) => {
      lines.push(`| ${label} | ${fmt(bv)} | ${fmt(v1v)} | ${fmt(prlv)} |`);
    };
    row(
      "Duration (s)",
      r.baseline?.duration,
      r.basicProbe?.duration,
      r.prlProbe?.duration,
      (x) => (x == null ? "—" : Number(x).toFixed(2)),
    );
    row(
      "Frame size",
      r.baseline ? `${r.baseline.width}×${r.baseline.height}` : null,
      r.basicProbe ? `${r.basicProbe.width}×${r.basicProbe.height}` : null,
      r.prlProbe ? `${r.prlProbe.width}×${r.prlProbe.height}` : null,
    );
    row(
      "pix_fmt",
      r.baseline?.pix_fmt,
      r.basicProbe?.pix_fmt,
      r.prlProbe?.pix_fmt,
    );
    row(
      "Profile",
      r.baseline?.profile,
      r.basicProbe?.profile,
      r.prlProbe?.profile,
    );
    row(
      "Bitrate",
      r.baseline?.bitrate,
      r.basicProbe?.bitrate,
      r.prlProbe?.bitrate,
      fmtKbps,
    );
    row(
      "Size",
      r.baseline?.sizeBytes,
      r.basicProbe?.sizeBytes,
      r.prlProbe?.sizeBytes,
      fmtMB,
    );
    row("Segments", "8 (legacy fixed)", r.basic?.finalCount, r.prl?.finalCount);
    row(
      "Avg seg (s)",
      "≈7-8",
      r.basic?.finalDuration?.toFixed(2),
      r.prl?.finalDuration?.toFixed(2),
    );
    row(
      "Transition mix",
      "7× dissolve@0.5s",
      summariseTransitions(r.basic?.transitions),
      summariseTransitions(r.prl?.transitions),
    );
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`## What PRL adds on top of v1`);
  lines.push(``);
  lines.push(
    `- **Tighter pacing**: target 10–16 segments at 2.6–5.5s instead of 8–12 at 3.5–6.5s`,
  );
  lines.push(
    `- **Multi-strategy crops** when source images < target segments — different sharp.strategy per slot (attention / entropy / N/S/E/W/centre) so adjacent shots don't repeat the same crop`,
  );
  lines.push(
    `- **Flair badge** with subtle pulse line (Confirmed=green, Breaking=red, Rumour=amber, Trailer=purple)`,
  );
  lines.push(`- **Source bug** below the badge with subreddit / publisher`);
  lines.push(
    `- **Lower third** with thin amber accent line above the channel name + tagline`,
  );
  lines.push(`- **Stat card** (timed pop-in, Steam % / players if available)`);
  lines.push(
    `- **Comment swoop** (Reddit top_comment slides in from right at ~12s)`,
  );
  lines.push(
    `- **Hot-take card** (analysis blurb / loop string at ~videoEnd-18s)`,
  );
  lines.push(``);
  lines.push(`## How to inspect`);
  lines.push(``);
  lines.push(`Open all three files for one story side-by-side:`);
  lines.push(``);
  lines.push(`\`\`\``);
  lines.push(`output/final/1smsr12.mp4         # Legacy production`);
  lines.push(`test/output/after_1smsr12.mp4    # v1 redesign`);
  lines.push(`test/output/prl_1smsr12.mp4      # PRL`);
  lines.push(`\`\`\``);
  lines.push(``);
  lines.push(`## Known gaps in this harness`);
  lines.push(``);
  lines.push(
    `- TTS audio is from older ElevenLabs voice (not Liam) — these are`,
  );
  lines.push(`  cached fixture files. Production already uses Liam.`);
  lines.push(
    `- No intro / outro bumpers in the harness — production has them via`,
  );
  lines.push(
    `  \`concatWithBumpers\`. Adding to the harness is straightforward but`,
  );
  lines.push(`  the bumpers are unchanged across all three columns so the`);
  lines.push(`  comparison stays fair without them.`);
  lines.push(
    `- No entity portrait pop-ins yet (production has them; not in PRL v1).`,
  );
  lines.push(`- No video clip slot yet (Steam / IGDB trailers).`);

  const reportPath = path.join(TEST_OUT, "REPORT.md");
  await fs.writeFile(reportPath, lines.join("\n"));
  console.log(`\nReport: ${reportPath}\n`);

  const ok = results.filter((r) => r.basic?.ok && r.prl?.ok).length;
  console.log(`Summary: ${ok}/${results.length} pairs succeeded`);
  process.exit(ok === results.length ? 0 : 1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
