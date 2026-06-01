"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseTimeMs(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safetyIsIntact(operatorIndex = {}) {
  const safety = operatorIndex.safety || {};
  return (
    operatorIndex.safe_to_publish_boolean === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true
  );
}

function strictDryRunGeneratedAt(strictDryRunPlan = {}) {
  return clean(strictDryRunPlan.generated_at || strictDryRunPlan.generatedAt);
}

function explicitOperatorIndexDryRunSourceGeneratedAt(operatorIndex = {}) {
  return clean(
    operatorIndex.source_dry_run_generated_at ||
      operatorIndex.source_strict_dry_run_generated_at ||
      operatorIndex.dry_run_generated_at,
  );
}

function sourceIsStaleAfterStrictDryRun(operatorIndex = {}, strictDryRunPlan = {}) {
  const strictGeneratedAt = strictDryRunGeneratedAt(strictDryRunPlan);
  const explicitSourceGeneratedAt = explicitOperatorIndexDryRunSourceGeneratedAt(operatorIndex);
  const freshnessReferenceGeneratedAt = explicitSourceGeneratedAt || clean(operatorIndex.generated_at);
  const strictMs = parseTimeMs(strictGeneratedAt);
  const sourceMs = parseTimeMs(freshnessReferenceGeneratedAt);
  if (!Number.isFinite(strictMs) || !Number.isFinite(sourceMs)) {
    return {
      stale: false,
      strictGeneratedAt,
      sourceGeneratedAt: freshnessReferenceGeneratedAt,
      explicitSourceGeneratedAt,
    };
  }
  return {
    stale: sourceMs < strictMs,
    strictGeneratedAt,
    sourceGeneratedAt: freshnessReferenceGeneratedAt,
    explicitSourceGeneratedAt,
  };
}

function fileUrl(filePath) {
  const value = clean(filePath);
  if (!value) return "";
  return pathToFileURL(path.resolve(value)).href;
}

