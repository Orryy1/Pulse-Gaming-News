"use strict";

const { inferHeadlineGameCandidates } = require("../../game-title-inference");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function sceneType(scene = {}) {
  return String(scene.type || scene.sceneType || "").trim();
}

function isCardScene(scene = {}) {
  return /^card\./i.test(sceneType(scene));
}

function isOpenerScene(scene = {}) {
  return sceneType(scene) === "opener";
}

function sceneDuration(scene = {}) {
  const value = Number(scene.duration || scene.durationS || scene.duration_s);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function mergeWindows(windows = []) {
  const sorted = windows
    .filter((window) => Number(window.endS) - Number(window.startS) >= 0.8)
    .sort((a, b) => a.startS - b.startS);
  const merged = [];
  for (const window of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && window.startS <= previous.endS + 0.25) {
      previous.endS = Math.max(previous.endS, window.endS);
      previous.sceneIndexes.push(...window.sceneIndexes);
      continue;
    }
    merged.push({ ...window, sceneIndexes: [...(window.sceneIndexes || [])] });
  }
  return merged;
}

function buildOverlaySafeWindows(scenes = [], durationS = 60) {
  const safeDuration = Math.max(1, Number(durationS) || 60);
  const sourceScenes = asArray(scenes);
  if (!sourceScenes.length) {
    return [{ startS: 0.35, endS: Math.max(0.9, safeDuration - 0.35), sceneIndexes: [] }];
  }

  const windows = [];
  let cursor = 0;
  sourceScenes.forEach((scene, index) => {
    const duration = sceneDuration(scene);
    const start = cursor;
    const end = cursor + duration;
    cursor = end;
    if (duration <= 0 || isCardScene(scene)) return;

    // The opener already carries the hook and source badge. Let it breathe,
    // then start V3 overlays on the first clean motion beat after it.
    const startGuard = isOpenerScene(scene) ? 2.5 : 0.16;
    const safeStart = Math.min(end, start + startGuard);
    const safeEnd = Math.max(safeStart, end - 0.16);
    if (safeEnd - safeStart >= 0.8) {
      windows.push({
        startS: round(safeStart, 3),
        endS: round(safeEnd, 3),
        sceneIndexes: [index],
      });
    }
  });

  const merged = mergeWindows(windows);
  if (merged.length) return merged;
  return [{ startS: 0.35, endS: Math.max(0.9, safeDuration - 0.35), sceneIndexes: [] }];
}

function ffEscape(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/=/g, "\\=")
    .replace(/%/g, "\\%");
}

function cleanWord(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function fullText(story = {}) {
  return [
    story.title,
    story.hook,
    story.body,
    story.full_script,
    story.tts_script,
    story.top_comment,
  ]
    .filter(Boolean)
    .join(". ");
}

function hostSourceLabel(url) {
  try {
    const host = new URL(String(url || "")).hostname
      .replace(/^www\./i, "")
      .split(".")[0];
    return host || "";
  } catch {
    return "";
  }
}

function genericSourceLabel(label) {
  return /^(?:r\/)?(?:reddit|pcgaming|gaming|gamingnews|games|subreddit|gamingnewsfeed)$/i.test(
    String(label || "").trim(),
  );
}

function reportedSourceLabel(story = {}) {
  const text = fullText(story).replace(/\s+/g, " ").trim();
  const patterns = [
    /\baccording to\s+([A-Z][A-Za-z0-9+&'-]{2,}(?:\s+[A-Z][A-Za-z0-9+&'-]{2,}){0,2})\b/,
    /\b([A-Z][A-Za-z0-9+&'-]{2,}(?:\s+[A-Z][A-Za-z0-9+&'-]{2,}){0,2})\s+(?:reports?|says|claims|writes|states)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const label = match?.[1]?.trim();
    if (label && !genericSourceLabel(label)) return label;
  }
  return "";
}

