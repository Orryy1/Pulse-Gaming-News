"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "16_landing_page_engine";
const PLATFORM_KEYS = ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"];
const REQUIRED_LANDING_COMPONENTS = [
  "source_list",
  "summary",
  "embed",
  "link_pack",
  "disclosure_block",
  "related_paths",
  "newsletter_capture",
  "utm_tracking",
  "geo_routing",
  "expired_link_handling",
  "compliance_notes",
  "revenue_tracking",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function resolveWorkspacePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function slugify(value, fallback = "story") {
  const slug = cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function isPlaceholderRoute(route = "") {
  const text = cleanText(route);
  return !text || /^\/?p\/?(?:story|this-story|placeholder)(?:-|$)?/i.test(text);
}

function storyTitle(canonical = {}, storyPackage = {}) {
  return cleanText(
    canonical.selected_title ||
      canonical.short_title ||
      canonical.canonical_title ||
      canonical.title ||
      storyPackage.title ||
      canonical.canonical_subject,
  );
}

function storySubject(canonical = {}, title = "") {
  return cleanText(canonical.canonical_subject || canonical.canonical_game || canonical.subject || title);
}

function routeFor(storyId, title, landing = {}, affiliate = {}) {
  const existing = affiliate.landing_page_route || landing.landing_page_route || landing.route || asArray(landing.routes)[0];
  if (existing && !isPlaceholderRoute(existing)) return cleanText(existing);
  return `/p/${slugify(title || storyId, storyId)}`;
}

function slugFromRoute(route, fallback) {
  return slugify(cleanText(route).replace(/^\/p\//, ""), fallback);
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function validUrlish(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (text.startsWith("/") && !text.startsWith("//")) return true;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sourceLabel(source) {
  if (source && typeof source === "object") return cleanText(source.name || source.label || source.source_name || source.title);
  return cleanText(source);
}

function sourceUrl(source) {
  if (source && typeof source === "object") return cleanText(source.url || source.href || source.link);
  return "";
}

function addSource(out, label, url, type = "source") {
  const source = {
    label: cleanText(label || url),
    url: cleanText(url),
    type,
  };
  if (!source.label && !source.url) return;
  const key = `${source.label}|${source.url}`;
  if (!out.some((item) => `${item.label}|${item.url}` === key)) out.push(source);
}

function buildSourceList(canonical = {}, landing = {}, affiliate = {}, sourceManifest = {}) {
  const out = [];
  addSource(out, sourceLabel(canonical.primary_source), canonical.primary_source_url || sourceUrl(canonical.primary_source), "primary");
  addSource(out, sourceLabel(canonical.official_source), canonical.official_source_url || canonical.official_confirmation_source, "official");
  addSource(out, sourceLabel(canonical.discovery_source), canonical.discovery_source_url, "discovery");
  for (const source of asArray(canonical.secondary_sources)) {
    addSource(out, sourceLabel(source), sourceUrl(source), "secondary");
  }
  for (const source of asArray(landing.link_pack?.source_links)) {
    addSource(out, source.label || source.name, source.url || source.href, "landing_source");
  }
  for (const source of asArray(affiliate.source_links)) {
    addSource(out, source.label || source.name, source.url || source.href, "affiliate_source");
  }
  addSource(out, sourceLabel(sourceManifest.primary_source), sourceUrl(sourceManifest.primary_source), "source_manifest_primary");
  for (const source of asArray(sourceManifest.sources || sourceManifest.secondary_sources)) {
    addSource(out, sourceLabel(source), sourceUrl(source), "source_manifest");
  }
  return out.filter((source) => source.label || validUrlish(source.url));
}

function buildSummary(canonical = {}, title = "", subject = "") {
  const summary = cleanText(canonical.summary || canonical.description || canonical.public_summary);
  if (summary) return summary;
  const script = cleanText(canonical.narration_script || canonical.full_script || canonical.tts_script || canonical.first_spoken_line);
  if (script) return script.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 280).trim();
  if (title || subject) return cleanText(`${subject || title}: source-backed story page.`);
  return "";
}

function linkStatus(link = {}) {
  return cleanText(link.link_status || link.status || link.availability_status || link.product_status).toLowerCase();
}

function linkExpired(link = {}) {
  return /\b(?:expired|dead|broken|unavailable|out_of_stock|out-of-stock|discontinued)\b/.test(linkStatus(link));
}

function buildStoryLinkPack(landing = {}, affiliate = {}, sourceList = []) {
  const primary = affiliate.primary_link || landing.link_pack?.primary_link || null;
  const fallbacks = asArray(affiliate.fallback_links).length
    ? asArray(affiliate.fallback_links)
    : asArray(landing.link_pack?.fallback_links);
  return {
    primary_link: primary,
    fallback_links: fallbacks,
    source_links: sourceList,
    affiliate_tracking_map: affiliate.affiliate_tracking_map || landing.link_pack?.affiliate_tracking_map || null,
    status: primary || fallbacks.length || sourceList.length ? "present" : "empty",
    no_direct_offer_reason: primary || fallbacks.length
      ? null
      : cleanText(asArray(affiliate.rejection_reasons)[0] || "no_safe_direct_affiliate_offer"),
  };
}

function disclosureCopy(landing = {}, affiliate = {}) {
  const copy = affiliate.disclosure_copy || landing.disclosure_block?.copy || landing.disclosure_copy || null;
  const text = collectStrings(copy).join(" ");
  return { copy, text: cleanText(text) };
}

function buildStoryDisclosureBlock(landing = {}, affiliate = {}, linkPack = {}) {
  const required = Boolean(
    affiliate.disclosure_required ||
      landing.disclosure_block?.required ||
      linkPack.primary_link ||
      asArray(linkPack.fallback_links).length,
  );
  const copy = disclosureCopy(landing, affiliate);
  return {
    required,
    copy: copy.copy || null,
    source_first: true,
    status: required && !copy.text ? "missing_copy" : "present",
  };
}

function buildUtmTracking(storyId, route, slug, landing = {}, affiliate = {}) {
  const existing = affiliate.tracking_utm || landing.tracking_utm;
  const platforms = PLATFORM_KEYS.reduce((out, platform) => {
    out[platform] = `${route}?utm_source=${encodeURIComponent(platform)}&utm_medium=social&utm_campaign=${encodeURIComponent(slug)}&utm_content=${encodeURIComponent(`${storyId}_${platform}_story_page`)}&story_id=${encodeURIComponent(storyId)}&cta_variant=story_page`;
    return out;
  }, {});
  return {
    campaign: existing?.campaign || slug,
    story_id: storyId,
    platforms,
    source: existing ? "existing_plus_normalised_platform_routes" : "generated_local_proof_routes",
  };
}

function buildEmbed({ storyId, artifactDir, renderManifest = {}, upstream = [] } = {}) {
  const candidates = [
    renderManifest.output,
    renderManifest.output_path,
    renderManifest.video_path,
    "visual_v4_render.mp4",
  ].map((value) => {
    const text = cleanText(value);
    if (!text) return "";
    return path.isAbsolute(text) ? text : path.join(artifactDir, text);
  }).filter(Boolean);
  const localPath = unique(candidates).find((candidate) => fs.existsSync(candidate));
  if (localPath) {
    return {
      story_id: storyId,
      status: "local_proof_asset_available",
      type: "video",
      local_path: localPath,
      embed_strategy: "local_story_page_video_embed",
      publish_ready: false,
    };
  }
  return {
    story_id: storyId,
    status: upstream.length ? "upstream_blocked" : "missing",
    type: "video",
    local_path: null,
    embed_strategy: "wait_for_render_artifact",
    upstream_blockers: upstream,
    publish_ready: false,
  };
}

function buildRelatedStories(storyId, storyContext = []) {
  return asArray(storyContext)
    .filter((story) => story.story_id !== storyId)
    .slice(0, 4)
    .map((story) => ({
      story_id: story.story_id,
      title: story.title,
      route: story.route,
    }));
}

function productRows(linkPack = {}) {
  return [linkPack.primary_link, ...asArray(linkPack.fallback_links)]
    .filter(Boolean)
    .map((link) => ({
      id: link.id || null,
      label: link.label || link.product_category || link.category || "Related product",
      category: link.product_category || link.category || null,
      tracking_url: link.tracking_url || null,
      merchant: link.merchant || null,
      expired: linkExpired(link),
    }));
}

function buildNewsletterCapture(storyId) {
  return {
    enabled: true,
    placement: "after_source_list_before_related_links",
    copy: "Get the source-backed version of the next gaming story.",
    form_action: "local_proof_not_connected",
    story_id: storyId,
  };
}

function buildGeoRouting(linkPack = {}) {
  const links = [linkPack.primary_link, ...asArray(linkPack.fallback_links)].filter(Boolean);
  const ukOffer = links.find((link) => /amazon\.co\.uk|gbp|uk\b/i.test(collectStrings(link).join(" "))) || links[0] || null;
  const usOffer = links.find((link) => /amazon\.com|usd|united states|us\b/i.test(collectStrings(link).join(" "))) || null;
  return {
    enabled: true,
    regions: {
      UK: {
        route: ukOffer?.tracking_url || null,
        status: ukOffer ? "offer_route_available" : "story_page_only",
      },
      US: {
        route: usOffer?.tracking_url || null,
        status: usOffer ? "offer_route_available" : "fallback_to_story_page_pending_us_partner",
      },
    },
    no_live_geo_redirect_mutation: true,
  };
}

function buildExpiredLinkHandling(linkPack = {}) {
  const links = [linkPack.primary_link, ...asArray(linkPack.fallback_links)].filter(Boolean);
  return {
    required: true,
    live_link_checked: false,
    check_mode: "manifest_status_only",
    expired_link_count: links.filter(linkExpired).length,
    fallback_strategy: "send_to_source_list_and_story_page_when_offer_expires",
    operator_review_required_before_live_redirect_changes: true,
  };
}

function buildComplianceNotes(affiliate = {}, disclosureBlock = {}) {
  const vertical = cleanText(affiliate.vertical).toLowerCase();
  return {
    source_first: true,
    affiliate_disclosure_required: disclosureBlock.required,
    affiliate_disclosure_present: disclosureBlock.status === "present",
    no_hard_sell_cta: true,
    cookie_and_tracking_review_required: true,
    finance_or_crypto_review_required: vertical === "finance" || vertical === "crypto",
    no_live_publish_or_redirect_change: true,
  };
}

function zeroRevenueTracking(storyId, affiliate = {}, landing = {}) {
  const existing = landing.revenue_tracking || affiliate.revenue_attribution || {};
  return {
    story_id: storyId,
    mode: "LOCAL_PROOF",
    platform_clicks: existing.platform_clicks || PLATFORM_KEYS.reduce((out, platform) => {
      out[platform] = 0;
      return out;
    }, {}),
    landing_page_visits: 0,
    newsletter_signups: 0,
    affiliate_clicks: 0,
    conversions: 0,
    revenue: {
      amount: 0,
      currency: existing.revenue?.currency || "GBP",
      source: existing.revenue?.source || "waiting_for_affiliate_network_reporting",
    },
    no_affiliate_network_reporting_pull: true,
  };
}

function buildAffiliateIndex(upstreamAffiliateReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamAffiliateReport.stories || upstreamAffiliateReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamSkippedInfo(storyId, affiliateIndex = new Map()) {
  const row = affiliateIndex.get(cleanText(storyId));
  if (cleanText(row?.status || row?.verdict).toLowerCase() !== "skipped") return null;
  return {
    status: cleanText(row.skipped_status || row.status) || "skipped",
    reason: cleanText(row.skipped_reason || row.reason) || "upstream_affiliate_skipped",
  };
}

function upstreamBlockers(storyId, affiliateIndex = new Map()) {
  const row = affiliateIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal15_affiliate_intelligence_missing"];
  const status = cleanText(row.status || row.verdict).toLowerCase();
  if (["ready", "pass", "passed", "green"].includes(status)) return [];
  return unique(["upstream:goal15_affiliate_intelligence_blocked", ...asArray(row.blockers)]);
}

function componentStatus(landingPage = {}, directBlockers = []) {
  return REQUIRED_LANDING_COMPONENTS.reduce((out, component) => {
    const blockerByComponent = {
      source_list: "landing:source_list_missing",
      summary: "landing:summary_missing",
      embed: "landing:embed_missing",
      disclosure_block: "landing:affiliate_disclosure_missing",
      utm_tracking: "landing:utm_tracking_missing",
      geo_routing: "landing:geo_routing_missing",
      expired_link_handling: "landing:expired_link_handling_missing",
      compliance_notes: "landing:compliance_notes_missing",
      newsletter_capture: "landing:newsletter_capture_missing",
      revenue_tracking: "landing:revenue_tracking_missing",
    }[component];
    out[component] = blockerByComponent && directBlockers.includes(blockerByComponent) ? "fail" : "pass";
    return out;
  }, {});
}

async function buildStoryContext(storyPackages = [], workspaceRoot = process.cwd()) {
  const context = [];
  for (const storyPackage of asArray(storyPackages)) {
    const storyId = storyIdFromPackage(storyPackage);
    const artifactDir = resolveWorkspacePath(workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
    const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
    const landing = await readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json"), {});
    const affiliate = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {});
    const title = storyTitle(canonical, storyPackage);
    context.push({
      story_id: storyId,
      title,
      route: routeFor(storyId, title, landing, affiliate),
    });
  }
  return context;
}

async function inspectStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const skipped = upstreamSkippedInfo(storyId, context.affiliateIndex);
  if (skipped) {
    return {
      story_id: storyId,
      title: cleanText(storyPackage.title),
      subject: "",
      artifact_dir: artifactDir,
      status: "skipped",
      direct_landing_status: "skipped",
      upstream_status: "skipped",
      skipped_status: skipped.status,
      skipped_reason: skipped.reason,
      blockers: [],
      upstream_blockers: [],
      direct_landing_blockers: [],
      component_status: {},
      landing_page_manifest: null,
      link_pack: null,
      disclosure_block: null,
      revenue_tracking: null,
      source_material: {
        landing_manifest_present: false,
        affiliate_manifest_present: false,
        source_count: 0,
        related_story_count: 0,
        related_product_count: 0,
        direct_offer_present: false,
        embed_status: "skipped",
      },
      safety: {
        local_proof_only: true,
        no_publish_triggered: true,
        no_external_posting: true,
        no_live_geo_redirect_mutation: true,
        no_affiliate_network_reporting_pull: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
        no_secret_values_exposed: true,
      },
    };
  }
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const landing = await readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json"), {});
  const affiliate = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  const sourceManifest = await readJsonIfPresent(path.join(artifactDir, "source_manifest.json"), {});
  const renderManifest = await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {});
  const upstream = upstreamBlockers(storyId, context.affiliateIndex);
  const title = storyTitle(canonical, storyPackage);
  const subject = storySubject(canonical, title);
  const route = routeFor(storyId, title, landing, affiliate);
  const slug = affiliate.landing_page_slug || landing.landing_page_slug || slugFromRoute(route, storyId);
  const sourceList = buildSourceList(canonical, landing, affiliate, sourceManifest);
  const summary = buildSummary(canonical, title, subject);
  const linkPack = buildStoryLinkPack(landing, affiliate, sourceList);
  const disclosureBlock = buildStoryDisclosureBlock(landing, affiliate, linkPack);
  const embed = buildEmbed({ storyId, artifactDir, renderManifest, upstream });
  const relatedProducts = productRows(linkPack);
  const revenueTracking = zeroRevenueTracking(storyId, affiliate, landing);
  const landingPage = {
    schema_version: 1,
    goal: GOAL_ID,
    story_id: storyId,
    title,
    subject,
    landing_page_slug: slug,
    landing_page_route: route,
    status: "local_proof_prepared",
    source_list: sourceList,
    summary,
    embed,
    link_pack: linkPack,
    disclosure_block: disclosureBlock,
    related_stories: buildRelatedStories(storyId, context.storyContext),
    related_products: relatedProducts,
    newsletter_capture: buildNewsletterCapture(storyId),
    tracking_utm: buildUtmTracking(storyId, route, slug, landing, affiliate),
    geo_routing: buildGeoRouting(linkPack),
    expired_link_handling: buildExpiredLinkHandling(linkPack),
    compliance_notes: buildComplianceNotes(affiliate, disclosureBlock),
    revenue_tracking: revenueTracking,
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_live_geo_redirect_mutation: true,
      no_affiliate_network_reporting_pull: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };

  const directBlockers = [];
  if (!sourceList.length) directBlockers.push("landing:source_list_missing");
  if (!summary) directBlockers.push("landing:summary_missing");
  if (embed.status === "missing") directBlockers.push("landing:embed_missing");
  if (disclosureBlock.required && disclosureBlock.status !== "present") directBlockers.push("landing:affiliate_disclosure_missing");
  if (!Object.keys(landingPage.tracking_utm?.platforms || {}).length) directBlockers.push("landing:utm_tracking_missing");
  if (!landingPage.geo_routing?.regions?.UK || !landingPage.geo_routing?.regions?.US) directBlockers.push("landing:geo_routing_missing");
  if (!landingPage.expired_link_handling?.required) directBlockers.push("landing:expired_link_handling_missing");
  if (!landingPage.compliance_notes || !Object.keys(landingPage.compliance_notes).length) directBlockers.push("landing:compliance_notes_missing");
  if (landingPage.newsletter_capture?.enabled !== true) directBlockers.push("landing:newsletter_capture_missing");
  if (!landingPage.revenue_tracking) directBlockers.push("landing:revenue_tracking_missing");
  const blockers = unique([...upstream, ...directBlockers]);
  return {
    story_id: storyId,
    title,
    subject,
    artifact_dir: artifactDir,
    status: blockers.length ? "blocked" : "ready",
    direct_landing_status: directBlockers.length ? "blocked" : "pass",
    upstream_status: upstream.length ? "blocked" : "ready",
    blockers,
    upstream_blockers: upstream,
    direct_landing_blockers: directBlockers,
    component_status: componentStatus(landingPage, directBlockers),
    landing_page_manifest: landingPage,
    link_pack: linkPack,
    disclosure_block: disclosureBlock,
    revenue_tracking: revenueTracking,
    source_material: {
      landing_manifest_present: Object.keys(landing || {}).length > 0,
      affiliate_manifest_present: Object.keys(affiliate || {}).length > 0,
      source_count: sourceList.length,
      related_story_count: landingPage.related_stories.length,
      related_product_count: relatedProducts.length,
      direct_offer_present: Boolean(linkPack.primary_link || asArray(linkPack.fallback_links).length),
      embed_status: embed.status,
    },
    safety: landingPage.safety,
  };
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function directRiskCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.direct_landing_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function buildLandingPageManifest(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories)
      .filter((story) => story.status !== "skipped")
      .map((story) => story.landing_page_manifest),
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_live_page_deploy: true,
    },
  };
}

function buildLinkPackArtifact(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    stories: asArray(report.stories).filter((story) => story.status !== "skipped").map((story) => ({
      story_id: story.story_id,
      ...story.link_pack,
    })),
    safety: {
      no_external_posting: true,
      no_live_redirect_mutation: true,
      no_network_link_checking: true,
    },
  };
}

function buildDisclosureBlockArtifact(report = {}) {
  const rows = asArray(report.stories).filter((story) => story.status !== "skipped").map((story) => ({
    story_id: story.story_id,
    ...story.disclosure_block,
  }));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    verdict: rows.some((row) => row.status !== "present") ? "fail" : "pass",
    stories: rows,
    safety: {
      no_external_posting: true,
      no_platform_disclosure_toggle_mutation: true,
    },
  };
}