function shortFingerprint(value) {
  const text = clean(value);
  if (!text) return "";
  return text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-8)}` : text;
}

function captionPreview(filePath, maxLines = 4) {
  const resolved = clean(filePath);
  if (!resolved || !fs.existsSync(resolved)) return "";
  try {
    const lines = fs.readFileSync(resolved, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^\d+$/.test(line))
      .filter((line) => !/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(line));
    return lines.slice(0, maxLines).join(" ");
  } catch {
    return "";
  }
}

function commandWithoutApply(command) {
  const text = clean(command);
  if (/\s--apply(?:\s|$)/.test(text)) return "";
  return text;
}

function buildConsoleCard(card = {}) {
  const video = card.open_targets?.video_path || {};
  const captions = card.open_targets?.captions_path || {};
  const canonical = card.open_targets?.canonical_manifest_path || {};
  const platform = card.open_targets?.platform_publish_manifest_path || {};
  const ready = clean(card.review_status) === "ready_for_operator_review";

  return {
    review_sequence: card.review_sequence || 0,
    story_id: clean(card.story_id),
    title: clean(card.title || card.public_copy?.title),
    review_status: clean(card.review_status),
    recommended_next_decision: clean(card.recommended_next_decision),
    primary_source: clean(card.source_check_summary?.primary_source),
    discovery_source: clean(card.source_check_summary?.discovery_source),
    first_spoken_line: clean(card.public_copy?.first_spoken_line),
    thumbnail_headline: clean(card.public_copy?.thumbnail_headline),
    script_excerpt: clean(card.public_copy?.script_excerpt),
    description: clean(card.public_copy?.description),
    video_path: clean(video.path),
    video_uri: fileUrl(video.path),
    captions_path: clean(captions.path),
    captions_preview: captionPreview(captions.path),
    canonical_manifest_path: clean(canonical.path),
    platform_publish_manifest_path: clean(platform.path),
    fingerprints: {
      video: shortFingerprint(video.sha256),
      captions: shortFingerprint(captions.sha256),
      canonical_manifest: shortFingerprint(canonical.sha256),
      platform_publish_manifest: shortFingerprint(platform.sha256),
    },
    enabled_platforms: asArray(card.platform_plan?.enabled_for_review).map(clean).filter(Boolean),
    disabled_or_deferred_platforms: asArray(card.platform_plan?.deferred_or_disabled).map(clean).filter(Boolean),
    operator_checklist: asArray(card.operator_checklist).map(clean).filter(Boolean),
    review_actions: {
      approve_dry_run: commandWithoutApply(card.decision_commands?.approve_enabled_platforms_dry_run),
      reject_dry_run: commandWithoutApply(card.decision_commands?.reject_dry_run),
      request_repairs_dry_run: commandWithoutApply(card.decision_commands?.request_repairs_dry_run),
      apply_command_omitted_from_console: true,
    },
    review_guard: {
      can_approve_from_console: false,
      live_publish_allowed_from_console: false,
      guarded_dispatch_still_requires_approval_gate: true,
      operator_decision_required: Boolean(card.approval_guard?.operator_decision_required),
    },
    blockers: asArray(card.blockers).map(clean).filter(Boolean),
    actionable: ready && !asArray(card.blockers).length,
  };
}

function buildHumanReviewConsole({
  operatorIndex = {},
  strictDryRunPlan = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const blockers = [];
  const safetyOk = safetyIsIntact(operatorIndex);
  if (!safetyOk) blockers.push("human_review_console_safety_contract_failed");
  const freshness = strictDryRunPlan
    ? sourceIsStaleAfterStrictDryRun(operatorIndex, strictDryRunPlan)
    : { stale: false, strictGeneratedAt: "", sourceGeneratedAt: "" };
  if (freshness.stale) blockers.push("human_review_console_source_stale_after_strict_dry_run");

  const cards = safetyOk && !blockers.length ? asArray(operatorIndex.review_cards).map(buildConsoleCard) : [];
  const readyCards = cards.filter((card) => card.review_status === "ready_for_operator_review");
  const actionable = cards.filter((card) => card.actionable);
  const missing = cards.filter((card) => card.review_status === "missing_review_artefacts");
  const verdict = blockers.length ? "RED" : actionable.length || missing.length ? "AMBER" : "GREEN";

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "HUMAN_REVIEW_CONSOLE",
    source_operator_index_generated_at: clean(operatorIndex.generated_at),
    source_operator_index_dry_run_generated_at: freshness.explicitSourceGeneratedAt,
    freshness_reference_generated_at: freshness.sourceGeneratedAt,
    source_strict_dry_run_generated_at: freshness.strictGeneratedAt,
    verdict,
    safe_to_publish_boolean: false,
    summary: {
      card_count: cards.length,
      ready_card_count: readyCards.length,
      actionable_card_count: actionable.length,
      missing_artefact_card_count: missing.length,
      blocked_input_count: blockers.length,
    },
    cards,
    blockers,
    next_step: blockers.length
      ? blockers.includes("human_review_console_source_stale_after_strict_dry_run")
        ? "regenerate_human_review_queue_index_and_console"
        : "repair_human_review_console_inputs"
      : actionable.length
        ? "watch_console_cards_then_record_operator_decisions"
        : "run_human_review_approval_gate",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      approval_omitted_from_console: true,
    },
  };
}

function renderCommandBlock(label, command) {
  if (!command) return "";
  return [
    `<div class="command-label">${escapeHtml(label)}</div>`,
    `<pre><code>${escapeHtml(command)}</code></pre>`,
  ].join("\n");
}

function renderHumanReviewConsoleHtml(consoleBundle = {}) {
  const cards = asArray(consoleBundle.cards);
  const cardHtml = cards.map((card) => {
    const checklist = asArray(card.operator_checklist)
      .map((item) => `<li>${escapeHtml(item.replace(/_/g, " "))}</li>`)
      .join("");
    const deferred = asArray(card.disabled_or_deferred_platforms)
      .map((item) => `<span>${escapeHtml(item)}</span>`)
      .join("");
    const enabled = asArray(card.enabled_platforms)
      .map((item) => `<span>${escapeHtml(item)}</span>`)
      .join("");
    return `
      <article class="card">
        <header>
          <div class="sequence">#${escapeHtml(card.review_sequence)}</div>
          <h2>${escapeHtml(card.title)}</h2>
          <div class="status">${escapeHtml(card.review_status)} · ${escapeHtml(card.recommended_next_decision)}</div>
        </header>
        <video controls preload="metadata" src="${escapeHtml(card.video_uri)}"></video>
        <section class="copy">
          <p><strong>Opening:</strong> ${escapeHtml(card.first_spoken_line)}</p>
          <p><strong>Thumbnail:</strong> ${escapeHtml(card.thumbnail_headline)}</p>
          <p><strong>Source:</strong> ${escapeHtml(card.primary_source)} <span class="muted">discovered via ${escapeHtml(card.discovery_source || "unknown")}</span></p>
          <p><strong>Captions preview:</strong> ${escapeHtml(card.captions_preview || "missing")}</p>
        </section>
        <section class="chips">
          <div><strong>Enabled:</strong> ${enabled || "<span>none</span>"}</div>
          <div><strong>Deferred:</strong> ${deferred || "<span>none</span>"}</div>
        </section>
        <section class="fingerprints">
          <div>Video ${escapeHtml(card.fingerprints?.video)}</div>
          <div>Captions ${escapeHtml(card.fingerprints?.captions)}</div>
          <div>Canonical ${escapeHtml(card.fingerprints?.canonical_manifest)}</div>
          <div>Platform ${escapeHtml(card.fingerprints?.platform_publish_manifest)}</div>
        </section>
        <section class="checklist">
          <strong>Operator checks</strong>
          <ul>${checklist}</ul>
        </section>
        <section class="commands">
          ${renderCommandBlock("Approve dry-run", card.review_actions?.approve_dry_run)}
          ${renderCommandBlock("Reject dry-run", card.review_actions?.reject_dry_run)}
          ${renderCommandBlock("Request repairs dry-run", card.review_actions?.request_repairs_dry_run)}
        </section>
      </article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pulse Gaming Human Review Console</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #111; color: #f5f5f5; }
    main { max-width: 1280px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .summary { color: #cfcfcf; margin-bottom: 20px; }
    .warning { background: #3a1905; border: 1px solid #ff7a1a; padding: 12px; margin: 16px 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 18px; }
    .card { background: #1d1d1d; border: 1px solid #393939; padding: 16px; border-radius: 8px; }
    .sequence { color: #ff8a2a; font-size: 13px; font-weight: 700; }
    h2 { font-size: 20px; line-height: 1.2; margin: 4px 0; }
    .status, .muted { color: #aaa; }
    video { width: 100%; max-height: 560px; background: #000; margin: 12px 0; }
    .copy p { margin: 8px 0; }
    .chips span { display: inline-block; margin: 4px 4px 0 0; padding: 3px 7px; background: #2a2a2a; border: 1px solid #444; border-radius: 999px; font-size: 12px; }
    .fingerprints { margin-top: 10px; color: #bdbdbd; font-family: Consolas, monospace; font-size: 12px; }
    .checklist ul { padding-left: 20px; }
    .command-label { margin-top: 10px; color: #ffb07a; font-weight: 700; }
    pre { white-space: pre-wrap; word-break: break-word; background: #090909; border: 1px solid #333; padding: 10px; }
  </style>
</head>
<body>
<main>
  <h1>Pulse Gaming Human Review Console</h1>
  <div class="summary">Generated ${escapeHtml(consoleBundle.generated_at || "unknown")} · Verdict ${escapeHtml(consoleBundle.verdict || "UNKNOWN")} · ${escapeHtml(consoleBundle.summary?.actionable_card_count || 0)} cards ready to watch</div>
  <div class="warning">Review cannot approve or publish. This file is local-only evidence for watching videos and recording separate operator decisions.</div>
  <section class="grid">
    ${cardHtml}
  </section>
</main>
</body>
</html>
`;
}

async function writeHumanReviewConsole(consoleBundle = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeHumanReviewConsole requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "human_review_console.json");
  const htmlPath = path.join(outDir, "human_review_console.html");
  await fs.writeJson(jsonPath, consoleBundle, { spaces: 2 });
  await fs.writeFile(htmlPath, renderHumanReviewConsoleHtml(consoleBundle), "utf8");
  return { outputDir: outDir, jsonPath, htmlPath };
}

module.exports = {
  buildHumanReviewConsole,
  renderHumanReviewConsoleHtml,
  sourceIsStaleAfterStrictDryRun,
  writeHumanReviewConsole,
};
