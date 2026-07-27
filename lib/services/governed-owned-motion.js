"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const sharp = require("sharp");
const {
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  getPlatformSafeZoneProfile,
} = require("./platform-safe-zones");

const OWNED_MOTION_GENERATOR = "pulse-governed-owned-motion-v1";
const INTAKE_SCHEMA = "pulse-governed-story-intake-v1";
const ASSET_MANIFEST_SCHEMA = "pulse-owned-motion-manifest-v1";
const PLAN_SCHEMA = "pulse-governed-owned-motion-plan-v1";
const WIDTH = 1080;
const HEIGHT = 1920;
const DURATION_SECONDS = 28;
const OWNED_MOTION_SAFE_PROFILE = getPlatformSafeZoneProfile(
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
);
const OWNED_MOTION_SAFE_SCALE = Math.min(
  OWNED_MOTION_SAFE_PROFILE.safe_rect.width / WIDTH,
  OWNED_MOTION_SAFE_PROFILE.safe_rect.height / HEIGHT,
);
const OWNED_MOTION_SAFE_X =
  OWNED_MOTION_SAFE_PROFILE.safe_rect.x +
  (OWNED_MOTION_SAFE_PROFILE.safe_rect.width -
    WIDTH * OWNED_MOTION_SAFE_SCALE) /
    2;
const OWNED_MOTION_SAFE_Y =
  OWNED_MOTION_SAFE_PROFILE.safe_rect.y +
  (OWNED_MOTION_SAFE_PROFILE.safe_rect.height -
    HEIGHT * OWNED_MOTION_SAFE_SCALE) /
    2;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeStoryId(value) {
  const id = cleanText(value);
  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/i.test(id)) {
    throw new Error("owned_motion_story_id_invalid");
  }
  return id;
}

function normaliseSha256(value) {
  const hash = cleanText(value).replace(/^sha256:/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error("owned_motion_intake_manifest_sha256_invalid");
  }
  return hash;
}

function claimText(claim) {
  if (typeof claim === "string") return cleanText(claim);
  return cleanText(claim?.text || claim?.statement || claim?.claim);
}

function intakeCorpus(intake) {
  return [
    intake?.story?.title,
    intake?.story?.hook,
    intake?.story?.full_script,
    ...(Array.isArray(intake?.claims) ? intake.claims.map(claimText) : []),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function inferPlatformTheme(intake) {
  const corpus = intakeCorpus(intake);
  const briefPalette = Array.isArray(intake?.story?.visual_brief?.palette)
    ? intake.story.visual_brief.palette.filter((colour) =>
        /^#[a-f0-9]{6}$/i.test(String(colour || "")),
      )
    : [];
  if (briefPalette.length >= 2) {
    return {
      id: "visual-brief",
      label: /\bevercold\b/i.test(corpus) ? "EVERCOLD" : "PULSE",
      primary: briefPalette[1],
      accent: briefPalette[0],
      palette: briefPalette,
    };
  }
  if (/\b(xbox|game pass|microsoft gaming)\b/i.test(corpus)) {
    return {
      id: "xbox",
      label: "XBOX",
      primary: "#107C10",
      accent: "#9BF00B",
    };
  }
  if (/\b(playstation|ps5|sony interactive)\b/i.test(corpus)) {
    return {
      id: "playstation",
      label: "PLAYSTATION",
      primary: "#0050A4",
      accent: "#31A8FF",
    };
  }
  if (/\b(nintendo|switch)\b/i.test(corpus)) {
    return {
      id: "nintendo",
      label: "NINTENDO",
      primary: "#E60012",
      accent: "#FFFFFF",
    };
  }
  if (/\b(steam|pc)\b/i.test(corpus)) {
    return {
      id: "pc",
      label: "PC",
      primary: "#1B2838",
      accent: "#66C0F4",
    };
  }
  return {
    id: "gaming-neutral",
    label: "GAMING",
    primary: "#FF6B1A",
    accent: "#FFC247",
  };
}

const NUMBER_WORDS = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
});
const NUMBER_TOKEN =
  "(?:\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)";

function numericToken(value) {
  const token = cleanText(value).toLowerCase();
  return /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token] || null;
}

