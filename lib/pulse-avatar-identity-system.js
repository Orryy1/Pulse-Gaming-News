"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "13_pulse_avatar_identity_system";

const REQUIRED_SEGMENTS = [
  { id: "breaking_pulse", label: "Breaking Pulse", trigger: "breaking news or official urgent reveal" },
  { id: "trailer_truth_check", label: "Trailer Truth Check", trigger: "trailer, gameplay reveal or footage claim" },
  { id: "worth_your_wishlist", label: "Worth Your Wishlist?", trigger: "demo, release, discount or player-buying context" },
  { id: "platform_war_pulse", label: "Platform War Pulse", trigger: "PlayStation, Xbox, Nintendo or PC platform angle" },
  { id: "delisting_watch", label: "Delisting Watch", trigger: "delisting, shutdown, licence expiry or store removal" },
  { id: "steam_spike_check", label: "Steam Spike Check", trigger: "Steam charts, reviews, player count or PC momentum" },
  { id: "game_behind_the_headline", label: "The Game Behind The Headline", trigger: "default source-backed explainer" },
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(asArray(values).map(String).filter(Boolean))];
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function resolveWorkspacePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

function defaultAvatarIdentity(overrides = {}) {
  return {
    schema_version: 1,
    character_type: "stylised_signal_operator",
    name: "Pulse Operator",
    description:
      "A non-human signal-wave editorial identity built from the Pulse orbit mark, waveform bars and source-lock UI motifs.",
    visual_form: "abstract_operator_mark",
    photorealistic: false,
    human_likeness: false,
    presenter_claim: false,
    fake_presenter_risk: "none",
    face_policy: {
      no_human_face: true,
      no_named_person_likeness: true,
      no_deepfake_or_clone: true,
      no_photorealistic_presenter: true,
    },
    usage: [
      "intro_sting",
      "source_cards",
      "proof_cards",
      "lower_thirds",
      "story_card_posts",
      "cover_frames",
      "cta_outro",
    ],
    ...overrides,
  };
}

function defaultBrandStyleGuide(channel = {}) {
  const colours = channel.colours || {};
  return {
    schema_version: 1,
    channel_id: channel.id || "pulse-gaming",
    brand_name: channel.name || "PULSE GAMING",
    cta: channel.cta || "Follow Pulse Gaming so you never miss a beat",
    logo_lockups: ["pulse_orbit_mark", "pulse_gaming_wordmark", "pulse_operator_signal_mark"],
    colour_system: {
      primary: colours.PRIMARY || "#FF6B1A",
      background: colours.SECONDARY || "#0D0D0F",
      text: colours.TEXT || "#F0F0F0",
      alert: colours.ALERT || "#FF2D2D",
      confirmed: colours.CONFIRMED || "#22C55E",
      muted: colours.MUTED || "#6B7280",
    },
    typography: {
      headline: "condensed_bold_uppercase",
      source_label: "compact_semibold",
      captions: "mobile_readable_manual_captions",
      no_tiny_text: true,
    },
    source_card_style: {
      source_lock_badge: true,
      named_source_required: true,
      translucent_top_left_stack_forbidden: true,
      hierarchy: ["segment_badge", "headline", "source", "proof_line"],
    },
    lower_thirds: {
      collision_safe_zone: "below_top_ui_above_caption_band",
      max_lines: 2,
      source_and_title_overlap_forbidden: true,
    },
    caption_rules: {
      subtitle_last: true,
      preserve_game_title_numbers: true,
      no_internal_qa_language: true,
      no_pulse_gaming_pause_markup: true,
    },
  };
}

function defaultMotionIdentityKit() {
  return {
    schema_version: 1,
    components: [
      {
        id: "intro_signal_ping",
        type: "intro_sting",
        duration_ms: 350,
        usage: "first beat only when it does not delay the hook",
      },
      {
        id: "source_lock_wipe",
        type: "proof_transition",
        duration_ms: 280,
        usage: "reveals source cards and verified proof moments",
      },
      {
        id: "pulse_operator_glitch",
        type: "identity_accent",
        duration_ms: 220,
        usage: "between motion clips, never over narration-critical words",
      },
      {
        id: "cta_beat_outro",
        type: "outro_identity",
        duration_ms: 500,
        usage: "supports the spoken Pulse Gaming catch line without pausing the brand name",
      },
    ],
    restrictions: {
      no_gradient_orb_identity: true,
      no_fake_presenter_animation: true,
      no_competitor_template_clone: true,
      no_text_overlap_with_platform_ui: true,
    },
  };
}

