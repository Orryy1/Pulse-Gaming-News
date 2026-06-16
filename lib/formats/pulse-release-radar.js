"use strict";

const { buildAffiliateStack, AMAZON_ASSOCIATE_DISCLOSURE } = require("../affiliate-targeting");

const MIN_READY_CANDIDATES = 10;
const MIN_SEGMENT_SECONDS = 55;
const TARGET_SEGMENT_SECONDS = 72;
const INTRO_SECONDS = 70;
const OUTRO_SECONDS = 55;
const HONOURABLE_MENTIONS_SECONDS = 45;

const BANNED_PUBLIC_PHRASES = [
  /let'?s dive in/i,
  /here'?s what you need to know/i,
  /source-backed update/i,
  /the hook here is/i,
  /the hook is/i,
  /the signal is/i,
  /for fans to argue about/i,
  /viewers should know/i,
  /\bBy the end, viewers know\b/i,
  /this story finally has something specific to judge/i,
  /without further ado/i,
  /\bRisk check:/i,
  /\bMy read is\b/i,
  /That is why .* trailer both matter/i,
  /pre-ordering on autopilot/i,
];

function text(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isMissing(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const cleaned = value.trim();
    return cleaned === "" || /^NEEDS_SOURCE$/i.test(cleaned) || /^fixture/i.test(cleaned);
  }
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function hasUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function sourceManifest(candidate) {
  return asArray(candidate.source_manifest || candidate.sources).map((source) => ({
    type: text(source.type || source.kind || "source"),
    label: text(source.label || source.title || source.type || "Source"),
    url: text(source.url),
    supports: asArray(source.supports).map(text),
  }));
}

function claimInventory(candidate) {
  return asArray(candidate.claim_inventory || candidate.claims).map((claim) => ({
    claim: text(claim.claim || claim.text || claim),
    source_url: text(claim.source_url || claim.url || ""),
  }));
}

function officialMotion(candidate) {
  const motion = candidate.official_motion || {};
  return {
    trailer_url: text(motion.trailer_url || candidate.trailer_url),
    clip_count: Number(motion.clip_count || motion.trailer_clips || 0),
    distinct_source_families: Number(motion.distinct_source_families || motion.source_families || 0),
    gameplay_seconds: Number(motion.gameplay_seconds || motion.duration_seconds || 0),
  };
}

function sourceSupports(sources, needle) {
  return sources.some((source) =>
    source.supports.some((support) => support.toLowerCase().includes(needle)),
  );
}

function evaluateCandidate(candidate = {}) {
  const sources = sourceManifest(candidate);
  const claims = claimInventory(candidate);
  const motion = officialMotion(candidate);
  const blockers = [];
  const warnings = [];

  if (isMissing(candidate.id)) blockers.push("id_missing");
  if (isMissing(candidate.title || candidate.canonical_game)) blockers.push("title_missing");
  if (isMissing(candidate.release_date)) blockers.push("release_date_missing");
  if (isMissing(candidate.platforms)) blockers.push("platforms_missing");

  if (sources.length === 0) {
    blockers.push("source_manifest_missing");
  } else {
    if (!sources.some((source) => hasUrl(source.url))) blockers.push("source_manifest_has_no_https_url");
    if (!sourceSupports(sources, "release_date")) blockers.push("release_date_source_missing");
    if (!sourceSupports(sources, "platform")) blockers.push("platform_source_missing");
  }

  if (claims.length === 0) {
    blockers.push("claim_inventory_missing");
  } else if (claims.some((claim) => !claim.claim || !hasUrl(claim.source_url))) {
    blockers.push("claim_inventory_unsourced");
  }

  if (!hasUrl(motion.trailer_url) || motion.clip_count < 1 || motion.distinct_source_families < 1) {
    blockers.push("official_motion_missing");
  }
  if (motion.gameplay_seconds > 0 && motion.gameplay_seconds < 30) {
    warnings.push("official_motion_short_under_30s");
  }

  for (const field of ["player_impact", "curiosity_gap", "risk_factor", "payoff", "debate_prompt"]) {
    if (isMissing(candidate[field])) blockers.push(`${field}_missing`);
  }

  const publicText = [
    publicNarrationLine(candidate.player_impact),
    publicNarrationLine(candidate.curiosity_gap),
    publicNarrationLine(candidate.risk_factor),
    publicNarrationLine(candidate.payoff),
    publicNarrationLine(candidate.debate_prompt),
    publicNarrationLine(candidate.public_angle),
  ].join(" ");
  for (const pattern of BANNED_PUBLIC_PHRASES) {
    if (pattern.test(publicText)) blockers.push("public_copy_scaffold_language");
  }

  return {
    id: text(candidate.id),
    title: text(candidate.title || candidate.canonical_game),
    canonical_game: text(candidate.canonical_game || candidate.title),
    release_date: text(candidate.release_date),
    platforms: asArray(candidate.platforms).map(text),
    source_manifest: sources,
    claim_inventory: claims,
    official_motion: motion,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    passed: blockers.length === 0,
  };
}

function demandScore(value) {
  const demand = text(value).toLowerCase();
  if (demand === "very_high") return 18;
  if (demand === "high") return 14;
  if (demand === "medium") return 8;
  if (demand === "low") return 3;
  return 5;
}

function verdictScore(value) {
  const verdict = text(value).toLowerCase();
  if (verdict === "buy") return 10;
  if (verdict === "subscription_play") return 9;
  if (verdict === "wishlist") return 8;
  if (verdict === "demo_first") return 7;
  if (verdict === "wait") return 5;
  return 6;
}

function scoreCandidate(candidate, gate) {
  const platformReach = Math.min(gate.platforms.length, 4) * 4;
  const sourceScore = Math.min(gate.source_manifest.length, 4) * 8;
  const motionScore = Math.min(gate.official_motion.clip_count, 5) * 6;
  const familyScore = Math.min(gate.official_motion.distinct_source_families, 3) * 5;
  const utilityScore = ["player_impact", "risk_factor", "payoff", "debate_prompt"].reduce(
    (score, field) => score + (isMissing(candidate[field]) ? 0 : 6),
    0,
  );
  return Math.min(
    100,
    sourceScore +
      motionScore +
      familyScore +
      platformReach +
      utilityScore +
      demandScore(candidate.search_demand) +
      verdictScore(candidate.verdict),
  );
}

function rankCandidates(candidates) {
  return candidates
    .map((candidate) => {
      const gate = evaluateCandidate(candidate);
      return {
        candidate,
        gate,
        score: gate.passed ? scoreCandidate(candidate, gate) : 0,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return text(a.gate.release_date).localeCompare(text(b.gate.release_date));
    });
}

function safeDate(candidate) {
  return text(candidate.release_date || "date to verify");
}

function platformLine(candidate) {
  return asArray(candidate.platforms).map(text).join(", ");
}

function compactPlatformLine(platforms = []) {
  const list = asArray(platforms).map(text);
  const lower = list.map((item) => item.toLowerCase());
  const hasSwitch = lower.some((item) => item.includes("switch"));
  const hasXbox = lower.some((item) => item.includes("xbox"));
  const hasPlayStation = lower.some((item) => item.includes("playstation"));
  const hasPc = lower.some((item) => item === "pc" || item.includes("steam") || item.includes("windows"));
  if (hasSwitch && !hasXbox && !hasPlayStation && !hasPc) return "Switch";
  if (hasPc && hasXbox && hasPlayStation) return "PC, Xbox and PlayStation";
  if (hasPc && hasSwitch && !hasXbox && !hasPlayStation) return "PC and Switch";
  if (hasPc && hasPlayStation && !hasXbox) return "PC and PlayStation";
  if (hasPc && hasXbox && !hasPlayStation) return "PC and Xbox";
  if (hasPc && !hasXbox && !hasPlayStation && !hasSwitch) return "PC";
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, 2).join(", ")} and more`;
}

function formatReleaseDate(value) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  const [, , month, day] = match;
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${Number(day)} ${names[Number(month) - 1] || month}`;
}