function clipText(value, maximum = 64) {
  const text = cleanText(value);
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(1, maximum - 1)).replace(/\s+\S*$/, "")}…`;
}

function summariseClaim(value) {
  const detail = claimText(value);
  const patterns = [
    [/\b(greatshield|bastion)\b/i, "DUAL GREATSHIELDS"],
    [/\bevolved mode\b/i, "EVOLVED MODE"],
    [/\bbranch\w*\b.*\bscal\w*\b|\bscal\w*\b.*\bbranch\w*\b/i, "BRANCHING + SCALING"],
    [/\b(final fantasy vii|ffvii)\b/i, "FFVII RAID"],
    [/\bswitch 2\b/i, "SWITCH 2"],
  ];
  const matched = patterns.find(([pattern]) => pattern.test(detail));
  const fallback = detail
    .replace(/[.!?].*$/, "")
    .split(/\s+/)
    .slice(0, 5)
    .join(" ")
    .toUpperCase();
  return {
    label: matched?.[1] || fallback || "VERIFIED CHANGE",
    detail: clipText(detail, 58),
  };
}

function extractVisualGrammar(intake) {
  const corpus = intakeCorpus(intake);
  const quantities = [];
  const pattern = new RegExp(
    `\\b(${NUMBER_TOKEN})[\\s-]+(year|month|day)s?\\b`,
    "gi",
  );
  for (const match of corpus.matchAll(pattern)) {
    const numeric = numericToken(match[1]);
    const label = `${numeric} ${match[2].toUpperCase()}${numeric === 1 ? "" : "S"}`;
    if (!quantities.includes(label)) quantities.push(label);
  }
  const timeline = corpus.match(
    new RegExp(
      `\\bwithin\\s+(${NUMBER_TOKEN})\\s+(business\\s+)?days?\\b`,
      "i",
    ),
  );
  const calendarDate = corpus.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+([0-3]?\d)\b/i,
  );
  const dayFirstCalendarDate = corpus.match(
    /\b([0-3]?\d)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  );
  const beats = (Array.isArray(intake?.claims) ? intake.claims : [])
    .map(summariseClaim)
    .filter((beat) => beat.detail);
  const timelineBeats =
    beats.length >= 5 ? beats.slice(-3) : beats.slice(0, 3);
  return {
    comparison_mode: quantities.length >= 2 ? "threshold" : "feature_stack",
    change: {
      before: quantities[1] || quantities[0] || "BEFORE",
      after: quantities[0] || "NOW",
    },
    timeline: timeline
      ? `${numericToken(timeline[1])} ${timeline[2] ? "BUSINESS " : ""}DAYS`
      : calendarDate
        ? `${calendarDate[1].slice(0, 3).toUpperCase()} ${Number(calendarDate[2])}`
        : dayFirstCalendarDate
          ? `${dayFirstCalendarDate[2].slice(0, 3).toUpperCase()} ${Number(dayFirstCalendarDate[1])}`
          : "WHAT HAPPENS NEXT",
    beats,
    feature_beats: beats.slice(0, 2),
    timeline_beats: timelineBeats,
    sequence: [
      "hook_slam",
      "before_after_change",
      "verified_timeline",
      "player_impact",
    ],
  };
}

function classifyOwnedSceneRole(scene, index) {
  const text = cleanText(scene).toLowerCase();
  if (/\b(mode|evolved|toggle|switches from)\b/.test(text)) {
    return "mode_switch";
  }
  if (/\b(branch|route|map|auto.?balanc|level meter)\b/.test(text)) {
    return "branching_balance";
  }
  if (/\b(raid|eight.?slot|lifestream)\b/.test(text)) {
    return "raid_grid";
  }
  if (/\b(platform|switch 2|release|launch|date)\b/.test(text)) {
    return "platform_release";
  }
  if (/\b(shield|bastion|lock together)\b/.test(text) && index > 0) {
    return "shield_lock";
  }
  return index === 0 ? "hook_slam" : `owned_scene_${index + 1}`;
}

function resolveOwnedSceneRoles(intake) {
  const scenes = Array.isArray(intake?.story?.visual_brief?.scenes)
    ? intake.story.visual_brief.scenes.map(cleanText).filter(Boolean)
    : [];
  if (
    intake?.story?.visual_brief?.format === "owned-motion-only" &&
    scenes.length >= 3 &&
    scenes.length <= 8
  ) {
    const used = new Set();
    return scenes.map((scene, index) => {
      const base = classifyOwnedSceneRole(scene, index);
      let role = base;
      let suffix = 2;
      while (used.has(role)) {
        role = `${base}_${suffix}`;
        suffix += 1;
      }
      used.add(role);
      return role;
    });
  }
  return [
    "hook_slam",
    "before_after_change",
    "verified_timeline",
    "player_impact",
  ];
}

function validateIntakeContract(intake) {
  const blockers = [];
  if (intake?.schema_version !== INTAKE_SCHEMA) {
    blockers.push("story_intake_schema_invalid");
  }
  if (intake?.source_type !== "official") {
    blockers.push("story_intake_source_not_official");
  }
  if (!Array.isArray(intake?.claims) || intake.claims.length === 0) {
    blockers.push("story_intake_claims_missing");
  }
  if (!cleanText(intake?.story?.id)) {
    blockers.push("story_intake_story_id_missing");
  }
  if (!cleanText(intake?.story?.full_script)) {
    blockers.push("story_intake_script_missing");
  }
  if (
    intake?.contract?.editorial_lane_id !== "what_changes_for_players" ||
    intake?.contract?.hook_type !== "direct" ||
    intake?.contract?.duration_band_id !== "what_changes_short_25_32"
  ) {
    blockers.push("story_intake_editorial_contract_invalid");
  }
  return {
    valid: blockers.length === 0,
    blockers,
  };
}

function plannedAsset(relativePath, mediaType, role) {
  return {
    path: relativePath,
    media_type: mediaType,
    role,
    ownership: "owned",
    rights_basis: "OWNED",
    attribution_required: false,
    generator_identity: OWNED_MOTION_GENERATOR,
  };
}

function buildOwnedMotionPlan({
  intake,
  intakeManifestSha256,
  outputDir,
  generatedAt = new Date().toISOString(),
  ffmpegAvailable = false,
} = {}) {
  if (!cleanText(outputDir)) {
    throw new Error("owned_motion_explicit_output_dir_required");
  }
  const storyId = safeStoryId(intake?.story?.id);
  const intakeHash = normaliseSha256(intakeManifestSha256);
  const validation = validateIntakeContract(intake);
  const blockers = [...validation.blockers];
  if (ffmpegAvailable !== true) blockers.push("ffmpeg_unavailable");
  const explicitOutputDir = path.resolve(outputDir);
  const storyRoot = path.join(explicitOutputDir, storyId);
  const visualGrammar = extractVisualGrammar(intake);
  const sceneRoles = resolveOwnedSceneRoles(intake);
  visualGrammar.sequence = sceneRoles;
  const assets = [
    ...sceneRoles.map((role, index) =>
      plannedAsset(
        `assets/${String(index + 1).padStart(2, "0")}_${role}.png`,
        "image",
        role,
      ),
    ),
    plannedAsset(
      "assets/owned_motion_backbone.mp4",
      "video",
      "owned_motion_backbone",
    ),
  ];
  return {
    schema_version: PLAN_SCHEMA,
    generated_at: new Date(generatedAt).toISOString(),
    mode: "DRY_RUN",
    ready: blockers.length === 0,
    blockers,
    story_id: storyId,
    intake_manifest_sha256: intakeHash,
    explicit_output_dir: explicitOutputDir,
    output_root: storyRoot,
    generator_identity: OWNED_MOTION_GENERATOR,
    rights_basis: "OWNED",
    attribution_required: false,
    platform_theme: inferPlatformTheme(intake),
    visual_grammar: visualGrammar,
    video: {
      width: WIDTH,
      height: HEIGHT,
      duration_seconds: DURATION_SECONDS,
      fps: 30,
    },
    assets,
  };
}

function validateApplyAuthority({
  applyRequested = false,
  confirmStoryId,
  confirmManifestSha256,
  plan,
  env = process.env,
} = {}) {
  const blockers = [];
  if (applyRequested !== true) blockers.push("explicit_apply_required");
  if (plan?.ready !== true) blockers.push("owned_motion_plan_not_ready");
  if (cleanText(confirmStoryId) !== cleanText(plan?.story_id)) {
    blockers.push("story_id_confirmation_mismatch");
  }
  let confirmationHash = null;
  try {
    confirmationHash = normaliseSha256(confirmManifestSha256);
  } catch {
    blockers.push("manifest_sha256_confirmation_invalid");
  }
  if (
    confirmationHash &&
    confirmationHash !== cleanText(plan?.intake_manifest_sha256)
  ) {
    blockers.push("manifest_sha256_confirmation_mismatch");
  }
  if (cleanText(env.DEPLOYMENT_MODE).toLowerCase() !== "local") {
    blockers.push("local_proof_environment_required");
  }
  const operatingMode = cleanText(
    env.PULSE_OPERATING_MODE || env.OPERATING_MODE,
  ).toUpperCase();
  if (operatingMode !== "HUMAN_REVIEW") {
    blockers.push("human_review_operating_mode_required");
  }
  if (cleanText(env.AUTO_PUBLISH).toLowerCase() !== "false") {
    blockers.push("auto_publish_must_be_false");
  }
  if (
    cleanText(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED).toLowerCase() !==
    "false"
  ) {
    blockers.push("guarded_live_dispatch_must_be_false");
  }
  if (
    cleanText(env.PULSE_EMERGENCY_KILL_SWITCH).toLowerCase() !== "true"
  ) {
    blockers.push("emergency_kill_switch_must_be_tripped");
  }
  return {
    authorised: blockers.length === 0,
    blockers: [...new Set(blockers)],
    mode: "HUMAN_REVIEW",
    external_publish_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
    network_authorised: false,
  };
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function assertContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("owned_motion_output_path_outside_explicit_root");
  }
}

function validateAssetInspection({ mediaType, inspection }) {
  if (
    inspection?.width !== WIDTH ||
    inspection?.height !== HEIGHT
  ) {
    throw new Error("owned_motion_output_dimensions_invalid");
  }
  if (mediaType === "video") {
    const duration = Number(inspection.duration_seconds);
    if (!Number.isFinite(duration) || duration < 25 || duration > 32) {
      throw new Error("owned_motion_output_duration_invalid");
    }
  }
}

function renderOwnedMotionMarkdown(manifest) {
  const lines = [
    "# Governed Owned Motion Asset Manifest",
    "",
    `- Story: \`${manifest.story_id}\``,
    `- Generated: ${manifest.generated_at}`,
    `- Generator: \`${OWNED_MOTION_GENERATOR}\``,
    "- Rights basis: **OWNED**",
    "- Attribution required: **No**",
    "- External publication authorised: **No**",
    "",
    "| Role | Type | Dimensions / duration | SHA-256 | Path |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const asset of manifest.assets) {
    const media = asset.media_type === "video"
      ? `${asset.width}×${asset.height}, ${asset.duration_seconds.toFixed(3)}s`
      : `${asset.width}×${asset.height}`;
    lines.push(
      `| ${asset.role} | ${asset.media_type} | ${media} | \`${asset.sha256}\` | \`${asset.path}\` |`,
    );
  }
  lines.push(
    "",
    "All listed media was generated locally from repository-owned design code.",
    "No third-party footage, storefront art, trailer media or platform API was used.",
    "",
  );
  return lines.join("\n");
}

