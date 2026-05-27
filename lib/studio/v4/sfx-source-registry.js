"use strict";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalise(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const PREMIUM_PROVIDERS = [
  {
    provider_id: "boom_library",
    name: "BOOM Library",
    quality_tier: "creator_studio",
    licence_basis: "boom_library_media_license",
    licence_evidence_url: "https://www.boomlibrary.com/support/faq/what-am-i-allowed-to-do-with-your-sounds/",
    allowed_use: "finished_editorial_video_only",
    acquisition_mode: "operator_purchase_or_existing_licence",
    recommended_roles: ["impact", "transition", "riser", "sub_hit"],
    notes: "Best fit for polished impacts, whooshes, trailer-style transitions and low-end hits.",
  },
  {
    provider_id: "pro_sound_effects",
    name: "Pro Sound Effects",
    quality_tier: "creator_studio",
    licence_basis: "pro_sound_effects_subscription_license",
    licence_evidence_url: "https://www.prosoundeffects.com/licensing",
    allowed_use: "finished_editorial_video_only",
    acquisition_mode: "operator_subscription_or_existing_licence",
    recommended_roles: ["impact", "transition", "riser", "ui_tick", "sub_hit"],
    notes: "Good fit for broadcast/editorial polish and varied post-production libraries.",
  },
  {
    provider_id: "soundly",
    name: "Soundly",
    quality_tier: "creator_studio",
    licence_basis: "soundly_pro_commercial_use",
    licence_evidence_url: "https://getsoundly.com/faq/how-can-i-use-the-sounds/",
    allowed_use: "finished_editorial_video_only",
    acquisition_mode: "operator_subscription_or_existing_licence",
    recommended_roles: ["transition", "ui_tick", "impact", "riser"],
    notes: "Good fit for searchable editorial whooshes, UI clicks and fast production workflows.",
  },
  {
    provider_id: "epidemic_sound",
    name: "Epidemic Sound",
    quality_tier: "creator_studio",
    licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
    licence_evidence_url: "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
    allowed_use: "finished_editorial_video_only",
    acquisition_mode: "operator_subscription_or_existing_licence",
    recommended_roles: ["impact", "transition", "riser", "ui_tick", "sub_hit", "glitch"],
    notes: "Best used as a small retained pack of downloaded tracks/SFX with channel safelisting evidence kept in the rights ledger.",
  },
  {
    provider_id: "sonniss",
    name: "Sonniss / GameAudioGDC",
    quality_tier: "creator_studio",
    licence_basis: "sonniss_game_audio_gdc_bundle_license",
    licence_evidence_url: "https://sonniss.com/gdc-bundle-license/",
    allowed_use: "finished_editorial_video_only",
    acquisition_mode: "operator_download_or_existing_licence",
    recommended_roles: ["impact", "transition", "riser", "ui_tick", "glitch"],
    notes: "Good fit for game-native texture when the exact asset has a retained rights record.",
  },
];

const ROLE_BY_FAMILY = {
  impact: "impact",
  cash_snap: "impact",
  boom: "sub_hit",
  sub_hit: "sub_hit",
  whoosh: "transition",
  transition_hit: "transition",
  reveal: "riser",
  riser: "riser",
  chart_tick: "ui_tick",
  source_tick: "ui_tick",
  tick: "ui_tick",
  glitch: "glitch",
};

function cueRole(cue = {}) {
  return normalise(cue.role || cue.sfx_role || ROLE_BY_FAMILY[normalise(cue.family)] || cue.family || "transition");
}

function requiredRolesForCues(cues = []) {
  return Array.from(new Set(asArray(cues).map(cueRole).filter(Boolean))).sort();
}

function creatorStudioSfxSourceRegistry() {
  return PREMIUM_PROVIDERS.map((source) => ({
    ...source,
    recommended_roles: [...source.recommended_roles],
  }));
}

function providerForAsset(asset = {}) {
  const haystack = [
    asset.provider,
    asset.provider_id,
    asset.source_owner,
    asset.source_type,
    asset.licence_basis,
    asset.license_basis,
    asset.rights_basis,
    asset.source_url,
    asset.path,
  ].map(normalise).join(" ");
  return creatorStudioSfxSourceRegistry().find((source) =>
    haystack.includes(source.provider_id) ||
      haystack.includes(normalise(source.licence_basis)) ||
      haystack.includes(normalise(source.name)),
  ) || null;
}

function assetRole(asset = {}) {
  return normalise(asset.role || asset.sfx_role || ROLE_BY_FAMILY[normalise(asset.family)] || asset.family || asset.category);
}

function approvedForCommercialUse(asset = {}) {
  if (!asset || typeof asset !== "object") return false;
  if (asset.commercial_use_allowed === false) return false;
  const text = [
    asset.approval_status,
    asset.licence_basis,
    asset.license_basis,
    asset.rights_basis,
    asset.allowed_use,
  ].map(cleanText).join(" ").toLowerCase();
  return /approved|licensed|commercial|media_license|subscription_license|bundle_license/.test(text);
}

const EDITORIAL_POSITIVE_TERMS = [
  "cinematic",
  "trailer",
  "editor",
  "editors",
  "whoosh",
  "swoosh",
  "transition",
  "impact",
  "hit",
  "slam",
  "riser",
  "rise",
  "ui",
  "tick",
  "click",
  "futuristic",
  "sci-fi",
  "scifi",
  "glitch",
  "modern",
  "mechanical wave",
  "orbital emitter",
  "bluezone_bC0294",
  "qantum",
];

const EDITORIAL_NEGATIVE_TERMS = [
  "ambience",
  "ambient",
  "field recording",
  "room tone",
  "forest",
  "birds",
  "subway",
  "station",
  "crowd",
  "boat",
  "tractor",
  "farm",
  "vehicle",
  "engine",
  "car",
  "audi",
  "porsche",
  "pass by",
  "pass-by",
  "water",
  "watr",
  "rain",
  "thunder",
  "creek",
  "waterfall",
  "hair dryer",
  "sewer",
  "plastic textures",
  "wood",
  "stone",
  "gore",
  "flesh",
  "weapon",
  "rifle",
  "gun",
  "axe",
  "sword",
  "shield",
  "melee",
  "hammer",
  "gong",
  "thegong",
  "lighter",
  "button click on off",
  "flabby",
  "deviant",
  "dragon",
  "dragonreveal",
  "haunted",
  "horror",
  "ghost",
  "eerie",
  "gasp",
  "scream",
  "voice line",
  "hostile territory",
  "target acquired",
  "stringssection",
  "strings section",
  "guitar",
  "pick scrape",
  "whammy",
  "kawaii",
  "neoprene",
  "ski gloves",
  "countryside",
];

const PROVIDER_SCORE = {
  boom_library: 0.22,
  pro_sound_effects: 0.2,
  epidemic_sound: 0.19,
  soundly: 0.18,
  sonniss: 0.12,
};

function assetSearchText(asset = {}) {
  const raw = [
    asset.asset_id,
    asset.id,
    asset.role,
    asset.family,
    asset.category,
    asset.provider,
    asset.provider_id,
    asset.source_owner,
    asset.source_url,
    asset.path,
    asset.file_path,
  ].map(cleanText).join(" ");
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {}
  return decoded.toLowerCase().replace(/%20/g, " ").replace(/[_-]+/g, " ");
}

const ROLE_POSITIVE_TERMS = {
  impact: [
    "modern cinematic impact",
    "cinematic impact",
    "impact boom",
    "impact percussion",
    "trailer",
    "slam",
  ],
  transition: [
    "distinct whoosh",
    "pure scifi whoosh",
    "whoosh fast",
    "sci fi transition",
    "futuristic user interface transition",
    "heavy whoosh",
    "cinematic transitions for editors",
    "searing",
    "swoosh",
  ],
  ui_tick: [
    "qantum ui",
    "futuristic user interface",
    "user interaction",
    "uiclick select",
    "select",
    "ui click",
  ],
  riser: [
    "clean riser",
    "editorial riser",
    "news riser",
    "riser trailer",
  ],
  sub_hit: [
    "mechanical wave",
    "trailer sub",
    "cinematic hit",
    "cinematic feel",
    "boom trailer",
  ],
  glitch: [
    "futuristic user interface",
    "data glitch",
  ],
};

const ROLE_NEGATIVE_TERMS = {
  impact: ["hammer", "sweeteners", "metal hit sweeteners", "iron thick", "punch", "ricochet", "door", "cardboard"],
  transition: ["gong", "thegong", "pass by", "pass-by", "vehicle", "boat", "flabby", "deviant", "wind gust"],
  ui_tick: [
    "lighter",
    "high tech beep",
    "beep",
    "button click on off",
    "electricity electronic lighter",
    "data counter",
    "data progress",
    "uidata",
    "counter mid",
    "noisy impact",
    "progress",
    "plastic",
    "engine",
    "activation",
    "activation ui",
    "activation user interface",
    "activation ui click",
    "uialert",
    "ui alert",
    "alert confirm",
    "confirm middle",
    "confirm",
    "voice",
    "vox",
    "hostile territory",
    "target acquired",
  ],
  riser: [
    "creek",
    "rain",
    "thunder",
    "water",
    "dragon",
    "dragonreveal",
    "stringssection",
    "strings section",
    "recap",
    "haunted",
    "metal tensions",
    "guitar",
    "gasp",
  ],
  sub_hit: ["rain", "thunder", "waterfall", "creek", "haunted", "eerie", "metallic hit sub"],
  glitch: ["robot vox", "goofy", "talking", "voice"],
};

const ROLE_SCORE_FLOOR = {
  impact: 0.48,
  transition: 0.48,
  ui_tick: 0.48,
  riser: 0.56,
  sub_hit: 0.48,
  glitch: 0.48,
};

const HARD_REJECT_TERMS = [
  "dragonreveal",
  "stringssectionriser",
  "stringssection",
  "thegong",
  "flabby",
  "deviant whoosh",
  "haunted",
  "horror",
  "gasp",
  "scream",
  "hostile territory",
  "target acquired",
  "voice line",
  "human voice",
  "metal tensions",
  "pick scrape",
  "whammy",
  "kawaii",
  "lighter button click",
  "activation ui",
  "activation ui click",
  "activation user interface",
  "uialert",
  "alert confirm",
  "confirm middle",
  "countryside ambience",
  "ski gloves",
  "neoprene",
];

function isCompactNewsroomUiClickText(text = "") {
  if (!/\b(?:uiclick ui click|ui click)\b/.test(text)) return false;
  if (/\b(?:alert|confirm|data|progress|voice|vox|target acquired|high tech beep|beep|plastic|window|zoom)\b/.test(text)) {
    return false;
  }
  if (/\b(?:activation ui click|activation user interface|activation_ui_click)\b/.test(text)) return false;
  return true;
}

function hasHardRejectedSfxSemantics(text = "", role = "") {
  if (HARD_REJECT_TERMS.some((term) => text.includes(term))) return true;
  const key = normalise(role);
  return (ROLE_NEGATIVE_TERMS[key] || []).some((term) => {
    const normalizedTerm = term.toLowerCase();
    if (key === "ui_tick" && normalizedTerm === "activation" && isCompactNewsroomUiClickText(text)) {
      return false;
    }
    return text.includes(normalizedTerm);
  });
}

function minimumScoreForRole(role = "") {
  return ROLE_SCORE_FLOOR[normalise(role)] || 0.45;
}

function roleSpecificSfxAdjustment(text = "", role = "") {
  const key = normalise(role);
  let delta = 0;
  if (key === "ui_tick" && isCompactNewsroomUiClickText(text)) delta += 0.3;
  if (key === "ui_tick" && text.includes("select middle")) delta -= 0.14;
  for (const term of ROLE_POSITIVE_TERMS[key] || []) {
    if (text.includes(term.toLowerCase())) delta += 0.08;
  }
  for (const term of ROLE_NEGATIVE_TERMS[key] || []) {
    if (text.includes(term.toLowerCase())) delta -= 0.22;
  }
  return delta;
}

function editorialSfxScore(asset = {}, provider = providerForAsset(asset), role = assetRole(asset)) {
  const text = assetSearchText(asset);
  if (hasHardRejectedSfxSemantics(text, role)) return 0;
  let score = 0.5 + (PROVIDER_SCORE[provider?.provider_id] || 0);
  for (const term of EDITORIAL_POSITIVE_TERMS) {
    if (text.includes(term.toLowerCase())) score += 0.05;
  }
  for (const term of EDITORIAL_NEGATIVE_TERMS) {
    if (text.includes(term.toLowerCase())) score -= 0.16;
  }
  if (/audio[\\/]sfx[\\/](?:boom|impact|transition|reveal|ui|glitch)/i.test(cleanText(asset.source_url || asset.path))) {
    score -= provider?.provider_id ? 0.05 : 0.35;
  }
  score += roleSpecificSfxAdjustment(text, role);
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

function isLocalUtilityAsset(asset = {}) {
  const text = [
    asset.provider,
    asset.provider_id,
    asset.source_url,
    asset.path,
    asset.licence_basis,
    asset.license_basis,
    asset.source_type,
  ].map(cleanText).join(" ").toLowerCase();
  return /pulse[_-]?generated|owned_generated|bespoke|audio[\\/]sfx|local:\/\/pulse-generated-sfx/.test(text);
}

function normaliseAssets({ installedAssets = [], rightsLedger = [] } = {}) {
  const ledgerById = new Map(
    asArray(rightsLedger).map((asset) => [cleanText(asset.asset_id || asset.id), asset]),
  );
  return asArray(installedAssets).map((asset) => ({
    ...asset,
    ...(ledgerById.get(cleanText(asset.asset_id || asset.id)) || {}),
  }));
}

function recommendSources(requiredRoles = []) {
  const roleSet = new Set(requiredRoles);
  return creatorStudioSfxSourceRegistry()
    .map((source) => ({
      ...source,
      matching_roles: source.recommended_roles.filter((role) => roleSet.has(role)),
    }))
    .filter((source) => source.matching_roles.length > 0)
    .sort((a, b) => b.matching_roles.length - a.matching_roles.length || a.provider_id.localeCompare(b.provider_id));
}

function buildCreatorStudioSfxSourcingPlan({
  cues = [],
  installedAssets = [],
  rightsLedger = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const requiredRoles = requiredRolesForCues(cues);
  const allAssets = normaliseAssets({ installedAssets, rightsLedger });
  const selected = [];
  const coveredRoles = new Set();
  let localUtilityCount = 0;

  const rankedAssets = allAssets
    .map((asset, index) => {
      const provider = providerForAsset(asset);
      const role = assetRole(asset);
      return {
        asset,
        provider,
        role,
        editorial_sfx_score: editorialSfxScore(asset, provider, role),
        index,
      };
    })
    .sort((a, b) =>
      b.editorial_sfx_score - a.editorial_sfx_score ||
      (PROVIDER_SCORE[b.provider?.provider_id] || 0) - (PROVIDER_SCORE[a.provider?.provider_id] || 0) ||
      a.index - b.index,
    );

  for (const ranked of rankedAssets) {
    const { asset, provider, role, editorial_sfx_score: editorialScore } = ranked;
    if (!provider && isLocalUtilityAsset(asset)) {
      localUtilityCount += 1;
      continue;
    }
    if (!provider || !role || !requiredRoles.includes(role) || !approvedForCommercialUse(asset)) continue;
    if (editorialScore < minimumScoreForRole(role)) continue;
    if (coveredRoles.has(role)) continue;
    coveredRoles.add(role);
    selected.push({
      asset_id: cleanText(asset.asset_id || asset.id || `${provider.provider_id}_${role}`),
      role,
      family: cleanText(asset.family || asset.category || role),
      provider_id: provider.provider_id,
      provider_name: provider.name,
      source_url: cleanText(asset.source_url || asset.path || asset.file_path),
      rights_basis: cleanText(asset.licence_basis || asset.license_basis || asset.rights_basis || provider.licence_basis),
      licence_evidence_url: provider.licence_evidence_url,
      quality_tier: provider.quality_tier,
      editorial_sfx_score: editorialScore,
      approval_status: cleanText(asset.approval_status || "approved_for_commercial_editorial_use"),
    });
  }

  const covered = Array.from(coveredRoles).sort();
  const missing = requiredRoles.filter((role) => !coveredRoles.has(role));
  const blockers = [];
  if (selected.length === 0 && localUtilityCount > 0) {
    blockers.push("sfx_source:local_bespoke_or_generated_only");
  }
  if (selected.length === 0 && allAssets.length === 0 && requiredRoles.length > 0) {
    blockers.push("sfx_source:no_creator_studio_sfx_assets");
  }
  for (const role of missing) blockers.push(`sfx_source:missing_role:${role}`);

  return {
    schema_version: 1,
    generated_at: generatedAt,
    required_roles: requiredRoles,
    covered_roles: covered,
    selected_assets: selected,
    recommended_sources: recommendSources(requiredRoles),
    rights_requirements: {
      commercial_use_allowed_required: true,
      retained_rights_record_required: true,
      allowed_use: "finished_editorial_video_only",
      attribution_or_credit_record_required: true,
      raw_sfx_redistribution_forbidden: true,
    },
    readiness: {
      status: blockers.length ? "blocked" : "pass",
      blockers,
      warnings: [],
    },
    safety: {
      planner_only: true,
      no_downloads_started: true,
      no_oauth_or_token_change: true,
      no_db_mutation: true,
      no_posting: true,
    },
  };
}

module.exports = {
  buildCreatorStudioSfxSourcingPlan,
  creatorStudioSfxSourceRegistry,
  editorialSfxScore,
  minimumScoreForRole,
  requiredRolesForCues,
};
