"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  auditAffiliateTargeting,
  buildSponsorMediaKitDraft,
  buildRevenuePathReport,
  buildMonetisationReadiness,
  renderMonetisationReadinessMarkdown,
} = require("../../lib/intelligence/monetisation-readiness");
const {
  FIXTURE_STATE,
  parseArgs,
  renderMonetisationMarkdown,
} = require("../../tools/intelligence/run-monetisation-snapshot");
const {
  collectEnvMonetisationState,
  collectLocalDbMonetisationSignals,
  normaliseMonetisationState,
} = require("../../lib/intelligence/monetisation-state");

test("affiliate audit accepts relevant Amazon links with disclosure", () => {
  const audit = auditAffiliateTargeting({
    story: {
      id: "pokemon-go",
      title: "Mega Mewtwo's Pokémon Go debut gets a confirmed date",
    },
    tag: "pulsegaming-21",
  });

  assert.equal(audit.verdict, "pass");
  assert.equal(audit.disclosure_required, true);
  assert.ok(audit.links.length > 0);
  assert.ok(audit.links.every((link) => link.url.includes("tag=pulsegaming-21")));
  assert.ok(audit.links.every((link) => link.story_specific));
});

test("affiliate audit rejects unsafe and random links", () => {
  const audit = auditAffiliateTargeting({
    story: { id: "policy", title: "Platform policy update changes account rules" },
    existingLinks: [
      { label: "Random", url: "https://www.amazon.co.uk/s?k=coffee&tag=pulse-21" },
      { label: "Unsafe", url: "javascript:alert(1)" },
    ],
  });

  assert.equal(audit.verdict, "review");
  assert.ok(audit.rejections.some((item) => item.reason === "not_story_specific"));
  assert.ok(audit.rejections.some((item) => item.reason === "unsafe_or_missing_affiliate_tag"));
});

test("affiliate audit keeps platform policy stories in review without a product angle", () => {
  const audit = auditAffiliateTargeting({
    story: {
      id: "policy",
      title: "Xbox platform policy update changes account rules",
    },
    tag: "pulsegaming-21",
  });

  assert.equal(audit.verdict, "review");
  assert.ok(audit.rejections.some((item) => item.reason === "story_does_not_naturally_support_affiliate"));
});

test("sponsor media-kit draft marks missing metrics instead of inventing them", () => {
  const draft = buildSponsorMediaKitDraft({
    subscribers: 320,
    shorts_views_90d: 28000,
  });

  assert.ok(draft.missing_metrics.includes("average_view_duration_seconds"));
  assert.ok(draft.missing_metrics.includes("average_view_percentage"));
  assert.equal(draft.ready_for_outreach, false);
  assert.equal(draft.estimated_revenue, null);
});

test("revenue path report names the next milestone without fantasy projections", () => {
  const report = buildRevenuePathReport({
    subscribers: 320,
    shorts_views_90d: 28000,
    longform_watch_hours_12m: 4,
    amazon_affiliate_tag: "pulsegaming-21",
  });

  assert.equal(report.current_stage, "pre_monetisation");
  assert.match(report.next_monetisable_milestone, /Expanded YPP 500 subscribers|YPP subscriber threshold|Shorts 10M/);
  assert.ok(report.what_not_to_monetise_yet.includes("random affiliate links"));
  assert.equal(report.revenue_projection, null);
});

test("monetisation readiness report includes all required sections", () => {
  const readiness = buildMonetisationReadiness({
    snapshot: {
      subscribers: 320,
      shorts_views_90d: 28000,
      longform_watch_hours_12m: 4,
      amazon_affiliate_tag: "pulsegaming-21",
      tiktok_followers: 0,
      tiktok_views_30d: 0,
    },
    stories: [
      { id: "pokemon-go", title: "Pokemon Go Plus update confirmed" },
      { id: "gta6", title: "GTA 6 trailer evidence still unconfirmed" },
    ],
    generatedAt: "2026-05-06T22:05:00.000Z",
  });
  const markdown = renderMonetisationReadinessMarkdown(readiness);

  assert.ok(readiness.sections.youtube_partner_programme);
  assert.ok(readiness.affiliate_audits.length >= 2);
  assert.ok(readiness.sponsor_media_kit);
  assert.match(markdown, /Monetisation Overnight Report/);
  assert.match(markdown, /No fantasy revenue projection/);
});

test("monetisation readiness treats provenance-missing zero values as missing metrics", () => {
  const readiness = buildMonetisationReadiness({
    snapshot: {
      subscribers: 0,
      shorts_views_90d: 1000,
      average_view_duration_seconds: 0,
      average_view_percentage: 0,
      comments_per_view: 0.01,
    },
    stateProvenance: {
      fields: {
        subscribers: { present: false },
        shorts_views_90d: { present: true },
        average_view_duration_seconds: { present: false },
        average_view_percentage: { present: false },
        comments_per_view: { present: true },
      },
    },
  });

  assert.ok(readiness.sponsor_media_kit.missing_metrics.includes("subscribers"));
  assert.ok(
    readiness.sponsor_media_kit.missing_metrics.includes("average_view_duration_seconds"),
  );
  assert.ok(readiness.sponsor_media_kit.missing_metrics.includes("average_view_percentage"));
  assert.ok(!readiness.sponsor_media_kit.missing_metrics.includes("comments_per_view"));
});

