"use strict";

const LONGFORM_FORMAT_PORTFOLIO = Object.freeze([
  {
    id: "monthly_release_radar",
    label: "Monthly Release Radar",
    cadence: "monthly, published 5-7 days before the new month",
    purpose: "A dated, platform-aware guide to the games most worth tracking next month.",
    targets: {
      duration_minutes: { min: 12, ideal: 16, max: 22 },
      words: { min: 1900, ideal: 2450, max: 3200 },
      chapters: { min: 6, ideal: 8, max: 12 },
      segments: { min: 10, ideal: 14, max: 18 },
    },
    monetisation_surfaces: [
      "platform and retailer affiliate links for confirmed releases",
      "story-relevant hardware and storage recommendations",
      "newsletter release-calendar capture",
      "sponsor-safe pre-roll and mid-roll inventory",
    ],
    gates: {
      source: [
        "Every release date and platform requires an official publisher, developer or platform-store source.",
        "Delay risk, regional differences and early-access status must be explicit.",
      ],
      motion: [
        "Every ranked release requires exact-subject official trailer or gameplay motion.",
        "At least three distinct motion families must support the full programme.",
      ],
      originality: [
        "Ranking and recommendations must use an original Pulse scoring rationale.",
        "The programme must add player-impact analysis beyond a release-date list.",
      ],
    },
    derivatives: [
      "one Short per top-five release",
      "monthly release-calendar carousel",
      "platform-specific release threads",
      "newsletter calendar and buyer-intent landing page",
    ],
  },
  {
    id: "weekly_news_verdict",
    label: "Weekly News Verdict",
    cadence: "weekly, after the final major weekday news cycle",
    purpose: "A decisive, source-backed account of what mattered this week and what it changes for players.",
    targets: {
      duration_minutes: { min: 10, ideal: 14, max: 18 },
      words: { min: 1550, ideal: 2100, max: 2750 },
      chapters: { min: 5, ideal: 7, max: 10 },
      segments: { min: 6, ideal: 9, max: 12 },
    },
    monetisation_surfaces: [
      "sponsor-safe pre-roll and one contextual mid-roll",
      "newsletter weekly briefing capture",
      "story-relevant affiliate links only",
      "owned-site source and analysis page",
    ],
    gates: {
      source: [
        "Every factual claim requires a primary source or two independent reliable sources.",
        "Rumours must be labelled, separated and excluded from definitive verdicts.",
      ],
      motion: [
        "Each lead story requires exact-subject official or licensed motion.",
        "No story may rely on a repeated generic gameplay bed.",
      ],
      originality: [
        "Each chapter must state a distinct Pulse verdict and concrete player consequence.",
        "The script must synthesise the week rather than recite article summaries.",
      ],
    },
    derivatives: [
      "three verdict Shorts",
      "weekly winners-and-losers carousel",
      "source thread",
      "newsletter briefing",
    ],
  },
  {
    id: "ranked_countdown",
    label: "Ranked Countdown",
    cadence: "fortnightly or event-led",
    purpose: "An evidence-led ranking built around a clear player decision or debate.",
    targets: {
      duration_minutes: { min: 12, ideal: 18, max: 26 },
      words: { min: 1850, ideal: 2700, max: 3900 },
      chapters: { min: 7, ideal: 11, max: 16 },
      segments: { min: 8, ideal: 12, max: 15 },
    },
    monetisation_surfaces: [
      "rank-matched affiliate links",
      "comparison landing page",
      "sponsor-safe category placement with editorial separation",
      "newsletter ranked-list capture",
    ],
    gates: {
      source: [
        "Eligibility facts, availability and prices require current first-party or retailer evidence.",
        "The scoring rubric and material uncertainty must be disclosed.",
      ],
      motion: [
        "Every ranked entry requires exact-subject motion or an explicit visual hold.",
        "No clip family may dominate more than one entry unless the comparison requires it.",
      ],
      originality: [
        "Ranks must be produced from a documented Pulse rubric, not copied consensus.",
        "Every position requires a specific reason and meaningful trade-off.",
      ],
    },
    derivatives: [
      "top-three Short",
      "one Short for the most controversial rank",
      "ranked carousel",
      "interactive comparison landing page",
    ],
  },
  {
    id: "single_topic_deep_dive",
    label: "Single-Topic Deep Dive",
    cadence: "twice monthly or when a major story sustains investigation",
    purpose: "A chaptered explanation of one consequential gaming story, system or controversy.",
    targets: {
      duration_minutes: { min: 15, ideal: 22, max: 35 },
      words: { min: 2300, ideal: 3300, max: 5000 },
      chapters: { min: 6, ideal: 9, max: 14 },
      segments: { min: 8, ideal: 13, max: 20 },
    },
    monetisation_surfaces: [
      "sponsor-safe pre-roll and chapter-boundary mid-roll",
      "supporting source dossier landing page",
      "newsletter investigation capture",
      "strictly relevant affiliate route where editorially justified",
    ],
    gates: {
      source: [
        "Major claims require primary evidence and a claim-level source ledger.",
        "Disputed claims require fair attribution, uncertainty and material counter-evidence.",
      ],
      motion: [
        "Exact-subject motion must anchor each major chapter.",
        "Owned diagrams, timelines and kinetic typography must carry abstract evidence without pretending to be gameplay.",
      ],
      originality: [
        "The thesis, structure and conclusions must be original Pulse analysis.",
        "The programme must deliver a material payoff not available from reading one source.",
      ],
    },
    derivatives: [
      "thesis Short",
      "evidence-timeline carousel",
      "source dossier",
      "two chapter extracts with independent context",
    ],
  },
  {
    id: "source_backed_launch_verdict",
    label: "Source-Backed Launch Verdict",
    cadence: "launch-led, after sufficient review and live-player evidence exists",
    purpose: "A timely verdict on whether a new game deserves players' time and money now.",
    targets: {
      duration_minutes: { min: 10, ideal: 15, max: 22 },
      words: { min: 1550, ideal: 2250, max: 3200 },
      chapters: { min: 6, ideal: 8, max: 12 },
      segments: { min: 8, ideal: 11, max: 15 },
    },
    monetisation_surfaces: [
      "clearly disclosed game and platform affiliate links",
      "performance-matched hardware recommendations",
      "launch-verdict landing page",
      "sponsor inventory separated from the verdict",
    ],
    gates: {
      source: [
        "Launch status, price, platforms and technical claims require current official evidence.",
        "Performance conclusions require attributable testing or multiple credible measurements.",
      ],
      motion: [
        "The final programme requires exact-build gameplay or clearly labelled official footage.",
        "Menus, performance claims and visual comparisons must show the claimed platform or build.",
      ],
      originality: [
        "The verdict must use a disclosed Pulse decision framework.",
        "The script must distinguish observed evidence, sourced reports and editorial judgement.",
      ],
    },
    derivatives: [
      "buy-wait-skip Short",
      "performance findings Short",
      "launch verdict card",
      "platform comparison landing page",
    ],
  },
  {
    id: "buyer_guide",
    label: "Buyer Guide",
    cadence: "monthly, seasonal or tied to a meaningful price change",
    purpose: "A transparent decision guide matching products or services to distinct player needs and budgets.",
    targets: {
      duration_minutes: { min: 12, ideal: 20, max: 30 },
      words: { min: 1850, ideal: 3000, max: 4400 },
      chapters: { min: 7, ideal: 10, max: 15 },
      segments: { min: 8, ideal: 12, max: 18 },
    },
    monetisation_surfaces: [
      "Amazon UK and US deep links with valid affiliate tags",
      "merchant-specific comparison links",
      "buyer-guide landing page with UTM attribution",
      "newsletter deal and price-drop capture",
    ],
    gates: {
      source: [
        "Specifications, compatibility, price and availability require current manufacturer or retailer evidence.",
        "Every commercial relationship and affiliate link requires conspicuous disclosure.",
      ],
      motion: [
        "Every recommended product requires exact-product footage or owned demonstration media.",
        "Comparison visuals must preserve model and revision identity.",
      ],
      originality: [
        "Recommendations must map to named use cases, budgets and trade-offs.",
        "Ranking cannot be determined by commission rate, merchant preference or copied reviews.",
      ],
    },
    derivatives: [
      "best-for-most-people Short",
      "budget-pick Short",
      "comparison carousel",
      "regional affiliate landing pages",
    ],
  },
]);

