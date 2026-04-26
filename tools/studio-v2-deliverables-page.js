/**
 * tools/studio-v2-deliverables-page.js — generates a single browsable
 * HTML page that bundles every v2 artefact for review.
 *
 * Output: test/output/studio_v2_deliverables.html
 *
 * Sections:
 *   - Headline: verdict, anchor commit, render output stats
 *   - Embedded MP4 player for the canonical v2 render
 *   - Embedded MP4 player for the side-by-side v1-vs-v2 comparison
 *   - Side-by-side contact sheets (v1 vs v2)
 *   - Rubric scoreboard (auto-graded criteria with green/amber/red)
 *   - Scene list (v2)
 *   - Premium card lane decisions
 *   - Grammar v2 transformations applied
 *   - Beat-awareness summary
 *   - Editorial summary (chosen hook, tightened script, pronunciation map)
 *
 * No external assets — fonts come from system stack, MP4s/JPGs are
 * referenced by relative path so the page renders correctly when
 * served from test/output/ via any local web server.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");

const STORY_ID = process.argv[2] || "1sn9xhe";

const COLOURS = {
  green: "#1a8f3c",
  amber: "#d29c1a",
  red: "#c8332b",
  bg: "#0d0d0f",
  panel: "#16161a",
  text: "#e8dcc8",
  accent: "#ff6b1a",
  muted: "rgba(232, 220, 200, 0.55)",
};

function gradeBadge(grade) {
  const colour = COLOURS[grade] || COLOURS.muted;
  return `<span class="grade" style="background:${colour}">${grade.toUpperCase()}</span>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function currentBranch() {
  try {
    return execSync("git branch --show-current", {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function currentCommit() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function autoTable(auto) {
  const rows = Object.entries(auto).map(([k, v]) => {
    if (!v || typeof v !== "object" || !v.grade) return "";
    return `<tr>
      <td class="metric">${escapeHtml(k)}</td>
      <td class="value">${escapeHtml(String(v.value))}</td>
      <td class="grade-cell">${gradeBadge(v.grade)}</td>
    </tr>`;
  });
  return `<table class="rubric-table">
    <thead><tr><th>Criterion</th><th>Value</th><th>Grade</th></tr></thead>
    <tbody>${rows.join("\n")}</tbody>
  </table>`;
}

function sceneListTable(scenes) {
  const rows = scenes.map((s, i) => {
    const tag = s.grammarV2 ? `<span class="tag-v2">${s.grammarV2}</span>` : "";
    const lane =
      s.premiumLane === "hyperframes" ? `<span class="tag-hf">HF</span>` : "";
    return `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(s.type)} ${tag}${lane}</td>
      <td>${escapeHtml(s.label || "")}</td>
      <td>${Number(s.duration || 0).toFixed(2)}s</td>
      <td class="src">${escapeHtml(path.basename(String(s.source || "")))}</td>
    </tr>`;
  });
  return `<table class="scene-table">
    <thead><tr><th>#</th><th>Type</th><th>Label</th><th>Dur</th><th>Source</th></tr></thead>
    <tbody>${rows.join("\n")}</tbody>
  </table>`;
}

async function main() {
  const reportPath = path.join(TEST_OUT, `${STORY_ID}_studio_v2_report.json`);
  const pkgPath = path.join(TEST_OUT, `${STORY_ID}_studio_v2_package.json`);
  const v1ReportPath = path.join(
    TEST_OUT,
    `${STORY_ID}_studio_v1_elevenlabs_report.json`,
  );
  if (!(await fs.pathExists(reportPath)))
    throw new Error(`v2 report missing: ${reportPath}`);

  const report = await fs.readJson(reportPath);
  const pkg = (await fs.pathExists(pkgPath))
    ? await fs.readJson(pkgPath)
    : null;
  const v1Report = (await fs.pathExists(v1ReportPath))
    ? await fs.readJson(v1ReportPath)
    : null;

  const renderRel = path.relative(
    TEST_OUT,
    path.join(TEST_OUT, `studio_v2_${STORY_ID}.mp4`),
  );
  const compareRel = path.relative(
    TEST_OUT,
    path.join(TEST_OUT, `studio_v1_vs_v2_${STORY_ID}.mp4`),
  );
  const contactV1Rel = path.relative(
    TEST_OUT,
    path.join(TEST_OUT, `studio_v1_${STORY_ID}_contact.jpg`),
  );
  const contactV2Rel = path.relative(
    TEST_OUT,
    path.join(TEST_OUT, `studio_v2_${STORY_ID}_contact.jpg`),
  );

  const verdictColour = COLOURS[report.verdict.lane] || COLOURS.muted;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Studio v2 — deliverables · ${escapeHtml(STORY_ID)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: ${COLOURS.bg};
    color: ${COLOURS.text};
    font-family: -apple-system, "Segoe UI", "Inter", system-ui, sans-serif;
    line-height: 1.55;
  }
  .wrap { max-width: 1280px; margin: 0 auto; padding: 48px 32px 96px; }
  header {
    border-bottom: 2px solid ${COLOURS.accent};
    padding-bottom: 24px;
    margin-bottom: 36px;
  }
  h1 {
    font-size: 36px;
    margin: 0;
    letter-spacing: -0.01em;
  }
  h1 .accent { color: ${COLOURS.accent}; }
  h2 {
    font-size: 22px;
    margin: 48px 0 18px;
    border-left: 4px solid ${COLOURS.accent};
    padding-left: 14px;
  }
  .meta {
    display: flex;
    gap: 28px;
    flex-wrap: wrap;
    margin-top: 14px;
    color: ${COLOURS.muted};
    font-size: 14px;
  }
  .meta b { color: ${COLOURS.text}; }
  .verdict {
    display: inline-block;
    padding: 8px 18px;
    background: ${verdictColour};
    color: white;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    border-radius: 4px;
    font-size: 13px;
  }
  .stat-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin: 18px 0;
  }
  .stat {
    background: ${COLOURS.panel};
    padding: 18px;
    border-radius: 6px;
    border-left: 3px solid ${COLOURS.accent};
  }
  .stat .label { font-size: 11px; letter-spacing: 0.18em; color: ${COLOURS.muted}; text-transform: uppercase; }
  .stat .num { font-size: 28px; font-weight: 800; margin-top: 6px; }
  video {
    display: block;
    width: 100%;
    max-height: 80vh;
    background: #000;
    border-radius: 6px;
  }
  .video-wrap { margin: 18px 0 12px; }
  .video-wrap.compare video { max-height: 70vh; }
  .video-caption {
    color: ${COLOURS.muted};
    font-size: 13px;
    margin-bottom: 24px;
  }
  .contact-sheets {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    margin: 18px 0;
  }
  .contact-sheet img {
    width: 100%;
    height: auto;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.06);
  }
  .contact-sheet .label {
    color: ${COLOURS.muted};
    font-size: 12px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    background: ${COLOURS.panel};
    border-radius: 6px;
    overflow: hidden;
    margin: 16px 0;
    font-size: 14px;
  }
  th, td {
    padding: 10px 14px;
    text-align: left;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  th { background: rgba(255, 107, 26, 0.08); font-weight: 700; color: ${COLOURS.accent}; }
  td.metric { font-weight: 600; }
  td.value { font-family: Consolas, monospace; }
  td.src { color: ${COLOURS.muted}; font-family: Consolas, monospace; font-size: 12px; }
  .grade-cell { width: 100px; text-align: right; }
  .grade {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 3px;
    color: white;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.18em;
  }
  .tag-v2 {
    background: rgba(255, 107, 26, 0.18);
    color: ${COLOURS.accent};
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 700;
    margin-left: 6px;
  }
  .tag-hf {
    background: rgba(107, 92, 231, 0.18);
    color: #b0a5ff;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 700;
    margin-left: 6px;
  }
  .quote-block {
    background: ${COLOURS.panel};
    border-left: 4px solid ${COLOURS.accent};
    padding: 18px 22px;
    border-radius: 4px;
    font-size: 17px;
    margin: 14px 0;
    font-style: italic;
  }
  .pron-list, .grammar-list, .decision-list {
    background: ${COLOURS.panel};
    padding: 14px 22px;
    border-radius: 6px;
    margin: 12px 0;
    font-family: Consolas, monospace;
    font-size: 13px;
  }
  .pron-list li, .grammar-list li, .decision-list li {
    padding: 4px 0;
    list-style: none;
    color: ${COLOURS.muted};
  }
  .pron-list li b, .grammar-list li b, .decision-list li b { color: ${COLOURS.text}; }
  footer {
    margin-top: 64px;
    padding-top: 24px;
    border-top: 1px solid rgba(255,255,255,0.06);
    color: ${COLOURS.muted};
    font-size: 12px;
  }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Studio Short Engine <span class="accent">v2</span> — deliverables</h1>
  <div class="meta">
    <span><b>Story:</b> ${escapeHtml(STORY_ID)}</span>
    <span><b>Branch:</b> ${escapeHtml(currentBranch())}</span>
    <span><b>Commit:</b> ${escapeHtml(currentCommit())}</span>
    <span><b>Generated:</b> ${escapeHtml(report.generatedAt || new Date().toISOString())}</span>
    <span class="verdict">${escapeHtml(report.verdict.lane)}</span>
  </div>
</header>

<div class="stat-row">
  <div class="stat"><div class="label">Green hits</div><div class="num">${report.verdict.greenHits}</div></div>
  <div class="stat"><div class="label">Amber trips</div><div class="num">${report.verdict.amberTrips}</div></div>
  <div class="stat"><div class="label">Red trips</div><div class="num">${report.verdict.redTrips}</div></div>
  <div class="stat"><div class="label">HF cards</div><div class="num">${report.premiumLane?.hyperframesCardCount ?? "?"}</div></div>
</div>

<h2>Canonical render</h2>
<div class="video-wrap">
  <video controls preload="metadata" src="${escapeHtml(renderRel.replace(/\\/g, "/"))}"></video>
  <div class="video-caption">
    ${escapeHtml(report.runtime?.path || renderRel)} · ${(report.runtime?.durationS || 0).toFixed(2)}s ·
    ${((report.runtime?.sizeBytes || 0) / 1024 / 1024).toFixed(2)} MB ·
    ${report.runtime?.width}x${report.runtime?.height} ·
    ${escapeHtml(report.runtime?.profile || "")} h264 / ${escapeHtml(report.runtime?.audioCodec || "")}
  </div>
</div>

<h2>Side-by-side: v1 (left) vs v2 (right)</h2>
<div class="video-wrap compare">
  <video controls preload="metadata" src="${escapeHtml(compareRel.replace(/\\/g, "/"))}"></video>
  <div class="video-caption">
    Both panels run on the v2 audio mix. v1 is the prior production
    pipeline (from the v1 ElevenLabs report); v2 is this build.
  </div>
</div>

<h2>Contact sheets</h2>
<div class="contact-sheets">
  <div class="contact-sheet">
    <div class="label">v1 — every 1.5s</div>
    <img src="${escapeHtml(contactV1Rel.replace(/\\/g, "/"))}" alt="v1 contact sheet">
  </div>
  <div class="contact-sheet">
    <div class="label">v2 — every 1.5s</div>
    <img src="${escapeHtml(contactV2Rel.replace(/\\/g, "/"))}" alt="v2 contact sheet">
  </div>
</div>

<h2>Rubric scoreboard</h2>
${autoTable(report.auto)}

<h2>Editorial</h2>
<div class="quote-block">"${escapeHtml(report.editorial?.chosenHook || "")}"</div>
<div class="meta">
  <span><b>Source:</b> ${escapeHtml(report.editorial?.chosenHookSource || "?")}</span>
  <span><b>Tightened script word count:</b> ${escapeHtml(String(report.editorial?.tightenedWordCount ?? "?"))}</span>
  <span><b>Pronunciation map entries:</b> ${escapeHtml(String(report.editorial?.pronunciationMapEntries ?? 0))}</span>
</div>

${
  pkg && pkg.pronunciationMap?.length
    ? `<h2>Pronunciation map</h2>
<ul class="pron-list">
  ${pkg.pronunciationMap
    .map(
      (e) =>
        `<li><b>${escapeHtml(e.written)}</b> → ${escapeHtml(e.spoken)} <span style="color:${COLOURS.muted}">[${escapeHtml(e.kind)}]</span></li>`,
    )
    .join("")}
</ul>`
    : ""
}

<h2>Premium card lane decisions</h2>
<ul class="decision-list">
  ${(report.premiumLane?.decisions || [])
    .map(
      (d) =>
        `<li><b>${escapeHtml(d.scene || "")}</b> · ${escapeHtml(d.type || "")} → <b>${escapeHtml(d.renderer || "")}</b><br>${escapeHtml(d.reason || "")}</li>`,
    )
    .join("")}
</ul>

<h2>Grammar v2 transformations</h2>
<ul class="grammar-list">
  ${(report.grammarApplied || [])
    .map((g) => {
      const desc = [
        g.kind ? `<b>${escapeHtml(g.kind)}</b>` : "",
        g.atIdx !== undefined ? `@scene ${g.atIdx}` : "",
        g.sources
          ? `sources: ${g.sources.map((s) => escapeHtml(s)).join(", ")}`
          : "",
        g.source ? `source: ${escapeHtml(g.source)}` : "",
        g.caption ? `caption: "${escapeHtml(g.caption)}"` : "",
        g.envelope ? `envelope: ${escapeHtml(g.envelope)}` : "",
        g.note ? `(${escapeHtml(g.note)})` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `<li>${desc}</li>`;
    })
    .join("")}
</ul>

<h2>Beat-awareness</h2>
<div class="meta">
  <span><b>Cuts:</b> ${escapeHtml(String(report.beatAware?.cutCount ?? "?"))}</span>
  <span><b>Aligned within 150ms of a word boundary:</b> ${escapeHtml(String(report.beatAware?.cutsAlignedWithin150ms ?? "?"))}</span>
  <span><b>Ratio:</b> ${escapeHtml(String(report.beatAware?.ratio ?? "?"))}</span>
</div>

<h2>Scene list (v2 slate)</h2>
${sceneListTable(report.sceneList || [])}

<footer>
  Studio Short Engine v2 — local render · audit anchor commit ${escapeHtml(currentCommit())}
  · ${escapeHtml(currentBranch())} branch · no production publish jobs touched
</footer>

</div>
</body>
</html>
`;

  const outPath = path.join(TEST_OUT, "studio_v2_deliverables.html");
  await fs.writeFile(outPath, html);
  console.log(`[deliverables-page] wrote ${path.relative(ROOT, outPath)}`);
  console.log(`  Open it locally:`);
  console.log(`    file:///${outPath.replace(/\\/g, "/")}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