function renderOwnedMotionPlanMarkdown(plan) {
  const lines = [
    "# Governed Owned Motion Plan",
    "",
    `- Mode: **${plan.mode}**`,
    `- Ready: **${plan.ready ? "Yes" : "No"}**`,
    `- Story: \`${plan.story_id}\``,
    `- Intake SHA-256: \`${plan.intake_manifest_sha256}\``,
    `- Generator: \`${plan.generator_identity}\``,
    `- Canvas: ${plan.video.width}×${plan.video.height}`,
    `- Runtime: ${plan.video.duration_seconds}s at ${plan.video.fps}fps`,
    `- Platform theme: ${plan.platform_theme.label}`,
    "- Rights basis: **OWNED**",
    "- Attribution required: **No**",
    "- External publication authorised: **No**",
    "",
    "## Visual grammar",
    "",
    `- Change: ${plan.visual_grammar.change.before} → ${plan.visual_grammar.change.after}`,
    `- Timeline: ${plan.visual_grammar.timeline}`,
    `- Sequence: ${plan.visual_grammar.sequence.join(" → ")}`,
    "",
    "## Planned assets",
    "",
    "| Role | Type | Path |",
    "| --- | --- | --- |",
  ];
  for (const asset of plan.assets) {
    lines.push(`| ${asset.role} | ${asset.media_type} | \`${asset.path}\` |`);
  }
  lines.push("", "## Blockers", "");
  if (plan.blockers.length) {
    lines.push(...plan.blockers.map((blocker) => `- ${blocker}`));
  } else {
    lines.push("- None. Apply still requires exact identity confirmation.");
  }
  lines.push(
    "",
    "Dry-run evidence does not create media and does not authorise publication.",
    "",
  );
  return lines.join("\n");
}

function escapeSvg(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapSvgText(value, {
  x,
  y,
  maxChars = 24,
  lineHeight = 82,
  maxLines = 4,
  className = "headline",
  anchor = "start",
} = {}) {
  const words = cleanText(value).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(" ").length > lines.join(" ").length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/, "")}…`;
  }
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${className}">${lines
    .map(
      (entry, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeSvg(entry)}</tspan>`,
    )
    .join("")}</text>`;
}

function sharedSvgFrame(plan) {
  const theme = plan.platform_theme;
  return {
    open: `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#080A0F"/>
    <stop offset="0.56" stop-color="#111620"/>
    <stop offset="1" stop-color="${theme.primary}"/>
  </linearGradient>
  <radialGradient id="glow"><stop offset="0" stop-color="${theme.accent}" stop-opacity=".34"/><stop offset="1" stop-color="${theme.accent}" stop-opacity="0"/></radialGradient>
  <filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="26" flood-color="#000" flood-opacity=".48"/></filter>
