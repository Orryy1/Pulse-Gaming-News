"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildCreatorStudioSfxSourcingPlan,
} = require("./sfx-source-registry");

const AUDIO_EXTENSIONS = /\.(wav|flac|mp3|aiff?|ogg)$/i;

const DEFAULT_REQUIRED_CUES = [
  { family: "impact", role: "impact" },
  { family: "whoosh", role: "transition" },
  { family: "riser", role: "riser" },
  { family: "source_tick", role: "ui_tick" },
  { family: "sub_hit", role: "sub_hit" },
  { family: "glitch", role: "glitch" },
];

const PROVIDERS = [
  {
    provider_id: "boom_library",
    licence_basis: "boom_library_media_license",
    licence_evidence_url: "https://www.boomlibrary.com/support/faq/what-am-i-allowed-to-do-with-your-sounds/",
    patterns: [/boom[ _-]?library/i, /[\\/]boom[\\/]/i],
  },
  {
    provider_id: "pro_sound_effects",
    licence_basis: "pro_sound_effects_subscription_license",
    licence_evidence_url: "https://www.prosoundeffects.com/licensing",
    patterns: [/pro[ _-]?sound[ _-]?effects/i, /[\\/]pse[\\/]/i],
  },
  {
    provider_id: "soundly",
    licence_basis: "soundly_pro_commercial_use",
    licence_evidence_url: "https://getsoundly.com/faq/how-can-i-use-the-sounds/",
    patterns: [/soundly/i],
  },
  {
    provider_id: "epidemic_sound",
    licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
    licence_evidence_url: "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
    patterns: [/epidemic[ _-]?sound/i, /[\\/]epidemic[\\/]/i],
  },
  {
    provider_id: "sonniss",
    licence_basis: "sonniss_game_audio_gdc_bundle_license",
    licence_evidence_url: "https://sonniss.com/gdc-bundle-license/",
    patterns: [/sonniss/i, /gameaudio[ _-]?gdc/i, /game[ _-]?audio[ _-]?gdc/i],
  },
];

const ROLE_PATTERNS = [
  ["glitch", /glitch|stutter|static|digital|bitcrush|broken/i],
  ["riser", /riser|rise|reveal|swell|build[-_ ]?up|buildup|tension/i],
  ["transition", /whoosh|swoosh|swipe|transition|pass[-_ ]?by|sweep/i],
  ["ui_tick", /ui(?:click|data|misc)?|(?:^|[^a-z0-9])(?:tick|blip|click|beep|button|alert|select|feedback|counter)(?:[^a-z0-9]|$)/i],
  ["impact", /impact|hit|punch|thump|slam|thud|smash|drop/i],
  ["sub_hit", /\bsub(?:[-_ ]?hit)?\b|boom|bass[-_ ]?drop|low[-_ ]?hit/i],
];

