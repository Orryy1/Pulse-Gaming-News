"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVisualV3OverlayFilter,
  buildVisualV3OverlayPlan,
} = require("../../lib/studio/v2/visual-v3-overlays");

function wordsFrom(text) {
  return text.split(/\s+/).map((word, index) => ({
    word,
    start: index * 0.42,
    end: index * 0.42 + 0.34,
  }));
}

test("Visual V3 plans a Steam chart, entity fly-in and source lock for stat-led stories", () => {
  const plan = buildVisualV3OverlayPlan({
    story: {
      id: "forza-steam",
      title:
        "Forza Horizon 6 immediately beats its predecessor's all-time Steam record with 130,000 concurrent players",
      subreddit: "GamesRadar",
      source_type: "rss",
      full_script:
        "GamesRadar reports Forza Horizon 6 hit 130,000 concurrent players on Steam during early access.",
    },
    words: wordsFrom(
      "GamesRadar reports Forza Horizon 6 hit one hundred and thirty thousand concurrent players on Steam during early access",
    ),
    durationS: 62,
  });

  assert.equal(plan.verdict, "visual_v3_ready");
  assert.ok(plan.events.some((event) => event.kind === "steam_chart"));
  assert.ok(plan.events.some((event) => event.kind === "entity_fly_in"));
  assert.ok(plan.events.some((event) => event.kind === "source_lock"));
  assert.ok(plan.events.some((event) => event.kind === "caveat_card"));
  assert.equal(plan.events.find((event) => event.kind === "steam_chart").metric, "130,000");
  assert.equal(plan.events.find((event) => event.kind === "entity_fly_in").entity, "Forza Horizon 6");
});

test("Visual V3 trims review-score headline verbs from entity fly-ins", () => {
  const plan = buildVisualV3OverlayPlan({
    story: {
      id: "forza-metacritic",
      title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
      publisher: "Twisted Voxel",
      full_script:
        "Twisted Voxel reports Forza Horizon 6 reached a 92 Metacritic score and is currently the highest rated game of 2026.",
    },
    words: wordsFrom(
      "Twisted Voxel reports Forza Horizon 6 reached a ninety two Metacritic score and is currently the highest rated game of twenty twenty six",
    ),
    durationS: 62,
  });

  assert.equal(plan.events.find((event) => event.kind === "entity_fly_in").entity, "Forza Horizon 6");
});

test("Visual V3 adds source-bound Metacritic score and ranking beats for review-score stories", () => {
  const plan = buildVisualV3OverlayPlan({
    story: {
      id: "forza-metacritic",
      title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
      publisher: "Twisted Voxel",
      full_script:
        "Twisted Voxel reports Forza Horizon 6 reached a 92 Metacritic score and is currently the highest rated game of 2026.",
    },
    words: wordsFrom(
      "Twisted Voxel reports Forza Horizon 6 reached a ninety two Metacritic score and is currently the highest rated game of twenty twenty six",
    ),
    durationS: 70,
  });

  const score = plan.events.find((event) => event.kind === "review_score_card");
  const ranking = plan.events.find((event) => event.kind === "ranking_snap");

  assert.ok(score);
  assert.equal(score.metric, "92");
  assert.equal(score.title, "METACRITIC");
  assert.ok(ranking);
  assert.equal(ranking.label, "TOP OF 2026");
});

test("Visual V3 recognises Metacritic aggregate phrasing from source-bound copy", () => {
  const plan = buildVisualV3OverlayPlan({
    story: {
      id: "forza-metacritic-aggregate",
      title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
      source_name: "Twisted Voxel",
      full_script:
        "Twisted Voxel says it now leads Metacritic's 2026 list with a 92 aggregate, ahead of Pokemon Pokopia at 89. The same report cites a SteamDB peak of 178,009 concurrent users during Premium Edition early access, priced at $120.",
    },
    words: wordsFrom(
      "Twisted Voxel says it now leads Metacritic's twenty twenty six list with a ninety two aggregate ahead of Pokemon Pokopia at eighty nine",
    ),
    durationS: 70,
  });

  assert.ok(plan.events.some((event) => event.kind === "review_score_card"));
  assert.equal(plan.events.find((event) => event.kind === "review_score_card").metric, "92");
  assert.ok(plan.events.some((event) => event.kind === "ranking_snap"));
  assert.ok(plan.events.some((event) => event.kind === "steam_chart"));
});