</defs>
<rect width="1080" height="1920" fill="url(#bg)"/>
<circle cx="900" cy="230" r="460" fill="url(#glow)"/>
<path d="M0 1660 L1080 1370 L1080 1920 L0 1920Z" fill="#05070B" opacity=".78"/>
<g id="safe-zone-content" data-safe-zone-profile="${CROSS_PLATFORM_PORTRAIT_PROFILE_ID}" transform="translate(${OWNED_MOTION_SAFE_X} ${OWNED_MOTION_SAFE_Y}) scale(${OWNED_MOTION_SAFE_SCALE})">
<rect x="54" y="54" width="972" height="1812" rx="46" fill="none" stroke="${theme.accent}" stroke-opacity=".22" stroke-width="3"/>
<g font-family="Arial,Helvetica,sans-serif">
  <rect x="80" y="84" width="330" height="58" rx="29" fill="${theme.primary}"/>
  <text x="245" y="123" text-anchor="middle" font-size="27" font-weight="800" fill="#FFF" letter-spacing="3">${escapeSvg(theme.label)} // PULSE</text>
  <circle cx="955" cy="113" r="12" fill="${theme.accent}"/>
  <circle cx="955" cy="113" r="25" fill="none" stroke="${theme.accent}" stroke-width="3" opacity=".42"/>
`,
    close: `<text x="160" y="1788" text-anchor="start" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" fill="#FFF" opacity=".72" letter-spacing="3">CHECKED • EXPLAINED • PLAYER-FIRST</text>
</g>
</g></svg>`,
  };
}

function hookSlamSvg(intake, plan) {
  const frame = sharedSvgFrame(plan);
  const hook = intake.story.hook || intake.story.title;
  const shieldBrief = /\b(shield|bastion)\b/i.test(
    [
      ...(intake.claims || []).map(claimText),
      ...(intake.story.visual_brief?.scenes || []),
    ].join(" "),
  );
  const heroGraphic = shieldBrief
    ? `<g transform="translate(185 340)" filter="url(#shadow)">
  <path d="M175 0 L320 65 V255 C320 385 250 485 175 530 C100 485 30 385 30 255 V65Z" fill="#172A39" stroke="${plan.platform_theme.accent}" stroke-width="9"/>
  <path d="M535 0 L680 65 V255 C680 385 610 485 535 530 C460 485 390 385 390 255 V65Z" fill="#172A39" stroke="${plan.platform_theme.accent}" stroke-width="9"/>
  <path d="M320 255 H390" stroke="${plan.platform_theme.accent}" stroke-width="20"/>
</g>`
    : `<g filter="url(#shadow)">
  <circle cx="540" cy="660" r="310" fill="none" stroke="${plan.platform_theme.accent}" stroke-width="5" opacity=".18"/>
  <circle cx="540" cy="660" r="230" fill="none" stroke="${plan.platform_theme.accent}" stroke-width="8" opacity=".3"/>
  <path d="M245 660 H390 L445 565 L520 785 L610 545 L675 660 H835" fill="none" stroke="${plan.platform_theme.accent}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
</g>`;
  return `${frame.open}