function verdictLine(candidate) {
  const verdict = text(candidate.verdict || "wishlist").replace(/_/g, " ");
  return `${verdict}: ${publicNarrationLine(candidate.payoff)}`;
}

function verdictLabel(value) {
  const verdict = text(value).toLowerCase();
  if (verdict === "buy") return "buy";
  if (verdict === "wait") return "wait";
  if (verdict === "demo_first") return "demo first";
  if (verdict === "subscription_play") return "try through Game Pass or subscription first";
  return "wishlist";
}

function stripTerminalPunctuation(value) {
  return text(value).replace(/[.!?]+$/g, "");
}

function lowerFirst(value) {
  const cleaned = text(value);
  if (/^Early Access\b/.test(cleaned)) return cleaned;
  return cleaned ? `${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}` : "";
}

function sentenceCaseStart(value) {
  return text(value).replace(/^(\s*)([a-z])/, (_, prefix, first) => `${prefix}${first.toUpperCase()}`);
}

function publicNarrationLine(value) {
  const cleaned = stripTerminalPunctuation(value);
  if (/^by the end,\s*viewers know if\s+/i.test(cleaned)) {
    return sentenceCaseStart(cleaned.replace(/^by the end,\s*viewers know if\s+/i, "The practical call is whether "));
  }
  if (/^by the end,\s*viewers know whether\s+/i.test(cleaned)) {
    return sentenceCaseStart(cleaned.replace(/^by the end,\s*viewers know whether\s+/i, "The practical call is whether "));
  }
  if (/^the hook is not that\s+/i.test(cleaned)) {
    return cleaned.replace(/^the hook is not that\s+/i, "The point is not that ");
  }
  if (/^the hook is the tension between\s+/i.test(cleaned)) {
    return cleaned.replace(/^the hook is the tension between\s+/i, "The tension is between ");
  }
  if (/^the hook is\s+/i.test(cleaned)) {
    return sentenceCaseStart(cleaned.replace(/^the hook is\s+/i, ""));
  }
  if (/^the open question is whether\s+/i.test(cleaned)) {
    return cleaned.replace(/^the open question is whether\s+/i, "The thing to watch is whether ");
  }
  if (/^the question is whether\s+/i.test(cleaned)) {
    return cleaned.replace(/^the question is whether\s+/i, "The real test is whether ");
  }
  if (/^viewers should know whether\s+/i.test(cleaned)) {
    return cleaned.replace(/^viewers should know whether\s+/i, "You should come away knowing whether ");
  }
  if (/^viewers should know\s+/i.test(cleaned)) {
    return cleaned.replace(/^viewers should know\s+/i, "You should come away knowing ");
  }
  return sentenceCaseStart(cleaned);
}