test("Visual V3 does not turn contextual early-access pricing into a generic price snap", () => {
  const plan = buildVisualV3OverlayPlan({
    story: {
      id: "forza-early-access-price",
      title:
        "Forza Horizon 6 beats the all-time Steam record with 130,000 concurrent players and a $120 early access edition",
      url: "https://www.gamesradar.com/games/racing/forza-horizon-6-steam-record",
      source_type: "rss",
      full_script:
        "GamesRadar reports Forza Horizon 6 hit 130,000 concurrent players on Steam, but that only counts players willing to pay around $120 before standard launch.",
    },
    words: wordsFrom(
      "GamesRadar reports Forza Horizon 6 hit one hundred and thirty thousand concurrent players on Steam but that only counts early access players",
    ),
    durationS: 62,
  });

  assert.ok(plan.events.some((event) => event.kind === "steam_chart"));
  assert.equal(plan.events.some((event) => event.kind === "price_snap"), false);
  assert.match(
    plan.events.find((event) => event.kind === "caveat_card").detail,
    /not all players/i,
  );
});

test("Visual V3 turns explicit angle-first money beats into a source-safe price snap", () => {
  const plan = buildVisualV3OverlayPlan({
    story: {
      id: "forza-angle-money",
      title: "Forza Horizon 6 Hits 92 on Metacritic, Steam Numbers Skyrocket",
      source_name: "Twisted Voxel",
      full_script:
        "Forza just gave Xbox the headline it badly needed. Twisted Voxel says Forza Horizon 6 now sits on a 92 Metacritic aggregate, ahead of Pokemon Pokopia at 89, with SteamDB showing 178,009 concurrent users. But the sharper detail is money: that Steam peak came during Premium Edition early-access, around $120 before the standard launch. That means it is not full demand yet. It is a paid-access stress test.",
    },
    words: wordsFrom(
      "Forza just gave Xbox the headline it badly needed Twisted Voxel says Forza Horizon 6 now sits on a ninety two Metacritic aggregate ahead of Pokemon Pokopia at eighty nine with SteamDB showing one hundred and seventy eight thousand and nine concurrent users But the sharper detail is money that Steam peak came during Premium Edition early access around one hundred and twenty dollars before the standard launch",
    ),
    durationS: 62,
  });

  const price = plan.events.find((event) => event.kind === "price_snap");
  const caveat = plan.events.find((event) => event.kind === "caveat_card");

  assert.ok(price);
  assert.equal(price.label, "$120");
  assert.equal(price.detail, "PAID ACCESS");
  assert.ok(caveat);
  assert.equal(caveat.label, "EARLY ACCESS");
  assert.match(caveat.detail, /not all players/i);
});

test("Visual V3 still uses a price snap for price-led stories", () => {
  const plan = buildVisualV3OverlayPlan({
    story: {
      id: "switch-price",
      title: "Nintendo's new bundle price is $499 and the value split matters",
      source_type: "rss",
      publisher: "IGN",
      full_script:
        "IGN says the bundle price is $499, and the cost is the key detail for players comparing upgrades.",
    },
    words: wordsFrom(
      "IGN says the bundle price is four hundred and ninety nine dollars and the cost is the key detail",
    ),
    durationS: 55,
  });

  const price = plan.events.find((event) => event.kind === "price_snap");
  assert.ok(price);
  assert.equal(price.label, "$499");
  assert.equal(price.detail, "PRICE SIGNAL");
});

test("Visual V3 source lock prefers article publisher or URL host over subreddit", () => {
  const plan = buildVisualV3OverlayPlan({
    story: {
      id: "forza-source",
      title: "Forza Horizon 6 hits 130,000 players on Steam",
      url: "https://www.gamesradar.com/games/racing/forza-horizon-6-steam-record",
      subreddit: "pcgaming",
      full_script:
        "GamesRadar reports Forza Horizon 6 hit 130,000 concurrent players on Steam.",
    },
    words: wordsFrom(
      "GamesRadar reports Forza Horizon 6 hit one hundred and thirty thousand concurrent players on Steam",
    ),
    durationS: 62,
  });

  assert.equal(plan.events.find((event) => event.kind === "source_lock").source, "GAMESRADAR");
});

