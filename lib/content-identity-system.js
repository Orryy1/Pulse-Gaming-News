"use strict";

const crypto = require("node:crypto");

const makeIdentity = ({
  id,
  label,
  accent,
  motion,
  playlist,
  bedRole,
  bedIndexes,
  stingRole = null,
  stingIndexes = [],
  sfxRoles,
  energy,
  pace,
}) => Object.freeze({
  id,
  label,
  brand: Object.freeze({
    accent,
    motion_language: motion,
    on_screen_label: label.toUpperCase(),
  }),
  audio: Object.freeze({
    playlist_name: playlist,
    bed: Object.freeze({ role: bedRole, variant_indexes: Object.freeze([...bedIndexes]) }),
    sting: stingRole
      ? Object.freeze({ role: stingRole, variant_indexes: Object.freeze([...stingIndexes]) })
      : null,
    sfx_roles: Object.freeze([...sfxRoles]),
    mix: Object.freeze({ energy, pace }),
  }),
});

const CONTENT_IDENTITIES = Object.freeze({
  breaking_alert: makeIdentity({
    id: "breaking_alert",
    label: "Breaking Pulse",
    accent: "#FF3B30",
    motion: "hard signal cut, red alert rail, rapid proof lock",
    playlist: "Pulse Redline",
    bedRole: "bed_breaking",
    bedIndexes: [2, 0],
    stingRole: "sting_breaking",
    stingIndexes: [2],
    sfxRoles: ["impact", "riser", "transition"],
    energy: 1,
    pace: "urgent",
  }),
  leak_file: makeIdentity({
    id: "leak_file",
    label: "Leak File",
    accent: "#00E5FF",
    motion: "encrypted scan, clipped data reveal, evidence cursor",
    playlist: "Pulse Cipher",
    bedRole: "bed_primary",
    bedIndexes: [2],
    stingRole: "sting_rumour",
    stingIndexes: [2],
    sfxRoles: ["glitch", "ui_tick", "sub_hit"],
    energy: 0.72,
    pace: "tense",
  }),
  rumour_watch: makeIdentity({
    id: "rumour_watch",
    label: "Rumour Watch",
    accent: "#B388FF",
    motion: "soft scanline, unresolved frame, cautious source pulse",
    playlist: "Pulse Unknown",
    bedRole: "bed_primary",
    bedIndexes: [1],
    stingRole: "sting_rumour",
    stingIndexes: [0],
    sfxRoles: ["riser", "glitch", "ui_tick"],
    energy: 0.55,
    pace: "suspense",
  }),
  confirmed_drop: makeIdentity({
    id: "confirmed_drop",
    label: "Confirmed Drop",
    accent: "#32D74B",
    motion: "clean source lock, green confirmation sweep, precise snap",
    playlist: "Pulse Verified",
    bedRole: "bed_primary",
    bedIndexes: [0],
    stingRole: "sting_verified",
    stingIndexes: [2],
    sfxRoles: ["ui_tick", "impact", "transition"],
    energy: 0.64,
    pace: "assured",
  }),
  major_reveal: makeIdentity({
    id: "major_reveal",
    label: "World Reveal",
    accent: "#FF9F0A",
    motion: "cinematic aperture, hero-name slam, expanding light rail",
    playlist: "Pulse Premiere",
    bedRole: "bed_breaking",
    bedIndexes: [3],
    stingRole: "sting_verified",
    stingIndexes: [0],
    sfxRoles: ["riser", "impact", "sub_hit"],
    energy: 0.9,
    pace: "cinematic",
  }),
  game_update: makeIdentity({
    id: "game_update",
    label: "Patch Pulse",
    accent: "#64D2FF",
    motion: "modular patch tiles, feature wipe, changelog tick",
    playlist: "Pulse Patch Notes",
    bedRole: "bed_primary",
    bedIndexes: [3],
    stingRole: "sting_verified",
    stingIndexes: [1],
    sfxRoles: ["ui_tick", "transition", "impact"],
    energy: 0.68,
    pace: "driving",
  }),
  review_verdict: makeIdentity({
    id: "review_verdict",
    label: "Verdict",
    accent: "#FFD60A",
    motion: "score count, split verdict rail, weighted final lock",
    playlist: "Pulse Scoreline",
    bedRole: "bed_primary",
    bedIndexes: [4],
    stingRole: "sting_verified",
    stingIndexes: [0],
    sfxRoles: ["ui_tick", "sub_hit", "impact"],
    energy: 0.7,
    pace: "measured",
  }),
  release_radar: makeIdentity({
    id: "release_radar",
    label: "Release Radar",
    accent: "#FF7A00",
    motion: "calendar sweep, countdown marker, launch-line burst",
    playlist: "Pulse Launch Window",
    bedRole: "bed_primary",
    bedIndexes: [5],
    stingRole: "sting_breaking",
    stingIndexes: [0],
    sfxRoles: ["riser", "ui_tick", "transition"],
    energy: 0.78,
    pace: "countdown",
  }),
  deal_drop: makeIdentity({
    id: "deal_drop",
    label: "Deal Drop",
    accent: "#30D158",
    motion: "price snap, value counter, offer-window close",
    playlist: "Pulse Checkout",
    bedRole: "bed_breaking",
    bedIndexes: [1],
    stingRole: "sting_verified",
    stingIndexes: [1],
    sfxRoles: ["impact", "ui_tick", "transition"],
    energy: 0.82,
    pace: "punchy",
  }),
  industry_watch: makeIdentity({
    id: "industry_watch",
    label: "Industry Watch",
    accent: "#8E8E93",
    motion: "editorial dossier, company-line shift, sober data lock",
    playlist: "Pulse Boardroom",
    bedRole: "bed_primary",
    bedIndexes: [2],
    stingRole: "sting_rumour",
    stingIndexes: [1],
    sfxRoles: ["sub_hit", "ui_tick", "transition"],
    energy: 0.48,
    pace: "sober",
  }),
  community_debate: makeIdentity({
    id: "community_debate",
    label: "Player Debate",
    accent: "#FF6B1A",
    motion: "split-screen argument, comment pulse, opposing rails",
    playlist: "Pulse Hot Take",
    bedRole: "bed_primary",
    bedIndexes: [1],
    stingRole: "sting_verified",
    stingIndexes: [1],
    sfxRoles: ["impact", "glitch", "transition"],
    energy: 0.76,
    pace: "argumentative",
  }),
  evergreen_guide: makeIdentity({
    id: "evergreen_guide",
    label: "Pulse Guide",
    accent: "#5AC8FA",
    motion: "chapter glide, ranked marker, calm utility rail",
    playlist: "Pulse Deep Play",
    bedRole: "bed_primary",
    bedIndexes: [5],
    stingRole: null,
    stingIndexes: [],
    sfxRoles: ["ui_tick", "transition"],
    energy: 0.4,
    pace: "steady",
  }),
});

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function storyText(story = {}) {
  return [
    story.title,
    story.selected_title,
    story.public_title,
    story.classification,
    story.flair,
    story.content_pillar,
    story.hook,
    story.description,
  ].map(clean).filter(Boolean).join(" ").toLowerCase();
}

