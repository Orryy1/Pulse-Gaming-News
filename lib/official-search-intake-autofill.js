"use strict";

const { mediaSourceUrlKindFields } = require("./media-source-url-kind");

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return typeof value === "object" ? [value] : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalise(value) {
  return cleanText(value)
    .replace(/[™®©]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[™®©]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return normalise(value).replace(/\s+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

function tokens(value) {
  return normalise(value)
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

const GENERIC_ENTITY_RE = /^(?:this|that|the|a|an)\s+(?:game|title|one)\b|^(?:this\s+game|that\s+game|unknown|game|title)$/i;

function entityIsSafeForAutofill(entity = "") {
  const text = normalise(entity);
  if (!text || GENERIC_ENTITY_RE.test(text)) return false;
  return tokens(text).length > 0;
}

function orderedContains(haystack, needle) {
  const source = tokens(haystack);
  const wanted = tokens(needle);
  if (!source.length || !wanted.length) return false;
  let cursor = 0;
  for (const token of source) {
    if (token === wanted[cursor]) cursor += 1;
    if (cursor >= wanted.length) return true;
  }
  return false;
}

function matchScore(appName, entity) {
  const app = normalise(appName);
  const target = normalise(entity);
  if (!app || !target) return 0;
  if (app === target) return 1;
  if (app.startsWith(`${target} `)) return 0.96;
  if (orderedContains(app, target)) {
    const appTokens = tokens(app);
    const entityTokens = tokens(target);
    const coverage = entityTokens.length / Math.max(appTokens.length, entityTokens.length);
    return coverage >= 0.5 ? 0.9 : 0.78;
  }
  const appTokenSet = new Set(tokens(app));
  const entityTokens = tokens(target);
  const overlap = entityTokens.filter((token) => appTokenSet.has(token)).length;
  return entityTokens.length ? overlap / entityTokens.length : 0;
}

const DERIVATIVE_PRODUCT_TOKENS = new Set([
  "soundtrack",
  "ost",
  "points",
  "currency",
  "coins",
  "credits",
  "token",
  "tokens",
  "dlc",
  "addon",
  "add",
  "pack",
  "pass",
  "bundle",
]);

function hasDerivativeProductMismatch(appName = "", entity = "") {
  const appTokens = new Set(tokens(appName));
  const entityTokens = new Set(tokens(entity));
  if (!appTokens.size || !entityTokens.size) return false;
  for (const token of DERIVATIVE_PRODUCT_TOKENS) {
    if (appTokens.has(token) && !entityTokens.has(token)) return true;
  }
  if (appTokens.has("original") && appTokens.has("soundtrack") && !entityTokens.has("soundtrack")) return true;
  if (appTokens.has("season") && appTokens.has("pass") && !entityTokens.has("pass")) return true;
  return false;
}

function acceptedSourcesAllowSteam(entry = {}) {
  const text = [entry.query, ...asArray(entry.accepted_sources)].map(cleanText).join(" ");
  return /\b(?:steam|storefront|platform\s+store)\b/i.test(text);
}

function acceptedSourcesAllowOfficialSite(entry = {}) {
  const text = [entry.query, ...asArray(entry.accepted_sources)].map(cleanText).join(" ");
  return /\b(?:official\s+(?:game\s+site|site|media|publisher|publisher\s+channel)|publisher\s+channel|media\s+page)\b/i.test(text);
}

function steamApiSearchUrl(entity) {
  const term = encodeURIComponent(cleanText(entity));
  return `https://store.steampowered.com/api/storesearch/?term=${term}&l=english&cc=us`;
}

const OFFICIAL_MEDIA_PAGE_CATALOG = [
  {
    canonical_entity: "Grand Theft Auto VI",
    aliases: ["Grand Theft Auto VI", "Grand Theft Auto 6", "GTA VI", "GTA 6"],
    source_family: "rockstar_gta_vi_official_videos",
    source_type: "official_game_website_media_page",
    source_owner: "Rockstar Games official site",
    source_title: "Grand Theft Auto VI Videos",
    official_source_url: "https://www.rockstargames.com/VI/media/videos",
  },
];

function officialMediaCatalogMatch(entry = {}) {
  if (!acceptedSourcesAllowOfficialSite(entry)) return null;
  const entity = normalise(entry.entity);
  if (!entity || !entityIsSafeForAutofill(entry.entity)) return null;
  return (
    OFFICIAL_MEDIA_PAGE_CATALOG.find((candidate) =>
      asArray([candidate.canonical_entity, ...asArray(candidate.aliases)])
        .map(normalise)
        .filter(Boolean)
        .includes(entity),
    ) || null
  );
}

function intakeEntryFromOfficialMediaCatalog(searchEntry = {}, match = {}) {
  const entity = cleanText(searchEntry.entity || match.canonical_entity);
  const officialSourceUrl = cleanText(match.official_source_url);
  const sourceKind = mediaSourceUrlKindFields(officialSourceUrl);
  const evidenceOwner = cleanText(match.source_owner).replace(/\s+official\s+site$/i, "");
  return {
    story_id: cleanText(searchEntry.story_id),
    entity,
    source_family: cleanText(match.source_family),
    source_type: cleanText(match.source_type),
    source_owner: cleanText(match.source_owner),
    source_title: cleanText(match.source_title),
    official_source_url: officialSourceUrl,
    direct_media_url_if_available: "",
    approved_direct_media_url: "",
    local_operator_file_path: "",
    licence_evidence:
      "Official publisher media page; direct media must still be discovered, probed and segment-validated before render use.",
    permission_evidence:
      "Official publisher media page reference only; no video download requested by this autofill step.",
    licence_scope: "reference_validation_only_no_download",
    licence_expires_at: "",
    autonomous_use_approved: false,
    approval_notes: "autofilled_from_trusted_official_media_page_catalog",
    direct_media_url_notes:
      "Leave blank here; run official-direct-media-discovery to extract validation-eligible direct video URLs from the official media page.",
    evidence_of_officialness:
      `${evidenceOwner || cleanText(match.source_owner)} official media page for ${cleanText(match.canonical_entity)} matched ${entity}.`,
    entity_match_notes: `Autofill accepted only because trusted official media catalog entity "${cleanText(match.canonical_entity)}" matches "${entity}".`,
    downloads_allowed: false,
    source_url_kind: sourceKind.source_url_kind,
    segment_validation_eligible: sourceKind.segment_validation_eligible,
    candidate_generation_policy:
      "official_media_page_reference_only_direct_media_discovery_required",
    autofill_provider: "official_site_catalog",
    autofill_match_score: 1,
    acceptance_checks: [
      `Official media page must match ${entity}.`,
      "Run official direct-media discovery before any render-use claim.",
      "Segment validator must pass before the media can feed Visual V4 motion.",
    ],
    rejection_checks: [
      "wrong_official_media_page",
      "unofficial_reupload",
      "direct_media_field_contains_page_url",
      "downloads_requested",
    ],
  };
}

function hasStylisedTitleMarker(word = "") {
  const text = cleanText(word);
  if (!/[A-Za-z]/.test(text)) return false;
  return /^[-_()[\]{}]+[A-Za-z0-9][A-Za-z0-9\s.'’:]*[-_()[\]{}]+$/.test(text);
}

function hasDistinctiveGameTitleMarker(words = []) {
  return words.some(
    (word) =>
      /\d/.test(word) ||
      /^(?:ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(word) ||
      hasStylisedTitleMarker(word),
  );
}

function steamSearchEntities(entity = "") {
  const original = cleanText(entity);
  if (!original) return [];
  const words = original.split(/\s+/).filter(Boolean);
  const lower = words.map((word) => normalise(word));
  const candidates = [original];
  const add = (candidateWords) => {
    if (!candidateWords || candidateWords.length < 2) return;
    if (!hasDistinctiveGameTitleMarker(candidateWords)) return;
    const candidate = cleanText(candidateWords.join(" "));
    if (!candidate || normalise(candidate) === normalise(original)) return;
    candidates.push(candidate);
  };

  const trailingOfficialIndex = lower.findLastIndex((word) => word === "official");
  if (trailingOfficialIndex >= 2 && trailingOfficialIndex === words.length - 1) {
    add(words.slice(0, trailingOfficialIndex));
  }

  const characterIndex = lower.findIndex((word, index) => {
    if (word !== "character") return false;
    return lower.slice(index + 1).some((tail) => /^(?:gameplay|trailer|reveal|showcase)$/.test(tail));
  });
  if (characterIndex > 2) add(words.slice(0, characterIndex - 1));

  for (let i = words.length - 1; i >= 2; i--) {
    if (!hasDistinctiveGameTitleMarker(words.slice(0, i))) continue;
    add(words.slice(0, i));
  }

  return [...new Map(candidates.map((candidate) => [normalise(candidate), candidate])).values()].slice(0, 4);
}

async function defaultFetchJson(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json,*/*;q=0.5",
        "user-agent": "PulseGamingOfficialSourceAutofill/1.0 report-only",
      },
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, status: response.status, json: null, text };
    }
    try {
      return { ok: true, status: response.status, json: JSON.parse(text), text };
    } catch {
      return { ok: false, status: response.status, json: null, text, parse_error: true };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function steamResultsFromPayload(payload = {}) {
  return asArray(payload.items || payload.results || payload.apps);
}

function steamStoreUrlForResult(result = {}) {
  const appid = cleanText(result.id || result.appid || result.app_id);
  if (!appid || !/^\d+$/.test(appid)) return "";
  const nameSlug = encodeURIComponent(cleanText(result.name || result.title).replace(/\s+/g, "_"));
  return `https://store.steampowered.com/app/${appid}/${nameSlug}/`;
}

function bestSteamResult(results = [], entity = "", minimumScore = 0.9) {
  const ranked = steamResultsFromPayload({ items: results })
    .map((result) => ({
      result,
      appid: cleanText(result.id || result.appid || result.app_id),
      name: cleanText(result.name || result.title),
      score: matchScore(result.name || result.title, entity),
    }))
    .filter((row) => {
      if (!row.appid || !row.name || row.score < minimumScore) return false;
      if (hasDerivativeProductMismatch(row.name, entity)) return false;
      const entityTokenCount = tokens(entity).length;
      if (entityTokenCount < 2) return normalise(row.name) === normalise(entity);
      return true;
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return ranked[0] || null;
}

function intakeEntryFromSteamMatch(searchEntry = {}, match = {}) {
  const entity = cleanText(searchEntry.entity);
  const appName = cleanText(match.name);
  const storeUrl = steamStoreUrlForResult(match.result);
  const family = `steam_${match.appid}_${slug(appName || entity)}`;
  const sourceKind = mediaSourceUrlKindFields(storeUrl);
  return {
    story_id: cleanText(searchEntry.story_id),
    entity,
    source_family: family,
    source_type: "platform_storefront",
    source_owner: `Steam storefront for ${appName || entity}`,
    source_title: appName || entity,
    official_source_url: storeUrl,
    direct_media_url_if_available: "",
    approved_direct_media_url: "",
    local_operator_file_path: "",
    licence_evidence:
      "Official Steam storefront reference found by report-only exact/strong app-name match; direct media must still be discovered and validated.",
    permission_evidence: "Official Steam app page; no media download requested by this autofill step.",
    licence_scope: "reference_validation_only_no_download",
    licence_expires_at: "",
    autonomous_use_approved: false,
    approval_notes: "autofilled_from_official_search_template_exact_steam_match",
    direct_media_url_notes:
      "Leave blank here; run media:discover-direct-media to extract validation-eligible Steam trailer manifests from the official storefront page.",
    evidence_of_officialness:
      `Steam official app ${match.appid} matched ${entity} with score ${match.score.toFixed(2)}.`,
    entity_match_notes: `Autofill accepted only because Steam app title "${appName}" strongly matches "${entity}".`,
    downloads_allowed: false,
    source_url_kind: sourceKind.source_url_kind,
    segment_validation_eligible: sourceKind.segment_validation_eligible,
    candidate_generation_policy: "official_storefront_reference_only_not_render_candidate",
    autofill_provider: "steam_storesearch",
    autofill_match_score: Number(match.score.toFixed(2)),
    acceptance_checks: [
      `Steam app title must match ${entity}.`,
      "Run official direct-media discovery before any render-use claim.",
      "Segment validator must pass before the media can feed Visual V4 motion.",
    ],
    rejection_checks: [
      "wrong_steam_app",
      "unofficial_reupload",
      "direct_media_field_contains_page_url",
      "downloads_requested",
    ],
  };
}

async function autofillSteamEntry(entry = {}, options = {}) {
  if (!acceptedSourcesAllowSteam(entry)) {
    return {
      provider: "steam_storesearch",
      status: "skipped",
      reason: "steam_or_storefront_not_allowed_by_search_template",
      entry: null,
    };
  }
  const entity = cleanText(entry.entity);
  if (!entity) {
    return {
      provider: "steam_storesearch",
      status: "skipped",
      reason: "missing_entity",
      entry: null,
    };
  }
  if (!entityIsSafeForAutofill(entity)) {
    return {
      provider: "steam_storesearch",
      status: "skipped",
      reason: "generic_entity_not_safe_for_autofill",
      entry: null,
    };
  }
  const fetchJson = options.fetchJson || defaultFetchJson;
  let lastSearchUrl = steamApiSearchUrl(entity);
  let lastResultCount = 0;
  for (const searchEntity of steamSearchEntities(entity)) {
    const searchUrl = steamApiSearchUrl(searchEntity);
    lastSearchUrl = searchUrl;
    let fetched;
    try {
      fetched = await fetchJson(searchUrl, options);
    } catch (err) {
      return {
        provider: "steam_storesearch",
        status: "fetch_failed",
        reason: err?.name === "AbortError" ? "fetch_timeout" : cleanText(err.message || "fetch_failed"),
        search_url: searchUrl,
        entry: null,
      };
    }
    if (!fetched?.ok) {
      return {
        provider: "steam_storesearch",
        status: "fetch_failed",
        reason: `http_${fetched?.status || "unknown"}`,
        search_url: searchUrl,
        entry: null,
      };
    }
    const results = steamResultsFromPayload(fetched.json);
    lastResultCount = results.length;
    const match = bestSteamResult(results, searchEntity, options.minimumSteamScore || 0.9);
    if (match) {
      return {
        provider: "steam_storesearch",
        status: "accepted",
        reason: null,
        search_url: searchUrl,
        result_count: results.length,
        matched_app_id: match.appid,
        matched_app_name: match.name,
        match_score: Number(match.score.toFixed(2)),
        entry: intakeEntryFromSteamMatch(entry, match),
      };
    }
  }
  return {
    provider: "steam_storesearch",
    status: "no_confident_match",
    reason: "no_exact_or_strong_steam_app_match",
    search_url: lastSearchUrl,
    result_count: lastResultCount,
    entry: null,
  };
}

function dedupeEntries(entries = []) {
  const seen = new Set();
  const output = [];
  for (const entry of asArray(entries)) {
    const key = [
      cleanText(entry.story_id),
      cleanText(entry.source_family),
      cleanText(entry.official_source_url),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

async function buildOfficialSearchIntakeAutofillReport({
  entries = [],
  existingEntries = [],
  generatedAt = new Date().toISOString(),
  fetchJson = defaultFetchJson,
  timeoutMs = 10000,
  minimumSteamScore = 0.9,
} = {}) {
  const rows = [];
  for (const [index, rawEntry] of asArray(entries).entries()) {
    const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
    const officialMediaMatch = officialMediaCatalogMatch(entry);
    const officialMediaEntry = officialMediaMatch
      ? intakeEntryFromOfficialMediaCatalog(entry, officialMediaMatch)
      : null;
    const steam = officialMediaEntry
      ? {
          provider: "official_site_catalog",
          status: "accepted",
          reason: null,
          search_url: officialMediaEntry.official_source_url,
          result_count: 1,
          matched_app_id: null,
          matched_app_name: officialMediaEntry.source_title,
          match_score: 1,
          entry: officialMediaEntry,
        }
      : await autofillSteamEntry(entry, { fetchJson, timeoutMs, minimumSteamScore });
    rows.push({
      index,
      story_id: cleanText(entry.story_id),
      entity: cleanText(entry.entity),
      query: cleanText(entry.query),
      accepted_sources: asArray(entry.accepted_sources).map(cleanText).filter(Boolean),
      provider: steam.provider,
      status: steam.status,
      reason: steam.reason,
      search_url: steam.search_url || null,
      result_count: steam.result_count || 0,
      matched_app_id: steam.matched_app_id || null,
      matched_app_name: steam.matched_app_name || null,
      match_score: steam.match_score || null,
      output_entry: steam.entry,
    });
  }

  const autofilledEntries = rows
    .map((row) => row.output_entry)
    .filter((entry) => entry && typeof entry === "object");
  const outputEntries = dedupeEntries([...asArray(existingEntries), ...autofilledEntries]);

  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "official_search_intake_autofill",
    local_only: true,
    summary: {
      search_entries: asArray(entries).length,
      existing_entries: asArray(existingEntries).length,
      accepted: rows.filter((row) => row.status === "accepted").length,
      skipped: rows.filter((row) => row.status === "skipped").length,
      no_confident_match: rows.filter((row) => row.status === "no_confident_match").length,
      fetch_failed: rows.filter((row) => row.status === "fetch_failed").length,
      output_entries: outputEntries.length,
    },
    safety: {
      local_only: true,
      provider_scope: ["official_site_catalog", "steam_storesearch"],
      fetched_official_store_metadata_only: true,
      video_downloads_started: false,
      retained_video_files: false,
      browser_scraping_started: false,
      yt_dlp_started: false,
      oauth_triggered: false,
      production_db_mutated: false,
      railway_mutated: false,
      social_posting_triggered: false,
      render_readiness_claimed: false,
    },
    rows,
    output_template: {
      schema_version: 1,
      generated_at: generatedAt,
      entries: outputEntries,
    },
  };
}

function renderOfficialSearchIntakeAutofillMarkdown(report = {}) {
  const lines = [];
  lines.push("# Official Search Intake Autofill");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push(`Search entries: ${report.summary?.search_entries ?? 0}`);
  lines.push(`Accepted: ${report.summary?.accepted ?? 0}`);
  lines.push(`Output entries: ${report.summary?.output_entries ?? 0}`);
  lines.push("");
  lines.push("Safety: report-only official-site/Steam metadata lookup. No downloads, browser scraping, DB mutation, OAuth or posting.");
  lines.push("");
  lines.push("| story | entity | provider | status | match | reason |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const row of asArray(report.rows)) {
    lines.push(
      `| ${row.story_id || "unknown"} | ${row.entity || "unknown"} | ${row.provider || "unknown"} | ${
        row.status || "unknown"
      } | ${row.matched_app_name || "none"} | ${row.reason || "clear"} |`,
    );
  }
  if (!asArray(report.rows).length) lines.push("| none | none | none | none | none | none |");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildOfficialSearchIntakeAutofillReport,
  renderOfficialSearchIntakeAutofillMarkdown,
  matchScore,
  bestSteamResult,
  steamApiSearchUrl,
  steamSearchEntities,
  intakeEntryFromSteamMatch,
  intakeEntryFromOfficialMediaCatalog,
};
