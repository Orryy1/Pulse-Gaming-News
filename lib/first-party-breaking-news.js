"use strict";

const FIRST_PARTY_SOURCES = [
  {
    key: "xbox_wire",
    name: "Xbox Wire",
    source_re: /^xbox wire$/i,
    hosts: ["news.xbox.com", "xbox.com"],
  },
  {
    key: "playstation_blog",
    name: "PlayStation Blog",
    source_re: /^playstation blog$/i,
    hosts: ["blog.playstation.com", "playstation.com"],
  },
  {
    key: "nintendo",
    name: "Nintendo",
    source_re: /^nintendo$/i,
    hosts: ["nintendo.com"],
  },
  {
    key: "steam",
    name: "Steam",
    source_re: /^steam$/i,
    hosts: ["steampowered.com", "steamcommunity.com"],
  },
  {
    key: "epic_games",
    name: "Epic Games",
    source_re: /^epic games$/i,
    hosts: ["epicgames.com"],
  },
  {
    key: "ea",
    name: "EA",
    source_re: /^(?:ea|electronic arts)$/i,
    hosts: ["ea.com"],
  },
  {
    key: "ubisoft",
    name: "Ubisoft",
    source_re: /^ubisoft$/i,
    hosts: ["ubisoft.com"],
  },
  {
    key: "bethesda",
    name: "Bethesda",
    source_re: /^bethesda$/i,
    hosts: ["bethesda.net"],
  },
];

const ANNOUNCEMENT_SIGNALS = [
  ["launch", /\b(?:launch(?:es|ed|ing)?|released?|available now|early release|early access)\b/i],
  ["release_date", /\b(?:release date|arrives? on|coming (?:on|to)|dated for)\b/i],
  ["platform_expansion", /\b(?:backward compatibility|comes? to pc|cross[- ]play|play anywhere|new platform)\b/i],
  ["subscription_change", /\b(?:game pass|playstation plus|ps plus|subscription)\b/i],
  ["ownership_change", /\b(?:existing (?:digital )?owners?|do not pay|no extra cost|included in every)\b/i],
  ["major_reveal", /\b(?:announc(?:e|es|ed|ement)|reveal(?:s|ed)?|showcase|state of play|nintendo direct)\b/i],
  ["commercial_change", /\b(?:price|pre[- ]?orders?|acquisition|hardware)\b/i],
  ["feature_rollout", /\b(?:achievements?|new feature|rolls? out|update adds?)\b/i],
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function sourceName(story = {}) {
  const primary = parseObject(story.primary_source);
  return clean(
    story.source_name ||
      story.subreddit ||
      primary.name ||
      primary.label ||
      primary.source_name,
  );
}

function sourceUrl(story = {}) {
  const primary = parseObject(story.primary_source);
  return clean(
    story.article_url ||
      story.source_url ||
      story.url ||
      primary.url ||
      primary.source_url,
  );
}

function urlHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function hostAllowed(host, allowedHosts = []) {
  return allowedHosts.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

function firstPartySourceForStory(story = {}) {
  if (clean(story.source_type).toLowerCase() !== "rss") return null;
  const name = sourceName(story);
  const url = sourceUrl(story);
  const host = urlHost(url);
  if (!name || !host) return null;
  const rule = FIRST_PARTY_SOURCES.find(
    (candidate) =>
      candidate.source_re.test(name) && hostAllowed(host, candidate.hosts),
  );
  if (!rule) return null;
  return {
    key: rule.key,
    name: rule.name,
    host,
    url,
  };
}

function appendValue(parts, value) {
  if (Array.isArray(value)) {
    for (const item of value) appendValue(parts, item);
    return;
  }
  if (value && typeof value === "object") {
    appendValue(
      parts,
      value.text || value.claim || value.summary || value.description,
    );
    return;
  }
  const text = clean(value);
  if (text) parts.push(text);
}

function storyScoringText(story = {}) {
  const extra = parseObject(story._extra);
  const parts = [];
  for (const value of [
    story.title,
    story.body,
    story.hook,
    story.full_script,
    story.description,
    story.summary,
    story.source_excerpt,
    story.source_material_excerpt,
    story.rss_description,
    story.confirmed_claims,
    extra.description,
    extra.summary,
    extra.source_excerpt,
    extra.source_material_excerpt,
    extra.confirmed_claims,
  ]) {
    appendValue(parts, value);
  }
  return parts.join(" ");
}

function classifyVerifiedFirstPartyAnnouncement(story = {}) {
  const source = firstPartySourceForStory(story);
  const text = storyScoringText(story);
  const signals = ANNOUNCEMENT_SIGNALS.filter(([, pattern]) =>
    pattern.test(text),
  ).map(([key]) => key);
  return {
    qualifies: Boolean(source && signals.length > 0),
    source,
    signals,
    evidence_text_present: clean(text).length >= 40,
  };
}

module.exports = {
  ANNOUNCEMENT_SIGNALS,
  FIRST_PARTY_SOURCES,
  classifyVerifiedFirstPartyAnnouncement,
  firstPartySourceForStory,
  storyScoringText,
};