${heroGraphic}
<text x="80" y="1040" font-family="Arial,Helvetica,sans-serif" font-size="31" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="7">THE CHANGE</text>
${wrapSvgText(hook, { x: 80, y: 1140, maxChars: 20, lineHeight: 94, maxLines: 4, className: "headline" })}
<style>.headline{font-family:Arial,Helvetica,sans-serif;font-size:78px;font-weight:900;fill:#FFF;letter-spacing:-2px}</style>
${frame.close}`;
}

function beforeAfterSvg(intake, plan) {
  const frame = sharedSvgFrame(plan);
  const { before, after } = plan.visual_grammar.change;
  const featureBeats = plan.visual_grammar.feature_beats || [];
  const first = featureBeats[0] || {
    label: "THE HEADLINE",
    detail: intake.story.hook || intake.story.title,
  };
  const second = featureBeats[1] || {
    label: "PLAYER-FACING CHANGE",
    detail: intake.story.title,
  };
  const panels =
    plan.visual_grammar.comparison_mode === "threshold"
      ? `<g filter="url(#shadow)">
  <rect x="80" y="350" width="920" height="460" rx="48" fill="#10151E" stroke="#FFFFFF" stroke-opacity=".12"/>
  <text x="140" y="445" font-size="27" font-weight="800" fill="#A6ACB8" letter-spacing="5">PREVIOUS RULE</text>
  <text x="140" y="625" font-size="104" font-weight="900" fill="#FFF">${escapeSvg(before)}</text>
  <path d="M835 515 H920 M880 470 L925 515 L880 560" fill="none" stroke="#8A93A2" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<g filter="url(#shadow)">
  <rect x="80" y="860" width="920" height="540" rx="48" fill="${plan.platform_theme.primary}" stroke="${plan.platform_theme.accent}" stroke-width="4"/>
  <text x="140" y="965" font-size="27" font-weight="800" fill="#FFF" opacity=".78" letter-spacing="5">NEW RULE</text>
  <text x="140" y="1160" font-size="118" font-weight="900" fill="#FFF">${escapeSvg(after)}</text>
  <rect x="140" y="1230" width="500" height="64" rx="32" fill="${plan.platform_theme.accent}"/>
  <text x="390" y="1273" text-anchor="middle" font-size="27" font-weight="900" fill="#09100B">PLAYER-FACING UPDATE</text>
</g>`
      : `<g filter="url(#shadow)">
  <rect x="80" y="350" width="920" height="460" rx="48" fill="#10151E" stroke="${plan.platform_theme.accent}" stroke-opacity=".48" stroke-width="4"/>
  <text x="140" y="445" font-size="27" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="5">FEATURE ONE</text>
  ${wrapSvgText(first.label, { x: 140, y: 570, maxChars: 19, lineHeight: 82, maxLines: 2, className: "featureTitle" })}
  ${wrapSvgText(first.detail, { x: 140, y: 730, maxChars: 44, lineHeight: 42, maxLines: 2, className: "featureDetail" })}
</g>
<g filter="url(#shadow)">
  <rect x="80" y="860" width="920" height="540" rx="48" fill="${plan.platform_theme.primary}" stroke="${plan.platform_theme.accent}" stroke-width="4"/>
  <text x="140" y="965" font-size="27" font-weight="800" fill="#FFF" opacity=".78" letter-spacing="5">FEATURE TWO</text>
  ${wrapSvgText(second.label, { x: 140, y: 1100, maxChars: 19, lineHeight: 82, maxLines: 2, className: "featureTitle" })}
  ${wrapSvgText(second.detail, { x: 140, y: 1280, maxChars: 44, lineHeight: 42, maxLines: 2, className: "featureDetail" })}
</g>`;
  return `${frame.open}
<text x="80" y="275" font-size="32" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="7">${plan.visual_grammar.comparison_mode === "threshold" ? "BEFORE → NOW" : "WHAT’S IN THE UPDATE"}</text>
${panels}
<text x="80" y="1515" font-size="31" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="7">WHAT CHANGES FOR PLAYERS</text>
${wrapSvgText(intake.story.title, { x: 80, y: 1595, maxChars: 38, lineHeight: 58, maxLines: 2, className: "support" })}
<style>.support{font-family:Arial,Helvetica,sans-serif;font-size:48px;font-weight:800;fill:#FFF}.featureTitle{font-family:Arial,Helvetica,sans-serif;font-size:64px;font-weight:900;fill:#FFF}.featureDetail{font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:600;fill:#D8DDE5}</style>
${frame.close}`;
}

function timelineSvg(intake, plan) {
  const frame = sharedSvgFrame(plan);
  const beats = [...(plan.visual_grammar.timeline_beats || [])];
  const fallbacks = [
    {
      label: "HEADLINE CONFIRMED",
      detail: intake.story.hook || intake.story.title,
    },
    {
      label: "PLAYER IMPACT",
      detail: intake.story.title,
    },
    {
      label: "NEXT MILESTONE",
      detail: plan.visual_grammar.timeline,
    },
  ];
  while (beats.length < 3) beats.push(fallbacks[beats.length]);
  const positions = [70, 355, 640];
  const nodes = beats
    .slice(0, 3)
    .map((beat, index) => {
      const y = positions[index];
      const fill =
        index === 0
          ? plan.platform_theme.accent
          : index === 1
            ? plan.platform_theme.primary
            : "#FFFFFF";
      const numberFill = index === 2 ? plan.platform_theme.primary : "#081009";
      return `<circle cx="65" cy="${y}" r="43" fill="${fill}" stroke="${plan.platform_theme.accent}" stroke-width="${index === 1 ? 5 : 0}"/>
  <text x="65" y="${y + 12}" text-anchor="middle" font-size="34" font-weight="900" fill="${numberFill}">${index + 1}</text>
  <text x="150" y="${y - 8}" font-size="30" font-weight="800" fill="#FFF" letter-spacing="2">${escapeSvg(beat.label)}</text>
  <text x="150" y="${y + 42}" font-size="27" fill="#B8BEC8">${escapeSvg(clipText(beat.detail, 52))}</text>`;
    })
    .join("\n");
  return `${frame.open}
<text x="80" y="285" font-size="32" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="7">VERIFIED TIMELINE</text>
<text x="540" y="455" text-anchor="middle" font-size="86" font-weight="900" fill="#FFF">${escapeSvg(plan.visual_grammar.timeline)}</text>
<g transform="translate(115 610)">
  <path d="M65 55 V730" stroke="${plan.platform_theme.accent}" stroke-width="10" opacity=".75"/>
  ${nodes}
</g>
<rect x="80" y="1500" width="920" height="150" rx="40" fill="#FFF" fill-opacity=".08" stroke="#FFF" stroke-opacity=".12"/>
<text x="130" y="1565" font-size="26" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="4">OFFICIAL CLAIMS ONLY</text>
<text x="130" y="1615" font-size="31" font-weight="700" fill="#FFF">No rumour layer. No sourced footage.</text>
${frame.close}`;
}

function playerImpactSvg(intake, plan) {
  const frame = sharedSvgFrame(plan);
  const claims = intake.claims.map(claimText).filter(Boolean);
  const impact = claims[claims.length - 1] || intake.story.full_script;
  return `${frame.open}
<text x="80" y="285" font-size="32" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="7">PLAYER IMPACT</text>
<g transform="translate(270 390)" filter="url(#shadow)">
  <path d="M270 0 L500 92 V315 C500 510 400 650 270 715 C140 650 40 510 40 315 V92Z" fill="${plan.platform_theme.primary}" stroke="${plan.platform_theme.accent}" stroke-width="8"/>
  <path d="M152 335 L235 418 L395 245" fill="none" stroke="#FFF" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<rect x="80" y="1190" width="920" height="410" rx="48" fill="#0A0E15" stroke="${plan.platform_theme.accent}" stroke-opacity=".55" stroke-width="4"/>
<text x="140" y="1280" font-size="27" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="5">THE PRACTICAL RESULT</text>
${wrapSvgText(impact, { x: 140, y: 1380, maxChars: 30, lineHeight: 65, maxLines: 3, className: "impact" })}
<style>.impact{font-family:Arial,Helvetica,sans-serif;font-size:51px;font-weight:800;fill:#FFF}</style>
${frame.close}`;
}

function shieldLockSvg(intake, plan) {
  const frame = sharedSvgFrame(plan);
  return `${frame.open}
<text x="80" y="285" font-size="32" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="7">NEW JOB REVEALED</text>
<g transform="translate(80 380)" filter="url(#shadow)">
  <path d="M220 0 L410 80 V330 C410 500 320 625 220 685 C120 625 30 500 30 330 V80Z" fill="#132432" stroke="${plan.platform_theme.accent}" stroke-width="10"/>
  <path d="M700 0 L890 80 V330 C890 500 800 625 700 685 C600 625 510 500 510 330 V80Z" fill="#132432" stroke="${plan.platform_theme.accent}" stroke-width="10"/>
  <path d="M410 330 H510" stroke="${plan.platform_theme.accent}" stroke-width="24"/>
</g>
<text x="540" y="1190" text-anchor="middle" font-size="118" font-weight="900" fill="#FFF">BASTION</text>
<rect x="235" y="1260" width="610" height="74" rx="37" fill="${plan.platform_theme.accent}"/>
<text x="540" y="1310" text-anchor="middle" font-size="31" font-weight="900" fill="#10212E">DUAL GREATSHIELDS</text>
${wrapSvgText(plan.visual_grammar.feature_beats?.[0]?.detail || intake.claims[0], { x: 540, y: 1455, maxChars: 40, lineHeight: 52, maxLines: 2, className: "shieldDetail", anchor: "middle" })}
<style>.shieldDetail{font-family:Arial,Helvetica,sans-serif;font-size:39px;font-weight:700;fill:#DCEFF5}</style>
${frame.close}`;
}

function modeSwitchSvg(intake, plan) {
  const frame = sharedSvgFrame(plan);
  return `${frame.open}
<text x="80" y="285" font-size="32" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="7">COMBAT MODE</text>
<g filter="url(#shadow)">
  <rect x="80" y="460" width="920" height="270" rx="54" fill="#101820" stroke="#FFF" stroke-opacity=".12"/>
  <circle cx="210" cy="595" r="54" fill="#44515E"/>
  <text x="310" y="620" font-size="69" font-weight="900" fill="#7F8C98">REBORN</text>
</g>
<path d="M540 790 V945 M490 895 L540 945 L590 895" fill="none" stroke="${plan.platform_theme.accent}" stroke-width="18" stroke-linecap="round"/>
<g filter="url(#shadow)">
  <rect x="80" y="1000" width="920" height="360" rx="54" fill="${plan.platform_theme.primary}" stroke="${plan.platform_theme.accent}" stroke-width="8"/>
  <circle cx="210" cy="1180" r="68" fill="${plan.platform_theme.accent}"/>
  <path d="M180 1180 L205 1205 L248 1155" fill="none" stroke="#10212E" stroke-width="16" stroke-linecap="round"/>
  <text x="320" y="1205" font-size="80" font-weight="900" fill="#FFF">EVOLVED</text>
  <text x="320" y="1270" font-size="31" font-weight="700" fill="#E8F8FF">SELECTED FOR NEW JOBS</text>
</g>
<text x="540" y="1510" text-anchor="middle" font-size="26" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="4">EVOLVED MODE EXPANDS COMBAT CHOICES</text>
${frame.close}`;
}

function branchingBalanceSvg(intake, plan) {
  const frame = sharedSvgFrame(plan);
  return `${frame.open}
<text x="80" y="285" font-size="32" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="7">STORY + SCALING</text>
<g transform="translate(120 420)" filter="url(#shadow)">
  <path d="M420 30 V210 M420 210 L170 420 M420 210 L670 420 M170 420 V660 M670 420 V660" fill="none" stroke="${plan.platform_theme.accent}" stroke-width="18" stroke-linecap="round"/>
  <circle cx="420" cy="30" r="55" fill="#FFF"/>
  <circle cx="170" cy="420" r="66" fill="${plan.platform_theme.primary}" stroke="${plan.platform_theme.accent}" stroke-width="7"/>
  <circle cx="670" cy="420" r="66" fill="${plan.platform_theme.primary}" stroke="${plan.platform_theme.accent}" stroke-width="7"/>
  <circle cx="170" cy="660" r="46" fill="${plan.platform_theme.accent}"/>
  <circle cx="670" cy="660" r="46" fill="${plan.platform_theme.accent}"/>
</g>
<text x="540" y="1225" text-anchor="middle" font-size="67" font-weight="900" fill="#FFF">CHOOSE YOUR ROUTE</text>
<rect x="120" y="1320" width="840" height="150" rx="42" fill="#0D151D" stroke="${plan.platform_theme.accent}" stroke-width="4"/>
<text x="170" y="1380" font-size="27" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="4">AUTO CONTENT BALANCING</text>
<rect x="170" y="1410" width="670" height="20" rx="10" fill="#33414E"/><rect x="170" y="1410" width="500" height="20" rx="10" fill="${plan.platform_theme.accent}"/><circle cx="670" cy="1420" r="28" fill="#FFF"/>
<text x="160" y="1585" text-anchor="start" font-size="29" font-weight="800" fill="#FFF">BRANCHING + SCALING</text>
${frame.close}`;
}

function raidGridSvg(intake, plan) {
  const frame = sharedSvgFrame(plan);
  const slots = Array.from({ length: 8 }, (_, index) => {
    const x = 145 + (index % 4) * 215;
    const y = 510 + Math.floor(index / 4) * 225;
    return `<rect x="${x}" y="${y}" width="150" height="150" rx="34" fill="${index === 7 ? plan.platform_theme.accent : "#162633"}" stroke="${plan.platform_theme.accent}" stroke-width="5"/><text x="${x + 75}" y="${y + 93}" text-anchor="middle" font-size="43" font-weight="900" fill="${index === 7 ? "#10212E" : "#FFF"}">${index + 1}</text>`;
  }).join("");
  return `${frame.open}
<text x="80" y="285" font-size="32" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="7">EIGHT-PLAYER RAID</text>
<g filter="url(#shadow)">${slots}</g>
<text x="540" y="1110" text-anchor="middle" font-size="49" font-weight="900" fill="#FFF">BEYOND THE</text>
<text x="540" y="1195" text-anchor="middle" font-size="76" font-weight="900" fill="${plan.platform_theme.accent}">LIFESTREAM</text>
<rect x="220" y="1290" width="640" height="78" rx="39" fill="#FFF"/>
<text x="540" y="1342" text-anchor="middle" font-size="34" font-weight="900" fill="#142536">FFVII RAID CROSSOVER</text>
${frame.close}`;
}

function platformReleaseSvg(intake, plan) {
  const frame = sharedSvgFrame({
    ...plan,
    platform_theme: {
      ...plan.platform_theme,
      primary: "#B50016",
      accent: "#FFFFFF",
      label: "DATE",
    },
  });
  return `${frame.open}
<text x="80" y="300" font-size="32" font-weight="800" fill="#FFF" letter-spacing="7">NEW PLATFORM</text>
<rect x="80" y="420" width="920" height="700" rx="62" fill="#E60012" stroke="#FFF" stroke-width="8" filter="url(#shadow)"/>
<text x="540" y="700" text-anchor="middle" font-size="116" font-weight="900" fill="#FFF">SWITCH 2</text>
<path d="M220 810 H860" stroke="#FFF" stroke-width="5" opacity=".5"/>
<text x="540" y="975" text-anchor="middle" font-size="96" font-weight="900" fill="#FFF">4 AUGUST</text>
<text x="540" y="1050" text-anchor="middle" font-size="31" font-weight="700" fill="#FFF" letter-spacing="5">OFFICIAL PLATFORM DATE</text>
<text x="80" y="1320" font-size="29" font-weight="800" fill="${plan.platform_theme.accent}" letter-spacing="5">FINAL FANTASY XIV: EVERCOLD</text>
${frame.close}`;
}

async function renderOwnedStill({ outputPath, role, intake, plan } = {}) {
  const svg = buildOwnedStillSvg({ role, intake, plan });
  await sharp(Buffer.from(svg, "utf8"))
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath);
}