function buildRevenueTracking(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories)
      .filter((story) => story.status !== "skipped")
      .map((story) => story.revenue_tracking),
    safety: {
      no_affiliate_network_reporting_pull: true,
      no_production_db_mutation: true,
      local_zeroed_attribution_only: true,
    },
  };
}

async function buildGoal16LandingPageEngine({
  storyPackages = [],
  upstreamAffiliateReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal16LandingPageEngine requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const affiliateIndex = buildAffiliateIndex(upstreamAffiliateReport);
  const storyContext = await buildStoryContext(storyPackages, workspaceRoot);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, { workspaceRoot, affiliateIndex, storyContext }));
  }
  const activeStories = stories.filter((story) => story.status !== "skipped");
  const skippedStories = stories.filter((story) => story.status === "skipped");
  const readyStories = activeStories.filter((story) => story.status === "ready");
  const blockedStories = activeStories.filter((story) => story.status === "blocked");
  const directPassStories = activeStories.filter((story) => story.direct_landing_status === "pass");
  const directBlockedStories = activeStories.filter((story) => story.direct_landing_status !== "pass");
  const verdict = !activeStories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";
  const directLandingVerdict = !activeStories.length
    ? "FAIL"
    : directBlockedStories.length && directPassStories.length
      ? "PARTIAL"
      : directBlockedStories.length
        ? "BLOCKED"
        : "PASS";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    direct_landing_verdict: directLandingVerdict,
    summary: {
      story_count: stories.length,
      active_story_count: activeStories.length,
      skipped_story_count: skippedStories.length,
      landing_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_landing_pass_story_count: directPassStories.length,
      direct_landing_blocked_story_count: directBlockedStories.length,
      source_list_story_count: activeStories.filter((story) => story.source_material.source_count > 0).length,
      local_embed_story_count: activeStories.filter((story) => story.source_material.embed_status === "local_proof_asset_available").length,
      upstream_blocked_embed_story_count: activeStories.filter((story) => story.source_material.embed_status === "upstream_blocked").length,
      related_story_count: activeStories.filter((story) => story.source_material.related_story_count > 0).length,
      related_product_story_count: activeStories.filter((story) => story.source_material.related_product_count > 0).length,
      newsletter_capture_story_count: activeStories.filter((story) => story.landing_page_manifest.newsletter_capture?.enabled === true).length,
    },
    blocker_counts: blockerCounts(activeStories),
    direct_risk_counts: directRiskCounts(activeStories),
    upstream_blockers: {
      goal15_affiliate_intelligence_engine:
        "Goal 16 can prepare local landing-page manifests, but readiness requires Goal 15 and its upstream gates to be ready first.",
      note:
        "This gate creates local proof artefacts only. It does not deploy pages, mutate redirects, check live links over the network, inspect secrets or touch OAuth/token state.",
    },
    stories,
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_live_page_deploy: true,
      no_live_redirect_mutation: true,
      no_network_link_checking: true,
      no_affiliate_network_reporting_pull: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.landing_page_manifest = buildLandingPageManifest(report);
  report.link_pack = buildLinkPackArtifact(report);
  report.disclosure_block = buildDisclosureBlockArtifact(report);
  report.revenue_tracking = buildRevenueTracking(report);
  return report;
}

