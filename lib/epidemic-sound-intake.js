"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildSfxLibraryIngestReport,
} = require("./studio/v4/sfx-library-ingest");

const AUDIO_EXTENSIONS = /\.(wav|flac|mp3|aiff?|ogg|m4a)$/i;

const EPIDEMIC_PROVIDER = {
  provider_id: "epidemic_sound",
  provider_name: "Epidemic Sound",
  licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
  licence_evidence_url: "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
  cancellation_evidence_url: "https://help.epidemicsound.com/hc/en-us/articles/26254650213266-What-happens-when-a-subscription-is-canceled",
  stems_evidence_url: "https://help.epidemicsound.com/hc/en-us/articles/25921163391762-Download-the-music-in-stems-or-audio-layers",
};

const REQUIRED_MUSIC_ROLES = [
  "bed_primary",
  "bed_breaking",
  "sting_verified",
  "sting_rumour",
  "sting_breaking",
];

const REQUIRED_SFX_ROLES = ["impact", "transition", "ui_tick", "riser", "sub_hit", "glitch"];

const CHANNELS = [
  {
    channel_id: "pulse-gaming",
    name: "Pulse Gaming Epidemic Sound",
    brief: "Gaming-news beds: electronic, kinetic, punchy, low vocal risk, clean loop points.",
  },
  {
    channel_id: "stacked",
    name: "Stacked Epidemic Sound",
    brief: "Finance/markets beds: clean tension, modern business tech, restrained percussion.",
  },
  {
    channel_id: "the-signal",
    name: "The Signal Epidemic Sound",
    brief: "Tech-news beds: sleek synth, future-facing, precise UI ticks and light risers.",
  },
];

const VARIANT_TARGETS = {
  bed_primary: 6,
  bed_breaking: 4,
  sting_verified: 3,
  sting_rumour: 3,
  sting_breaking: 3,
  impact: 4,
  transition: 4,
  ui_tick: 4,
  riser: 4,
  sub_hit: 4,
  glitch: 4,
};

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalisePath(value) {
  return cleanText(value).replace(/\\/g, "/");
}

function readSafelistEvidenceReport(safelistEvidence = "", { workspaceRoot = process.cwd() } = {}) {
  const reference = cleanText(safelistEvidence);
  const base = {
    reference: reference || null,
    present: Boolean(reference),
    parsed: false,
    safelisted_platforms: [],
    not_safelisted_platforms: [],
    blocked_platforms: [],
    warnings: [],
  };
  if (!reference) return base;

  const resolved = path.isAbsolute(reference)
    ? reference
    : path.resolve(workspaceRoot, reference);
  if (!fs.existsSync(resolved) || path.extname(resolved).toLowerCase() !== ".json") {
    return base;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
    const safelisted = asArray(parsed.safelisted_platforms);
    const notSafelisted = asArray(parsed.not_safelisted_platforms);
    const blocked = notSafelisted
      .filter((item) => cleanText(item.status).toLowerCase() === "blocked")
      .map((item) => ({
        channel_id: cleanText(item.channel_id),
        platform: cleanText(item.platform),
        blocker: cleanText(item.blocker),
      }))
      .filter((item) => item.platform);

    return {
      ...base,
      parsed: true,
      path: resolved,
      safelisted_platforms: safelisted,
      not_safelisted_platforms: notSafelisted,
      blocked_platforms: blocked,
      warnings: asArray(parsed.unverified_channel_scopes).map((channelId) => `epidemic:unverified_channel_scope:${channelId}`),
    };
  } catch {
    return {
      ...base,
      parsed: true,
      path: resolved,
      blocked_platforms: [{ platform: "unknown", blocker: "epidemic_safelist_evidence_unreadable" }],
      warnings: ["epidemic:safelist_evidence_json_unreadable"],
    };
  }
}

function pathContainsSegment(filePath, segment) {
  return normalisePath(filePath).toLowerCase().split("/").includes(segment);
}

function relativeFrom(root, filePath) {
  return normalisePath(path.relative(root, filePath));
}

function stableAssetId(filePath, role) {
  const digest = crypto
    .createHash("sha1")
    .update(normalisePath(filePath).toLowerCase())
    .digest("hex")
    .slice(0, 12);
  return `epidemic_sound_${role}_${digest}`;
}