function sourceLabel(story = {}) {
  const explicit = story.source_name || story.publisher || story.outlet || story.source;
  const host = hostSourceLabel(story.url || story.source_url);
  const reported = reportedSourceLabel(story);
  const source =
    (explicit && !genericSourceLabel(explicit) && explicit) ||
    (host && !genericSourceLabel(host) && host) ||
    reported ||
    explicit ||
    host ||
    story.subreddit ||
    "SOURCE";
  return String(source)
    .replace(/^r\//i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 28);
}

function extractNumericClaim(text) {
  const raw = String(text || "");
  const comma = raw.match(/\b\d{1,3}(?:,\d{3})+\b/);
  if (comma) {
    return {
      raw: comma[0],
      value: Number(comma[0].replace(/,/g, "")),
      display: comma[0],
    };
  }
  const compact = raw.match(/\b\d+(?:\.\d+)?\s*(?:k|thousand|million|billion)\b/i);
  if (compact) {
    return {
      raw: compact[0],
      value: null,
      display: compact[0].replace(/\s+/g, " ").toUpperCase(),
    };
  }
  return null;
}

function extractReviewScoreClaim(text) {
  const raw = String(text || "");
  if (!/\b(?:metacritic|critic score|review score|highest rated|top rated)\b/i.test(raw)) {
    return null;
  }
  const patterns = [
    /\b(?:metacritic|score|review score|critic score)[\s\S]{0,96}?\b(?:with\s+(?:a|an)\s+)?(100|[1-9]\d)\s+(?:aggregate|score|rating)\b/i,
    /\b(?:metacritic|score|review score|critic score)\D{0,24}(100|[1-9]\d)\b/i,
    /\b(100|[1-9]\d)\D{0,24}(?:metacritic|score|review score|critic score)\b/i,
    /\b(100|[1-9]\d)\s+(?:aggregate|critic\s+score|review\s+score)\b/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 50 && value <= 100) {
      return {
        raw: match[1],
        value,
        display: match[1],
      };
    }
  }
  return null;
}

function priceSnapContext(text, price) {
  const raw = String(text || "");
  if (!price) return { shouldSnap: false, detail: null };
  const escaped = price.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sentenceMatch = raw.match(new RegExp(`[^.!?]*${escaped}[^.!?]*`, "i"));
  const sentence = (sentenceMatch?.[0] || raw).toLowerCase();
  const full = raw.toLowerCase();
  const priceLed =
    /\b(?:price|pricing|costs?|cost|priced|rrp|msrp|discount|sale|deal|bundle|pre[- ]?order)\b/.test(
      sentence,
    ) ||
    /\b(?:price|pricing|costs?|cost|discount|sale|deal|bundle)\b/.test(full);
  const contextualCaveat =
    /\b(?:early[-\s]access|premium early|only count(?:s|ing)?|willing to pay|before standard launch|not all players)\b/.test(
      sentence,
    ) ||
    /\bsteam\b/.test(full) && /\b(?:concurrent players|player|players|peak|record)\b/.test(full);
  const intentionalMoneyAngle =
    /\b(?:sharper detail is money|money angle|price is the story|paid[-\s]access stress test|paid[-\s]access signal)\b/.test(
      full,
    ) ||
    (/\bpremium edition\b/.test(sentence) &&
      /\b(?:money|paid[-\s]access|price|pricing)\b/.test(full));

  if (contextualCaveat && !priceLed && !intentionalMoneyAngle) {
    return { shouldSnap: false, detail: "early_access_context" };
  }
  return {
    shouldSnap: priceLed || intentionalMoneyAngle,
    detail: intentionalMoneyAngle ? "PAID ACCESS" : "PRICE SIGNAL",
  };
}

function wordTime(words, terms, fallbackS) {
  const normalTerms = asArray(terms).map(cleanWord).filter(Boolean);
  if (!normalTerms.length) return round(fallbackS, 3);
  for (const word of asArray(words)) {
    const w = cleanWord(word?.word);
    if (!w) continue;
    if (normalTerms.some((term) => w.includes(term) || term.includes(w))) {
      const start = Number(word.start ?? word.startS ?? word.start_s);
      if (Number.isFinite(start)) return round(start, 3);
    }
  }
  return round(fallbackS, 3);
}