function stripRiskLead(value) {
  return stripTerminalPunctuation(value)
    .replace(/^Risk\s*\d*\s*:\s*/i, "")
    .replace(/^Risk check:\s*/i, "")
    .replace(/^The risk is\s+/i, "");
}

function curiosityClause(value) {
  const line = publicNarrationLine(value);
  const pointMatch = line.match(/^The point is not that\s+(.+?)\.\s*It is whether\s+(.+)$/i);
  if (pointMatch) return `whether ${pointMatch[2]}`;
  const tensionMatch = line.match(/^The tension is between\s+(.+?)\s+and\s+(.+)$/i);
  if (tensionMatch) return `how it balances ${tensionMatch[1]} and ${tensionMatch[2]}`;
  const stripped = line
    .replace(/^The thing to watch is whether\s+/i, "whether ")
    .replace(/^The real test is whether\s+/i, "whether ")
    .replace(/^The useful question is whether\s+/i, "whether ")
    .replace(/^Judge it on whether\s+/i, "whether ");
  return stripped || "whether the footage backs up the promise";
}

function payoffLine(value, verdict, rank = 1) {
  const line = publicNarrationLine(value);
  if (!line) return `Treat it as ${verdict} until more proof lands`;
  const cleaned = line
    .replace(/\bbuy, wait or wishlist candidate\b/gi, "buy, wait or wishlist territory")
    .replace(/\bday-one nostalgia bet\b/gi, "day-one nostalgia bet");
  const knownMatch = cleaned.match(/^You should come away knowing whether\s+(.+)$/i);
  if (!knownMatch) return cleaned;
  const decision = knownMatch[1];
  const variants = [
    `The practical call is whether ${decision}`,
    `Use the footage to decide whether ${decision}`,
    `That should tell you whether ${decision}`,
    `The decision point is whether ${decision}`,
  ];
  return variants[(rank - 1) % variants.length];
}

