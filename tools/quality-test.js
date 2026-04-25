/**
 * tools/quality-test.js — orchestrator for `npm run quality:test`.
 *
 * Renders 3 representative local stories through the redesigned
 * pipeline (tools/quality-render.js), then ffprobes both the
 * NEW render (`test/output/after_<id>.mp4`) and the legacy
 * baseline (`output/final/<id>.mp4` if present), writes a
 * Markdown comparison report at `test/output/REPORT.md`.
 *
 * The script is purely local: no network, no DB writes, no
 * production touch.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");
const { renderOne } = require("./quality-render");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");

// Picked because each has audio + word-level timestamps + multiple
// images already cached locally. Mix of CONFIRMED + Trailer to
// stress different content shapes.
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

async function main() {
  await fs.ensureDir(TEST_OUT);

  console.log(`\n=== Pulse Gaming quality:test ===`);
  console.log(`Output: ${TEST_OUT}\n`);

  const results = [];
  for (const id of SAMPLES) {
    console.log(`\n--- ${id} ---`);
    let r;
    try {
      r = await renderOne(id);
    } catch (e) {
      console.error(`[quality:test] ${id}: ${e.message}`);
      r = { ok: false, error: e.message };
    }
    const baselinePath = path.join(ROOT, "output", "final", `${id}.mp4`);
    const baseline = ffprobeOrNull(baselinePath);
    const after = r?.ok ? ffprobeOrNull(r.outputPath) : null;
    results.push({ id, baseline, after, render: r });
    if (r?.ok) {
      console.log(
        `  ✓ ${id}: ${after?.duration?.toFixed(1)}s, ${fmtMB(after?.sizeBytes)}, ${fmtKbps(after?.bitrate)}, ${r.finalCount} segments, ${summariseTransitions(r.transitions)}`,
      );
    } else {
      console.log(`  ✗ ${id}: ${r?.error || "render failed"}`);
    }
  }

  // Build the report.
  const lines = [];
  lines.push(`# Pulse Gaming quality:test report`);
  lines.push(``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Branch: \`quality-redesign\``);
  lines.push(``);
  lines.push(`Samples: ${SAMPLES.map((s) => `\`${s}\``).join(", ")}`);
  lines.push(``);

  for (const r of results) {
    lines.push(`## ${r.id}`);
    lines.push(``);
    if (r.render?.ok) {
      lines.push(
        `**Render: OK** (${r.render.elapsedMs} ms, ${r.render.finalCount} segments at ~${r.render.finalDuration.toFixed(2)}s each)`,
      );
    } else {
      lines.push(`**Render: FAILED** — ${r.render?.error || "unknown error"}`);
    }
    lines.push(``);
    lines.push(`| Metric | Legacy baseline | Redesigned | Delta |`);
    lines.push(`| ------ | --------------- | ---------- | ----- |`);

    const b = r.baseline;
    const a = r.after;
    const row = (label, bv, av, fmt = (x) => String(x ?? "—")) => {
      const bvs = fmt(bv);
      const avs = fmt(av);
      let delta = "—";
      if (typeof bv === "number" && typeof av === "number") {
        const d = av - bv;
        delta = `${d >= 0 ? "+" : ""}${fmt === fmtMB ? fmtMB(d) : fmt === fmtKbps ? fmtKbps(d) : d.toFixed(1)}`;
      }
      lines.push(`| ${label} | ${bvs} | ${avs} | ${delta} |`);
    };
    row("Duration (s)", b?.duration, a?.duration, (x) => (x ?? 0).toFixed(2));
    row(
      "Frame size",
      b ? `${b.width}×${b.height}` : null,
      a ? `${a.width}×${a.height}` : null,
    );
    row(
      "Codec / profile",
      b ? `${b.vcodec} / ${b.profile || "?"}` : null,
      a ? `${a.vcodec} / ${a.profile || "?"}` : null,
    );
    row("pix_fmt", b?.pix_fmt, a?.pix_fmt);
    row("Bitrate", b?.bitrate, a?.bitrate, fmtKbps);
    row("Size", b?.sizeBytes, a?.sizeBytes, fmtMB);
    if (r.render?.ok) {
      lines.push(
        `| Segments (cuts) | ? (legacy used static 8) | ${r.render.finalCount} (~${r.render.finalDuration.toFixed(2)}s each) | — |`,
      );
      lines.push(
        `| Transition mix | 7× dissolve@0.5s | ${summariseTransitions(r.render.transitions)} | — |`,
      );
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`## How to inspect`);
  lines.push(``);
  lines.push(`Renders are at \`test/output/after_<id>.mp4\`. Compare against`);
  lines.push(
    `\`output/final/<id>.mp4\` (legacy baseline). The redesign target`,
  );
  lines.push(`shapes:`);
  lines.push(``);
  lines.push(`- More cuts: target ≥10 segments per 60s (legacy was 8 max)`);
  lines.push(
    `- Faster transitions: mix of CUT (instant) + 0.22-0.30s dissolves`,
  );
  lines.push(`- Hook overlay: visible 0–3s, fades out by 3.0s`);
  lines.push(
    `- Caption emphasis: keywords (game names, money, dates) in amber + 1.15× scale`,
  );
  lines.push(`- Subtitle sync: anchored to ElevenLabs word timestamps`);
  lines.push(``);
  lines.push(`## What's NOT in the harness`);
  lines.push(``);
  lines.push(
    `The harness is intentionally minimal: it skips entity portraits,`,
  );
  lines.push(
    `Reddit comments, stat cards, intro/outro bumpers, and the teaser`,
  );
  lines.push(`cut. Those layers are independent of the core quality changes.`);
  lines.push(`Once the core renders cleanly, those layers can be re-added in`);
  lines.push(`assemble.js.`);

  const reportPath = path.join(TEST_OUT, "REPORT.md");
  await fs.writeFile(reportPath, lines.join("\n"));
  console.log(`\nReport: ${reportPath}\n`);

  const ok = results.filter((r) => r.render?.ok).length;
  console.log(`Summary: ${ok}/${results.length} renders succeeded`);
  process.exit(ok === results.length ? 0 : 1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