test("Visual V3 source lock can infer a named outlet from the script over generic Reddit metadata", () => {
  const plan = buildVisualV3OverlayPlan({
    story: {
      id: "forza-reddit-crosspost",
      title: "Forza Horizon 6 hits 130,000 players on Steam",
      url: "https://www.reddit.com/r/pcgaming/comments/example/forza_horizon_6_steam_record/",
      subreddit: "pcgaming",
      full_script:
        "GamesRadar reports Forza Horizon 6 hit 130,000 concurrent players on Steam.",
    },
    words: wordsFrom(
      "GamesRadar reports Forza Horizon 6 hit one hundred and thirty thousand concurrent players on Steam",
    ),
    durationS: 62,
  });

  assert.equal(plan.events.find((event) => event.kind === "source_lock").source, "GAMESRADAR");
});

test("Visual V3 filter emits a labelled ffmpeg overlay chain", () => {
  const plan = {
    events: [
      {
        kind: "steam_chart",
        atS: 6,
        durationS: 4,
        title: "STEAM PEAK",
        metric: "130,000",
        detail: "CONCURRENT PLAYERS",
      },
      {
        kind: "entity_fly_in",
        atS: 2,
        durationS: 2.6,
        entity: "Forza Horizon 6",
      },
    ],
  };

  const filter = buildVisualV3OverlayFilter({
    inputLabel: "heroBase",
    outputLabel: "visualV3Base",
    plan,
    fontOpt: "font='Arial'",
  });

  assert.match(filter, /^\[heroBase\]/);
  assert.match(filter, /\[visualV3Base\]$/);
  assert.match(filter, /STEAM PEAK/);
  assert.match(filter, /130\\,000/);
  assert.match(filter, /FORZA HORIZON 6/);
  assert.match(filter, /between\(t\\,6\.00\\,10\.00\)/);
});