function inferPrimaryEntity(story = {}) {
  const explicit = story.game_title || story.primary_entity || story.entity;
  if (explicit) return String(explicit).trim();

  const title = String(story.title || "").replace(/\s+/g, " ").trim();
  if (!title) return null;

  const headlineCandidate = inferHeadlineGameCandidates(title)[0];
  if (headlineCandidate) return headlineCandidate;

  const beforeSeparator = title.split(/\s+[|:–—-]\s+/)[0].trim();
  const stopRe =
    /\b(?:just|immediately|reportedly|officially|quietly|finally|hit|hits|has|have|had|beats|beat|breaks|broke|drops|dropped|launches|launched|gets|got|becomes|became|becoming|is|are|will|could|might|report|record|steam)\b/i;
  const parts = beforeSeparator.split(/\s+/);
  const kept = [];
  for (const part of parts) {
    if (stopRe.test(part)) break;
    kept.push(part.replace(/^[^\w]+|[^\w]+$/g, ""));
    if (kept.length >= 5) break;
  }
  const candidate = kept.join(" ").trim();
  if (/^[A-Z0-9][A-Za-z0-9' ]{2,42}$/.test(candidate) && /\s/.test(candidate)) {
    return candidate;
  }

  const titleCase = title.match(/\b([A-Z][A-Za-z']+(?:\s+(?:[A-Z][A-Za-z']+|\d+)){1,4})\b/);
  return titleCase ? titleCase[1].trim() : null;
}

function placeEvents(events, durationS) {
  const safeDuration = Math.max(1, Number(durationS) || 60);
  const safeWindows = buildOverlaySafeWindows([], safeDuration);
  return placeEventsInWindows(events, durationS, safeWindows);
}

function fitEventIntoWindows(event, desiredStart, durationS, safeWindows = []) {
  const duration = Math.max(0.8, Number(durationS) || 1.4);
  for (const window of safeWindows) {
    const startLimit = Number(window.startS);
    const endLimit = Number(window.endS);
    if (!Number.isFinite(startLimit) || !Number.isFinite(endLimit)) continue;
    if (endLimit - startLimit < 0.8) continue;
    if (desiredStart > endLimit - 0.35) continue;
    const fittedDuration = Math.min(duration, Math.max(0.8, endLimit - Math.max(desiredStart, startLimit)));
    const latestStart = Math.max(startLimit, endLimit - fittedDuration);
    const atS = clamp(Math.max(desiredStart, startLimit), startLimit, latestStart);
    if (atS + fittedDuration <= endLimit + 0.01) {
      return {
        atS: round(atS, 3),
        durationS: round(fittedDuration, 3),
        endS: round(atS + fittedDuration, 3),
        safeWindow: {
          startS: round(startLimit, 3),
          endS: round(endLimit, 3),
          sceneIndexes: window.sceneIndexes || [],
        },
      };
    }
  }
  return null;
}

function placeEventsInWindows(events, durationS, safeWindows = []) {
  const safeDuration = Math.max(1, Number(durationS) || 60);
  const windows = mergeWindows(safeWindows).length
    ? mergeWindows(safeWindows)
    : buildOverlaySafeWindows([], safeDuration);
  const sorted = events
    .filter((event) => Number.isFinite(Number(event.atS)))
    .sort((a, b) => a.atS - b.atS || b.priority - a.priority);
  let previousEnd = -Infinity;
  const placed = [];
  for (const event of sorted) {
    const duration = clamp(event.durationS, 1.2, 5.5);
    const desiredStart = clamp(
      Math.max(Number(event.atS), Number.isFinite(previousEnd) ? previousEnd + 0.22 : -Infinity),
      0.2,
      Math.max(0.2, safeDuration - Math.min(duration, safeDuration)),
    );
    const fitted = fitEventIntoWindows(event, desiredStart, duration, windows);
    if (!fitted) continue;
    previousEnd = fitted.endS;
    placed.push({
      ...event,
      ...fitted,
    });
  }
  return placed;
}

function retentionEventsFromIntelligence(retentionIntelligence) {
  const rawEvents = asArray(
    retentionIntelligence?.visual_v3_adjustments?.timeline_events,
  );
  return rawEvents
    .filter(
      (event) =>
        event?.kind === "retention_pattern_interrupt" &&
        Number.isFinite(Number(event.atS)),
    )
    .slice(0, 3)
    .map((event, index) => ({
      id: event.id || `retention_pattern_interrupt_${index + 1}`,
      kind: "retention_pattern_interrupt",
      label: event.label || "NEW ANGLE",
      detail: event.detail || "Retention save beat",
      atS: Number(event.atS),
      durationS: Number(event.durationS || 1.8),
      priority: Number(event.priority || 86),
      treatment: "retention intelligence pattern interrupt",
      source: "retention_intelligence",
    }));
}

function retentionRequestsEarlyMetric(retentionIntelligence) {
  const text = [
    ...asArray(retentionIntelligence?.recommendations).map(
      (item) => `${item.id || ""} ${item.action || ""}`,
    ),
    ...asArray(retentionIntelligence?.visual_v3_adjustments?.prompt_directives),
  ]
    .join(" ")
    .toLowerCase();
  return /move.*(?:steam|metric|number|chart).*first|opening four|first four|concrete number/.test(text);
}