function resolveContentIdentity(story = {}) {
  const explicit = clean(story.content_identity_id || story.content_identity);
  if (CONTENT_IDENTITIES[explicit]) return CONTENT_IDENTITIES[explicit];

  const text = storyText(story);
  if (story.breaking_fast_track || story.breaking === true || Number(story.breaking_score || 0) >= 80 || /\bbreaking\b/.test(text)) {
    return CONTENT_IDENTITIES.breaking_alert;
  }
  if (/\b(?:leak|leaked|datamin(?:e|ed)|accidentally posted|unannounced build)\b/.test(text)) {
    return CONTENT_IDENTITIES.leak_file;
  }
  if (/\b(?:rumou?r|reportedly|sources? (?:say|claim)|unconfirmed)\b/.test(text)) {
    return CONTENT_IDENTITIES.rumour_watch;
  }
  if (/\b(?:deal|sale|discount|price cut|lowest price|free play days|bundle offer)\b/.test(text)) {
    return CONTENT_IDENTITIES.deal_drop;
  }
  if (/\b(?:review|reviews|metacritic|opencritic|score|verdict|rated)\b/.test(text)) {
    return CONTENT_IDENTITIES.review_verdict;
  }
  if (/\b(?:release date|launch date|launches|released|available now|preload|pre-order|preorder)\b/.test(text)) {
    return CONTENT_IDENTITIES.release_radar;
  }
  if (/\b(?:reveal|revealed|announcement trailer|gameplay trailer|first gameplay|world premiere|showcase debut|announced)\b/.test(text)) {
    return CONTENT_IDENTITIES.major_reveal;
  }
  if (/\b(?:patch|update|season\s+\d+|season\s+[a-z]+|dlc|expansion|roadmap|hotfix|balance changes?)\b/.test(text)) {
    return CONTENT_IDENTITIES.game_update;
  }
  if (/\b(?:layoffs?|job cuts?|acquisition|merger|union|workers? protest|studio closure|restructur)\b/.test(text)) {
    return CONTENT_IDENTITIES.industry_watch;
  }
  if (/\b(?:backlash|controversy|debate|review bomb|players? divided|fan reaction|community)\b/.test(text)) {
    return CONTENT_IDENTITIES.community_debate;
  }
  if (/\b(?:guide|best games?|top\s+\d+|ranking|ranked|explained|everything you need|beginner)\b/.test(text)) {
    return CONTENT_IDENTITIES.evergreen_guide;
  }
  return CONTENT_IDENTITIES.confirmed_drop;
}

function stableIndex(seed, count) {
  if (count <= 1) return 0;
  const digest = crypto.createHash("sha1").update(seed).digest("hex").slice(0, 8);
  return Number.parseInt(digest, 16) % count;
}

function selectIdentityVariant(variants = [], allowedIndexes = [], {
  identityId = "confirmed_drop",
  storySeed = "story",
  role = "asset",
} = {}) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const availableIndexes = (Array.isArray(allowedIndexes) ? allowedIndexes : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value < variants.length);
  const pool = availableIndexes.length ? availableIndexes : variants.map((_, index) => index);
  const poolIndex = stableIndex(`${identityId}:${role}:${storySeed}`, pool.length);
  const identityVariantIndex = pool[poolIndex];
  return {
    ...variants[identityVariantIndex],
    identity_id: identityId,
    identity_variant_index: identityVariantIndex,
    identity_playlist_size: pool.length,
    identity_selection_strategy: "content_identity_story_hash",
  };
}

module.exports = {
  CONTENT_IDENTITIES,
  resolveContentIdentity,
  selectIdentityVariant,
};
