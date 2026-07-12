"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const PLATFORM_VISUAL_SPECS = Object.freeze({
  youtube_thumbnail: { width: 1280, height: 720, safe: { top: 52, right: 64, bottom: 54, left: 64 }, publish_state: "enabled" },
  youtube_shorts_cover: { width: 1080, height: 1920, safe: { top: 190, right: 72, bottom: 390, left: 72 }, publish_state: "enabled" },
  instagram_reels_cover: { width: 1080, height: 1920, safe: { top: 250, right: 78, bottom: 430, left: 78 }, publish_state: "enabled" },
  instagram_story: { width: 1080, height: 1920, safe: { top: 250, right: 72, bottom: 340, left: 72 }, publish_state: "enabled" },
  facebook_reels_cover: { width: 1080, height: 1920, safe: { top: 190, right: 72, bottom: 370, left: 72 }, publish_state: "enabled" },
  discord_card: { width: 1200, height: 630, safe: { top: 44, right: 54, bottom: 44, left: 54 }, publish_state: "notification_only" },
  threads_card: { width: 1080, height: 1350, safe: { top: 72, right: 72, bottom: 96, left: 72 }, publish_state: "deferred_package_only" },
  pinterest_pin: { width: 1000, height: 1500, safe: { top: 80, right: 72, bottom: 100, left: 72 }, publish_state: "deferred_package_only" },
});

const CONTENT_IDENTITIES = Object.freeze({
  breaking: { id: "breaking", label: "BREAKING", accent: "#FF3B30", accent2: "#FFD23F", signal: "URGENT SIGNAL" },
  reveal: { id: "reveal", label: "REVEAL", accent: "#19D3FF", accent2: "#FF6B1A", signal: "FIRST LOOK" },
  review: { id: "review", label: "REVIEW", accent: "#9DFF57", accent2: "#19D3FF", signal: "PULSE VERDICT" },
  rumour: { id: "rumour", label: "RUMOUR WATCH", accent: "#FF4FD8", accent2: "#FFD23F", signal: "UNCONFIRMED" },
  deal: { id: "deal", label: "DEAL WATCH", accent: "#FFD23F", accent2: "#9DFF57", signal: "VALUE CHECK" },
  update: { id: "update", label: "UPDATE", accent: "#FF6B1A", accent2: "#19D3FF", signal: "PLAYER IMPACT" },
  release: { id: "release", label: "RELEASE", accent: "#9DFF57", accent2: "#FF6B1A", signal: "NOW LIVE" },
});