function buildLongformFormatPortfolio({ generatedAt = new Date().toISOString() } = {}) {
  return {
    schema_version: 1,
    generated_at: generatedAt,
    status: "portfolio_defined_local_proof_only",
    summary: {
      format_count: LONGFORM_FORMAT_PORTFOLIO.length,
      recurring_format_count: LONGFORM_FORMAT_PORTFOLIO.length,
    },
    formats: LONGFORM_FORMAT_PORTFOLIO,
    safety: {
      local_proof_only: true,
      no_publish: true,
      no_upload: true,
      no_scheduler_change: true,
      no_production_db_mutation: true,
      no_oauth_or_token_change: true,
      no_platform_setting_change: true,
      no_format_is_publish_ready_by_definition: true,
    },
  };
}

function targetRange(target, unit = "") {
  const suffix = unit ? ` ${unit}` : "";
  return `${target.min}-${target.max}${suffix} (ideal ${target.ideal}${suffix})`;
}

function appendBulletSection(lines, heading, entries) {
  lines.push(`### ${heading}`, "");
  for (const entry of entries) lines.push(`- ${entry}`);
  lines.push("");
}

function renderLongformFormatPortfolioMarkdown(report) {
  const lines = [
    "# Pulse Gaming Longform Format Portfolio",
    "",
    `Generated: ${report.generated_at}`,
    "Status: Local proof only",
    "",
    "> No upload or publish action is permitted. Every episode still requires its own source, rights, production and control-tower approval.",
    "",
    `Formats: ${report.summary.format_count}`,
    "",
  ];

  for (const format of report.formats) {
    lines.push(`## ${format.label}`, "");
    lines.push(`- Format ID: \`${format.id}\``);
    lines.push(`- Cadence: ${format.cadence}`);
    lines.push(`- Purpose: ${format.purpose}`);
    lines.push("");
    lines.push("### Production Targets", "");
    lines.push(`- Duration: ${targetRange(format.targets.duration_minutes, "minutes")}`);
    lines.push(`- Words: ${targetRange(format.targets.words)}`);
    lines.push(`- Chapters: ${targetRange(format.targets.chapters)}`);
    lines.push(`- Segments: ${targetRange(format.targets.segments)}`);
    lines.push("");
    appendBulletSection(lines, "Monetisation Surfaces", format.monetisation_surfaces);
    appendBulletSection(lines, "Source Gates", format.gates.source);
    appendBulletSection(lines, "Motion Gates", format.gates.motion);
    appendBulletSection(lines, "Originality Gates", format.gates.originality);
    appendBulletSection(lines, "Derivatives", format.derivatives);
  }

  lines.push("## Safety", "");
  lines.push("- Local proof generation only.");
  lines.push("- No publishing, upload, scheduling or platform-setting changes.");
  lines.push("- No production database, OAuth or token mutation.");
  lines.push("- A format definition never makes an episode publish-ready.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  LONGFORM_FORMAT_PORTFOLIO,
  buildLongformFormatPortfolio,
  renderLongformFormatPortfolioMarkdown,
};