function scanAudioFiles(root, { maxDepth = 8 } = {}) {
  const files = [];
  if (!root || !fs.existsSync(root)) return files;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    if (current.depth > maxDepth) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(fullPath).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (isDir) {
        stack.push({ dir: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (AUDIO_EXTENSIONS.test(entry.name)) files.push(fullPath);
    }
  }
  return files.sort((a, b) => normalisePath(a).localeCompare(normalisePath(b)));
}

function classifyMusicRole(filePath) {
  const text = normalisePath(filePath).toLowerCase();
  if (
    pathContainsSegment(filePath, "stems") ||
    /\b(?:stem|drums|bass|instrument|melody)\b/.test(text)
  ) {
    return "stem";
  }
  if (pathContainsSegment(filePath, "bed_primary") || text.includes("epidemic_bed_primary_")) {
    return "bed_primary";
  }
  if (pathContainsSegment(filePath, "bed_breaking") || text.includes("epidemic_bed_breaking_")) {
    return "bed_breaking";
  }
  if (pathContainsSegment(filePath, "sting_verified") || text.includes("epidemic_sting_verified_")) {
    return "sting_verified";
  }
  if (pathContainsSegment(filePath, "sting_rumour") || text.includes("epidemic_sting_rumour_")) {
    return "sting_rumour";
  }
  if (pathContainsSegment(filePath, "sting_breaking") || text.includes("epidemic_sting_breaking_")) {
    return "sting_breaking";
  }
  if (pathContainsSegment(filePath, "stings") || /\b(?:sting|stinger|bumper|hit)\b/.test(text)) {
    if (/rumou?r|leak/.test(text)) return "sting_rumour";
    if (/breaking|urgent|alert/.test(text)) return "sting_breaking";
    if (/verified|official|source|lock/.test(text)) return "sting_verified";
    return "sting_verified";
  }
  if (/breaking|urgent|alert|fast|high[-_ ]?energy/.test(text)) return "bed_breaking";
  if (/bed|loop|main|primary|background|underscore|full[-_ ]?mix|music/.test(text)) {
    return "bed_primary";
  }
  return "";
}

function musicAssetType(role) {
  if (role === "stem") return "music_stem";
  if (String(role || "").startsWith("sting_")) return "music_sting";
  return "music_bed";
}

function musicRoots(root) {
  return ["music", "stings", "stems"]
    .map((folder) => path.join(root, folder))
    .filter((candidate) => fs.existsSync(candidate));
}

function buildMusicInventory({
  workspaceRoot = process.cwd(),
  root = path.join(workspaceRoot, "audio", "epidemic"),
  safelistEvidence = "",
  safelistApproved = Boolean(cleanText(safelistEvidence)),
} = {}) {
  const roots = musicRoots(root);
  const files = roots.flatMap((musicRoot) => scanAudioFiles(musicRoot));
  const assets = [];
  const rejected = [];
  for (const filePath of files) {
    const role = classifyMusicRole(filePath);
    if (!role) {
      rejected.push({ path: filePath, reason: "epidemic_music_role_not_detected" });
      continue;
    }
    const asset = {
      asset_id: stableAssetId(filePath, role),
      asset_type: musicAssetType(role),
      role,
      provider_id: EPIDEMIC_PROVIDER.provider_id,
      provider_name: EPIDEMIC_PROVIDER.provider_name,
      path: filePath,
      filename: relativeFrom(root, filePath),
      source_url: `file://${normalisePath(filePath)}`,
      source_type: "epidemic_sound_local_file",
      licence_basis: EPIDEMIC_PROVIDER.licence_basis,
      licence_evidence_url: EPIDEMIC_PROVIDER.licence_evidence_url,
      safelist_evidence: cleanText(safelistEvidence) || null,
      allowed_use: "finished_editorial_video_only",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
      commercial_use_allowed: true,
      active_subscription_required_for_new_posts: true,
      published_during_subscription_remains_cleared: true,
      raw_redistribution_allowed: false,
      approval_status: safelistApproved
        ? "approved_for_commercial_editorial_use"
        : cleanText(safelistEvidence)
          ? "blocked_until_required_platforms_safelisted"
          : "blocked_until_safelist_evidence_retained",
      risk_score: safelistApproved ? 0.08 : 0.42,
    };
    assets.push(asset);
  }
  return { assets, rejected };
}

function rightsRecordFromAsset(asset) {
  return {
    ...asset,
    evidence_reference: asset.safelist_evidence || EPIDEMIC_PROVIDER.licence_evidence_url,
    provider_policy_links: [
      EPIDEMIC_PROVIDER.licence_evidence_url,
      EPIDEMIC_PROVIDER.cancellation_evidence_url,
      EPIDEMIC_PROVIDER.stems_evidence_url,
    ],
  };
}

function buildAudioPackCandidates(musicAssets = [], { rootPath = "audio/epidemic" } = {}) {
  const usable = asArray(musicAssets).filter((asset) => REQUIRED_MUSIC_ROLES.includes(asset.role));
  if (!usable.length) return [];
  return CHANNELS.map((channel) => ({
    id: `${channel.channel_id}-epidemic-v1`,
    channel_id: channel.channel_id,
    name: channel.name,
    root_path: rootPath,
    license: EPIDEMIC_PROVIDER.licence_basis,
    _note: "Candidate only. Copy into channels/<channel>/audio/pack.json after operator checks safelisting and fit.",
    assets: usable.map((asset) => ({
      role: asset.role,
      filename: asset.filename,
      asset_id: asset.asset_id,
      license: asset.licence_basis,
      provider_id: asset.provider_id,
      safelist_evidence: asset.safelist_evidence,
    })),
  }));
}

function downloadSlotCategory(role) {
  return REQUIRED_SFX_ROLES.includes(role) ? "sfx" : "music";
}

function epidemicSearchUrl({ role, search_brief: searchBrief, asset_category: assetCategory } = {}) {
  const category = assetCategory || downloadSlotCategory(role);
  const base =
    category === "sfx"
      ? "https://www.epidemicsound.com/sound-effects/"
      : "https://www.epidemicsound.com/music/";
  return `${base}?term=${encodeURIComponent(searchBrief || role || "")}`;
}

function enrichDownloadSlot(slot = {}) {
  const assetCategory = slot.asset_category || downloadSlotCategory(slot.role);
  return {
    ...slot,
    asset_category: assetCategory,
    local_target_path: `audio/epidemic/${slot.folder}`,
    recommended_filename_prefix: slot.recommended_filename_prefix || `epidemic_${slot.role}_`,
    search_url: slot.search_url || epidemicSearchUrl({ ...slot, asset_category: assetCategory }),
  };
}

function defaultDownloadPlan() {
  const requiredSlots = [
    {
      role: "bed_primary",
      folder: "music/bed_primary",
      search_brief: "instrumental gaming news bed, modern electronic, 100-130 BPM, no vocals, clean loop.",
    },
    {
      role: "bed_breaking",
      folder: "music/bed_breaking",
      search_brief: "urgent news bed, high energy electronic, controlled low end, no vocals.",
    },
    {
      role: "sting_verified",
      folder: "stings/sting_verified",
      search_brief: "short source-lock hit, clean confirmation sting, less than two seconds.",
    },
    {
      role: "sting_rumour",
      folder: "stings/sting_rumour",
      search_brief: "short restrained tension sting for rumour/watch segments.",
    },
    {
      role: "sting_breaking",
      folder: "stings/sting_breaking",
      search_brief: "short breaking-news impact, punchy but not horror or trailer parody.",
    },
    {
      role: "impact",
      folder: "sfx",
      search_brief: "cinematic editorial impact hit, short, no voice, no weapon/foley semantics.",
    },
    {
      role: "transition",
      folder: "sfx",
      search_brief: "fast whoosh transition for phone edits, clean and non-comedic.",
    },
    {
      role: "ui_tick",
      folder: "sfx",
      search_brief: "subtle UI click or source-lock tick, no alert voice, no game UI phrase.",
    },
    {
      role: "riser",
      folder: "sfx",
      search_brief: "short riser or swell for proof-card build, not horror/fantasy.",
    },
    {
      role: "sub_hit",
      folder: "sfx",
      search_brief: "low sub hit or boom for opener landing, controlled tail.",
    },
    {
      role: "glitch",
      folder: "sfx",
      search_brief: "clean digital glitch/static accent for leak or data moments, no voice.",
    },
  ].map(enrichDownloadSlot);
  const slotByRole = new Map(requiredSlots.map((slot) => [slot.role, slot]));
  const variantTargets = Object.entries(VARIANT_TARGETS).map(([role, targetVariants]) => {
    const slot = slotByRole.get(role);
    return {
      role,
      target_variants: targetVariants,
      starter_slot_present: Boolean(slot),
      folder: slot?.folder || (REQUIRED_SFX_ROLES.includes(role) ? "sfx" : "music"),
      asset_category: slot?.asset_category || downloadSlotCategory(role),
      local_target_path: slot?.local_target_path || `audio/epidemic/${slot?.folder || ""}`.replace(/\/$/, ""),
      search_url: slot?.search_url || epidemicSearchUrl({ role }),
      recommended_filename_prefix: slot?.recommended_filename_prefix || `epidemic_${role}_`,
    };
  });
  const expansionSlots = variantTargets.flatMap((target) => {
    const baseSlot = slotByRole.get(target.role) || enrichDownloadSlot({
      role: target.role,
      folder: target.folder,
      search_brief: target.role,
      asset_category: target.asset_category,
    });
    const slots = [];
    for (let variantNumber = 2; variantNumber <= target.target_variants; variantNumber += 1) {
      slots.push({
        ...baseSlot,
        slot_id: `${target.role}_variant_${String(variantNumber).padStart(2, "0")}`,
        variant_number: variantNumber,
        target_variants: target.target_variants,
        recommended_filename_prefix: `epidemic_${target.role}_${String(variantNumber).padStart(2, "0")}_`,
      });
    }
    return slots;
  });

  return {
    provider: EPIDEMIC_PROVIDER.provider_name,
    policy_links: [
      EPIDEMIC_PROVIDER.licence_evidence_url,
      EPIDEMIC_PROVIDER.cancellation_evidence_url,
      EPIDEMIC_PROVIDER.stems_evidence_url,
    ],
    required_slots: requiredSlots,
    variant_strategy: {
      mode: "unbounded_role_variants",
      starter_library_target: variantTargets.reduce((sum, target) => sum + target.target_variants, 0),
      selection: "story_id_hash_rotation_after_intake",
      scaling_rule: "Keep adding local files with the role prefix; the materializer groups and rotates every approved variant without code changes.",
    },
    variant_targets: variantTargets,
    expansion_slots: expansionSlots,
    channels: CHANNELS,
    operator_steps: [
      "Safelist the intended social channels in Epidemic Sound before publishing.",
      "Download full mixes for bed roles and short files for stings/SFX.",
      "Rename vague download filenames with the recommended role prefix before intake.",
      "Use stems only when a human wants manual mix control.",
      "Place files in the listed folders, then rerun the intake command.",
      "Keep screenshots or exported proof of safelisting outside tokens and .env files.",
    ],
  };
}

function enrichSfxRights(records = [], safelistEvidence = "", { safelistApproved = Boolean(cleanText(safelistEvidence)) } = {}) {
  return asArray(records).map((record) => ({
    ...record,
    safelist_evidence: cleanText(safelistEvidence) || null,
    active_subscription_required_for_new_posts: true,
    published_during_subscription_remains_cleared: true,
    evidence_reference: cleanText(safelistEvidence) || record.evidence_reference || record.licence_evidence_url,
    approval_status: safelistApproved
      ? record.approval_status || "approved_for_commercial_editorial_use"
      : cleanText(safelistEvidence)
        ? "blocked_until_required_platforms_safelisted"
        : "blocked_until_safelist_evidence_retained",
    risk_score: safelistApproved ? record.risk_score || 0.08 : Math.max(Number(record.risk_score || 0), 0.42),
  }));
}

function buildEpidemicSoundIntakeReport({
  workspaceRoot = process.cwd(),
  root = path.join(workspaceRoot, "audio", "epidemic"),
  outputDir = path.join(workspaceRoot, "output", "epidemic-sound-intake"),
  generatedAt = new Date().toISOString(),
  safelistEvidence = "",
} = {}) {
  const resolvedRoot = path.resolve(workspaceRoot, root);
  const resolvedOutputDir = path.resolve(workspaceRoot, outputDir);
  const safelistEvidenceReport = readSafelistEvidenceReport(safelistEvidence, { workspaceRoot });
  const safelistApproved =
    Boolean(cleanText(safelistEvidence)) && safelistEvidenceReport.blocked_platforms.length === 0;
  const music = buildMusicInventory({
    workspaceRoot,
    root: resolvedRoot,
    safelistEvidence,
    safelistApproved,
  });
  const sfxRoot = path.join(resolvedRoot, "sfx");
  const sfxReport = buildSfxLibraryIngestReport({
    workspaceRoot,
    roots: fs.existsSync(sfxRoot) ? [sfxRoot] : [],
    generatedAt,
  });
  const sfxRecords = enrichSfxRights(sfxReport.rights_ledger?.records, safelistEvidence, { safelistApproved });
  const musicRights = music.assets.map(rightsRecordFromAsset);
  const allRecords = [...musicRights, ...sfxRecords];
  const rootPath = normalisePath(path.relative(workspaceRoot, resolvedRoot)) || normalisePath(resolvedRoot);
  const audioPackCandidates = buildAudioPackCandidates(music.assets, { rootPath });
  const downloadPlan = defaultDownloadPlan();
  const presentMusicRoles = new Set(music.assets.map((asset) => asset.role));
  const blockers = [];
  const warnings = [];
  const allAudioCount = music.assets.length + Number(sfxReport.summary?.accepted_assets || 0);

  if (!cleanText(safelistEvidence)) blockers.push("epidemic:safelist_evidence_missing");
  for (const platform of safelistEvidenceReport.blocked_platforms) {
    blockers.push(`epidemic:safelist_platform_blocked:${platform.platform}`);
  }
  if (allAudioCount === 0) blockers.push("epidemic:no_local_audio_assets");
  for (const role of REQUIRED_MUSIC_ROLES) {
    if (!presentMusicRoles.has(role)) blockers.push(`epidemic:missing_music_role:${role}`);
  }
  blockers.push(...asArray(sfxReport.source_plan?.readiness?.blockers));
  if (music.assets.some((asset) => asset.role === "stem")) {
    warnings.push("epidemic:stems_need_operator_mix_decision");
  }
  warnings.push(...safelistEvidenceReport.warnings);
  if (CHANNELS.length > 1) warnings.push("epidemic:verify_subscription_plan_covers_all_channels");

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "epidemic_sound_local_intake",
    root: resolvedRoot,
    output_dir: resolvedOutputDir,
    provider: EPIDEMIC_PROVIDER,
    summary: {
      files_scanned: allAudioCount + music.rejected.length + Number(sfxReport.summary?.rejected_assets || 0),
      music_assets: music.assets.length,
      sfx_assets: Number(sfxReport.summary?.accepted_assets || 0),
      rights_records: allRecords.length,
      audio_pack_candidates: audioPackCandidates.length,
      variant_target_total: downloadPlan.variant_strategy.starter_library_target,
      variant_expansion_slots: downloadPlan.expansion_slots.length,
      safelist_evidence_present: Boolean(cleanText(safelistEvidence)),
      safelisted_platforms: safelistEvidenceReport.safelisted_platforms.length,
      safelist_blocked_platforms: safelistEvidenceReport.blocked_platforms.length,
    },
    readiness: {
      status: blockers.length ? "blocked" : "pass",
      blockers,
      warnings,
    },
    music_inventory: music.assets,
    music_rejected_assets: music.rejected,
    sfx_inventory: sfxReport.asset_inventory || [],
    sfx_source_plan: sfxReport.source_plan || {},
    sfx_rejected_assets: sfxReport.rejected_assets || [],
    safelist_evidence_report: safelistEvidenceReport,
    rights_ledger: {
      schema_version: 1,
      provider_id: EPIDEMIC_PROVIDER.provider_id,
      records: allRecords,
    },
    audio_pack_candidates: audioPackCandidates,
    download_plan: downloadPlan,
    safety: {
      local_only: true,
      no_downloads_started: true,
      no_oauth_or_token_change: true,
      no_db_mutation: true,
      no_posting: true,
      no_external_api_calls: true,
      no_secret_or_token_read: true,
    },
  };
}

module.exports = {
  EPIDEMIC_PROVIDER,
  REQUIRED_MUSIC_ROLES,
  buildAudioPackCandidates,
  buildEpidemicSoundIntakeReport,
  buildMusicInventory,
  classifyMusicRole,
  defaultDownloadPlan,
  epidemicSearchUrl,
  enrichDownloadSlot,
  readSafelistEvidenceReport,
  REQUIRED_SFX_ROLES,
  scanAudioFiles,
};