function proofVerb(proof) {
  return /\band\b|details$/i.test(proof) ? "give" : "gives";
}

function sourceProofPhrase(segment) {
  const labels = asArray(segment.sources).map((source) => text(source.label)).filter(Boolean);
  const hasStore = labels.some((label) => /steam|store|xbox|nintendo/i.test(label));
  const hasPublisher = labels.some((label) => /news|wire|ubisoft|bethesda|cygames|pocketpair/i.test(label));
  if (hasPublisher && hasStore) return "publisher details and a store page";
  if (hasPublisher) return "publisher details";
  if (hasStore) return "the store page";
  return labels[0] || "the official source";
}

function sentence(value) {
  const cleaned = stripTerminalPunctuation(value);
  return cleaned ? `${cleaned}.` : "";
}

function buildNarrativeSegment(segment) {
  const date = formatReleaseDate(segment.release_date);
  const platform = compactPlatformLine(segment.platforms);
  const verdict = verdictLabel(segment.verdict);
  const rank = segment.rank;
  const impact = publicNarrationLine(segment.player_impact);
  const curiosity = publicNarrationLine(segment.curiosity_gap);
  const curiosityAsClause = curiosityClause(segment.curiosity_gap);
  const risk = stripRiskLead(segment.risk_factor);
  const payoff = payoffLine(segment.payoff, verdict, rank);
  const proof = sourceProofPhrase(segment);
  const title = segment.canonical_game;
  const variants = [
    [
      `${rank}. ${title}. The first reason this belongs here is simple: ${lowerFirst(impact)}.`,
      `It lands ${date} for ${platform}, but the trailer still has to prove ${curiosityAsClause}.`,
      `The catch is ${lowerFirst(risk)}.`,
      `My call is ${verdict}. ${payoff}.`,
      `Check ${proof} against the footage before treating it as safe. ${segment.debate_prompt}`,
    ],
    [
      `${rank}. ${title}. This slot is about proof, not logo size.`,
      sentence(impact),
      `The pitch only works if it answers ${curiosityAsClause}.`,
      `It lands ${date} on ${platform}, so the audience is there if the loop holds.`,
      `The worry is ${lowerFirst(risk)}.`,
      `I would treat it as ${verdict} for now. ${payoff}.`,
      `${segment.debate_prompt}`,
    ],
    [
      `${rank}. ${title}. Here is the sleeper argument.`,
      sentence(impact),
      `The sharper question is ${curiosityAsClause}.`,
      `That matters because ${lowerFirst(risk)}.`,
      `Verdict: ${verdict}. ${payoff}.`,
      `${sentenceCaseStart(proof)} ${proofVerb(proof)} us enough to judge the promise, but not enough to switch our brains off.`,
    ],
    [
      `${rank}. ${title}. This one is less about the date, ${date}, and more about trust.`,
      sentence(curiosity),
      sentence(impact),
      `The danger is ${lowerFirst(risk)}.`,
      `That makes it a ${verdict} pick for me. ${payoff}.`,
      `${segment.debate_prompt}`,
    ],
    [
      `${rank}. ${title}. For committed players, this is the calendar check.`,
      sentence(impact),
      `The trailer needs to answer ${curiosityAsClause}.`,
      `The weak point: ${sentenceCaseStart(risk)}.`,
      `I would keep it at ${verdict}. ${payoff}.`,
      `Do not separate ${proof} from the actual footage here. ${segment.debate_prompt}`,
    ],
    [
      `${rank}. ${title}. The premise gets attention quickly, but the useful test is narrower.`,
      sentence(curiosity),
      sentence(impact),
      `If it misses, this is probably why: ${lowerFirst(risk)}.`,
      `For now, call it ${verdict}. ${payoff}.`,
      `${segment.debate_prompt}`,
    ],
    [
      `${rank}. ${title}. This is the comeback check.`,
      sentence(impact),
      `The audience question is ${curiosityAsClause}.`,
      `That is only exciting if the game avoids this problem: ${lowerFirst(risk)}.`,
      `Verdict: ${verdict}. ${payoff}.`,
      `${sentenceCaseStart(proof)} ${proofVerb(proof)} us the promise; the footage has to sell the return.`,
    ],
    [
      `${rank}. ${title}. This rises or falls on fundamentals.`,
      sentence(curiosity),
      sentence(impact),
      `The visible risk: ${sentenceCaseStart(risk)}.`,
      `That keeps it at ${verdict} for me. ${payoff}.`,
      `${segment.debate_prompt}`,
    ],
    [
      `${rank}. ${title}. This is the pressure test of the list.`,
      sentence(impact),
      `It lands ${date} for ${platform}, but the question is ${curiosityAsClause}.`,
      `The easiest way this goes wrong: ${lowerFirst(risk)}.`,
      `My call is ${verdict}. ${payoff}.`,
      `Put ${proof} next to the trailer before buying the promise. ${segment.debate_prompt}`,
    ],
    [
      `${rank}. ${title}. The final slot is the gamble.`,
      sentence(impact),
      `It only belongs this high if it answers ${curiosityAsClause}.`,
      `The red flag: ${sentenceCaseStart(risk)}.`,
      `I would treat it as ${verdict}. ${payoff}.`,
      `${segment.debate_prompt}`,
    ],
  ];
  return variants[(rank - 1) % variants.length].filter(Boolean).join(" ");
}