function buildOwnedStillSvg({ role, intake, plan } = {}) {
  const renderers = {
    hook_slam: hookSlamSvg,
    before_after_change: beforeAfterSvg,
    verified_timeline: timelineSvg,
    player_impact: playerImpactSvg,
    shield_lock: shieldLockSvg,
    mode_switch: modeSwitchSvg,
    branching_balance: branchingBalanceSvg,
    raid_grid: raidGridSvg,
    platform_release: platformReleaseSvg,
  };
  const renderer = renderers[role];
  if (!renderer) throw new Error(`owned_motion_unknown_still_role:${role}`);
  return renderer(intake, plan);
}

function renderOwnedVideo({
  stillPaths,
  outputPath,
  plan,
  ffmpegPath = "ffmpeg",
  spawnSyncImpl = spawnSync,
} = {}) {
  if (
    !Array.isArray(stillPaths) ||
    stillPaths.length < 3 ||
    stillPaths.length > 8
  ) {
    throw new Error("owned_motion_three_to_eight_stills_required");
  }
  for (const stillPath of stillPaths) {
    if (!fs.existsSync(stillPath)) {
      throw new Error("owned_motion_still_missing");
    }
  }
  const duration = Number(plan?.video?.duration_seconds);
  const fps = Number(plan?.video?.fps);
  if (!Number.isFinite(duration) || duration < 25 || duration > 32) {
    throw new Error("owned_motion_planned_duration_invalid");
  }
  if (fps !== 30) throw new Error("owned_motion_planned_fps_invalid");

  const transitionDuration = 0.6;
  const sceneDuration =
    (duration + transitionDuration * (stillPaths.length - 1)) /
    stillPaths.length;
  const args = ["-hide_banner", "-loglevel", "error"];
  for (const stillPath of stillPaths) {
    args.push(
      "-loop",
      "1",
      "-framerate",
      String(fps),
      "-t",
      sceneDuration.toFixed(3),
      "-i",
      stillPath,
    );
  }
  const sceneFilters = stillPaths.map((_, index) => {
    const zoom =
      index % 2 === 0
        ? "min(zoom+0.00045,1.06)"
        : "if(eq(on,1),1.06,max(zoom-0.00045,1.0))";
    const filters = [
      `[${index}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase`,
      `crop=${WIDTH}:${HEIGHT}`,
      `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${WIDTH}x${HEIGHT}:fps=${fps}`,
      `trim=duration=${sceneDuration.toFixed(3)}`,
      "setpts=PTS-STARTPTS",
    ].join(",");
    return `${filters}[v${index}]`;
  });
  const transitionStep = sceneDuration - transitionDuration;
  const transitionNames = ["slideleft", "wipeup", "slideup", "wiperight"];
  const transitions = [];
  let previous = "[v0]";
  for (let index = 1; index < stillPaths.length; index += 1) {
    const final = index === stillPaths.length - 1;
    const output = final ? "[v]" : `[x${index}]`;
    const format = final ? ",format=yuv420p" : "";
    transitions.push(
      `${previous}[v${index}]xfade=transition=${transitionNames[(index - 1) % transitionNames.length]}:duration=${transitionDuration}:offset=${(transitionStep * index).toFixed(3)}${format}${output}`,
    );
    previous = output;
  }
  args.push(
    "-filter_complex",
    [...sceneFilters, ...transitions].join(";"),
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-t",
    duration.toFixed(3),
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  );
  const result = spawnSyncImpl(ffmpegPath, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result?.status !== 0) {
    throw new Error(
      `owned_motion_ffmpeg_failed:${cleanText(result?.stderr).slice(0, 240)}`,
    );
  }
  if (!fs.existsSync(outputPath)) {
    throw new Error("owned_motion_video_output_missing");
  }
}