function dedupeMetricRetentionEvents(events) {
  const hasMetricChart = events.some((event) => event.kind === "steam_chart");
  if (!hasMetricChart) return events;
  return events.filter((event) => {
    if (event.kind !== "retention_pattern_interrupt") return true;
    const text = `${event.label || ""} ${event.detail || ""}`.toLowerCase();
    return !/\b(number|metric|steam|chart)\b/.test(text);
  });
}

function buildVisualV3OverlayPlan({
  story = {},
  words = [],
  durationS = 60,
  maxEvents = 7,
  retentionIntelligence = null,
  scenes = [],
} = {}) {
  const text = fullText(story);
  const lower = text.toLowerCase();
  const numeric = extractNumericClaim(text);
  const reviewScore = extractReviewScoreClaim(text);
  const events = [];
  const entity = inferPrimaryEntity(story);
  const sceneList = asArray(scenes);
  const safeWindows = buildOverlaySafeWindows(sceneList, durationS);
  const hasSceneEntityBadges = sceneList.some((scene) => scene?.entity);
  const steamMetricStory = /\bsteam(?:db)?\b/i.test(text) && numeric;
  const metricEarly = retentionRequestsEarlyMetric(retentionIntelligence);

  if (entity && !(steamMetricStory && (hasSceneEntityBadges || metricEarly))) {
    events.push({
      id: "primary_entity_fly_in",
      kind: "entity_fly_in",
      entity,
      atS: Math.max(1.1, wordTime(words, entity.split(/\s+/).slice(0, 2), 2.2)),
      durationS: 2.8,
      priority: 90,
      treatment: "game-art fly-in cue",
    });
  }

  if (steamMetricStory) {
    events.push({
      id: "steam_stat_chart",
      kind: "steam_chart",
      title: "STEAM PEAK",
      metric: numeric.display,
      detail: /players?|concurrent/i.test(text)
        ? "CONCURRENT PLAYERS"
        : "VISIBLE STORE SIGNAL",
      atS: metricEarly
        ? 2.55
        : Math.max(3.4, wordTime(words, ["steam"], 7.2) - 0.35),
      durationS: metricEarly ? 3.75 : 4.25,
      priority: 100,
      treatment: "broadcast stat panel with chart bars",
    });
  }

  if (reviewScore) {
    events.push({
      id: "metacritic_score_card",
      kind: "review_score_card",
      title: /\bmetacritic\b/i.test(text) ? "METACRITIC" : "REVIEW SCORE",
      metric: reviewScore.display,
      detail: "CRITIC SCORE",
      atS: Math.max(11.4, wordTime(words, ["metacritic", "score"], 13.0) - 0.15),
      durationS: 3.15,
      priority: 88,
      treatment: "source-bound review score plate",
    });
    if (/\b(?:highest rated|top rated|top review|highest review|top score|2026)\b/i.test(text)) {
      events.push({
        id: "review_ranking_snap",
        kind: "ranking_snap",
        label: /\b2026\b/.test(text) ? "TOP OF 2026" : "TOP REVIEW SCORE",
        detail: "Source-locked review framing",
        atS: Math.max(14.8, Number(durationS || 60) - 13.0),
        durationS: 2.8,
        priority: 66,
        treatment: "late retention ranking snap",
      });
    }
  }

  if (story.subreddit || story.source_name || story.publisher || /\breports?\b/i.test(text)) {
    events.push({
      id: "source_lock",
      kind: "source_lock",
      source: sourceLabel(story),
      atS: metricEarly ? 6.5 : Math.max(2.0, wordTime(words, ["reports", "according"], 4.0)),
      durationS: 2.7,
      priority: 70,
      treatment: "compact source bug",
    });
  }

  if (/\bearly[-\s]access\b|\bsteam only\b|\bonly count(?:s|ing)?\b|\bnot confirmed\b|\breportedly\b/i.test(text)) {
    events.push({
      id: "source_caveat",
      kind: "caveat_card",
      label: /\bearly[-\s]access\b/i.test(text)
        ? "EARLY ACCESS"
        : /\bsteam\b/i.test(text)
          ? "STEAM ONLY"
          : "CONTEXT",
      detail: /\bonly count(?:s|ing)?\b|\bsteam only\b|\bearly[-\s]access\b/i.test(text)
        ? "Storefront data, not all players"
        : "Keep the claim tied to the source",
      atS: numeric ? wordTime(words, ["early", "access", "steam"], 12.0) + 2.0 : 14.0,
      durationS: 3.0,
      priority: 65,
      treatment: "caveat lock-up",
    });
  }

  if (/\$\d/.test(text)) {
    const price = text.match(/\$\d+(?:\.\d+)?/)?.[0] || null;
    const priceContext = priceSnapContext(text, price);
    if (priceContext.shouldSnap) {
      events.push({
        id: "price_snap",
        kind: "price_snap",
        label: price,
        detail: priceContext.detail || "PRICE SIGNAL",
        atS: wordTime(words, ["dollars", "price", "pay", "paid", "premium", "money"], 18.0),
        durationS: 2.6,
        priority: 60,
        treatment: "price tag snap",
      });
    }
  }

  events.push(...retentionEventsFromIntelligence(retentionIntelligence));

  const placed = placeEventsInWindows(dedupeMetricRetentionEvents(events), durationS, safeWindows)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxEvents)
    .sort((a, b) => a.atS - b.atS);
  const blockers = [];
  if (placed.length < 3) blockers.push("visual_v3_too_few_story_beats");
  if (/\bsteam(?:db)?\b/i.test(text) && numeric && !placed.some((event) => event.kind === "steam_chart")) {
    blockers.push("visual_v3_missing_steam_chart");
  }

  return {
    schemaVersion: 3,
    storyId: story.id || null,
    generatedAt: new Date().toISOString(),
    verdict: blockers.length ? "visual_v3_needs_more_beats" : "visual_v3_ready",
    blockers,
    warnings: placed.length > 5 ? ["visual_v3_dense_overlay_plan"] : [],
    eventCount: placed.length,
    events: placed,
    safety: {
      renderOnly: true,
      sourceAware: true,
      avoidsBottomSubtitleBand: true,
      avoidsTextHeavySceneWindows: sceneList.length > 0,
      noTemporalOverlayStacking: true,
      noPublishingSideEffects: true,
    },
    safeWindows,
  };
}

