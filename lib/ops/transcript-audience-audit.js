"use strict";

const fs = require("fs-extra");
const crypto = require("node:crypto");
const path = require("node:path");

const { buildViralScriptIntelligence } = require("../viral-script-intelligence");
const { normaliseCaptionDisplayText } = require("../caption-display-text");
const { PRIMARY_PULSE_CTA, isApprovedPulseCta } = require("../pulse-cta");
const { runScriptCoherenceQa } = require("../script-coherence-qa");

const UNSUPPORTED_UNIVERSAL_CLAIM = "unsupported_universal_claim";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readJsonSync(filePath);
}

function storyDirsFromBatchDir(batchDir) {
  if (!batchDir || !fs.existsSync(batchDir)) return [];
  return fs.readdirSync(batchDir)
    .map((name) => path.join(batchDir, name))
    .filter((dir) => fs.statSync(dir).isDirectory())
    .filter((dir) => fs.existsSync(path.join(dir, "canonical_story_manifest.json")));
}

function validStoryDir(dir) {
  return !!dir && fs.existsSync(path.join(dir, "canonical_story_manifest.json"));
}

function uniqueExistingStoryDirs(dirs = []) {
  const seen = new Set();
  return dirs
    .map((dir) => path.resolve(dir))
    .filter(validStoryDir)
    .filter((dir) => {
      const key = path.resolve(dir);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function discoverProofBatchDirs(root = process.cwd()) {
  const bases = [
    path.join(root, "output", "goal-contract"),
    path.join(root, "output", "autonomous-feedback-monitor"),
    path.join(root, "output", "candidate-supply"),
  ];
  const batchDirs = [];
  const visit = (dir, depth = 0) => {
    if (!dir || depth > 4 || !fs.existsSync(dir)) return;
    const base = path.basename(dir).toLowerCase();
    if (base === "batch" || base === "goal-proof-batch") {
      batchDirs.push(dir);
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      visit(path.join(dir, entry.name), depth + 1);
    }
  };
  for (const base of bases) visit(base, 0);
  return batchDirs;
}

function primarySourceName(manifest = {}, sourceManifest = {}) {
  const source = sourceManifest.primary_source || manifest.primary_source || manifest.official_source;
  if (typeof source === "string") return clean(source);
  return clean(source?.name || source?.source_name || source?.label || source?.title);
}

function transcriptFrom(manifest = {}, narration = {}) {
  return clean(
    narration.final_transcript ||
      narration.transcript ||
      manifest.narration_script ||
      manifest.full_script ||
      manifest.tts_script,
  );
}

function scriptFileSha256(script = "") {
  return crypto.createHash("sha256").update(`${clean(script)}\n`).digest("hex");
}

function badNumericSpellouts(text = "") {
  return [
    ...new Set(
      clean(text)
        .toUpperCase()
        .match(/\b\d+(?:\.\d+)?\s+DOLLARS\b/g) || [],
    ),
  ];
}

function authoritativeDisplayTranscript(narration = {}, spokenScript = "") {
  const displayScript = clean(narration.display_transcript);
  const spoken = clean(spokenScript);
  if (!displayScript || !spoken) return null;

  const displaySha = scriptFileSha256(displayScript);
  const spokenSha = scriptFileSha256(spoken);
  const lineage = narration.lineage || {};
  const checks = narration.checks || {};
  const blockers = Array.isArray(narration.blockers) ? narration.blockers : [];
  const evidenceIsCurrent =
    narration.authoritative === true &&
    /^(?:pass|green)$/i.test(clean(narration.verdict)) &&
    /^(?:ready|pass|green)$/i.test(clean(narration.status)) &&
    blockers.length === 0 &&
    checks.display_script_verified === true &&
    checks.spoken_script_verified === true &&
    clean(narration.display_script_sha256) === displaySha &&
    clean(lineage.display_script_sha256) === displaySha &&
    clean(narration.spoken_script_sha256) === spokenSha &&
    clean(lineage.spoken_script_sha256) === spokenSha &&
    badNumericSpellouts(displayScript).length === 0;

  return evidenceIsCurrent ? displayScript : null;
}

function sentences(text = "") {
  return clean(text)
    .split(/(?<=[.!?])\s+/)
    .map((item) => clean(item))
    .filter(Boolean);
}

function wordCount(sentence = "") {
  return clean(sentence).split(/\s+/).filter(Boolean).length;
}

function scriptWithoutApprovedCtaSentence(script = "") {
  const scriptSentences = sentences(script);
  const editorialSentences = scriptSentences.filter((sentence) => !isApprovedPulseCta(sentence));
  return {
    script: editorialSentences.join(" "),
    removed: editorialSentences.length !== scriptSentences.length,
  };
}

function weightedViralScore(scores = {}) {
  return Math.round(
    Number(scores.hook_strength || 0) * 0.24 +
      Number(scores.curiosity_gap || 0) * 0.19 +
      Number(scores.insight_density || 0) * 0.22 +
      Number(scores.source_safety || 0) * 0.18 +
      Number(scores.retention_pacing || 0) * 0.17,
  );
}

function viralVerdict(viralScore, blockers = []) {
  if (blockers.length || viralScore < 75) return "rewrite_required";
  return viralScore >= 85 ? "viral_ready" : "tighten_before_tts";
}

function removeUniversalClaimGuidance(values = []) {
  return values.filter((value) => !/\b(?:absolute wording|universal claim)\b/i.test(clean(value)));
}

function buildTranscriptViralIntelligence({ story = {}, script = "" } = {}) {
  const viral = buildViralScriptIntelligence({ story, script });
  if (!(viral.blockers || []).includes(UNSUPPORTED_UNIVERSAL_CLAIM)) return viral;

  const editorial = scriptWithoutApprovedCtaSentence(script);
  if (!editorial.removed) return viral;

  // Re-run only to distinguish the approved CTA's "never" from editorial universals.
  const editorialViral = buildViralScriptIntelligence({ story, script: editorial.script });
  if ((editorialViral.blockers || []).includes(UNSUPPORTED_UNIVERSAL_CLAIM)) return viral;

  const blockers = (viral.blockers || []).filter((blocker) => blocker !== UNSUPPORTED_UNIVERSAL_CLAIM);
  const scores = {
    ...viral.scores,
    source_safety: editorialViral.scores.source_safety,
  };
  const viralScore = weightedViralScore(scores);
  return {
    ...viral,
    verdict: viralVerdict(viralScore, blockers),
    viral_score: viralScore,
    scores,
    blockers,
    rewrite_recommendations: removeUniversalClaimGuidance(viral.rewrite_recommendations),
    prompt_directives: removeUniversalClaimGuidance(viral.prompt_directives),
  };
}

function applyNumericDisplayEvidence(viral = {}, numericScript = "") {
  const numericBlockers = badNumericSpellouts(numericScript);
  const blockers = new Set(viral.blockers || []);
  if (numericBlockers.length) blockers.add("bad_numeric_spellout");
  else blockers.delete("bad_numeric_spellout");
  const blockerList = [...blockers];
  const viralScore = weightedViralScore(viral.scores || {});
  return {
    ...viral,
    verdict: viralVerdict(viralScore, blockerList),
    viral_score: viralScore,
    blockers: blockerList,
    fact_lock: {
      ...(viral.fact_lock || {}),
      bad_numeric_spellouts: numericBlockers,
    },
  };
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normaliseLooseSubject(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceNameVariants(value = "") {
  const raw = clean(value);
  if (!raw) return [];
  const camelSpaced = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return [
    ...new Set(
      [raw, camelSpaced, raw.replace(/\s+/g, "")]
        .map(normaliseLooseSubject)
        .filter(Boolean),
    ),
  ];
}

function sourceNameAppearsInScript(sourceName = "", script = "") {
  const scriptKey = normaliseLooseSubject(script);
  if (!sourceName || !scriptKey) return false;
  const compactScriptKey = scriptKey.replace(/\s+/g, "");
  return sourceNameVariants(sourceName).some((variant) => {
    const compactVariant = variant.replace(/\s+/g, "");
    return scriptKey.includes(variant) || (compactVariant && compactScriptKey.includes(compactVariant));
  });
}

function scriptContainsSubject(script = "", subject = "") {
  const subjectKeys = subjectAliases(subject).map(normaliseLooseSubject).filter(Boolean);
  if (!subjectKeys.length) return true;
  const scriptKey = normaliseLooseSubject(script);
  return subjectKeys.some((subjectKey) =>
    new RegExp(`(?:^|\\s)${escapeRegExp(subjectKey)}(?:\\s|$)`, "i").test(scriptKey),
  );
}

function subjectAliases(subject = "") {
  const raw = clean(subject);
  if (!raw) return [];
  const aliases = [raw];
  const hasGrandTheftAuto = /\bgrand\s+theft\s+auto\b/i.test(raw);
  const hasGta = /\bg\s*\.?\s*t\s*\.?\s*a\b/i.test(raw);
  if (hasGrandTheftAuto || hasGta) {
    if (/\b(?:vi|6|six)\b/i.test(raw)) {
      aliases.push(
        "GTA",
        "Grand Theft Auto",
        "GTA VI",
        "GTA 6",
        "GTA six",
        "Grand Theft Auto VI",
        "Grand Theft Auto 6",
        "Grand Theft Auto six",
      );
    } else if (/\b(?:v|5|five)\b/i.test(raw)) {
      aliases.push(
        "GTA V",
        "GTA 5",
        "GTA five",
        "Grand Theft Auto V",
        "Grand Theft Auto 5",
        "Grand Theft Auto five",
      );
    } else {
      aliases.push("GTA", "Grand Theft Auto");
    }
  }
  const numberedBlackOps = raw.match(/^call of duty:\s*black ops\s+(\d+)$/i);
  if (numberedBlackOps) {
    aliases.push(`Black Ops ${numberedBlackOps[1]}`);
  }
  if (/^call of duty:\s*black ops$/i.test(raw)) {
    aliases.push("Black Ops", "Black Ops 1 and 2", "classic Black Ops", "classic Black Ops games");
  }
  if (/\bblack\s+flag\s+resynced\b/i.test(raw)) {
    aliases.push(
      "Black Flag Resynced",
      "Black Flag reesynced",
      "Assassin's Creed Black Flag reesynced",
    );
  }
  if (/\b(?:xbox\s+)?game\s+pass\b/i.test(raw) && /\b(?:wave|drop|january|february|march|april|may|june|july|august|september|october|november|december|\d{4})\b/i.test(raw)) {
    aliases.push("Xbox Game Pass", "Game Pass");
  }
  if (/\bmonopoly\b/i.test(raw) && /\bstar\s+wars\b/i.test(raw)) {
    aliases.push(
      "Star Wars Monopoly",
      "Monopoly Star Wars",
      "MONOPOLY Star Wars",
      "Star Wars Heroes versus Villains",
      "Star Wars Heroes vs Villains",
    );
  }
  if (/\bbethesda\s+game\s+studios\b/i.test(raw) && /\bzenimax\b/i.test(raw)) {
    aliases.push("Bethesda", "Bethesda Game Studios", "ZeniMax");
  }
  return [...new Set(aliases)];
}

function auditMassAudienceClarity({ script = "", title = "", sourceName = "", canonicalSubject = "" } = {}) {
  const text = clean(script);
  const bodySentences = sentences(text).filter((sentence) => !isApprovedPulseCta(sentence));
  const blockers = [];
  const warnings = [];
  const recommendations = [];
  const abstractPayoff =
    /\b(?:wider conversation|changes the conversation|conversation shifts|useful part is the context|detail gives players|story becomes more than a feed update|next beat lands|source-backed update|reason to exist beyond repeating the feed|direction of travel|signal problem|cleaner way to judge the direction)\b/i.test(text);
  const publicSafetyScaffold =
    /\b(?:players should watch for a named update|watch for a named update|claim still needs official confirmation|needs official confirmation before players treat it as locked in|honest angle is what has changed for players today|what has changed for players today|player-facing consequence matters more than stretching the headline|stretching the headline beyond the source|for players,\s*the decision point is simple|does this change what they can buy,\s*play or trust today|finally has something specific to judge|something specific to judge|new player-facing detail to judge|players will judge the practical change first|what feels better,\s*what lasts longer|content push that has to prove it is more than maintenance|headline fades before the patch notes do|concrete detail players can argue with|floating headline)\b/i.test(text);
  const figurativePayoff =
    /\b(?:ordinary excellence|part of the legend|without losing the theatre|losing the theatre|cutscenes start carrying too much weight|menus start fighting them|sanding off the bite|becomes the first argument|turns into a trust fight|trust fight players decide)\b/i.test(text);
  const unclearReferentCount = bodySentences.filter((sentence) =>
    /^(?:this matters|this is why|that is where|that gives|it matters|the useful part|the interesting part|the important part|the next beat|the context|the detail)\b/i.test(sentence),
  ).length;
  const concreteMatches = text.match(
    /\b(?:gameplay|trailer|demo|release date|date|delay|price|discount|score|review|mission|combat|gunfight|camera|boss|map|mode|co[- ]?op|campaign|deckbuild(?:er|ing)?|cards?|restaurant|monster|kitchen|platform|xbox|playstation|switch|steam|pc|game pass|beta|patch|update|download|gb|fps|hours?|minutes?|handling|tracks?|items?|kart|racer|racing|vehicle|driving|controls?|wishlist|adventure|board|turns?|rent|revenge|comeback|replay|abilities|powers?|heroes|villains|family|families|gift|match|momentum|\d{2,4})\b/gi,
  ) || [];
  const longSentences = bodySentences.filter((sentence) => wordCount(sentence) > 28);
  const subject = clean(canonicalSubject);

  const openingSubjectWindow = bodySentences.slice(0, 2).join(" ");
  if (subject && !scriptContainsSubject(openingSubjectWindow, subject)) {
    blockers.push("mass_audience:tts_transcript_subject_drift");
    recommendations.push("Regenerate narration and captions when ASR mutates the game or story subject.");
  }
  if (abstractPayoff) {
    blockers.push("mass_audience:abstract_payoff");
    recommendations.push("Replace abstract words like signal, context and conversation with the exact player-facing thing that changed.");
  }
  if (publicSafetyScaffold) {
    blockers.push("mass_audience:public_safety_scaffold");
    recommendations.push("Remove internal safety scaffolding and write the actual viewer payoff in plain language.");
  }
  if (figurativePayoff) {
    blockers.push("mass_audience:figurative_payoff");
    recommendations.push("Replace critic-style metaphors with plain, specific player stakes a casual viewer can understand in one listen.");
  }
  if (concreteMatches.length < 3) {
    blockers.push("mass_audience:low_concrete_detail");
    recommendations.push("Add at least one concrete mechanic, platform, number, clip detail, date, score or player consequence in the first half.");
  }
  if (unclearReferentCount >= 2) {
    blockers.push("mass_audience:unclear_referents");
    recommendations.push("Stop opening sentences with this, that, the detail or the context unless the previous sentence names the thing clearly.");
  }
  if (longSentences.length > 0) {
    warnings.push("mass_audience:sentence_too_dense");
    recommendations.push("Split long sentences so the narration lands cleanly on mobile speakers.");
  }
  const titleWords = clean(title).split(/\s+/).filter(Boolean).slice(0, 2);
  if (
    titleWords.length >= 2 &&
    !normaliseLooseSubject(text).includes(normaliseLooseSubject(titleWords.join(" ")))
  ) {
    warnings.push("mass_audience:title_subject_not_obvious");
  }
  if (sourceName && !sourceNameAppearsInScript(sourceName, text)) {
    warnings.push("mass_audience:source_not_named");
  }

  return {
    result: blockers.length ? "fail" : warnings.length ? "warn" : "pass",
    blockers,
    warnings,
    concrete_detail_count: concreteMatches.length,
    unclear_referent_count: unclearReferentCount,
    long_sentence_count: longSentences.length,
    recommendations,
  };
}

function auditOneTranscript({ storyId, artifactDir } = {}) {
  const canonical = readJsonIfExists(path.join(artifactDir, "canonical_story_manifest.json")) || {};
  const source = readJsonIfExists(path.join(artifactDir, "source_manifest.json")) || {};
  const claims = readJsonIfExists(path.join(artifactDir, "claim_inventory.json")) || {};
  const narration = readJsonIfExists(path.join(artifactDir, "narration_manifest.json")) || {};
  const rawScript = transcriptFrom(canonical, narration);
  const script = normaliseCaptionDisplayText(rawScript);
  const boundDisplayTranscript = authoritativeDisplayTranscript(narration, rawScript);
  const numericFormatScript = boundDisplayTranscript || script;
  const title = clean(canonical.selected_title || canonical.title || storyId);
  const sourceName = primarySourceName(canonical, source);
  const canonicalSubject = clean(canonical.canonical_subject || canonical.canonical_game || canonical.subject || "");
  const story = {
    id: storyId,
    title,
    source_name: sourceName,
    source_type: clean(canonical.discovery_source?.type || canonical.source_type || "rss"),
    subreddit: clean(canonical.discovery_source?.name || canonical.subreddit),
    selected_title: title,
    confirmed_claims: [
      ...(Array.isArray(canonical.confirmed_claims) ? canonical.confirmed_claims : []),
      ...(Array.isArray(claims.confirmed) ? claims.confirmed : []),
    ],
    claim_inventory: {
      confirmed: [
        ...(Array.isArray(canonical.claim_inventory?.confirmed)
          ? canonical.claim_inventory.confirmed
          : []),
        ...(Array.isArray(claims.confirmed) ? claims.confirmed : []),
      ],
    },
  };
  const viral = applyNumericDisplayEvidence(
    buildTranscriptViralIntelligence({ story, script }),
    numericFormatScript,
  );
  const coherence = runScriptCoherenceQa(
    { ...story, full_script: script, cta: PRIMARY_PULSE_CTA },
    { requireCtaField: true, requireFullScriptCta: false },
  );
  const massAudience = auditMassAudienceClarity({ script, title, sourceName, canonicalSubject });
  const blockers = [...new Set([...(viral.blockers || []), ...(coherence.failures || []), ...(massAudience.blockers || [])])];
  const verdict = viral.verdict === "viral_ready" && blockers.length === 0 ? "pass" : "rewrite_required";
  return {
    story_id: storyId,
    title,
    source_name: sourceName,
    artifact_dir: artifactDir,
    verdict,
    viral_verdict: viral.verdict,
    viral_score: viral.viral_score,
    scores: viral.scores,
    mass_audience: massAudience,
    blockers,
    rewrite_recommendations: [...(viral.rewrite_recommendations || []), ...(massAudience.recommendations || [])],
    prompt_directives: viral.prompt_directives || [],
    first_line: clean(script.split(/(?<=[.!?])\s+/)[0] || script),
    transcript: script,
    display_transcript: boundDisplayTranscript || undefined,
    numeric_format_source: boundDisplayTranscript
      ? "authoritative_display_transcript"
      : "spoken_transcript",
    raw_transcript: rawScript === script ? undefined : rawScript,
  };
}

async function auditGeneratedTranscripts({
  root = process.cwd(),
  batchDir = path.join(root, "output", "goal-proof", "batch"),
  batchDirs = null,
  artifactDirs = [],
  extraBatchDirs = [
    path.join(root, "output", "autonomous-feedback-monitor", "fresh-goal-proof", "batch"),
    path.join(root, "output", "candidate-supply", "fresh-goal-proof", "batch"),
  ],
} = {}) {
  const explicitStoryDirs = uniqueExistingStoryDirs(artifactDirs);
  const sourceBatchDirs = Array.isArray(batchDirs)
    ? batchDirs
    : [batchDir, ...extraBatchDirs, ...discoverProofBatchDirs(root)];
  const storyDirs = explicitStoryDirs.length
    ? explicitStoryDirs
    : uniqueExistingStoryDirs(sourceBatchDirs.flatMap(storyDirsFromBatchDir));

  const stories = storyDirs
    .map((dir) => auditOneTranscript({ storyId: path.basename(dir), artifactDir: dir }))
    .sort((a, b) => {
      if (a.verdict !== b.verdict) return a.verdict.localeCompare(b.verdict);
      return a.viral_score - b.viral_score;
    });

  const summary = stories.reduce(
    (acc, story) => {
      acc.total += 1;
      acc[story.verdict] = (acc[story.verdict] || 0) + 1;
      acc.viral_verdict_counts[story.viral_verdict] = (acc.viral_verdict_counts[story.viral_verdict] || 0) + 1;
      return acc;
    },
    { total: 0, pass: 0, rewrite_required: 0, viral_verdict_counts: {} },
  );

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    execution_mode: "local_transcript_audience_audit",
    summary,
    stories,
    safety: {
      local_only: true,
      analysis_only: true,
      no_live_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function renderTranscriptAudienceAuditMarkdown(report = {}) {
  const lines = [
    "# Transcript Audience Audit",
    "",
    `Generated: ${report.generated_at || ""}`,
    "",
    `Total transcripts: ${report.summary?.total || 0}`,
    `Pass: ${report.summary?.pass || 0}`,
    `Rewrite required: ${report.summary?.rewrite_required || 0}`,
    "",
    "## Rewrite Required",
    "",
  ];
  for (const story of (report.stories || []).filter((item) => item.verdict !== "pass")) {
    lines.push(`- ${story.story_id} - ${story.title}`);
    lines.push(`  - score: ${story.viral_score}`);
    lines.push(`  - blockers: ${story.blockers.join(", ") || "none"}`);
    lines.push(`  - first line: ${story.first_line}`);
  }
  lines.push("", "## Passed", "");
  for (const story of (report.stories || []).filter((item) => item.verdict === "pass")) {
    lines.push(`- ${story.story_id} - ${story.title} (${story.viral_score})`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function writeTranscriptAudienceAudit(report, { outputDir = path.join(process.cwd(), "output", "transcript-audience-audit") } = {}) {
  await fs.ensureDir(outputDir);
  const jsonPath = path.join(outputDir, "transcript_audience_audit.json");
  const mdPath = path.join(outputDir, "transcript_audience_audit.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderTranscriptAudienceAuditMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

module.exports = {
  auditGeneratedTranscripts,
  auditMassAudienceClarity,
  auditOneTranscript,
  renderTranscriptAudienceAuditMarkdown,
  writeTranscriptAudienceAudit,
};
