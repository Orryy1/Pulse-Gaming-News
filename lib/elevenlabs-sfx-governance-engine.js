"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "12_elevenlabs_sfx_governance";
const PROVIDER_ID = "elevenlabs_sfx";
const DEFAULT_REQUIRED_ROLES = ["impact", "transition", "ui_tick", "riser", "sub_hit", "glitch"];
const DEFAULT_MODEL = "operator_selected_elevenlabs_sfx_model";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(asArray(values).map(cleanText).filter(Boolean))];
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalisePath(value) {
  return cleanText(value).replace(/\\/g, "/");
}

async function readJsonIfPresent(filePath, fallback = null) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

async function scanSidecars(root, { maxDepth = 8 } = {}) {
  const files = [];
  if (!root || !(await fs.pathExists(root))) return files;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    if (current.depth > maxDepth) continue;
    let entries = [];
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        stack.push({ dir: fullPath, depth: current.depth + 1 });
      } else if (/\.elevenlabs-sfx\.json$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  return files.sort((a, b) => normalisePath(a).localeCompare(normalisePath(b)));
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function resolveAudioPath({ workspaceRoot, sidecarPath, audioPath }) {
  const text = cleanText(audioPath);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  const sidecarRelative = path.resolve(path.dirname(sidecarPath), text);
  if (fs.existsSync(sidecarRelative)) return sidecarRelative;
  return path.resolve(workspaceRoot || process.cwd(), text);
}

function generationPromptForRole(role) {
  const prompts = {
    impact: "Clean editorial impact hit for a gaming-news hook, short tail, no weapon or horror semantics.",
    transition: "Fast whoosh transition for mobile gaming-news edits, clean, non-comedic and no voice.",
    ui_tick: "Subtle source-lock UI tick for proof cards, no alert voice and no recognisable game UI phrase.",
    riser: "Short restrained riser for a verified reveal, controlled low end and no cinematic trailer parody.",
    sub_hit: "Low sub hit for opener landing, controlled tail, no explosion or weapon semantics.",
    glitch: "Clean digital glitch accent for data or leak moments, no spoken phrase.",
    ambience: "Low unobtrusive tech-news ambience loop for under narration, no melody and no crowd/room tone.",
    tension_bed: "Short tension bed for breaking gaming news, no vocals and narration-safe dynamics.",
    segment_sting: "Brief Pulse segment sting for source-card transitions, no copyrighted melody.",
  };
  return prompts[role] || `Clean editorial ${role} for a Pulse Gaming short, no voice or copyrighted melody.`;
}

function buildGenerationPlan(requiredRoles = DEFAULT_REQUIRED_ROLES, generatedAt = null) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    provider_id: PROVIDER_ID,
    mode: "LOCAL_PROOF_GENERATION_PLAN",
    slots: unique(requiredRoles).map((role) => ({
      role,
      prompt: generationPromptForRole(role),
      model: DEFAULT_MODEL,
      sidecar_required: true,
      required_sidecar_fields: [
        "asset_id",
        "role",
        "prompt",
        "model",
        "generation_time",
        "audio_path",
        "sha256",
        "rights_note",
        "duration_ms",
        "loudness_lufs",
        "true_peak_db",
        "reuse_limit",
        "usage_count",
      ],
    })),
    safety: {
      no_external_generation_started: true,
      no_api_call: true,
      no_oauth_or_token_change: true,
      no_posting: true,
    },
  };
}

