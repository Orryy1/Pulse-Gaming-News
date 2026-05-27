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

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalisePath(value) {
  return cleanText(value).replace(/\\/g, "/");
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
      approval_status: cleanText(safelistEvidence)
        ? "approved_for_commercial_editorial_use"
        : "blocked_until_safelist_evidence_retained",
      risk_score: cleanText(safelistEvidence) ? 0.08 : 0.42,
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

function defaultDownloadPlan() {
  return {
    provider: EPIDEMIC_PROVIDER.provider_name,
    policy_links: [
      EPIDEMIC_PROVIDER.licence_evidence_url,
      EPIDEMIC_PROVIDER.cancellation_evidence_url,
      EPIDEMIC_PROVIDER.stems_evidence_url,
    ],
    required_slots: [
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
    ],
    channels: CHANNELS,
    operator_steps: [
      "Safelist the intended social channels in Epidemic Sound before publishing.",
      "Download full mixes for bed roles and short files for stings/SFX.",
      "Use stems only when a human wants manual mix control.",
      "Place files in the listed folders, then rerun the intake command.",
      "Keep screenshots or exported proof of safelisting outside tokens and .env files.",
    ],
  };
}

function enrichSfxRights(records = [], safelistEvidence = "") {
  return asArray(records).map((record) => ({
    ...record,
    safelist_evidence: cleanText(safelistEvidence) || null,
    active_subscription_required_for_new_posts: true,
    published_during_subscription_remains_cleared: true,
    evidence_reference: cleanText(safelistEvidence) || record.evidence_reference || record.licence_evidence_url,
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
  const music = buildMusicInventory({
    workspaceRoot,
    root: resolvedRoot,
    safelistEvidence,
  });
  const sfxRoot = path.join(resolvedRoot, "sfx");
  const sfxReport = buildSfxLibraryIngestReport({
    workspaceRoot,
    roots: fs.existsSync(sfxRoot) ? [sfxRoot] : [],
    generatedAt,
  });
  const sfxRecords = enrichSfxRights(sfxReport.rights_ledger?.records, safelistEvidence);
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
  if (allAudioCount === 0) blockers.push("epidemic:no_local_audio_assets");
  for (const role of REQUIRED_MUSIC_ROLES) {
    if (!presentMusicRoles.has(role)) blockers.push(`epidemic:missing_music_role:${role}`);
  }
  blockers.push(...asArray(sfxReport.source_plan?.readiness?.blockers));
  if (music.assets.some((asset) => asset.role === "stem")) {
    warnings.push("epidemic:stems_need_operator_mix_decision");
  }
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
      safelist_evidence_present: Boolean(cleanText(safelistEvidence)),
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
  scanAudioFiles,
};