function buildSegment(entry, rank) {
  const candidate = entry.candidate;
  const title = text(candidate.title || candidate.canonical_game);
  const game = text(candidate.canonical_game || title);
  const release = safeDate(candidate);
  const platforms = platformLine(candidate);
  const sourceLabel = entry.gate.source_manifest[0]?.label || "official source";
  const estimatedSeconds = Math.max(
    MIN_SEGMENT_SECONDS,
    Math.min(96, TARGET_SEGMENT_SECONDS + Math.round((entry.score - 80) / 3)),
  );
  return {
    rank,
    id: entry.gate.id,
    title,
    canonical_game: game,
    release_date: release,
    platforms: entry.gate.platforms,
    score: entry.score,
    estimated_seconds: estimatedSeconds,
    verdict: text(candidate.verdict || "wishlist"),
    risk_factor: text(candidate.risk_factor),
    player_impact: text(candidate.player_impact),
    curiosity_gap: text(candidate.curiosity_gap),
    payoff: text(candidate.payoff),
    debate_prompt: text(candidate.debate_prompt),
    official_motion: entry.gate.official_motion,
    sources: entry.gate.source_manifest,
    claims: entry.gate.claim_inventory,
    script: "",
  };
}

function buildLongformScript({ monthLabel, segments }) {
  const lead = segments[0];
  const sleeper = segments.find((segment) => segment.rank > 3) || segments.at(-1);
  const pickPool = [];
  for (const segment of [
    lead,
    segments.find((item) => /doom|halo|assassin/i.test(item.canonical_game)),
    [...segments].reverse().find((item) => /demo|wait/i.test(item.verdict)),
    sleeper,
  ]) {
    if (segment && !pickPool.some((item) => item.canonical_game === segment.canonical_game)) {
      pickPool.push(segment);
    }
  }
  while (pickPool.length < 3 && pickPool.length < segments.length) {
    const next = segments.find((item) => !pickPool.some((pick) => pick.canonical_game === item.canonical_game));
    if (!next) break;
    pickPool.push(next);
  }
  for (const segment of segments) {
    segment.script = buildNarrativeSegment(segment);
  }
  const lines = [
    `${monthLabel} has the kind of release calendar where every trailer wants to look essential. This is the filter: which games actually deserve your time first?`,
    `This is not a hype countdown. It is a buyer-risk list: real dates, real footage, clear upside and the weak points that could make a day-one purchase feel silly.`,
    `${pickPool.map((segment) => segment.canonical_game).join(", ")} are the pressure points for the month. One looks safest, one has the loudest audience and one still has the most to prove.`,
    "",
    ...segments.map((segment) => segment.script),
    "",
    `If I had to pick one game to watch closest, it would be ${sleeper.canonical_game}. Not because it is guaranteed. Because it has the cleanest gap between what the footage promises and what players still need proved.`,
    `That is the point of this list. Do not let the biggest logo make the decision for you. Use the footage, use the source and be honest about the risk before you spend the money.`,
  ];
  return lines.join("\n\n");
}