async function inspectSidecar(sidecarPath, { workspaceRoot = process.cwd() } = {}) {
  const resolvedSidecar = path.resolve(workspaceRoot, sidecarPath);
  const sidecar = await readJsonIfPresent(resolvedSidecar, null);
  if (!sidecar) {
    return {
      sidecar_path: resolvedSidecar,
      status: "blocked",
      blockers: ["elevenlabs_sfx:sidecar_unreadable"],
    };
  }

  const role = cleanText(sidecar.role);
  const audioPath = resolveAudioPath({ workspaceRoot, sidecarPath: resolvedSidecar, audioPath: sidecar.audio_path });
  const blockers = [];
  const add = (blocker) => {
    if (!blockers.includes(blocker)) blockers.push(blocker);
  };

  if (!cleanText(sidecar.asset_id)) add("elevenlabs_sfx:asset_id_missing");
  if (!role) add("elevenlabs_sfx:role_missing");
  if (!cleanText(sidecar.prompt)) add("elevenlabs_sfx:prompt_missing");
  if (!cleanText(sidecar.model)) add("elevenlabs_sfx:model_missing");
  if (!cleanText(sidecar.generation_time)) add("elevenlabs_sfx:generation_time_missing");
  if (!audioPath) add("elevenlabs_sfx:audio_path_missing");
  if (!cleanText(sidecar.sha256)) add("elevenlabs_sfx:sha256_missing");
  if (!cleanText(sidecar.rights_note)) add("elevenlabs_sfx:rights_note_missing");
  if (sidecar.commercial_use_allowed !== true) add("elevenlabs_sfx:commercial_use_not_declared");
  if (!cleanText(sidecar.allowed_use)) add("elevenlabs_sfx:allowed_use_missing");

  let actualSha256 = null;
  if (audioPath && (await fs.pathExists(audioPath))) {
    actualSha256 = await sha256File(audioPath);
    if (cleanText(sidecar.sha256) && cleanText(sidecar.sha256) !== actualSha256) {
      add("elevenlabs_sfx:sha256_mismatch");
    }
  } else if (audioPath) {
    add("elevenlabs_sfx:audio_file_missing");
  }

  const loudnessLufs = numberOrNull(sidecar.loudness_lufs);
  const truePeakDb = numberOrNull(sidecar.true_peak_db);
  if (loudnessLufs === null) add("elevenlabs_sfx:loudness_lufs_missing");
  if (truePeakDb === null) add("elevenlabs_sfx:true_peak_missing");
  if (truePeakDb !== null && truePeakDb > -1) add("elevenlabs_sfx:true_peak_too_hot");

  const reuseLimit = numberOrNull(sidecar.reuse_limit);
  const usageCount = numberOrNull(sidecar.usage_count) ?? 0;
  if (reuseLimit === null || reuseLimit < 1) add("elevenlabs_sfx:reuse_limit_missing");
  if (reuseLimit !== null && usageCount > reuseLimit) add("elevenlabs_sfx:reuse_limit_exceeded");

  const status = blockers.length ? "blocked" : "accepted";
  return {
    asset_id: cleanText(sidecar.asset_id) || path.basename(resolvedSidecar, ".json"),
    role,
    family: cleanText(sidecar.family || role),
    provider_id: PROVIDER_ID,
    sidecar_path: resolvedSidecar,
    audio_path: audioPath || null,
    prompt: cleanText(sidecar.prompt),
    model: cleanText(sidecar.model),
    generation_time: cleanText(sidecar.generation_time),
    sha256: cleanText(sidecar.sha256),
    actual_sha256: actualSha256,
    sha256_verified: Boolean(actualSha256 && cleanText(sidecar.sha256) === actualSha256),
    rights_note: cleanText(sidecar.rights_note),
    terms_evidence_url: cleanText(sidecar.terms_evidence_url) || null,
    allowed_use: cleanText(sidecar.allowed_use),
    commercial_use_allowed: sidecar.commercial_use_allowed === true,
    duration_ms: numberOrNull(sidecar.duration_ms),
    loudness_lufs: loudnessLufs,
    true_peak_db: truePeakDb,
    reuse_limit: reuseLimit,
    usage_count: usageCount,
    status,
    blockers,
  };
}