test("monetisation snapshot markdown is encoding-clean and keeps Pokémon spelling", () => {
  const snapshot = {
    generated_at: "2026-05-06T23:00:00.000Z",
    summary: {
      cleared: 1,
      total_milestones: 12,
      ypp_eligible: false,
      ypp_blockers: ["YPP subscriber threshold"],
    },
    sections: {
      affiliate: {
        items: [
          {
            milestone_label: "Pokémon affiliate disclosure",
            current_value: 1,
            threshold_value: 1,
            progress_percent: 100,
            cleared: true,
            unlock_path: "affiliate_amazon",
            notes: ["Pokémon Go links require disclosure"],
          },
        ],
      },
    },
  };
  const tiktok = {
    primaryRecommendation: { label: "Official inbox", rationale: "Safe manual completion." },
    fallback: { label: "Phone workflow", rationale: "No browser automation." },
    rejected: [],
    notes: ["No live post"],
  };
  const markdown = renderMonetisationMarkdown(snapshot, tiktok);

  assert.equal(FIXTURE_STATE.amazon_affiliate_tag, "pulsegaming-21");
  assert.match(markdown, /Pokémon/);
  assert.doesNotMatch(markdown, /â|Â|PokÃ/);
});
test("monetisation state normalises numbers and masks affiliate tag provenance", () => {
  const { state, provenance } = normaliseMonetisationState(
    {
      subscribers: "1,250",
      shorts_views_90d: "3,500,000",
      amazon_affiliate_tag: "pulsegaming-21",
      tiktok_account_type: "personal",
    },
    {
      mode: "file",
      source: "unit",
      fieldSources: {
        subscribers: "file:state.json",
        amazon_affiliate_tag: "file:state.json",
      },
    },
  );

  assert.equal(state.subscribers, 1250);
  assert.equal(state.shorts_views_90d, 3500000);
  assert.equal(state.tiktok_personal_account, true);
  assert.equal(provenance.fields.subscribers.source, "file:state.json");
  assert.equal(provenance.fields.amazon_affiliate_tag.public_value, "puls...21");
});

test("monetisation state collector reads safe env overrides only", () => {
  const envState = collectEnvMonetisationState({
    PULSE_YOUTUBE_SUBSCRIBERS: "777",
    PULSE_SHORTS_VIEWS_90D: "12345",
    AMAZON_AFFILIATE_TAG: "pulsegaming-21",
    ["TIKTOK_" + "CLIENT_SECRET"]: "must-not-appear",
  });

  assert.equal(envState.raw.subscribers, "777");
  assert.equal(envState.raw.shorts_views_90d, "12345");
  assert.equal(envState.raw.amazon_affiliate_tag, "pulsegaming-21");
  assert.equal(envState.raw["TIKTOK_" + "CLIENT_SECRET"], undefined);
  assert.equal(envState.fieldSources.subscribers, "env:PULSE_YOUTUBE_SUBSCRIBERS");
});

test("monetisation state local DB signals are read-only and scoped to recent YouTube uploads", () => {
  const os = require("node:os");
  const path = require("node:path");
  const fs = require("fs-extra");
  const Database = require("better-sqlite3");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-monetisation-"));
  const dbPath = path.join(dir, "pulse.db");
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE stories (
        id TEXT PRIMARY KEY,
        youtube_post_id TEXT,
        youtube_views INTEGER,
        youtube_comments INTEGER,
        youtube_published_at TEXT,
        published_at TEXT,
        created_at TEXT,
        timestamp TEXT
      );
      CREATE TABLE video_performance_snapshots (
        snapshot_at TEXT,
        average_view_duration_seconds REAL,
        average_percentage_viewed REAL
      );
    `);
    db.prepare(
      `INSERT INTO stories
       (id, youtube_post_id, youtube_views, youtube_comments, youtube_published_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("recent", "yt_1", 1000, 20, "2026-05-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO stories
       (id, youtube_post_id, youtube_views, youtube_comments, youtube_published_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("old", "yt_2", 9999, 999, "2025-01-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO video_performance_snapshots
       (snapshot_at, average_view_duration_seconds, average_percentage_viewed)
       VALUES (?, ?, ?)`,
    ).run("2026-05-02T00:00:00.000Z", 31, 62);
  } finally {
    db.close();
  }

  const signals = collectLocalDbMonetisationSignals({
    dbPath,
    now: new Date("2026-05-07T00:00:00.000Z"),
  });

  assert.equal(signals.values.valid_public_uploads_90d, 1);
  assert.equal(signals.values.shorts_views_90d, 1000);
  assert.equal(signals.values.comments_per_view, 0.02);
  assert.equal(signals.values.average_view_duration_seconds, 31);
  assert.equal(signals.values.average_view_percentage, 62);
  assert.equal(signals.fieldSources.shorts_views_90d, "local_db:stories.youtube_views_90d");
});

test("monetisation CLI args support fixture/local/file and output controls", () => {
  assert.equal(parseArgs(["--fixture"]).mode, "fixture");
  assert.equal(parseArgs(["--local", "--no-root"]).updateRoot, false);
  const fileArgs = parseArgs(["--state", "state.json", "--out-dir", "tmp"]);
  assert.equal(fileArgs.mode, "file");
  assert.equal(fileArgs.statePath, "state.json");
  assert.match(fileArgs.outDir, /tmp$/);
});