function enableExpr(event, { startOffsetS = 0 } = {}) {
  const start = Number(event.atS) + Number(startOffsetS || 0);
  const end = Number(event.endS);
  return `enable='between(t\\,${start.toFixed(2)}\\,${Math.max(start, end).toFixed(2)})'`;
}

function boxEnableExpr(event) {
  return enableExpr(event, { startOffsetS: 0.12 });
}

function fadeExpr(event) {
  const start = Number(event.atS).toFixed(2);
  const end = Number(event.endS).toFixed(2);
  return `alpha='if(lt(t\\,${start})\\,0\\,if(lt(t-${start}\\,0.20)\\,(t-${start})/0.20\\,if(gt(t\\,${end}-0.25)\\,max(0\\,(${end}-t)/0.25)\\,1)))'`;
}

function steamChartFilters(event, fontOpt) {
  const enable = enableExpr(event);
  const boxEnable = boxEnableExpr(event);
  const fade = fadeExpr(event);
  const start = Number(event.atS || 0);
  const title = ffEscape(event.title || "STEAM PEAK");
  const metric = ffEscape(event.metric || "LIVE");
  const detail = ffEscape(event.detail || "PLAYER SIGNAL");
  const barW = (width, delay = 0) =>
    `'if(lt(t\\,${(start + delay).toFixed(2)})\\,1\\,min(${width}\\,1+(${width}-1)*(t-${(start + delay).toFixed(2)})/0.42))'`;
  return [
    `drawbox=x=56:y=160:w=968:h=324:color=black@0.70:t=fill:${boxEnable}`,
    `drawbox=x=56:y=160:w=968:h=7:color=0xFF6B1A@0.98:t=fill:${boxEnable}`,
    `drawtext=text='${title}':${fontOpt}:fontcolor=0xFF6B1A:fontsize=30:x=92:y=196:${fade}:${enable}`,
    `drawtext=text='${metric}':${fontOpt}:fontcolor=white:fontsize=76:x=92:y=235:${fade}:${enable}`,
    `drawtext=text='${detail}':${fontOpt}:fontcolor=white@0.82:fontsize=27:x=98:y=318:${fade}:${enable}`,
    `drawtext=text='FH5 PEAK':${fontOpt}:fontcolor=white@0.70:fontsize=20:x=112:y=374:${fade}:${enable}`,
    `drawbox=x=302:y=372:w=250:h=20:color=white@0.14:t=fill:${boxEnable}`,
    `drawbox=x=302:y=372:w=${barW(178, 0.08)}:h=20:color=white@0.52:t=fill:${boxEnable}`,
    `drawtext=text='EARLY ACCESS':${fontOpt}:fontcolor=white@0.70:fontsize=20:x=112:y=414:${fade}:${enable}`,
    `drawbox=x=302:y=412:w=620:h=20:color=white@0.14:t=fill:${boxEnable}`,
    `drawbox=x=302:y=412:w=${barW(620, 0.18)}:h=20:color=0xFF6B1A@0.92:t=fill:${boxEnable}`,
    `drawtext=text='CURRENT SPIKE':${fontOpt}:fontcolor=0xFF6B1A:fontsize=22:x=666:y=444:${fade}:${enable}`,
  ];
}