function recurringSegmentRegistry() {
  return {
    schema_version: 1,
    segments: REQUIRED_SEGMENTS.map((segment) => ({
      ...segment,
      badge_style: {
        shape: "source_lock_tab",
        includes_pulse_operator_mark: true,
        mobile_min_height_px: 44,
      },
      intro_rule: "segment badge may appear after the hook, not before the hook is understood",
      outro_rule: "return to Pulse Gaming catch line only once",
    })),
  };
}

function identityBlockers(identity = {}, registry = recurringSegmentRegistry(), motionKit = defaultMotionIdentityKit(), styleGuide = defaultBrandStyleGuide()) {
  const blockers = [];
  if (identity.photorealistic === true) blockers.push("identity:photorealistic_avatar_forbidden");
  if (identity.human_likeness === true) blockers.push("identity:human_likeness_forbidden");
  if (identity.presenter_claim === true) blockers.push("identity:fake_presenter_claim_forbidden");
  const segmentIds = new Set(asArray(registry.segments).map((segment) => segment.id));
  for (const segment of REQUIRED_SEGMENTS) {
    if (!segmentIds.has(segment.id)) blockers.push(`identity:missing_segment:${segment.id}`);
  }
  const motionIds = new Set(asArray(motionKit.components).map((component) => component.id));
  for (const required of ["source_lock_wipe", "cta_beat_outro"]) {
    if (!motionIds.has(required)) blockers.push(`identity:missing_motion_component:${required}`);
  }
  if (!cleanText(styleGuide.cta)) blockers.push("identity:cta_missing");
  if (styleGuide.source_card_style?.translucent_top_left_stack_forbidden !== true) {
    blockers.push("identity:source_card_overlap_guard_missing");
  }
  return unique(blockers);
}

function chooseSegment(canonical = {}) {
  const text = `${canonical.classification || ""} ${canonical.selected_title || ""} ${canonical.canonical_title || ""} ${canonical.canonical_subject || ""}`.toLowerCase();
  if (/\bbreaking\b|urgent|just dropped|shadow[- ]?drop/.test(text)) return "breaking_pulse";
  if (/\btrailer\b|gameplay|footage|reveal/.test(text)) return "trailer_truth_check";
  if (/\bwishlist\b|demo|discount|deal|free|edition|launch/.test(text)) return "worth_your_wishlist";
  if (/\bdelist|shutdown|removed|licen[cs]e expir/.test(text)) return "delisting_watch";
  if (/\bsteam\b|player count|charts?|reviews?\b/.test(text)) return "steam_spike_check";
  if (/\bxbox|playstation|ps5|nintendo|switch|pc\b/.test(text)) return "platform_war_pulse";
  return "game_behind_the_headline";
}

async function buildStoryIdentityAssignments(storyPackages = [], { workspaceRoot = process.cwd() } = {}) {
  const assignments = [];
  for (const storyPackage of asArray(storyPackages)) {
    const storyId = cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
    const artifactDir = resolveWorkspacePath(workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
    const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
    const segmentId = chooseSegment(canonical);
    const segment = REQUIRED_SEGMENTS.find((item) => item.id === segmentId);
    assignments.push({
      story_id: storyId,
      title: cleanText(canonical.selected_title || canonical.canonical_title || storyPackage.title),
      segment_id: segmentId,
      segment_label: segment?.label || segmentId,
      badge_asset_key: `pulse_segment_${segmentId}`,
      motion_identity_components: ["source_lock_wipe", "pulse_operator_glitch", "cta_beat_outro"],
      safety: {
        no_fake_presenter: true,
        no_human_likeness: true,
        no_external_generation: true,
      },
    });
  }
  return assignments;
}

function countBlockers(blockers = []) {
  return asArray(blockers).reduce((out, blocker) => {
    out[blocker] = (out[blocker] || 0) + 1;
    return out;
  }, {});
}

function buildIdentityQualityGateReport({ blockers = [], assignments = [] } = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    status: blockers.length ? "blocked" : "pass",
    blockers,
    checks: {
      non_photorealistic_identity: !blockers.includes("identity:photorealistic_avatar_forbidden"),
      no_human_likeness: !blockers.includes("identity:human_likeness_forbidden"),
      recurring_segments_registered: REQUIRED_SEGMENTS.length,
      story_assignments_checked: asArray(assignments).length,
      source_card_overlap_guard: !blockers.includes("identity:source_card_overlap_guard_missing"),
    },
  };
}