const CONTEXT_REJECT_PATTERNS = [
  /\b(?:ambiences?|ambient|amb|atmos|field[-_ ]?recording|room[-_ ]?tone|wildtrack)\b/i,
  /\b(?:crowd|subway|train[-_ ]?station|station|forest|birds?|summerhouse|escalator|tunnel)\b/i,
  /\b(?:engine|vehicle|car|audi|ford|porsche|quattro|tractor|farm|boat|mercury|gear[-_ ]?stick|idle|blips?|pass[-_ ]?by)\b/i,
  /(?:water|watr|rain|thunder|creek|waterfall|liquid|organic|texture|drone|tone)/i,
  /\b(?:hair[-_ ]?dryer|sewer|pipe|plastic[-_ ]?textures?|wood|stone)\b/i,
  /\b(?:gore|flesh|weapon|gun|rifle|dragunov|rpg|warfare|axe|sword|shield|melee)\b/i,
  /\b(?:guitar[-_ ]?pickup|interference|spade|drumstick|glass)\b/i,
  /(?:voices?|vox|robot|robotic|droid|android|target[-_ ]?acquired|hostile[-_ ]?territory|stealth[-_ ]?mode)/i,
  /(?:haunted|eerie|groan|gasp|wail|horror|scary|creaky)/i,
  /(?:steampunk|cardboard|prop[-_ ]?texture|metal[-_ ]?tensions?|stringssection|whammy|flabby|deviant)/i,
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

function defaultRoots(workspaceRoot = process.cwd()) {
  return [
    path.join(workspaceRoot, "audio", "epidemic"),
    path.join(workspaceRoot, "audio", "sonniss"),
    path.join(workspaceRoot, "audio", "licensed-sfx"),
    path.join(workspaceRoot, "audio", "sfx"),
    path.join(workspaceRoot, "assets", "sfx", "licensed"),
  ];
}

function stableAssetId(filePath, providerId, role) {
  const digest = crypto.createHash("sha1").update(normalisePath(filePath).toLowerCase()).digest("hex").slice(0, 12);
  return `${providerId}_${role}_${digest}`;
}

function providerForPath(filePath) {
  const normalised = normalisePath(filePath);
  return PROVIDERS.find((provider) => provider.patterns.some((pattern) => pattern.test(normalised))) || null;
}

function roleForPath(filePath) {
  const normalised = normalisePath(filePath);
  if (CONTEXT_REJECT_PATTERNS.some((pattern) => pattern.test(normalised))) return "";
  if (/(?:^|[^a-z0-9])(?:dsgnboom|sub|bass[-_ ]?drop|low[-_ ]?hit)(?:[^a-z0-9]|$)/i.test(normalised)) return "sub_hit";
  return ROLE_PATTERNS.find(([, pattern]) => pattern.test(normalised))?.[0] || "";
}

function rejectedContextForPath(filePath) {
  const normalised = normalisePath(filePath);
  return CONTEXT_REJECT_PATTERNS.some((pattern) => pattern.test(normalised));
}

function isBespokeKitPath(filePath, workspaceRoot = process.cwd()) {
  const bespokeRoot = normalisePath(path.join(workspaceRoot, "audio", "sfx")).toLowerCase();
  return normalisePath(filePath).toLowerCase().startsWith(`${bespokeRoot}/`);
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

function buildAssetRecord(filePath, { workspaceRoot = process.cwd() } = {}) {
  if (isBespokeKitPath(filePath, workspaceRoot)) {
    return {
      rejected: {
        path: filePath,
        reason: "local_bespoke_sfx_not_creator_studio_grade",
      },
    };
  }
  const provider = providerForPath(filePath);
  const role = roleForPath(filePath);
  if (!provider) {
    return { rejected: { path: filePath, reason: "unknown_sfx_provider" } };
  }
  if (rejectedContextForPath(filePath)) {
    return { rejected: { path: filePath, reason: "sfx_context_not_editorial_hit" } };
  }
  if (!role) {
    return { rejected: { path: filePath, reason: "sfx_role_not_detected" } };
  }
  const asset = {
    asset_id: stableAssetId(filePath, provider.provider_id, role),
    asset_type: "sfx",
    role,
    family: role,
    provider_id: provider.provider_id,
    path: filePath,
    source_url: `file://${normalisePath(filePath)}`,
    source_type: "licensed_sfx_library_file",
    licence_basis: provider.licence_basis,
    licence_evidence_url: provider.licence_evidence_url,
    allowed_use: "finished_editorial_video_only",
    allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
    commercial_use_allowed: true,
    credit_required: false,
    approval_status: "approved_for_commercial_editorial_use",
    risk_score: 0.08,
  };
  return {
    asset,
    rightsRecord: {
      ...asset,
      evidence_reference: provider.licence_evidence_url,
      raw_redistribution_allowed: false,
    },
  };
}

function buildSfxLibraryIngestReport({
  workspaceRoot = process.cwd(),
  roots = defaultRoots(workspaceRoot),
  requiredCues = DEFAULT_REQUIRED_CUES,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedRoots = asArray(roots).map((root) => path.resolve(workspaceRoot, root));
  const files = resolvedRoots.flatMap((root) => scanAudioFiles(root));
  const assets = [];
  const rightsRecords = [];
  const rejectedAssets = [];

  for (const filePath of files) {
    const record = buildAssetRecord(filePath, { workspaceRoot });
    if (record.asset) assets.push(record.asset);
    if (record.rightsRecord) rightsRecords.push(record.rightsRecord);
    if (record.rejected) rejectedAssets.push(record.rejected);
  }

  const sourcePlan = buildCreatorStudioSfxSourcingPlan({
    cues: requiredCues,
    installedAssets: assets,
    rightsLedger: rightsRecords,
    generatedAt,
  });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "visual_v4_sfx_library_ingest",
    roots_scanned: resolvedRoots,
    summary: {
      files_scanned: files.length,
      accepted_assets: assets.length,
      rejected_assets: rejectedAssets.length,
      covered_roles: sourcePlan.covered_roles,
      missing_roles: sourcePlan.required_roles.filter((role) => !sourcePlan.covered_roles.includes(role)),
      readiness: sourcePlan.readiness.status,
    },
    asset_inventory: assets,
    rights_ledger: { records: rightsRecords },
    source_plan: sourcePlan,
    rejected_assets: rejectedAssets,
    safety: {
      no_downloads_started: true,
      no_oauth_or_token_change: true,
      no_db_mutation: true,
      no_posting: true,
    },
  };
}

module.exports = {
  DEFAULT_REQUIRED_CUES,
  buildAssetRecord,
  buildSfxLibraryIngestReport,
  defaultRoots,
  providerForPath,
  roleForPath,
  scanAudioFiles,
};