const GENERIC_HEADLINE_RE = /^(?:BIG|HUGE|MAJOR|NEW|LATEST)?\s*(?:GAMING|GAME)?\s*(?:NEWS|UPDATE|STORY|REVEAL)(?:\s+(?:NEWS|UPDATE|TODAY|NOW))*[!?]*$/i;
const STOPWORDS = new Set(["the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "is", "has", "with"]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeStem(value) {
  return clean(value || "story").replace(/[^a-z0-9_-]+/gi, "_") || "story";
}

function escapeXml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtml(value) {
  return escapeXml(value).replace(/'/g, "&#39;");
}

function meaningfulTokens(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function normaliseIdentity(value) {
  const haystack = clean(value).toLowerCase();
  if (/break|urgent/.test(haystack)) return CONTENT_IDENTITIES.breaking;
  if (/rumou?r|leak|reported/.test(haystack)) return CONTENT_IDENTITIES.rumour;
  if (/review|score|verdict/.test(haystack)) return CONTENT_IDENTITIES.review;
  if (/deal|sale|discount|price/.test(haystack)) return CONTENT_IDENTITIES.deal;
  if (/reveal|trailer|first look|announce/.test(haystack)) return CONTENT_IDENTITIES.reveal;
  if (/release|launch|now live|out now/.test(haystack)) return CONTENT_IDENTITIES.release;
  return CONTENT_IDENTITIES.update;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function splitHeadline(value, maxChars = 20, maxLines = 3) {
  const words = clean(value).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > maxChars && lines.length < maxLines - 1) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function buildPremiumVisualCampaignSpec(input = {}) {
  const storyId = safeStem(input.story_id || input.id);
  const subject = clean(input.canonical_subject || input.subject || input.canonical_game || input.title);
  const title = clean(input.title || input.canonical_title || input.selected_title);
  const headline = clean(input.headline || input.thumbnail_headline || input.suggested_thumbnail_text || title).toUpperCase();
  const sourceLabel = clean(input.source_label || input.source_card_label || input.primary_source).toUpperCase();
  const identity = normaliseIdentity(`${input.classification || ""} ${input.content_pillar || ""} ${title}`);
  const outputs = Object.fromEntries(Object.entries(PLATFORM_VISUAL_SPECS).map(([platform, spec]) => [platform, {
    platform,
    ...spec,
    static_filename: `${storyId}_${platform}.png`,
    headline,
    source_label: sourceLabel,
  }]));
  const visualFingerprint = hash([subject, headline, identity.id, identity.accent, identity.accent2].join("|"));
  return {
    schema_version: 1,
    story_id: storyId,
    canonical_subject: subject,
    title,
    headline,
    source_label: sourceLabel,
    story_prompt: clean(input.story_prompt || input.poll_prompt || "WHAT CHANGES FOR PLAYERS?").toUpperCase(),
    identity,
    brand_lockup: "PULSE GAMING",
    brand_signal: "THE SIGNAL BEHIND THE HEADLINE",
    visual_fingerprint: visualFingerprint,
    outputs,
  };
}

function validatePremiumVisualCampaign(campaign = {}, { heroImagePresent = false, recentCampaigns = [] } = {}) {
  const blockers = [];
  const warnings = [];
  const headline = clean(campaign.headline);
  const subjectTokens = new Set(meaningfulTokens(campaign.canonical_subject));
  const headlineTokens = meaningfulTokens(headline);
  const overlap = headlineTokens.filter((token) => subjectTokens.has(token));
  const words = headline.split(/\s+/).filter(Boolean);
  if (!heroImagePresent) blockers.push("premium_visual_safe_hero_missing");
  if (!headline || GENERIC_HEADLINE_RE.test(headline) || !overlap.length) blockers.push("premium_visual_headline_subject_mismatch");
  if (words.length > 8 || headline.length > 72) blockers.push("premium_visual_headline_not_mobile_readable");
  if (!clean(campaign.source_label)) warnings.push("premium_visual_source_label_missing");
  if (!campaign.identity?.accent || !campaign.identity?.accent2) blockers.push("premium_visual_identity_missing");
  if (recentCampaigns.some((row) => clean(row.visual_fingerprint) === clean(campaign.visual_fingerprint))) {
    blockers.push("premium_visual_recent_fingerprint_repeated");
  }
  const outputRows = Object.values(campaign.outputs || {});
  if (outputRows.length !== Object.keys(PLATFORM_VISUAL_SPECS).length) blockers.push("premium_visual_output_matrix_incomplete");
  for (const row of outputRows) {
    const safe = row.safe || {};
    if (![row.width, row.height, safe.top, safe.right, safe.bottom, safe.left].every((value) => Number(value) > 0)) {
      blockers.push(`premium_visual_safe_zone_invalid:${row.platform || "unknown"}`);
    }
  }
  const uniqueBlockers = [...new Set(blockers)];
  const uniqueWarnings = [...new Set(warnings)];
  const score = Math.max(0, 100 - uniqueBlockers.length * 25 - uniqueWarnings.length * 5);
  return {
    schema_version: 1,
    story_id: campaign.story_id,
    verdict: uniqueBlockers.length ? "red" : uniqueWarnings.length ? "amber" : "green",
    score,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    checks: {
      safe_hero_present: heroImagePresent,
      headline_word_count: words.length,
      subject_headline_overlap: overlap,
      platform_output_count: outputRows.length,
      recent_fingerprint_unique: !uniqueBlockers.includes("premium_visual_recent_fingerprint_repeated"),
    },
  };
}

function typographyFor(spec, headline) {
  const landscape = spec.width / spec.height > 1.2;
  const lines = splitHeadline(headline, landscape ? 22 : 18, landscape ? 3 : 4);
  const longest = Math.max(...lines.map((line) => line.length), 1);
  const base = landscape ? 78 : 86;
  const fontSize = Math.max(42, Math.min(base, Math.floor((landscape ? 760 : 860) / Math.max(8, longest)) * 2.05));
  return { lines, fontSize, lineHeight: Math.round(fontSize * 1.03) };
}

function buildPremiumVisualSvg(campaign = {}, platform, { heroDataUri = "" } = {}) {
  const spec = campaign.outputs?.[platform];
  if (!spec) throw new Error(`Unknown premium visual platform: ${platform}`);
  const { width, height, safe } = spec;
  const landscape = width / height > 1.2;
  const type = typographyFor(spec, campaign.headline);
  const contentWidth = width - safe.left - safe.right;
  const headlineY = landscape ? Math.round(height * 0.49) : Math.round(height * 0.56);
  const lineMarkup = type.lines.map((line, index) =>
    `<tspan x="${safe.left}" dy="${index === 0 ? 0 : type.lineHeight}">${escapeXml(line)}</tspan>`,
  ).join("");
  const sourceY = Math.min(height - safe.bottom + 86, headlineY + type.lines.length * type.lineHeight + 58);
  const brandY = height - Math.max(42, Math.round(safe.bottom * 0.22));
  const accent = campaign.identity.accent;
  const accent2 = campaign.identity.accent2;
  const showStoryPrompt = platform === "instagram_story";
  const promptLines = splitHeadline(campaign.story_prompt, 27, 2);
  const promptY = Math.min(brandY - 190, sourceY + 175);
  const promptMarkup = showStoryPrompt ? `<g data-role="story-question" transform="translate(${safe.left},${promptY})">
    <text x="0" y="0" font-family="Arial,Inter,sans-serif" font-size="16" font-weight="800" fill="${accent2}" letter-spacing="3">THE QUESTION</text>
    <text x="0" y="44" font-family="Arial,Inter,sans-serif" font-size="30" font-weight="900" fill="#F7F9FC" letter-spacing="0">${promptLines.map((line, index) => `<tspan x="0" dy="${index === 0 ? 0 : 36}">${escapeXml(line)}</tspan>`).join("")}</text>
  </g>` : "";
  const imageHref = heroDataUri || "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-platform="${platform}" data-safe-zone="${safe.top},${safe.right},${safe.bottom},${safe.left}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03060A" stop-opacity="0.04"/><stop offset="0.48" stop-color="#03060A" stop-opacity="0.26"/><stop offset="1" stop-color="#03060A" stop-opacity="0.96"/></linearGradient>
    <linearGradient id="side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#03060A" stop-opacity="0.84"/><stop offset="0.62" stop-color="#03060A" stop-opacity="0.1"/></linearGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity="0.75"/></filter>
    <pattern id="grain" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1" cy="2" r="0.6" fill="#fff" opacity="0.06"/><circle cx="5" cy="6" r="0.45" fill="#fff" opacity="0.04"/></pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="#070A0F"/>
  <image data-role="full-bleed-hero" href="${imageHref}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${width}" height="${height}" fill="url(#scrim)"/>
  <rect width="${Math.round(width * 0.72)}" height="${height}" fill="url(#side)"/>
  <rect width="${width}" height="${height}" fill="url(#grain)"/>
  <g data-role="pulse-signal-identity">
    <rect x="${safe.left}" y="${safe.top}" width="8" height="70" fill="${accent}"/>
    <path d="M ${safe.left + 24} ${safe.top + 54} h 34 l 11 -18 l 15 32 l 15 -44 l 13 30 h ${Math.max(170, Math.round(contentWidth * 0.33))}" fill="none" stroke="${accent2}" stroke-width="4"/>
    <text x="${safe.left + 24}" y="${safe.top + 22}" font-family="Arial,Inter,sans-serif" font-size="${landscape ? 18 : 22}" font-weight="800" fill="#F4F7FA" letter-spacing="3">${escapeXml(campaign.identity.label)}</text>
    <text x="${safe.left + 24}" y="${safe.top + 84}" font-family="Arial,Inter,sans-serif" font-size="${landscape ? 14 : 17}" font-weight="700" fill="${accent2}" letter-spacing="2">${escapeXml(campaign.identity.signal)}</text>
  </g>
  <text data-role="campaign-headline" x="${safe.left}" y="${headlineY}" font-family="Arial Black,Arial,Inter,sans-serif" font-size="${type.fontSize}" font-weight="900" fill="#F7F9FC" filter="url(#shadow)" letter-spacing="0">${lineMarkup}</text>
  <g data-role="source-lock" transform="translate(${safe.left},${sourceY})">
    <rect width="52" height="4" fill="${accent}"/>
    <text x="0" y="34" font-family="Arial,Inter,sans-serif" font-size="${landscape ? 17 : 20}" font-weight="800" fill="#D8DEE8" letter-spacing="2">SOURCE  ${escapeXml(campaign.source_label || "VERIFIED SOURCE")}</text>
  </g>
  ${promptMarkup}
  <g data-role="brand-lockup">
    <text x="${safe.left}" y="${brandY}" font-family="Arial,Inter,sans-serif" font-size="${landscape ? 20 : 24}" font-weight="900" fill="#F7F9FC" letter-spacing="2">PULSE GAMING</text>
    <rect x="${safe.left}" y="${brandY + 12}" width="${landscape ? 154 : 184}" height="4" fill="${accent}"/>
    <text x="${width - safe.right}" y="${brandY}" text-anchor="end" font-family="Arial,Inter,sans-serif" font-size="${landscape ? 12 : 14}" font-weight="700" fill="#AAB3C2" letter-spacing="2">${escapeXml(campaign.brand_signal)}</text>
  </g>
</svg>`;
}

function buildStoryMotionComposition(campaign = {}, { heroAssetName = "hero.jpg" } = {}) {
  const id = `premium-story-${safeStem(campaign.story_id)}`;
  const type = typographyFor(PLATFORM_VISUAL_SPECS.instagram_story, campaign.headline);
  const headline = type.lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080,height=1920"><title>${escapeHtml(campaign.title)}</title><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><style>
*{box-sizing:border-box}body{margin:0;background:#05070a;color:#f7f9fc;font-family:Arial,Inter,sans-serif}#root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#05070a}.clip{position:absolute;inset:0}.hero{position:absolute;inset:-70px;width:1220px;height:2060px;object-fit:cover}.scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,6,10,.08) 0%,rgba(3,6,10,.28) 43%,rgba(3,6,10,.96) 100%)}.signal{position:absolute;left:72px;top:250px;width:620px;border-left:8px solid ${campaign.identity.accent};padding:18px 24px 20px;background:rgba(3,6,10,.76)}.kicker{font-size:24px;font-weight:900;letter-spacing:4px}.rail{margin-top:22px;width:440px;height:4px;background:${campaign.identity.accent2};transform-origin:left}.headline{position:absolute;left:72px;right:72px;top:840px;font-size:${type.fontSize}px;line-height:1.16;font-weight:900;text-shadow:0 10px 26px #000}.headline span{display:block;min-height:1.16em}.source{position:absolute;left:72px;top:1285px;font-size:22px;font-weight:800;letter-spacing:3px;color:#d8dee8}.source:before{content:"";display:block;width:52px;height:5px;margin-bottom:22px;background:${campaign.identity.accent}}.question{position:absolute;left:72px;right:72px;top:1435px}.question small{display:block;color:${campaign.identity.accent2};font-size:16px;font-weight:900;letter-spacing:3px;margin-bottom:16px}.question strong{display:block;font-size:30px;line-height:1.15}.brand{position:absolute;left:72px;right:72px;bottom:290px;display:flex;justify-content:space-between;align-items:end;font-weight:900;letter-spacing:3px}.brand b{color:${campaign.identity.accent}}.brand small{color:#aab3c2;font-size:14px}.sweep{position:absolute;left:-20%;top:0;width:12%;height:100%;background:rgba(255,255,255,.12);transform:skewX(-12deg);filter:blur(18px)}
</style></head><body><div id="root" data-composition-id="${id}" data-start="0" data-width="1080" data-height="1920" data-duration="6"><section id="premium-story-scene" class="clip" data-start="0" data-duration="6" data-track-index="1"><img id="hero" class="hero" src="assets/${escapeHtml(heroAssetName)}"><div class="scrim"></div><div id="sweep" class="sweep"></div><div id="signal" class="signal"><div class="kicker">${escapeHtml(campaign.identity.label)}</div><div id="rail" class="rail"></div></div><div id="headline" class="headline">${headline}</div><div id="source" class="source">SOURCE&nbsp;&nbsp;${escapeHtml(campaign.source_label || "VERIFIED SOURCE")}</div><div id="question" class="question"><small>THE QUESTION</small><strong>${escapeHtml(campaign.story_prompt)}</strong></div><div id="brand" class="brand"><div>PULSE <b>GAMING</b></div><small>${escapeHtml(campaign.brand_signal)}</small></div></section></div><script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({ paused: true });tl.fromTo("#hero",{ scale: 1.08, x: -22, y: -12 },{ scale: 1.02, x: 12, y: 8, duration: 6, ease: "none" },0).from("#signal",{x:-34,opacity:0,duration:.55,ease:"power3.out"},.15).from("#rail",{scaleX:0,duration:.7,ease:"power3.out"},.25).from("#headline span",{y:62,opacity:0,duration:.62,stagger:.12,ease:"power4.out"},.62).from("#source",{y:18,opacity:0,duration:.45,ease:"power2.out"},1.15).from("#question",{y:20,opacity:0,duration:.5,ease:"power3.out"},2.25).from("#brand",{opacity:0,duration:.4},1.4).to("#sweep",{x:1450,duration:1.2,ease:"power2.inOut"},.85);window.__timelines["${id}"]=tl;tl.seek(0);
</script></body></html>`;
}

async function materializePremiumVisualCampaign({
  campaignInput = {},
  heroImagePath,
  heroImageBuffer,
  heroImageExtension = ".jpg",
  outputDir,
  recentCampaigns = [],
} = {}) {
  if (!outputDir) throw new Error("materializePremiumVisualCampaign requires outputDir");
  const heroAbsolute = heroImagePath ? path.resolve(heroImagePath) : "";
  const heroPathPresent = Boolean(heroImagePath && await fs.pathExists(heroAbsolute));
  const suppliedHeroBuffer = Buffer.isBuffer(heroImageBuffer) ? heroImageBuffer : null;
  const heroImagePresent = heroPathPresent || Boolean(suppliedHeroBuffer?.length);
  const campaign = buildPremiumVisualCampaignSpec(campaignInput);
  const report = validatePremiumVisualCampaign(campaign, { heroImagePresent, recentCampaigns });
  if (report.verdict === "red") {
    const error = new Error(`Premium visual campaign blocked: ${report.blockers.join(", ")}`);
    error.report = report;
    throw error;
  }
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const heroBuffer = suppliedHeroBuffer || await fs.readFile(heroAbsolute);
  const sharp = require("sharp");
  let ext = (heroPathPresent ? path.extname(heroAbsolute) : heroImageExtension).toLowerCase() || ".jpg";
  if (suppliedHeroBuffer) {
    const metadata = await sharp(heroBuffer).metadata();
    ext = metadata.format === "png" ? ".png" : metadata.format === "webp" ? ".webp" : ".jpg";
  }
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  const heroDataUri = `data:${mime};base64,${heroBuffer.toString("base64")}`;
  const outputs = {};
  for (const [platform, spec] of Object.entries(campaign.outputs)) {
    const svg = buildPremiumVisualSvg(campaign, platform, { heroDataUri });
    const svgPath = path.join(outDir, spec.static_filename.replace(/\.png$/i, ".svg"));
    const pngPath = path.join(outDir, spec.static_filename);
    await fs.writeFile(svgPath, svg, "utf8");
    await sharp(Buffer.from(svg)).png({ quality: 96, compressionLevel: 8 }).toFile(pngPath);
    outputs[platform] = { ...spec, static_path: pngPath, svg_path: svgPath };
  }
  const motionDir = path.join(outDir, "instagram_story_motion");
  await fs.ensureDir(path.join(motionDir, "assets"));
  const motionHeroPath = path.join(motionDir, "assets", `hero${ext || ".jpg"}`);
  if (heroPathPresent) await fs.copy(heroAbsolute, motionHeroPath);
  else await fs.writeFile(motionHeroPath, heroBuffer);
  await fs.writeJson(path.join(motionDir, "hyperframes.json"), {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
  }, { spaces: 2 });
  const motionHtml = buildStoryMotionComposition(campaign, { heroAssetName: `hero${ext || ".jpg"}` });
  const motionProjectPath = path.join(motionDir, "index.html");
  await fs.writeFile(motionProjectPath, motionHtml, "utf8");
  const manifest = {
    ...campaign,
    generated_at: new Date().toISOString(),
    mode: "LOCAL_PROOF_PREMIUM_VISUAL_CAMPAIGN",
    verdict: report.verdict,
    outputs,
    animated_story: { project_path: motionProjectPath, duration_seconds: 6, render_required: true },
    provenance: {
      hero_image_path: heroAbsolute || null,
      hero_sha256: hash(heroBuffer),
      hero_source: heroPathPresent ? "local_safe_asset_path" : "caller_supplied_safe_asset_buffer",
      derived_asset_only: true,
    },
    safety: { no_publish_triggered: true, no_network_uploads: true, no_db_mutation: true, no_oauth_or_token_change: true },
  };
  const manifestPath = path.join(outDir, "premium_visual_campaign_manifest.json");
  const scorecardPath = path.join(outDir, "premium_visual_campaign_scorecard.json");
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });
  await fs.writeJson(scorecardPath, report, { spaces: 2 });
  return { campaign, report, outputs, manifestPath, scorecardPath, motionProjectPath };
}

module.exports = {
  CONTENT_IDENTITIES,
  PLATFORM_VISUAL_SPECS,
  buildPremiumVisualCampaignSpec,
  buildPremiumVisualSvg,
  buildStoryMotionComposition,
  materializePremiumVisualCampaign,
  normaliseIdentity,
  validatePremiumVisualCampaign,
};