function blockerCounts(assets = [], extraBlockers = []) {
  const counts = {};
  for (const asset of asArray(assets)) {
    for (const blocker of asArray(asset.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  for (const blocker of asArray(extraBlockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  return counts;
}

function buildSidecarManifest(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    provider_id: PROVIDER_ID,
    assets: asArray(report.assets).map((asset) => ({
      asset_id: asset.asset_id,
      role: asset.role,
      family: asset.family,
      sidecar_path: asset.sidecar_path,
      audio_path: asset.audio_path,
      prompt: asset.prompt,
      model: asset.model,
      generation_time: asset.generation_time,
      sha256: asset.sha256,
      actual_sha256: asset.actual_sha256,
      sha256_verified: asset.sha256_verified,
      status: asset.status,
      blockers: asset.blockers,
    })),
  };
}

function buildRightsLedger(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    records: asArray(report.assets).map((asset) => ({
      asset_id: asset.asset_id,
      role: asset.role,
      provider_id: PROVIDER_ID,
      rights_basis: "elevenlabs_generated_sound_effect_account_terms",
      rights_note: asset.rights_note,
      terms_evidence_url: asset.terms_evidence_url,
      allowed_use: asset.allowed_use,
      commercial_use_allowed: asset.commercial_use_allowed,
      raw_redistribution_allowed: false,
      status: asset.status === "accepted" ? "rights_recorded" : "blocked",
      blockers: asArray(asset.blockers).filter((blocker) => blocker.includes("rights") || blocker.includes("commercial") || blocker.includes("allowed_use")),
    })),
  };
}

function buildLoudnessQc(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    assets: asArray(report.assets).map((asset) => ({
      asset_id: asset.asset_id,
      role: asset.role,
      loudness_lufs: asset.loudness_lufs,
      true_peak_db: asset.true_peak_db,
      status: asArray(asset.blockers).some((blocker) => blocker.includes("loudness") || blocker.includes("peak"))
        ? "blocked"
        : "pass",
      blockers: asArray(asset.blockers).filter((blocker) => blocker.includes("loudness") || blocker.includes("peak")),
    })),
  };
}

function buildReusePolicy(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    assets: asArray(report.assets).map((asset) => ({
      asset_id: asset.asset_id,
      role: asset.role,
      usage_count: asset.usage_count,
      reuse_limit: asset.reuse_limit,
      status: asArray(asset.blockers).includes("elevenlabs_sfx:reuse_limit_exceeded")
        ? "reuse_limit_exceeded"
        : "within_reuse_limit",
    })),
  };
}

function buildSfxRuntimeManifest(report = {}) {
  const accepted = asArray(report.assets).filter((asset) => asset.status === "accepted");
  const byRole = {};
  for (const asset of accepted) {
    if (!byRole[asset.role]) byRole[asset.role] = [];
    byRole[asset.role].push({
      role: asset.role,
      family: asset.family,
      provider_id: PROVIDER_ID,
      asset_id: asset.asset_id,
      path: asset.audio_path,
      source_url: asset.audio_path ? `file://${normalisePath(asset.audio_path)}` : null,
      source_type: "elevenlabs_generated_sfx_sidecar",
      approval_status: "approved_for_commercial_editorial_use",
      editorial_sfx_score: 0.82,
      elevenlabs_governance: {
        sidecar_path: asset.sidecar_path,
        sha256: asset.sha256,
        sha256_verified: asset.sha256_verified,
        prompt: asset.prompt,
        model: asset.model,
        generation_time: asset.generation_time,
        rights_note: asset.rights_note,
        loudness_qc_status: "pass",
        reuse_status: "within_reuse_limit",
      },
    });
  }
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    provider_id: PROVIDER_ID,
    readiness: {
      status: report.verdict === "PASS" ? "ready" : "blocked",
      blockers: Object.keys(report.blocker_counts || {}),
    },
    required_roles: report.required_roles || [],
    covered_roles: report.covered_roles || [],
    selected_assets: accepted,
    variant_assets_by_role: byRole,
    rotation_policy: {
      strategy: "story_id_hash",
      seed_fields: ["story.id", "story.url", "role"],
      fallback: "first_accepted_asset_for_role",
    },
    safety: report.safety || {},
  };
}