function entityFlyInFilters(event, fontOpt) {
  const enable = enableExpr(event);
  const boxEnable = boxEnableExpr(event);
  const fade = fadeExpr(event);
  const entity = ffEscape(String(event.entity || "GAME").toUpperCase());
  return [
    `drawbox=x=70:y=540:w=760:h=118:color=black@0.58:t=fill:${boxEnable}`,
    `drawbox=x=70:y=540:w=8:h=118:color=0xFF6B1A@0.95:t=fill:${boxEnable}`,
    `drawtext=text='NOW ON SCREEN':${fontOpt}:fontcolor=0xFF6B1A:fontsize=24:x=104:y=558:${fade}:${enable}`,
    `drawtext=text='${entity}':${fontOpt}:fontcolor=white:fontsize=48:x=104:y=594:${fade}:${enable}`,
  ];
}

function sourceLockFilters(event, fontOpt) {
  const enable = enableExpr(event);
  const boxEnable = boxEnableExpr(event);
  const fade = fadeExpr(event);
  const source = ffEscape(event.source || "SOURCE");
  return [
    `drawbox=x=64:y=74:w=438:h=70:color=black@0.56:t=fill:${boxEnable}`,
    `drawtext=text='SOURCE  ${source}':${fontOpt}:fontcolor=white:fontsize=28:x=86:y=94:${fade}:${enable}`,
  ];
}

function caveatFilters(event, fontOpt) {
  const enable = enableExpr(event);
  const boxEnable = boxEnableExpr(event);
  const fade = fadeExpr(event);
  const label = ffEscape(event.label || "CONTEXT");
  const detail = ffEscape(event.detail || "SOURCE BOUND");
  return [
    `drawbox=x=586:y=514:w=426:h=146:color=black@0.68:t=fill:${boxEnable}`,
    `drawbox=x=586:y=514:w=6:h=146:color=0xFF6B1A@0.92:t=fill:${boxEnable}`,
    `drawtext=text='${label}':${fontOpt}:fontcolor=0xFF6B1A:fontsize=31:x=614:y=538:${fade}:${enable}`,
    `drawtext=text='${detail}':${fontOpt}:fontcolor=white:fontsize=24:x=614:y=592:${fade}:${enable}`,
  ];
}

function priceSnapFilters(event, fontOpt) {
  const enable = enableExpr(event);
  const boxEnable = boxEnableExpr(event);
  const fade = fadeExpr(event);
  const label = ffEscape(event.label || "PRICE");
  const detail = ffEscape(event.detail || "PRICE SIGNAL");
  return [
    `drawbox=x=604:y=706:w=386:h=142:color=0xFF6B1A@0.86:t=fill:${boxEnable}`,
    `drawtext=text='${detail}':${fontOpt}:fontcolor=black@0.82:fontsize=26:x=632:y=728:${fade}:${enable}`,
    `drawtext=text='${label}':${fontOpt}:fontcolor=white:fontsize=62:x=632:y=762:${fade}:${enable}`,
  ];
}