function inspectFfmpeg({
  ffmpegPath = "ffmpeg",
  spawnSyncImpl = spawnSync,
} = {}) {
  try {
    const result = spawnSyncImpl(ffmpegPath, ["-version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      available: result?.status === 0,
      executable: ffmpegPath,
    };
  } catch {
    return {
      available: false,
      executable: ffmpegPath,
    };
  }
}

async function inspectOwnedAsset({
  filePath,
  mediaType,
  ffprobePath = "ffprobe",
  spawnSyncImpl = spawnSync,
} = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error("owned_motion_output_missing");
  }
  if (mediaType === "image") {
    const metadata = await sharp(filePath).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      duration_seconds: null,
    };
  }
  if (mediaType !== "video") {
    throw new Error("owned_motion_media_type_invalid");
  }
  const result = spawnSyncImpl(
    ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      filePath,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result?.status !== 0) {
    throw new Error(
      `owned_motion_ffprobe_failed:${cleanText(result?.stderr).slice(0, 240)}`,
    );
  }
  let probe;
  try {
    probe = JSON.parse(result.stdout);
  } catch {
    throw new Error("owned_motion_ffprobe_output_invalid");
  }
  const video = Array.isArray(probe?.streams) ? probe.streams[0] : null;
  return {
    width: Number(video?.width),
    height: Number(video?.height),
    duration_seconds: Number(probe?.format?.duration),
  };
}

async function writeFileAtomic(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporaryPath, content);
  await fsp.rename(temporaryPath, filePath);
}

async function writeOwnedMotionPlan(plan) {
  const storyRoot = path.resolve(plan.output_root);
  if (
    storyRoot !==
    path.join(path.resolve(plan.explicit_output_dir), plan.story_id)
  ) {
    throw new Error("owned_motion_output_root_identity_mismatch");
  }
  await fsp.mkdir(storyRoot, { recursive: true });
  const planPath = path.join(storyRoot, "owned-motion-plan.json");
  const markdownPath = path.join(storyRoot, "owned-motion-plan.md");
  await writeFileAtomic(
    planPath,
    Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, "utf8"),
  );
  await writeFileAtomic(
    markdownPath,
    Buffer.from(renderOwnedMotionPlanMarkdown(plan), "utf8"),
  );
  return {
    plan_path: planPath,
    markdown_path: markdownPath,
  };
}

