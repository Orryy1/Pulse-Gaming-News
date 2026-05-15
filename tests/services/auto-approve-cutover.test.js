/**
 * tests/services/auto-approve-cutover.test.js
 *
 * Pins the Phase E cutover: the legacy `shouldAutoApprove() { return true }`
 * path is gone, and publisher.autoApprove() routes exclusively through the
 * 100-point editorial rubric in lib/decision-engine::runScoringPass.
 *
 * Covers:
 *   - production mode + USE_SQLITE!=true -> hard error (no silent approve)
 *   - NODE_ENV=production + USE_SQLITE=true -> scoring runs, decisions apply
 *   - dev + USE_SCORING_ENGINE=false -> explicit no-op, nothing approved
 *   - dev + USE_SQLITE!=true -> explicit no-op, nothing approved
 *   - low-score stories are deterministically reviewed/deferred, not auto
 *   - rumour-presented-as-fact hard stop -> reject, not approved
 *   - publisher.js no longer exports shouldAutoApprove
 *
 * Run: node --test tests/services/auto-approve-cutover.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");
const { autoApprove } = require("../../publisher");
const publisher = require("../../publisher");

// Build a minimal repos bundle backed by an in-memory DB so we can drive
// scoring without touching the process-wide repositories singleton or
// requiring USE_SQLITE on the ambient env.
function makeRepos() {
  const db = new Database(":memory:");
  runMigrations(db, { log: () => {} });
  const scoring = require("../../lib/repositories/scoring").bind(db);
  const platformPosts = require("../../lib/repositories/platform_posts").bind(
    db,
  );
  return { db, scoring, platformPosts };
}

function seedStory(db, partial) {
  const defaults = {
    id: "s-" + Math.random().toString(36).slice(2, 10),
    title: "Default title",
    url: "https://ex.com/" + Math.random().toString(36).slice(2, 8),
    flair: "verified",
    subreddit: "gamingleaksandrumours",
    source_type: "reddit",
    score: 600,
    num_comments: 120,
    breaking_score: 80,
    timestamp: new Date().toISOString(),
    article_image: "https://cdn/ex.png",
    game_images: JSON.stringify(["https://steam/keyart.jpg"]),
    approved: 0,
    auto_approved: 0,
    hook: "A brand new reveal just dropped that nobody saw coming tonight",
    body: "Body text.",
    full_script: "Full script.",
  };
  const row = { ...defaults, ...partial };
  const cols = Object.keys(row);
  db.prepare(
    `INSERT INTO stories (${cols.join(",")}, created_at)
     VALUES (${cols.map(() => "?").join(",")}, datetime('now'))`,
  ).run(...cols.map((c) => row[c]));
  return row;
}

test("module no longer exports shouldAutoApprove", () => {
  assert.equal(
    publisher.shouldAutoApprove,
    undefined,
    "shouldAutoApprove must not be exported after Phase E cutover",
  );
});

test("production mode + USE_SQLITE!=true -> throws, never silently approves", async () => {
  await assert.rejects(
    () =>
      autoApprove({
        env: { NODE_ENV: "production", USE_SQLITE: "false" },
      }),
    (err) => /USE_SQLITE=true/.test(err.message),
  );
});

test("production mode + injected repos -> scoring runs and applies decisions", async () => {
  const repos = makeRepos();
  // Fresh story that should score well: verified flair, high source
  // confidence, recent timestamp, real visuals, strong hook.
  seedStory(repos.db, {
    id: "prod-auto",
    title: "Bethesda confirms release date for Elder Scrolls VI",
    flair: "verified",
    subreddit: "gamingleaksandrumours",
    score: 3000,
    num_comments: 450,
    hook: "Bethesda just officially confirmed when Elder Scrolls six ships",
    article_image: "https://cdn/elder.jpg",
    game_images: JSON.stringify([
      "https://steam/keyart.jpg",
      "https://steam/screenshot.jpg",
    ]),
    timestamp: new Date().toISOString(),
  });

  const summary = await autoApprove({
    repos,
    env: { NODE_ENV: "production", USE_SQLITE: "true" },
  });
  assert.equal(summary.skipped, undefined, "no skip in prod");
  assert.ok(summary.scored >= 1);

  // Every decision must be deterministic: check the persisted row.
  const scoreRow = repos.db
    .prepare(
      `SELECT decision, total FROM story_scores
       WHERE story_id = 'prod-auto'
       ORDER BY scored_at DESC LIMIT 1`,
    )
    .get();
  assert.ok(scoreRow, "a story_scores row must be persisted");
  assert.ok(
    ["auto", "review", "defer", "reject"].includes(scoreRow.decision),
    `decision must be one of the four canonical outcomes, got ${scoreRow.decision}`,
  );
  // If decision==='auto' the stories row must flip approved=1; if
  // review/defer/reject the stories row must NOT be approved.
  const storyRow = repos.db
    .prepare(
      `SELECT approved, auto_approved FROM stories WHERE id = 'prod-auto'`,
    )
    .get();
  if (scoreRow.decision === "auto") {
    assert.equal(storyRow.approved, 1);
    assert.equal(storyRow.auto_approved, 1);
  } else {
    assert.equal(
      storyRow.approved,
      0,
      `non-auto decision '${scoreRow.decision}' must not set approved=1`,
    );
  }
});

test("dev + USE_SCORING_ENGINE=false -> explicit no-op, nothing approved", async () => {
  const repos = makeRepos();
  seedStory(repos.db, { id: "dev-off" });

  const summary = await autoApprove({
    repos,
    env: {
      NODE_ENV: "development",
      USE_SQLITE: "true",
      USE_SCORING_ENGINE: "false",
    },
  });
  assert.equal(summary.skipped, "dev_scoring_disabled");
  assert.equal(summary.approved, 0);
  assert.equal(summary.scored, 0);

  const approved = repos.db
    .prepare(`SELECT approved FROM stories WHERE id = 'dev-off'`)
    .get();
  assert.equal(
    approved.approved,
    0,
    "no story may be approved when scoring is disabled",
  );
});

test("dev + USE_SQLITE!=true (no injected repos) -> no-op, nothing approved", async () => {
  const summary = await autoApprove({
    env: { NODE_ENV: "development", USE_SQLITE: "false" },
  });
  assert.equal(summary.skipped, "dev_no_sqlite");
  assert.equal(summary.approved, 0);
});

test("rumour-presented-as-fact hard stop -> reject, not approved", async () => {
  const repos = makeRepos();
  seedStory(repos.db, {
    id: "rumour-confirmed",
    title: "Massive leak: new handheld is confirmed",
    flair: "rumour",
    subreddit: "gamingleaksandrumours",
    full_script:
      "A massive leak has emerged. The new handheld is confirmed according to the source. " +
      "This changes everything we thought we knew.",
    hook: "A massive leak that is being confirmed tonight across the industry",
  });

  await autoApprove({
    repos,
    env: { NODE_ENV: "production", USE_SQLITE: "true" },
  });

  const scoreRow = repos.db
    .prepare(
      `SELECT decision, hard_stops FROM story_scores
       WHERE story_id = 'rumour-confirmed'
       ORDER BY scored_at DESC LIMIT 1`,
    )
    .get();
  assert.equal(scoreRow.decision, "reject");
  assert.ok(
    /rumour_presented_as_fact/.test(scoreRow.hard_stops),
    `hard_stops must record rumour_presented_as_fact, got: ${scoreRow.hard_stops}`,
  );

  const storyRow = repos.db
    .prepare(
      `SELECT approved, auto_approved FROM stories WHERE id = 'rumour-confirmed'`,
    )
    .get();
  assert.equal(storyRow.approved, 0);
  assert.equal(storyRow.auto_approved, 0);
});

test("low-confidence rumour without hard stop -> deterministic review/defer/reject, not auto", async () => {
  const repos = makeRepos();
  seedStory(repos.db, {
    id: "weak-rumour",
    title: "unnamed source maybe sees something probably",
    flair: "rumour",
    subreddit: "somerandomsub",
    score: 10,
    num_comments: 2,
    breaking_score: 20,
    article_image: null,
    game_images: null,
    hook: "So today a source maybe heard something",
    body: "Short weak body.",
    full_script: "Short.",
  });

  await autoApprove({
    repos,
    env: { NODE_ENV: "production", USE_SQLITE: "true" },
  });

  const scoreRow = repos.db
    .prepare(
      `SELECT decision FROM story_scores
       WHERE story_id = 'weak-rumour'
       ORDER BY scored_at DESC LIMIT 1`,
    )
    .get();
  assert.notEqual(
    scoreRow.decision,
    "auto",
    "a weak rumour must never auto-approve",
  );
  assert.ok(
    ["review", "defer", "reject"].includes(scoreRow.decision),
    `expected review/defer/reject for weak rumour, got ${scoreRow.decision}`,
  );

  const storyRow = repos.db
    .prepare(`SELECT approved FROM stories WHERE id = 'weak-rumour'`)
    .get();
  assert.equal(storyRow.approved, 0);
});

test("scoring pass is idempotent — running twice produces two audit rows, second pass does not re-approve", async () => {
  const repos = makeRepos();
  seedStory(repos.db, { id: "idem-1" });

  await autoApprove({
    repos,
    env: { NODE_ENV: "production", USE_SQLITE: "true" },
  });
  await autoApprove({
    repos,
    env: { NODE_ENV: "production", USE_SQLITE: "true" },
  });

  const rows = repos.db
    .prepare(`SELECT count(*) AS n FROM story_scores WHERE story_id = 'idem-1'`)
    .get();
  // Second pass should NOT double-score a story the first pass decided
  // (decision-engine filters out already-auto'd rows; only review/defer
  // are eligible to re-score). So count should be 1 for a story that
  // decisioned to 'auto' on the first pass, or up to 2 for review/defer
  // after the 6h re-score window. Either is valid; never more than 2.
  assert.ok(rows.n >= 1 && rows.n <= 2, `expected 1-2 rows, got ${rows.n}`);
});

test("low script quality score blocks otherwise-auto stories from auto-approval", async () => {
  const repos = makeRepos();
  seedStory(repos.db, {
    id: "low-script-quality",
    title: "PlayStation confirms a major free games drop for May",
    flair: "verified",
    subreddit: "ign",
    source_type: "rss",
    score: 3000,
    num_comments: 450,
    breaking_score: 95,
    article_image: "https://cdn/psplus.jpg",
    game_images: JSON.stringify([
      "https://steam/keyart.jpg",
      "https://steam/screenshot.jpg",
    ]),
    hook: "PlayStation just made May's free games lineup impossible to ignore",
    full_script:
      "PlayStation has confirmed May's free games lineup, with a major headline title leading the month. " +
      "The source is official and the timing matters because subscribers are deciding what to download next.",
    quality_score: 6,
    timestamp: new Date().toISOString(),
  });

  await autoApprove({
    repos,
    env: { NODE_ENV: "production", USE_SQLITE: "true" },
  });

  const scoreRow = repos.db
    .prepare(
      `SELECT decision, total, decision_reason, inputs FROM story_scores
       WHERE story_id = 'low-script-quality'
       ORDER BY scored_at DESC LIMIT 1`,
    )
    .get();

  assert.equal(scoreRow.decision, "review");
  assert.ok(
    scoreRow.total >= 75,
    `fixture should otherwise be auto-tier, got total=${scoreRow.total}`,
  );
  assert.match(scoreRow.decision_reason, /script_quality_score 6 below 7/);

  const inputs = JSON.parse(scoreRow.inputs);
  assert.equal(inputs.script_quality_score, 6);
  assert.match(inputs.script_quality_auto_block, /below 7/);

  const storyRow = repos.db
    .prepare(
      `SELECT approved, auto_approved FROM stories WHERE id = 'low-script-quality'`,
    )
    .get();
  assert.equal(storyRow.approved, 0);
  assert.equal(storyRow.auto_approved, 0);
});

test("community discussion prompts cannot auto-approve as news Shorts", async () => {
  const repos = makeRepos();
  seedStory(repos.db, {
    id: "community-discussion",
    title: "What's the best obscure video game you've ever played?",
    flair: "News",
    subreddit: "gaming",
    source_type: "reddit",
    score: 5000,
    num_comments: 800,
    breaking_score: 95,
    article_image: "https://cdn/forgotten-games.jpg",
    game_images: JSON.stringify([
      "https://steam/keyart.jpg",
      "https://steam/screenshot.jpg",
    ]),
    hook: "Reddit just surfaced a forgotten-games thread everyone is debating",
    full_script:
      "A viral Reddit discussion asked players for obscure game recommendations. " +
      "The thread is interesting, but it is not a confirmed news event with a source-backed development.",
    timestamp: new Date().toISOString(),
  });

  await autoApprove({
    repos,
    env: { NODE_ENV: "production", USE_SQLITE: "true" },
  });

  const scoreRow = repos.db
    .prepare(
      `SELECT decision, total, decision_reason, inputs FROM story_scores
       WHERE story_id = 'community-discussion'
       ORDER BY scored_at DESC LIMIT 1`,
    )
    .get();

  assert.equal(scoreRow.decision, "review");
  assert.ok(
    scoreRow.total >= 75,
    `fixture should otherwise be auto-tier, got total=${scoreRow.total}`,
  );
  assert.match(scoreRow.decision_reason, /community_discussion_prompt/);

  const inputs = JSON.parse(scoreRow.inputs);
  assert.equal(inputs.community_discussion_auto_block, "community_discussion_prompt");

  const storyRow = repos.db
    .prepare(
      `SELECT approved, auto_approved FROM stories WHERE id = 'community-discussion'`,
    )
    .get();
  assert.equal(storyRow.approved, 0);
  assert.equal(storyRow.auto_approved, 0);
});

test("script review metadata in _extra blocks otherwise-auto stories", async () => {
  const repos = makeRepos();
  seedStory(repos.db, {
    id: "script-review-extra",
    title: "Nintendo confirms a major Switch 2 launch bundle for June",
    flair: "verified",
    subreddit: "ign",
    source_type: "rss",
    score: 3000,
    num_comments: 450,
    breaking_score: 96,
    article_image: "https://cdn/switch-2-bundle.jpg",
    game_images: JSON.stringify([
      "https://steam/switch-2-keyart.jpg",
      "https://steam/mario-kart-world.jpg",
    ]),
    hook: "Nintendo just confirmed a Switch 2 bundle with three launch games",
    full_script:
      "Nintendo has confirmed a Switch 2 bundle that includes a console and one of three digital launch games. " +
      "The offer matters because it gives early buyers a clearer value choice before the June retail window.",
    _extra: JSON.stringify({
      script_generation_status: "review_required",
      script_review_reason:
        "script_coherence:unsupported_verified_insider_framing",
    }),
    timestamp: new Date().toISOString(),
  });

  await autoApprove({
    repos,
    env: { NODE_ENV: "production", USE_SQLITE: "true" },
  });

  const scoreRow = repos.db
    .prepare(
      `SELECT decision, total, decision_reason, inputs FROM story_scores
       WHERE story_id = 'script-review-extra'
       ORDER BY scored_at DESC LIMIT 1`,
    )
    .get();

  assert.equal(scoreRow.decision, "review");
  assert.ok(
    scoreRow.total >= 75,
    `fixture should otherwise be auto-tier, got total=${scoreRow.total}`,
  );
  assert.match(
    scoreRow.decision_reason,
    /script_review:script_coherence:unsupported_verified_insider_framing/,
  );

  const inputs = JSON.parse(scoreRow.inputs);
  assert.equal(
    inputs.script_review_auto_block,
    "script_review:script_coherence:unsupported_verified_insider_framing",
  );

  const storyRow = repos.db
    .prepare(
      `SELECT approved, auto_approved FROM stories WHERE id = 'script-review-extra'`,
    )
    .get();
  assert.equal(storyRow.approved, 0);
  assert.equal(storyRow.auto_approved, 0);
});

test("fresh source-backed game preservation policy stories can auto-approve", async () => {
  const repos = makeRepos();
  seedStory(repos.db, {
    id: "game-policy-auto",
    title:
      "California bill backed by Stop Killing Games campaign keeps games playable after server shutdowns",
    flair: "News",
    subreddit: "Games",
    source_type: "reddit",
    score: 250,
    num_comments: 80,
    breaking_score: 60,
    article_image: "https://cdn/stop-killing-games.jpg",
    game_images: JSON.stringify(["https://cdn/game-preservation.jpg"]),
    downloaded_images: JSON.stringify([
      { path: "output/image_cache/game-preservation.jpg", type: "article_hero" },
      { path: "output/image_cache/games-law.jpg", type: "article_inline" },
    ]),
    hook:
      "California just gave gamers a new weapon against abandoned games.",
    body:
      "According to Rock Paper Shotgun, a bill backed by Stop Killing Games passed a key committee vote and could force game developers to maintain online servers or offer refunds.",
    full_script:
      "California just gave gamers a new weapon against abandoned games. According to Rock Paper Shotgun, a bill backed by Stop Killing Games passed a key committee vote and could force game developers to maintain online servers or offer refunds when games shut down. Follow Pulse Gaming so you never miss a beat.",
    timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
  });

  await autoApprove({
    repos,
    env: { NODE_ENV: "production", USE_SQLITE: "true" },
  });

  const scoreRow = repos.db
    .prepare(
      `SELECT decision, total, decision_reason, inputs FROM story_scores
       WHERE story_id = 'game-policy-auto'
       ORDER BY scored_at DESC LIMIT 1`,
    )
    .get();

  assert.equal(scoreRow.decision, "auto");
  assert.match(scoreRow.decision_reason, /fresh_game_policy_reddit_auto_lane/);

  const inputs = JSON.parse(scoreRow.inputs);
  assert.match(inputs.auto_lane_reason, /fresh_game_policy_reddit_auto_lane/);

  const storyRow = repos.db
    .prepare(
      `SELECT approved, auto_approved FROM stories WHERE id = 'game-policy-auto'`,
    )
    .get();
  assert.equal(storyRow.approved, 1);
  assert.equal(storyRow.auto_approved, 1);
});

test("low-value community media posts cannot auto-approve from stale queue rows", async () => {
  const repos = makeRepos();
  seedStory(repos.db, {
    id: "low-value-community-media",
    title: "Alan Wake 2 safe rooms look like this",
    flair: "News",
    subreddit: "gaming",
    source_type: "reddit",
    score: 6000,
    num_comments: 900,
    breaking_score: 95,
    article_image: "https://cdn/alan-wake-room.jpg",
    game_images: JSON.stringify([
      "https://steam/alan-wake-keyart.jpg",
      "https://steam/alan-wake-screenshot.jpg",
    ]),
    hook: "Alan Wake 2 safe rooms are getting attention again",
    full_script:
      "A popular Reddit post shows Alan Wake 2 safe rooms. " +
      "It is a community screenshot post, not a sourced news development.",
    timestamp: new Date().toISOString(),
  });

  await autoApprove({
    repos,
    env: { NODE_ENV: "production", USE_SQLITE: "true" },
  });

  const scoreRow = repos.db
    .prepare(
      `SELECT decision, total, decision_reason, inputs FROM story_scores
       WHERE story_id = 'low-value-community-media'
       ORDER BY scored_at DESC LIMIT 1`,
    )
    .get();

  assert.equal(scoreRow.decision, "review");
  assert.match(scoreRow.decision_reason, /community_discussion_prompt/);

  const inputs = JSON.parse(scoreRow.inputs);
  assert.equal(inputs.community_discussion_auto_block, "community_discussion_prompt");

  const storyRow = repos.db
    .prepare(
      `SELECT approved, auto_approved FROM stories WHERE id = 'low-value-community-media'`,
    )
    .get();
  assert.equal(storyRow.approved, 0);
  assert.equal(storyRow.auto_approved, 0);
});