function formulaCount(value, pattern) {
  return (text(value).match(pattern) || []).length;
}

function transcriptQa(textValue) {
  const value = text(textValue);
  const blockers = [];
  for (const pattern of BANNED_PUBLIC_PHRASES) {
    if (pattern.test(value)) blockers.push("public_copy_scaffold_language");
  }
  if (formulaCount(value, /\bis dated for\b/gi) > 2) blockers.push("formulaic_release_date_narration");
  if (formulaCount(value, /\bThe question is whether\b/gi) > 2) blockers.push("formulaic_question_narration");
  if (formulaCount(value, /\bBy the end, you know\b/gi) > 2) blockers.push("formulaic_payoff_narration");
  if (/Follow Pulse Gaming\b/i.test(value)) blockers.push("generic_cta_only_ending");
  if (/NEEDS_SOURCE/i.test(value)) blockers.push("needs_source_leaked_to_public_copy");
  const words = value.split(/\s+/).filter(Boolean);
  return {
    verdict: blockers.length ? "fail" : "pass",
    word_count: words.length,
    blockers: [...new Set(blockers)],
  };
}

function buildShort(segment, monthLabel) {
  return {
    id: `${segment.id}_short`,
    title: `${segment.canonical_game}: buy, wait or wishlist?`,
    source_segment_rank: segment.rank,
    estimated_seconds: 52,
    script: [
      `${segment.canonical_game} is one of the ${monthLabel} releases I would not judge from the headline alone.`,
      `${segment.release_date} is the date to check, and the platform list is ${segment.platforms.join(", ")}.`,
      segment.player_impact,
      `The risk is simple: ${segment.risk_factor}`,
      `Verdict: ${segment.verdict.replace(/_/g, " ")}.`,
    ].join(" "),
  };
}