async function materializeOwnedMotion({
  intake,
  plan,
  authority,
  generatedAt = plan?.generated_at || new Date().toISOString(),
  renderStill = renderOwnedStill,
  renderVideo = renderOwnedVideo,
  inspectAsset = inspectOwnedAsset,
} = {}) {
  if (authority?.authorised !== true) {
    throw new Error(
      `owned_motion_apply_not_authorised:${(authority?.blockers || []).join(",")}`,
    );
  }
  if (
    typeof renderStill !== "function" ||
    typeof renderVideo !== "function" ||
    typeof inspectAsset !== "function"
  ) {
    throw new Error("owned_motion_renderer_dependencies_required");
  }
  const validation = validateIntakeContract(intake);
  if (!validation.valid || plan?.ready !== true) {
    throw new Error(
      `owned_motion_plan_not_ready:${[
        ...validation.blockers,
        ...(plan?.blockers || []),
      ].join(",")}`,
    );
  }

  const explicitRoot = path.resolve(plan.explicit_output_dir);
  const storyRoot = path.resolve(plan.output_root);
  const expectedStoryRoot = path.join(explicitRoot, plan.story_id);
  if (storyRoot !== expectedStoryRoot) {
    throw new Error("owned_motion_output_root_identity_mismatch");
  }
  assertContained(explicitRoot, storyRoot);
  const finalAssetsRoot = path.join(storyRoot, "assets");
  if (fs.existsSync(finalAssetsRoot)) {
    throw new Error("owned_motion_output_already_exists");
  }
  await fsp.mkdir(storyRoot, { recursive: true });
  const stagingRoot = path.join(
    storyRoot,
    `.staging-${process.pid}-${Date.now()}`,
  );
  assertContained(storyRoot, stagingRoot);
  await fsp.mkdir(path.join(stagingRoot, "assets"), { recursive: true });

  let assetsPromoted = false;
  try {
    const stillPaths = [];
    const visualInputs = [];
    for (const asset of plan.assets.filter(
      (item) => item.media_type === "image",
    )) {
      const outputPath = path.join(stagingRoot, asset.path);
      assertContained(stagingRoot, outputPath);
      await renderStill({
        outputPath,
        role: asset.role,
        intake,
        plan,
      });
      stillPaths.push(outputPath);
      visualInputs.push({
        path: asset.path.replace(/\\/g, "/"),
        sha256: sha256Buffer(await fsp.readFile(outputPath)),
      });
    }
    const videoAsset = plan.assets.find(
      (asset) => asset.media_type === "video",
    );
    if (!videoAsset) throw new Error("owned_motion_video_plan_missing");
    const videoPath = path.join(stagingRoot, videoAsset.path);
    assertContained(stagingRoot, videoPath);
    await renderVideo({
      outputPath: videoPath,
      stillPaths,
      intake,
      plan,
    });
    for (const visualInput of visualInputs) {
      const inputPath = path.join(stagingRoot, visualInput.path);
      const postRenderSha256 = sha256Buffer(await fsp.readFile(inputPath));
      if (postRenderSha256 !== visualInput.sha256) {
        throw new Error(
          `owned_motion_visual_input_mutated_during_render:${visualInput.path}`,
        );
      }
    }

    const manifestAssets = [];
    for (const planned of plan.assets) {
      const stagedPath = path.join(stagingRoot, planned.path);
      assertContained(stagingRoot, stagedPath);
      if (!fs.existsSync(stagedPath)) {
        throw new Error(`owned_motion_output_missing:${planned.role}`);
      }
      const inspection = await inspectAsset({
        filePath: stagedPath,
        mediaType: planned.media_type,
      });
      validateAssetInspection({
        mediaType: planned.media_type,
        inspection,
      });
      const sha256 = sha256Buffer(await fsp.readFile(stagedPath));
      manifestAssets.push({
        path: planned.path.replace(/\\/g, "/"),
        sha256,
        media_type: planned.media_type,
        role: planned.role,
        ownership: "owned",
        width: inspection.width,
        height: inspection.height,
        duration_seconds:
          planned.media_type === "video"
            ? Number(inspection.duration_seconds)
            : null,
        generator_identity: OWNED_MOTION_GENERATOR,
        rights_basis: "OWNED",
        attribution_required: false,
        provenance: {
          source: "repository_owned_generation",
          intake_manifest_sha256: plan.intake_manifest_sha256,
          third_party_media_used: false,
          ...(planned.media_type === "video"
            ? { visual_inputs: visualInputs }
            : {}),
        },
      });
    }

    const imageRoles = new Set(
      manifestAssets
        .filter((asset) => asset.media_type === "image")
        .map((asset) => asset.role),
    );
    if (imageRoles.size < 3) {
      throw new Error("owned_motion_distinct_still_budget_not_met");
    }

    await fsp.rename(path.join(stagingRoot, "assets"), finalAssetsRoot);
    assetsPromoted = true;
    const manifest = {
      schema_version: ASSET_MANIFEST_SCHEMA,
      story_id: plan.story_id,
      generated_at: new Date(generatedAt).toISOString(),
      assets: manifestAssets,
    };
    const manifestPath = path.join(storyRoot, "owned-motion-manifest.json");
    const markdownPath = path.join(storyRoot, "owned-motion-manifest.md");
    const manifestBytes = Buffer.from(
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await writeFileAtomic(manifestPath, manifestBytes);
    await writeFileAtomic(
      markdownPath,
      Buffer.from(renderOwnedMotionMarkdown(manifest), "utf8"),
    );
    await fsp.rm(stagingRoot, { recursive: true, force: true });
    return {
      manifest,
      manifest_path: manifestPath,
      markdown_path: markdownPath,
      manifest_sha256: sha256Buffer(manifestBytes),
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      network_used: false,
    };
  } catch (error) {
    await fsp.rm(stagingRoot, { recursive: true, force: true });
    if (assetsPromoted) {
      await fsp.rm(finalAssetsRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

module.exports = {
  ASSET_MANIFEST_SCHEMA,
  DURATION_SECONDS,
  HEIGHT,
  INTAKE_SCHEMA,
  OWNED_MOTION_GENERATOR,
  PLAN_SCHEMA,
  WIDTH,
  buildOwnedStillSvg,
  buildOwnedMotionPlan,
  extractVisualGrammar,
  inferPlatformTheme,
  inspectFfmpeg,
  inspectOwnedAsset,
  materializeOwnedMotion,
  normaliseSha256,
  renderOwnedStill,
  renderOwnedVideo,
  renderOwnedMotionMarkdown,
  renderOwnedMotionPlanMarkdown,
  sha256Buffer,
  validateIntakeContract,
  validateApplyAuthority,
  writeOwnedMotionPlan,
};
