"use strict";

const fs = require("node:fs");
const path = require("node:path");

function resolveFindingsPath({
  env = process.env,
  cwd = process.cwd(),
  resolveDbPath,
} = {}) {
  const override = String(env.STUDIO_ANALYTICS_FINDINGS_PATH || "").trim();
  if (override) return path.isAbsolute(override) ? override : path.resolve(cwd, override);

  const dbPath =
    typeof resolveDbPath === "function"
      ? resolveDbPath()
      : require("./db").resolveDbPath();
  return path.join(path.dirname(dbPath), "analytics_findings.md");
}

function parseLatestRecommendation(markdown) {
  const text = String(markdown || "");
  const matches = [...text.matchAll(/## Tomorrow'?s recommendation\s*\r?\n+([^\r\n#]+)/gi)];
  if (!matches.length) return null;
  const value = String(matches[matches.length - 1][1] || "")
    .replace(/\s+/g, " ")
    .trim();
  return value || null;
}

function readLatestRecommendation({
  findingsPath,
  env = process.env,
  cwd = process.cwd(),
  resolveDbPath,
  readFileSync = fs.readFileSync,
} = {}) {
  const target =
    findingsPath || resolveFindingsPath({ env, cwd, resolveDbPath });
  try {
    return {
      recommendation: parseLatestRecommendation(readFileSync(target, "utf8")),
      path: target,
      exists: true,
    };
  } catch {
    return { recommendation: null, path: target, exists: false };
  }
}

const CORPORATE_ACTORS = [
  "amazon",
  "apple",
  "ea",
  "ebay",
  "epic",
  "gamestop",
  "google",
  "microsoft",
  "nintendo",
  "playstation",
  "sony",
  "steam",
  "take-two",
  "tencent",
  "ubisoft",
  "valve",
  "xbox",
];

const CONFLICT_TERMS = [
  "accuse",
  "ban",
  "blocked",
  "cancel",
  "clash",
  "critic",
  "destroy",
  "dispute",
  "fight",
  "fired",
  "killed",
  "lawsuit",
  "passed on",
  "reject",
  "refuse",
  "respond",
  "shut down",
  "strong-arm",
  "sue",
  "takeover",
  "undercut",
];

const CONCRETE_OUTCOME_TERMS = [
  "announced",
  "confirmed",
  "delay",
  "launch",
  "price",
  "release date",
  "removed",
  "revealed",
  "ships",
  "sold",
  "update",
  "won't",
];

const ABSTRACT_TERMS = [
  "abstract",
  "commentary",
  "could",
  "future of",
  "industry",
  "may have",
  "might",
  "positive",
  "trend",
  "vague",
];

function containsAny(text, terms) {
  const lower = String(text || "").toLowerCase();
  return terms.filter((term) => lower.includes(term));
}

function extractCapitalisedPhrases(text) {
  const value = String(text || "");
  const matches = value.match(/\b[A-Z][A-Za-z0-9'&.-]*(?:\s+[A-Z][A-Za-z0-9'&.-]*){0,3}\b/g) || [];
  const stop = new Set([
    "According",
    "But",
    "For",
    "New",
    "The",
    "This",
    "Today",
  ]);
  return Array.from(
    new Set(matches.map((m) => m.trim()).filter((m) => !stop.has(m))),
  ).slice(0, 12);
}

function evaluateHookRecommendationSignal(story = {}, recommendation = "") {
  const text = [
    story.title,
    story.hook,
    story.body,
    story.full_script,
    story.source_name,
    story.subreddit,
  ]
    .filter(Boolean)
    .join("\n");

  const corporateActors = containsAny(text, CORPORATE_ACTORS);
  const conflictTerms = containsAny(text, CONFLICT_TERMS);
  const concreteOutcomeTerms = containsAny(text, CONCRETE_OUTCOME_TERMS);
  const abstractTerms = containsAny(text, ABSTRACT_TERMS);
  const namedEntities = extractCapitalisedPhrases(text);
  const wantsCorporateDrama = /corporate drama|named antagonists|concrete outcomes/i.test(
    String(recommendation || ""),
  );

  let score = 0;
  if (corporateActors.length) score += 30;
  if (conflictTerms.length) score += 25;
  if (concreteOutcomeTerms.length) score += 25;
  if (namedEntities.length >= 2) score += 10;
  if (abstractTerms.length) score -= Math.min(20, abstractTerms.length * 5);

  const priority =
    wantsCorporateDrama && score >= 55
      ? "aligns_with_latest_recommendation"
      : wantsCorporateDrama && abstractTerms.length
        ? "avoid_or_reframe"
        : "neutral";

  return {
    recommendation: recommendation || null,
    wants_corporate_drama: wantsCorporateDrama,
    priority,
    score: Math.max(0, Math.min(100, score)),
    named_entities: namedEntities,
    corporate_actors: corporateActors,
    conflict_terms: conflictTerms,
    concrete_outcome_terms: concreteOutcomeTerms,
    abstract_commentary_terms: abstractTerms,
    guidance:
      priority === "aligns_with_latest_recommendation"
        ? "Lead with the named company/person conflict and the concrete outcome."
        : priority === "avoid_or_reframe"
          ? "Reframe away from abstract industry commentary toward named actors and outcomes."
          : "No strong daily analytics alignment detected.",
  };
}

function formatRecommendationForPrompt(recommendation) {
  const value = String(recommendation || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return [
    "DAILY ANALYTICS RECOMMENDATION:",
    `- ${value}`,
    "- For hooks: lead with named people/companies, the conflict and the concrete outcome.",
    "- Avoid vague industry commentary, weak 'could/might' framing and abstract insider quotes unless the story is explicitly labelled as rumour.",
  ].join("\n");
}

module.exports = {
  evaluateHookRecommendationSignal,
  formatRecommendationForPrompt,
  parseLatestRecommendation,
  readLatestRecommendation,
  resolveFindingsPath,
};
