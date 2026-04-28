"use strict";

const FORMAT_DEFINITIONS = [
  {
    id: "daily_shorts",
    promise: "One verified gaming-news beat, fast.",
    idealRuntime: "30-60s",
    inputRequirements: "One verified source, safe thumbnail asset, at least one game visual.",
    promotionRule: "Promote to premium only when media inventory is standard_video or better.",
  },
  {
    id: "daily_briefing",
    promise: "A concise daily stack of the stories that matter.",
    idealRuntime: "3-6min",
    inputRequirements: "Five or more verified or clearly labelled items.",
    promotionRule: "Build when no single story deserves a premium Short.",
  },
  {
    id: "weekly_roundup",
    promise: "The week in gaming leaks, launches and confirmed updates.",
    idealRuntime: "8-12min",
    inputRequirements: "Seven days of published or approved items.",
    promotionRule: "Build every Sunday if at least six credible items exist.",
  },
  {
    id: "monthly_release_radar",
    promise: "The games worth watching next month, ranked by relevance.",
    idealRuntime: "10-14min",
    inputRequirements: "Ten dated releases with store or publisher sources.",
    promotionRule: "Publish only after manual fact-check and date verification.",
  },
  {
    id: "before_you_download",
    promise: "A pre-install value check for players.",
    idealRuntime: "5-8min",
    inputRequirements: "Release date, platforms, price/subscription status, gameplay media.",
    promotionRule: "Use for high-search releases with clear player utility.",
  },
  {
    id: "trailer_breakdown",
    promise: "What the trailer actually showed and what it implies.",
    idealRuntime: "6-10min",
    inputRequirements: "Official trailer plus frame inventory.",
    promotionRule: "Use only when official footage is strong enough.",
  },
  {
    id: "rumour_radar",
    promise: "Careful rumour coverage without overstating confidence.",
    idealRuntime: "3-6min",
    inputRequirements: "Named source or multiple independent signals.",
    promotionRule: "Never promote anonymous thin rumours to premium video.",
  },
  {
    id: "blog_only",
    promise: "Searchable context without forcing weak visuals into video.",
    idealRuntime: "article",
    inputRequirements: "Useful facts but weak media inventory.",
    promotionRule: "Use when visuals score below short_only.",
  },
  {
    id: "reject",
    promise: "No public output.",
    idealRuntime: "none",
    inputRequirements: "Unsafe, unverifiable, duplicate or commercially useless.",
    promotionRule: "Reject until a verified source or usable visual material appears.",
  },
];

function scoreReleaseCandidate(candidate) {
  let score = 0;
  if (candidate.publisherSource) score += 30;
  if (candidate.storeSource) score += 20;
  if (candidate.releaseDate) score += 20;
  if (candidate.platforms?.length) score += 10;
  if (candidate.trailerUrl) score += 10;
  if (candidate.searchDemand === "high") score += 10;
  return Math.min(100, score);
}

function buildMonthlyReleaseRadar({
  monthLabel = "Next Month",
  candidates = [],
} = {}) {
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      factCheckScore: scoreReleaseCandidate(candidate),
      factCheckStatus:
        scoreReleaseCandidate(candidate) >= 70
          ? "ready_for_manual_review"
          : "needs_more_sources",
    }))
    .sort((a, b) => b.factCheckScore - a.factCheckScore);
  const top10 = ranked.filter((c) => c.factCheckScore >= 70).slice(0, 10);
  const rejected = ranked.filter((c) => !top10.includes(c));

  const chapters = top10.map((item, idx) => ({
    time: `${String(Math.floor((idx * 65) / 60)).padStart(2, "0")}:${String((idx * 65) % 60).padStart(2, "0")}`,
    title: `${idx + 1}. ${item.title}`,
  }));
  const longFormScript = [
    `${monthLabel} is stacked enough to deserve a proper release radar.`,
    "This list is ranked by source confidence, player interest, platform reach and available footage.",
    ...top10.map(
      (item, idx) =>
        `${idx + 1}. ${item.title}. It is currently dated for ${item.releaseDate} on ${item.platforms.join(", ")}. The safe angle is ${item.angle || "why players should watch it"}.`,
    ),
    "Final review step: verify every date against the publisher or store page before recording.",
  ].join("\n\n");
  const shorts = top10.map((item, idx) => ({
    title: `${item.title}: worth watching?`,
    script: `${item.title} is one of the key ${monthLabel} releases. The confirmed date is ${item.releaseDate}, and the platform list is ${item.platforms.join(", ")}. The reason it matters is simple: ${item.angle || "it has enough player interest to cut through"}.`,
    titleOptions: [
      `${item.title} is coming`,
      `${item.title}: quick radar`,
      `Before ${item.title} drops`,
    ],
  }));

  return {
    generatedAt: new Date().toISOString(),
    format: "monthly_release_radar",
    monthLabel,
    sourceCandidateTable: ranked,
    top10,
    rejectedCandidates: rejected,
    factCheckGate: {
      status: top10.length >= 10 ? "manual_review_required" : "insufficient_verified_candidates",
      minimumReadyCandidates: 10,
      readyCandidates: top10.length,
    },
    longFormScript,
    chapters,
    seo: {
      title: `Top 10 New Games Coming in ${monthLabel}`,
      description:
        `A Pulse Gaming release radar for ${monthLabel}. Dates, platforms and sources must be manually verified before publication.`,
      pinnedComment:
        "Which release are you watching first? Manual source check required before this goes live.",
    },
    shorts,
    blogArticle: buildBlogArticle(monthLabel, top10),
    newsletterIssue: buildNewsletterIssue(monthLabel, top10),
    manualReviewChecklist: [
      "Verify each release date on an official publisher, platform or store page.",
      "Check regional date differences.",
      "Confirm platforms and subscription status.",
      "Confirm trailer/press-kit usage rights.",
      "Reject any candidate without a dated primary source.",
    ],
  };
}

function buildBlogArticle(monthLabel, top10) {
  const lines = [
    `# Top 10 New Games Coming in ${monthLabel}`,
    "",
    "This draft is generated for manual editorial review.",
    "",
    ...top10.map(
      (item, idx) =>
        `## ${idx + 1}. ${item.title}\n\nRelease date: ${item.releaseDate}\n\nPlatforms: ${item.platforms.join(", ")}\n\nWhy it matters: ${item.angle || "Pending editorial angle."}\n`,
    ),
  ];
  return lines.join("\n");
}

function buildNewsletterIssue(monthLabel, top10) {
  return [
    `Subject: ${monthLabel} Release Radar`,
    "",
    "The short version:",
    ...top10.slice(0, 5).map((item) => `- ${item.title}: ${item.releaseDate}`),
  ].join("\n");
}

module.exports = {
  FORMAT_DEFINITIONS,
  scoreReleaseCandidate,
  buildMonthlyReleaseRadar,
};