function reviewScoreCardFilters(event, fontOpt) {
  const enable = enableExpr(event);
  const boxEnable = boxEnableExpr(event);
  const fade = fadeExpr(event);
  const title = ffEscape(event.title || "REVIEW SCORE");
  const metric = ffEscape(event.metric || "92");
  const detail = ffEscape(event.detail || "CRITIC SCORE");
  return [
    `drawbox=x=616:y=182:w=388:h=210:color=black@0.68:t=fill:${boxEnable}`,
    `drawbox=x=616:y=182:w=388:h=6:color=0xFF6B1A@0.96:t=fill:${boxEnable}`,
    `drawtext=text='${title}':${fontOpt}:fontcolor=0xFF6B1A:fontsize=28:x=646:y=210:${fade}:${enable}`,
    `drawtext=text='${metric}':${fontOpt}:fontcolor=white:fontsize=92:x=646:y=246:${fade}:${enable}`,
    `drawtext=text='${detail}':${fontOpt}:fontcolor=white@0.80:fontsize=25:x=652:y=342:${fade}:${enable}`,
  ];
}

function rankingSnapFilters(event, fontOpt) {
  const enable = enableExpr(event);
  const boxEnable = boxEnableExpr(event);
  const fade = fadeExpr(event);
  const label = ffEscape(String(event.label || "TOP SCORE").toUpperCase());
  const detail = ffEscape(event.detail || "Source-locked review framing");
  return [
    `drawbox=x=78:y=300:w=704:h=124:color=black@0.64:t=fill:${boxEnable}`,
    `drawbox=x=78:y=300:w=704:h=6:color=0xFF6B1A@0.96:t=fill:${boxEnable}`,
    `drawtext=text='${label}':${fontOpt}:fontcolor=white:fontsize=42:x=112:y=326:${fade}:${enable}`,
    `drawtext=text='${detail}':${fontOpt}:fontcolor=0xFF6B1A:fontsize=25:x=116:y=382:${fade}:${enable}`,
  ];
}

function retentionPatternInterruptFilters(event, fontOpt) {
  const enable = enableExpr(event);
  const boxEnable = boxEnableExpr(event);
  const fade = fadeExpr(event);
  const label = ffEscape(String(event.label || "NEW ANGLE").toUpperCase());
  const detail = ffEscape(event.detail || "Retention save beat");
  return [
    `drawbox=x=76:y=410:w=928:h=136:color=black@0.66:t=fill:${boxEnable}`,
    `drawbox=x=76:y=410:w=928:h=6:color=0xFF6B1A@0.96:t=fill:${boxEnable}`,
    `drawtext=text='${label}':${fontOpt}:fontcolor=white:fontsize=42:x=112:y=436:${fade}:${enable}`,
    `drawtext=text='${detail}':${fontOpt}:fontcolor=0xFF6B1A:fontsize=28:x=116:y=492:${fade}:${enable}`,
  ];
}

function eventFilters(event, fontOpt) {
  switch (event.kind) {
    case "steam_chart":
      return steamChartFilters(event, fontOpt);
    case "entity_fly_in":
      return entityFlyInFilters(event, fontOpt);
    case "source_lock":
      return sourceLockFilters(event, fontOpt);
    case "caveat_card":
      return caveatFilters(event, fontOpt);
    case "price_snap":
      return priceSnapFilters(event, fontOpt);
    case "review_score_card":
      return reviewScoreCardFilters(event, fontOpt);
    case "ranking_snap":
      return rankingSnapFilters(event, fontOpt);
    case "retention_pattern_interrupt":
      return retentionPatternInterruptFilters(event, fontOpt);
    default:
      return [];
  }
}

function buildVisualV3OverlayFilter({
  inputLabel = "base",
  outputLabel = "visualV3Base",
  plan,
  fontOpt = "font='DejaVu Sans'",
} = {}) {
  const events = asArray(plan?.events).filter(
    (event) =>
      Number.isFinite(Number(event.atS)) &&
      Number(
        event.endS ?? Number(event.atS) + Number(event.durationS || 0),
      ) > Number(event.atS),
  );
  if (!events.length) return null;
  const normalisedEvents = events.map((event) => ({
    ...event,
    durationS: Number(event.durationS || event.endS - event.atS || 2.5),
    endS:
      event.endS ??
      Number(event.atS) + Number(event.durationS || event.endS - event.atS || 2.5),
  }));
  const parts = normalisedEvents.flatMap((event) => eventFilters(event, fontOpt));
  if (!parts.length) return null;
  return `[${inputLabel}]${parts.join(",")}[${outputLabel}]`;
}

module.exports = {
  buildVisualV3OverlayFilter,
  buildVisualV3OverlayPlan,
  buildOverlaySafeWindows,
  extractNumericClaim,
  inferPrimaryEntity,
  priceSnapContext,
};