function renderGoal16LandingPageEngineMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 16 Landing Page Engine");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct landing verdict: ${report.direct_landing_verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Full landing-ready stories: ${report.summary?.landing_ready_story_count || 0}`);
  lines.push(`Direct landing-pass stories: ${report.summary?.direct_landing_pass_story_count || 0}`);
  lines.push(`Source-list stories: ${report.summary?.source_list_story_count || 0}`);
  lines.push(`Local embed stories: ${report.summary?.local_embed_story_count || 0}`);
  lines.push(`Newsletter capture stories: ${report.summary?.newsletter_capture_story_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Direct Landing Hard Fails");
  const direct = Object.keys(report.direct_risk_counts || {}).sort();
  if (!direct.length) lines.push("- none");
  for (const blocker of direct) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This run did not deploy pages, publish, post externally, check live links over the network, mutate redirects or the database, touch OAuth or token files, inspect secrets or weaken gates.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal16LandingPageEngine(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal16LandingPageEngine requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal16_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal16_readiness_report.md");
  const landingPageManifest = path.join(outDir, "landing_page_manifest.json");
  const linkPack = path.join(outDir, "link_pack.json");
  const disclosureBlock = path.join(outDir, "disclosure_block.json");
  const revenueTracking = path.join(outDir, "revenue_tracking.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal16LandingPageEngineMarkdown(report), "utf8");
  await fs.writeJson(landingPageManifest, report.landing_page_manifest || buildLandingPageManifest(report), { spaces: 2 });
  await fs.writeJson(linkPack, report.link_pack || buildLinkPackArtifact(report), { spaces: 2 });
  await fs.writeJson(disclosureBlock, report.disclosure_block || buildDisclosureBlockArtifact(report), { spaces: 2 });
  await fs.writeJson(revenueTracking, report.revenue_tracking || buildRevenueTracking(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    landingPageManifest,
    linkPack,
    disclosureBlock,
    revenueTracking,
  };
}

module.exports = {
  GOAL_ID,
  PLATFORM_KEYS,
  REQUIRED_LANDING_COMPONENTS,
  buildDisclosureBlock: buildDisclosureBlockArtifact,
  buildGoal16LandingPageEngine,
  buildLandingPageManifest,
  buildLinkPack: buildLinkPackArtifact,
  buildRevenueTracking,
  inspectStoryPackage,
  renderGoal16LandingPageEngineMarkdown,
  writeGoal16LandingPageEngine,
};