async function buildElevenLabsSfxGovernanceEngine({
  workspaceRoot = process.cwd(),
  roots = [path.join(workspaceRoot, "audio", "elevenlabs", "sfx")],
  sidecarPaths = [],
  requiredRoles = DEFAULT_REQUIRED_ROLES,
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (outputDir) await fs.ensureDir(path.resolve(outputDir));
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const explicitSidecars = asArray(sidecarPaths).map((filePath) => path.resolve(resolvedWorkspace, filePath));
  const scannedSidecars = explicitSidecars.length
    ? []
    : (await Promise.all(asArray(roots).map((root) => scanSidecars(path.resolve(resolvedWorkspace, root))))).flat();
  const allSidecars = unique([...explicitSidecars, ...scannedSidecars]);
  const assets = [];
  for (const sidecarPath of allSidecars) {
    assets.push(await inspectSidecar(sidecarPath, { workspaceRoot: resolvedWorkspace }));
  }

  const accepted = assets.filter((asset) => asset.status === "accepted");
  const coveredRoles = unique(accepted.map((asset) => asset.role));
  const required = unique(requiredRoles);
  const missingRoleBlockers = required
    .filter((role) => !coveredRoles.includes(role))
    .map((role) => `elevenlabs_sfx:missing_required_role:${role}`);
  const counts = blockerCounts(assets, missingRoleBlockers);
  const hasBlockers = Object.keys(counts).length > 0;
  const verdict = !assets.length ? "PARTIAL" : hasBlockers ? "BLOCKED" : "PASS";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    provider_id: PROVIDER_ID,
    required_roles: required,
    covered_roles: coveredRoles,
    summary: {
      sidecar_count: assets.length,
      accepted_asset_count: accepted.length,
      blocked_asset_count: assets.length - accepted.length,
      required_role_count: required.length,
      covered_role_count: coveredRoles.length,
      missing_role_count: missingRoleBlockers.length,
    },
    blocker_counts: counts,
    assets,
    generation_plan: buildGenerationPlan(required, generatedAt),
    safety: {
      local_proof_only: true,
      no_external_generation_started: true,
      no_api_call: true,
      no_secret_or_token_read: true,
      no_oauth_or_token_change: true,
      no_db_mutation: true,
      no_posting: true,
      no_audio_binary_commit_required: true,
    },
  };
  report.sidecar_manifest = buildSidecarManifest(report);
  report.rights_ledger = buildRightsLedger(report);
  report.loudness_qc = buildLoudnessQc(report);
  report.reuse_policy = buildReusePolicy(report);
  report.sfx_runtime_manifest = buildSfxRuntimeManifest(report);
  return report;
}

function renderElevenLabsSfxGovernanceMarkdown(report = {}) {
  const lines = [];
  lines.push("# ElevenLabs SFX Governance Engine");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Sidecars checked: ${Number(report.summary?.sidecar_count || 0)}`);
  lines.push(`Accepted assets: ${Number(report.summary?.accepted_asset_count || 0)}`);
  lines.push(`Required roles covered: ${Number(report.summary?.covered_role_count || 0)} / ${Number(report.summary?.required_role_count || 0)}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This command did not call ElevenLabs, generate audio, publish, mutate the database, read secrets or touch OAuth/token settings.");
  return `${lines.join("\n")}\n`;
}

async function writeElevenLabsSfxGovernanceEngine(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeElevenLabsSfxGovernanceEngine requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "elevenlabs_sfx_governance_report.json");
  const readinessMarkdown = path.join(outDir, "elevenlabs_sfx_governance_report.md");
  const generationPlan = path.join(outDir, "elevenlabs_sfx_generation_plan.json");
  const sidecarManifest = path.join(outDir, "elevenlabs_sfx_sidecar_manifest.json");
  const rightsLedger = path.join(outDir, "elevenlabs_sfx_rights_ledger.json");
  const loudnessQc = path.join(outDir, "elevenlabs_sfx_loudness_qc.json");
  const reusePolicy = path.join(outDir, "elevenlabs_sfx_reuse_policy.json");
  const sfxRuntimeManifest = path.join(outDir, "elevenlabs_sfx_runtime_manifest.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderElevenLabsSfxGovernanceMarkdown(report), "utf8");
  await fs.writeJson(generationPlan, report.generation_plan || buildGenerationPlan(report.required_roles, report.generated_at), { spaces: 2 });
  await fs.writeJson(sidecarManifest, report.sidecar_manifest || buildSidecarManifest(report), { spaces: 2 });
  await fs.writeJson(rightsLedger, report.rights_ledger || buildRightsLedger(report), { spaces: 2 });
  await fs.writeJson(loudnessQc, report.loudness_qc || buildLoudnessQc(report), { spaces: 2 });
  await fs.writeJson(reusePolicy, report.reuse_policy || buildReusePolicy(report), { spaces: 2 });
  await fs.writeJson(sfxRuntimeManifest, report.sfx_runtime_manifest || buildSfxRuntimeManifest(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    generationPlan,
    sidecarManifest,
    rightsLedger,
    loudnessQc,
    reusePolicy,
    sfxRuntimeManifest,
  };
}

module.exports = {
  DEFAULT_REQUIRED_ROLES,
  GOAL_ID,
  PROVIDER_ID,
  buildElevenLabsSfxGovernanceEngine,
  buildGenerationPlan,
  buildLoudnessQc,
  buildReusePolicy,
  buildRightsLedger,
  buildSfxRuntimeManifest,
  buildSidecarManifest,
  inspectSidecar,
  renderElevenLabsSfxGovernanceMarkdown,
  scanSidecars,
  writeElevenLabsSfxGovernanceEngine,
};