function buildAffiliatePlan(segments, affiliateTag) {
  const links = [];
  const seen = new Set();
  for (const segment of segments) {
    const stack = buildAffiliateStack(
      {
        title: `${segment.canonical_game} release on ${segment.platforms.join(" ")}`,
        canonical_game: segment.canonical_game,
        full_script: `${segment.canonical_game} launches on ${segment.platforms.join(" ")} with editions, store pages and setup checks.`,
        source_type: "release_radar",
        subreddit: "Pulse Release Radar",
      },
      { tag: affiliateTag, maxLinks: 2 },
    );
    for (const link of stack) {
      const key = `${link.query}:${link.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        ...link,
        story_id: segment.id,
        story_title: segment.canonical_game,
      });
      if (links.length >= 12) break;
    }
    if (links.length >= 12) break;
  }
  return {
    disclosure_required: links.length > 0,
    disclosure_copy: links.length ? AMAZON_ASSOCIATE_DISCLOSURE : "No affiliate links attached.",
    policy: "Source links first. Affiliate links are search routes, labelled and story-relevant.",
    links,
  };
}

function buildSeo({ monthLabel, segments }) {
  if (!segments.length) {
    return {
      title: `Best New Games Coming in ${monthLabel}: source review needed`,
      description:
        `Pulse Release Radar for ${monthLabel} is blocked until 10 sourced games with official motion pass review.`,
      tags: ["new games", `${monthLabel} games`, "upcoming games", "Pulse Gaming"],
    };
  }
  const title = `Best New Games Coming in ${monthLabel}: ${segments[0].canonical_game} and More`;
  const firstTwo = segments.slice(0, 2).map((segment) => segment.canonical_game).join(", ");
  return {
    title: title.slice(0, 92),
    description: [
      `Pulse Release Radar for ${monthLabel}: ${firstTwo} and the games most worth checking before launch.`,
      "Every release date is tied to an official or store source. Affiliate links may earn us a commission.",
    ].join(" "),
    tags: [
      "new games",
      `${monthLabel} games`,
      "upcoming games",
      "Pulse Gaming",
      ...segments.slice(0, 6).map((segment) => segment.canonical_game),
    ],
  };
}

function buildChapters(segments) {
  let seconds = INTRO_SECONDS;
  const chapters = [{ time: "0:00", title: "Cold open" }, { time: "1:10", title: "How the list works" }];
  for (const segment of segments) {
    chapters.push({
      time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
      title: `${segment.rank}. ${segment.canonical_game}`,
    });
    seconds += segment.estimated_seconds;
  }
  chapters.push({
    time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
    title: "Honourable mentions and final verdict",
  });
  return chapters;
}

function buildBlogArticle({ monthLabel, segments, affiliatePlan }) {
  const body = [
    `# Best new games coming in ${monthLabel}`,
    "",
    `${monthLabel} is not a month where the biggest logo automatically wins. The useful question is which games have enough verified information, footage and player upside to deserve your time.`,
    "",
    ...segments.map((segment) =>
      [
        `## ${segment.rank}. ${segment.canonical_game}`,
        "",
        `Release date: ${segment.release_date}`,
        "",
        `Platforms: ${segment.platforms.join(", ")}`,
        "",
        `Verdict: ${segment.verdict.replace(/_/g, " ")}.`,
        "",
        segment.player_impact,
        "",
        `Risk: ${segment.risk_factor}`,
        "",
        `Source: ${segment.sources.map((source) => `[${source.label}](${source.url})`).join(", ")}`,
        "",
      ].join("\n"),
    ),
    affiliatePlan.disclosure_required ? `Disclosure: ${affiliatePlan.disclosure_copy}` : "",
  ];
  return { markdown: body.filter(Boolean).join("\n") };
}

function buildNewsletter({ monthLabel, segments }) {
  if (!segments.length) {
    return {
      subject: `${monthLabel} Release Radar needs source review`,
      markdown: [
        `Subject: ${monthLabel} Release Radar needs source review`,
        "",
        "The radar is blocked until 10 dated, sourced games with official motion pass the gate.",
      ].join("\n"),
    };
  }
  return {
    subject: `${monthLabel}'s games ranked by actual player risk`,
    markdown: [
      `Subject: ${monthLabel}'s games ranked by actual player risk`,
      "",
      `${segments[0].canonical_game} leads the radar, but the sleeper pick may be ${segments[Math.min(4, segments.length - 1)].canonical_game}.`,
      "",
      ...segments.slice(0, 6).map((segment) => `- ${segment.canonical_game}: ${segment.release_date}, ${segment.verdict.replace(/_/g, " ")}`),
      "",
      "The full video should go out only after operator source review.",
    ].join("\n"),
  };
}

function buildPulseReleaseRadarPack({
  monthLabel = "Next Month",
  candidates = [],
  affiliateTag = process.env.AMAZON_AFFILIATE_TAG || "placeholder",
  generatedAt = new Date().toISOString(),
} = {}) {
  const ranked = rankCandidates(candidates);
  const ready = ranked.filter((entry) => entry.gate.passed).slice(0, MIN_READY_CANDIDATES);
  const blocked = ranked
    .filter((entry) => !entry.gate.passed)
    .map((entry) => ({
      id: entry.gate.id,
      title: entry.gate.title,
      blockers: entry.gate.blockers,
      warnings: entry.gate.warnings,
    }));
  const segments = ready.map((entry, index) => buildSegment(entry, index + 1));
  const estimatedRuntime =
    INTRO_SECONDS +
    HONOURABLE_MENTIONS_SECONDS +
    OUTRO_SECONDS +
    segments.reduce((sum, segment) => sum + segment.estimated_seconds, 0);
  const script = segments.length ? buildLongformScript({ monthLabel, segments }) : "";
  const transcript = transcriptQa(script);
  const shorts = segments.map((segment) => buildShort(segment, monthLabel));
  const affiliatePlan = buildAffiliatePlan(segments, affiliateTag);
  const readyForReview =
    ready.length >= MIN_READY_CANDIDATES &&
    estimatedRuntime >= 600 &&
    transcript.verdict === "pass";
  const readiness = {
    verdict: readyForReview ? "READY_FOR_OPERATOR_REVIEW" : "BLOCKED",
    operator_review_required: true,
    minimum_ready_candidates: MIN_READY_CANDIDATES,
    ready_candidate_count: ready.length,
    blocked_candidate_count: blocked.length,
    hard_blockers: [
      ...(ready.length < MIN_READY_CANDIDATES ? ["insufficient_ready_candidates"] : []),
      ...(estimatedRuntime < 600 ? ["runtime_under_10_minutes"] : []),
      ...transcript.blockers.map((blocker) => `transcript:${blocker}`),
    ],
  };

  return {
    schema_version: 1,
    generated_at: generatedAt,
    format: "monthly_release_radar",
    package_id: `pulse_release_radar_${monthLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
    month_label: monthLabel,
    readiness,
    ready_candidates: ready.map((entry, index) => ({
      rank: index + 1,
      id: entry.gate.id,
      title: entry.gate.title,
      score: entry.score,
      release_date: entry.gate.release_date,
      platforms: entry.gate.platforms,
      sources: entry.gate.source_manifest,
      official_motion: entry.gate.official_motion,
      warnings: entry.gate.warnings,
    })),
    blocked_candidates: blocked,
    longform: {
      title: buildSeo({ monthLabel, segments }).title,
      estimated_runtime_seconds: estimatedRuntime,
      script,
      transcript_qa: transcript,
      chapters: buildChapters(segments),
      segments,
    },
    seo: buildSeo({ monthLabel, segments }),
    repurposing: {
      shorts,
      discussion_prompts: segments.map((segment) => ({
        story_id: segment.id,
        prompt: segment.debate_prompt,
      })),
    },
    affiliate_plan: affiliatePlan,
    blog_article: buildBlogArticle({ monthLabel, segments, affiliatePlan }),
    newsletter: buildNewsletter({ monthLabel, segments }),
    operator_checklist: [
      "Verify every release date against the linked official/store source.",
      "Watch every official trailer source and confirm the footage matches the named game.",
      "Run long-form visual assembly and freeze/choppy detection before upload.",
      "Run final TTS pace/loudness/caption alignment before upload.",
      "Do not publish if any source, motion or transcript gate turns RED.",
    ],
  };
}

function renderPulseReleaseRadarMarkdown(pack = {}) {
  const lines = [
    "# Pulse Release Radar",
    "",
    `Generated: ${pack.generated_at || ""}`,
    `Month: ${pack.month_label || ""}`,
    `Verdict: ${pack.readiness?.verdict || "UNKNOWN"}`,
    `Ready candidates: ${pack.readiness?.ready_candidate_count || 0}/${pack.readiness?.minimum_ready_candidates || MIN_READY_CANDIDATES}`,
    `Blocked candidates: ${pack.readiness?.blocked_candidate_count || 0}`,
    `Estimated runtime: ${pack.longform?.estimated_runtime_seconds || 0}s`,
    "",
    "Operator review required before render or publish.",
    "",
    "## Top 10",
    "",
  ];
  for (const candidate of pack.ready_candidates || []) {
    lines.push(`### ${candidate.rank}. ${candidate.title}`);
    lines.push("");
    lines.push(`- Date: ${candidate.release_date}`);
    lines.push(`- Platforms: ${candidate.platforms.join(", ")}`);
    lines.push(`- Score: ${candidate.score}`);
    lines.push(`- Motion: ${candidate.official_motion.trailer_url}`);
    for (const source of candidate.sources || []) {
      lines.push(`- ${source.label}: ${source.url}`);
    }
    lines.push("");
  }
  if ((pack.blocked_candidates || []).length) {
    lines.push("## Blocked");
    lines.push("");
    for (const item of pack.blocked_candidates) {
      lines.push(`- ${item.title || item.id}: ${item.blockers.join(", ")}`);
    }
    lines.push("");
  }
  lines.push("## Operator checklist");
  lines.push("");
  for (const item of pack.operator_checklist || []) lines.push(`- [ ] ${item}`);
  return `${lines.join("\n").trimEnd()}\n`;
}

module.exports = {
  MIN_READY_CANDIDATES,
  BANNED_PUBLIC_PHRASES,
  evaluateCandidate,
  rankCandidates,
  buildPulseReleaseRadarPack,
  renderPulseReleaseRadarMarkdown,
};