test("Visual V3 chart overlays avoid empty placeholder bars and delayed box-only flashes", () => {
  const plan = {
    events: [
      {
        kind: "steam_chart",
        atS: 6,
        durationS: 4,
        title: "STEAM PEAK",
        metric: "130,000",
        detail: "CONCURRENT PLAYERS",
      },
    ],
  };

  const filter = buildVisualV3OverlayFilter({
    inputLabel: "heroBase",
    outputLabel: "visualV3Base",
    plan,
    fontOpt: "font='Arial'",
  });

  const drawboxSegments = filter.match(/drawbox=[^']+enable='between\(t\\,[^']+'\)/g) || [];

  assert.doesNotMatch(filter, /color=white@0\.(26|36)/);
  assert.ok(drawboxSegments.every((segment) => !segment.includes("6.00\\,10.00")));
  assert.match(filter, /drawbox=[^;\n]+between\(t\\,6\.12\\,10\.00\)/);
  assert.match(filter, /drawtext=[^;\n]+STEAM PEAK[^;\n]+between\(t\\,6\.00\\,10\.00\)/);
});

test("Visual V3 caveat cards stay out of the subtitle band", () => {
  const filter = buildVisualV3OverlayFilter({
    inputLabel: "base",
    outputLabel: "visualV3Base",
    plan: {
      events: [
        {
          kind: "caveat_card",
          atS: 14,
          durationS: 2.4,
          label: "EARLY ACCESS",
          detail: "Storefront data, not all players",
        },
      ],
    },
    fontOpt: "font='Arial'",
  });

  assert.match(filter, /drawbox=x=586:y=514:w=426:h=146/);
  assert.doesNotMatch(filter, /y=1160/);
});

test("Visual V3 accepts retention intelligence timeline adjustments", () => {
  const plan = buildVisualV3OverlayPlan({
    story: {
      id: "forza-retention",
      title: "Forza Horizon 6 hits 130,000 concurrent players on Steam",
      full_script:
        "GamesRadar reports Forza Horizon 6 hit 130,000 concurrent players on Steam.",
      publisher: "GamesRadar",
    },
    words: wordsFrom(
      "GamesRadar reports Forza Horizon 6 hit one hundred and thirty thousand concurrent players on Steam",
    ),
    durationS: 60,
    retentionIntelligence: {
      visual_v3_adjustments: {
        timeline_events: [
          {
            id: "retention_pattern_interrupt_3s",
            kind: "retention_pattern_interrupt",
            label: "KEEP WATCHING",
            detail: "A fresh angle interrupts the scroll",
            atS: 2.2,
            durationS: 1.8,
            priority: 96,
          },
        ],
      },
    },
  });
  const retentionEvent = plan.events.find(
    (event) => event.kind === "retention_pattern_interrupt",
  );
  const filter = buildVisualV3OverlayFilter({
    inputLabel: "base",
    outputLabel: "v3",
    plan,
    fontOpt: "font='Arial'",
  });

  assert.ok(retentionEvent);
  assert.equal(retentionEvent.source, "retention_intelligence");
  assert.match(filter, /KEEP WATCHING/);
  assert.match(
    filter,
    new RegExp(`between\\(t\\\\,${retentionEvent.atS.toFixed(2)}\\\\,${retentionEvent.endS.toFixed(2)}\\)`),
  );
});

test("Visual V3 drops redundant metric retention beats when the Steam chart already carries the number", () => {
  const plan = buildVisualV3OverlayPlan({
    story: {
      id: "forza-retention-metric",
      title: "Forza Horizon 6 hits 130,000 concurrent players on Steam",
      full_script:
        "GamesRadar reports Forza Horizon 6 hit 130,000 concurrent players on Steam.",
      publisher: "GamesRadar",
    },
    words: wordsFrom(
      "GamesRadar reports Forza Horizon 6 hit one hundred and thirty thousand concurrent players on Steam",
    ),
    durationS: 60,
    retentionIntelligence: {
      recommendations: [
        {
          id: "move_metric_first",
          action: "Move the Steam chart and concrete number into the opening four seconds.",
        },
      ],
      visual_v3_adjustments: {
        timeline_events: [
          {
            id: "retention_pattern_interrupt_3s",
            kind: "retention_pattern_interrupt",
            label: "THE NUMBER IS THE STORY",
            detail: "Steam chart beat",
            atS: 2.2,
            durationS: 1.8,
            priority: 96,
          },
        ],
      },
    },
  });

  const chart = plan.events.find((event) => event.kind === "steam_chart");

  assert.ok(chart);
  assert.equal(
    plan.events.some((event) => event.kind === "retention_pattern_interrupt"),
    false,
  );
  assert.ok(chart.atS < 4, `chart was not pulled early enough: ${chart.atS}`);
});

test("Visual V3 safe windows avoid text-heavy card scenes", () => {
  const plan = buildVisualV3OverlayPlan({
    story: {
      id: "forza-safe-windows",
      title: "Forza Horizon 6 hits 130,000 concurrent players on Steam",
      full_script:
        "GamesRadar reports Forza Horizon 6 hit 130,000 concurrent players on Steam during early access.",
      publisher: "GamesRadar",
    },
    words: wordsFrom(
      "GamesRadar reports Forza Horizon 6 hit one hundred and thirty thousand concurrent players on Steam during early access",
    ),
    durationS: 18,
    scenes: [
      { type: "opener", duration: 4, entity: "Forza Horizon 6" },
      { type: "card.source", duration: 3.2 },
      { type: "clip", duration: 4, entity: "Forza Horizon 6" },
      { type: "card.quote", duration: 3.4 },
      { type: "clip", duration: 3.4, entity: "Forza Horizon 6" },
    ],
    retentionIntelligence: {
      recommendations: [
        {
          id: "move_metric_first",
          action: "Move the Steam chart and concrete number into the opening four seconds.",
        },
      ],
    },
  });

  assert.equal(plan.safety.avoidsTextHeavySceneWindows, true);
  assert.ok(plan.safeWindows.every((window) => window.startS < 4 || window.startS >= 7.2));
  assert.ok(
    plan.events.every(
      (event) =>
        !(
          (event.atS >= 4 && event.atS < 7.2) ||
          (event.atS >= 11.2 && event.atS < 14.6)
        ),
    ),
  );
  assert.ok(plan.events.every((event, index, events) => {
    if (index === 0) return true;
    return event.atS >= events[index - 1].endS;
  }));
});

test("Visual V3 returns null filter when no planned events exist", () => {
  assert.equal(
    buildVisualV3OverlayFilter({
      inputLabel: "base",
      outputLabel: "visualV3Base",
      plan: { events: [] },
    }),
    null,
  );
});