async function buildPulseAvatarIdentitySystem({
  storyPackages = [],
  channelConfig = {},
  identityOverrides = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (outputDir) await fs.ensureDir(path.resolve(outputDir));
  const avatarIdentity = defaultAvatarIdentity(identityOverrides);
  const brandStyleGuide = defaultBrandStyleGuide(channelConfig);
  const motionIdentityKit = defaultMotionIdentityKit();
  const segmentRegistry = recurringSegmentRegistry();
  const assignments = await buildStoryIdentityAssignments(storyPackages, { workspaceRoot });
  const blockers = identityBlockers(avatarIdentity, segmentRegistry, motionIdentityKit, brandStyleGuide);
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict: blockers.length ? "BLOCKED" : "PASS",
    summary: {
      story_count: asArray(storyPackages).length,
      assigned_story_count: assignments.length,
      segment_count: segmentRegistry.segments.length,
      motion_component_count: motionIdentityKit.components.length,
      blocker_count: blockers.length,
    },
    blocker_counts: countBlockers(blockers),
    avatar_identity: avatarIdentity,
    brand_style_guide: brandStyleGuide,
    motion_identity_kit: motionIdentityKit,
    recurring_segment_registry: segmentRegistry,
    story_identity_assignments: assignments,
    safety: {
      local_proof_only: true,
      no_fake_presenter_or_deepfake: true,
      no_photorealistic_likeness: true,
      no_external_image_generation: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_competitor_assets_copied: true,
    },
  };
  report.identity_quality_gate_report = buildIdentityQualityGateReport({ blockers, assignments });
  return report;
}

function renderPulseAvatarIdentityMarkdown(report = {}) {
  const lines = [];
  lines.push("# Pulse Avatar Identity System");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Stories assigned: ${Number(report.summary?.assigned_story_count || 0)}`);
  lines.push(`Segments registered: ${Number(report.summary?.segment_count || 0)}`);
  lines.push(`Motion components: ${Number(report.summary?.motion_component_count || 0)}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This identity pack did not generate images, copy competitor assets, publish, mutate DB rows or touch OAuth/token settings.");
  return `${lines.join("\n")}\n`;
}

async function writePulseAvatarIdentitySystem(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writePulseAvatarIdentitySystem requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "pulse_avatar_identity_report.json");
  const readinessMarkdown = path.join(outDir, "pulse_avatar_identity_report.md");
  const avatarIdentity = path.join(outDir, "pulse_avatar_identity_manifest.json");
  const brandStyleGuide = path.join(outDir, "pulse_brand_style_guide.json");
  const motionIdentityKit = path.join(outDir, "pulse_motion_identity_kit.json");
  const recurringSegmentRegistry = path.join(outDir, "recurring_segment_registry.json");
  const identityQualityGateReport = path.join(outDir, "identity_quality_gate_report.json");
  const storyIdentityAssignments = path.join(outDir, "story_identity_assignments.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderPulseAvatarIdentityMarkdown(report), "utf8");
  await fs.writeJson(avatarIdentity, report.avatar_identity || {}, { spaces: 2 });
  await fs.writeJson(brandStyleGuide, report.brand_style_guide || {}, { spaces: 2 });
  await fs.writeJson(motionIdentityKit, report.motion_identity_kit || {}, { spaces: 2 });
  await fs.writeJson(recurringSegmentRegistry, report.recurring_segment_registry || {}, { spaces: 2 });
  await fs.writeJson(identityQualityGateReport, report.identity_quality_gate_report || {}, { spaces: 2 });
  await fs.writeJson(storyIdentityAssignments, report.story_identity_assignments || [], { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    avatarIdentity,
    brandStyleGuide,
    motionIdentityKit,
    recurringSegmentRegistry,
    identityQualityGateReport,
    storyIdentityAssignments,
  };
}

module.exports = {
  GOAL_ID,
  REQUIRED_SEGMENTS,
  buildIdentityQualityGateReport,
  buildPulseAvatarIdentitySystem,
  buildStoryIdentityAssignments,
  defaultAvatarIdentity,
  defaultBrandStyleGuide,
  defaultMotionIdentityKit,
  recurringSegmentRegistry,
  renderPulseAvatarIdentityMarkdown,
  writePulseAvatarIdentitySystem,
};
