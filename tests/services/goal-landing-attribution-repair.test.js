"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const packageJson = require("../../package.json");

const {
  repairGoalLandingAttribution,
} = require("../../lib/goal-landing-attribution-repair");
const {
  parseArgs: parseGoalLandingAttributionRepairArgs,
} = require("../../tools/goal-landing-attribution-repair");

async function writePackageFixture(tmp) {
  const artifactDir = path.join(tmp, "forza-package");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "forza-attribution",
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    thumbnail_headline: "FORZA STEAM SPIKE",
    first_spoken_line: "Forza Horizon 6 just gave Xbox the paid access warning it needed.",
    narration_script:
      "Forza Horizon 6 just gave Xbox the paid access warning it needed. Sources and setup links sit on the story page.",
  });
  await fs.writeJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: "forza-attribution",
    vertical: "gaming",
    disclosure_required: false,
    primary_link: null,
    fallback_links: [],
  });
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    status: "ready",
    routes: ["/p/forza-horizon-6-steam-peak"],
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    schema_version: 1,
    story_id: "forza-attribution",
    outputs: {},
    no_publish_triggered: true,
  });
  return {
    story_id: "forza-attribution",
    artifact_dir: artifactDir,
  };
}

test("goal landing attribution repair upgrades local artefacts with backups only", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-attribution-"));
  const storyPackage = await writePackageFixture(tmp);

  const dryRun = await repairGoalLandingAttribution({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T17:00:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.summary.repaired_count, 0);
  assert.equal(dryRun.items[0].target_attribution_verdict, "pass");

  const applied = await repairGoalLandingAttribution({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T17:01:00.000Z",
    apply: true,
    backupRoot: path.join(tmp, "backups"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  assert.equal(applied.safety.no_publish_triggered, true);
  assert.equal(applied.safety.no_db_mutation, true);
  assert.equal(applied.safety.local_artifact_files_only, true);

  const landing = await fs.readJson(path.join(storyPackage.artifact_dir, "landing_page_manifest.json"));
  const platform = await fs.readJson(path.join(storyPackage.artifact_dir, "platform_publish_manifest.json"));

  assert.equal(landing.attribution_manifest.verdict, "pass");
  assert.equal(Object.keys(landing.attribution_manifest.platforms).length, 7);
  assert.match(landing.attribution_manifest.platforms.youtube.landing_page_url, /utm_source=youtube/);
  assert.equal(platform.landing_page_attribution.verdict, "pass");
  assert.equal(await fs.pathExists(path.join(tmp, "backups", "forza-attribution", "landing_page_manifest.json")), true);
});

test("goal landing attribution repair replaces placeholder story routes with title routes", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-attribution-placeholder-"));
  const artifactDir = path.join(tmp, "v-rising-package");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "1s47yge",
    canonical_subject: "V Rising",
    selected_title: "V Rising Devs Are Making Another Vampire Game",
    narration_script: "V Rising devs are making another vampire game.",
  });
  await fs.writeJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: "1s47yge",
    landing_page_slug: "this-story-1s47yge",
    landing_page_route: "/p/this-story-1s47yge",
    disclosure_required: true,
    disclosure_copy: {
      short: "Affiliate links may earn us a commission.",
    },
  });
  await fs.writeJson(path.join(artifactDir, "youtube_publish_pack.json"), {
    description: "Sources and related links: /p/this-story-1s47yge",
    profile_or_landing_page_cta: "Story sources and related links: /p/this-story-1s47yge",
  });
  await fs.writeJson(path.join(artifactDir, "x_publish_pack.json"), {
    landing_page_link: "/p/this-story-1s47yge",
    thread: ["Sources and related links: /p/this-story-1s47yge"],
  });
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: "1s47yge",
    landing_page_slug: "this-story-1s47yge",
    landing_page_route: "/p/this-story-1s47yge",
    attribution_manifest: {
      verdict: "pass",
      platforms: {
        youtube: {
          landing_page_url: "/p/this-story-1s47yge?utm_source=youtube",
        },
      },
    },
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: "1s47yge",
    outputs: {
      youtube_shorts: {
        description: "Sources and related links: /p/this-story-1s47yge",
      },
      x: {
        landing_page_link: "/p/this-story-1s47yge",
      },
    },
    landing_page_attribution: {
      verdict: "pass",
      platforms: {
        youtube: {
          landing_page_url: "/p/this-story-1s47yge?utm_source=youtube",
        },
      },
    },
  });

  const applied = await repairGoalLandingAttribution({
    storyPackages: [{ story_id: "1s47yge", artifact_dir: artifactDir }],
    generatedAt: "2026-05-23T22:00:00.000Z",
    apply: true,
    backupRoot: path.join(tmp, "backups"),
  });

  assert.equal(applied.summary.repairable_count, 1);
  assert.equal(applied.summary.repaired_count, 1);

  const affiliate = await fs.readJson(path.join(artifactDir, "affiliate_link_manifest.json"));
  const landing = await fs.readJson(path.join(artifactDir, "landing_page_manifest.json"));
  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const youtube = await fs.readJson(path.join(artifactDir, "youtube_publish_pack.json"));
  const x = await fs.readJson(path.join(artifactDir, "x_publish_pack.json"));

  assert.equal(landing.landing_page_slug, "v-rising-devs-are-making-another-vampire-game");
  assert.equal(landing.landing_page_route, "/p/v-rising-devs-are-making-another-vampire-game");
  assert.equal(affiliate.landing_page_slug, "v-rising-devs-are-making-another-vampire-game");
  assert.equal(affiliate.landing_page_route, "/p/v-rising-devs-are-making-another-vampire-game");
  assert.match(landing.attribution_manifest.platforms.youtube.landing_page_url, /v-rising-devs-are-making-another-vampire-game/);
  assert.match(platform.outputs.youtube_shorts.description, /v-rising-devs-are-making-another-vampire-game/);
  assert.equal(platform.outputs.x.landing_page_link, "/p/v-rising-devs-are-making-another-vampire-game");
  assert.match(youtube.description, /v-rising-devs-are-making-another-vampire-game/);
  assert.equal(x.landing_page_link, "/p/v-rising-devs-are-making-another-vampire-game");
});

test("goal landing attribution repair preserves parsed offer ids from existing tracking routes", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-attribution-tracking-"));
  const artifactDir = path.join(tmp, "forza-package");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "1tf955x",
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Just Got More Expensive",
    narration_script: "Forza Horizon 6 just got more expensive for players.",
  });
  await fs.writeJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: "1tf955x",
    disclosure_required: true,
    disclosure_copy: {
      short: "Affiliate links may earn us a commission.",
    },
    primary_link: {
      label: "Racing wheel",
      product_category: "racing wheel",
      tracking_url: "/go/1tf955x/racing-wheel-racing-wheel-ps5-xbox-pc?platform=story_page&cta=racing%20wheel",
    },
  });
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: "1tf955x",
    landing_page_route: "/p/forza-horizon-6-1tf955x",
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: "1tf955x",
    landing_page_attribution: {
      verdict: "fail",
      platforms: {},
    },
  });

  const applied = await repairGoalLandingAttribution({
    storyPackages: [{ story_id: "1tf955x", artifact_dir: artifactDir }],
    generatedAt: "2026-05-23T22:10:00.000Z",
    apply: true,
    backupRoot: path.join(tmp, "backups"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  const landing = await fs.readJson(path.join(artifactDir, "landing_page_manifest.json"));
  const youtube = landing.attribution_manifest.platforms.youtube;
  assert.equal(landing.attribution_manifest.link_tracking[0].offer_id, "racing-wheel-racing-wheel-ps5-xbox-pc");
  assert.match(youtube.offer_tracking_url, /^\/go\/1tf955x\/racing-wheel-racing-wheel-ps5-xbox-pc\?/);
  assert.doesNotMatch(youtube.offer_tracking_url, /undefined|\/go\/\/undefined/);
});

test("goal landing attribution repair treats pass verdicts with broken offer routes as repairable", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-attribution-broken-offer-"));
  const artifactDir = path.join(tmp, "forza-package");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "1tf955x",
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Just Got More Expensive",
  });
  await fs.writeJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: "1tf955x",
    disclosure_required: true,
    disclosure_copy: { short: "Affiliate links may earn us a commission." },
    primary_link: {
      label: "Racing wheel",
      product_category: "racing wheel",
      tracking_url: "/go/1tf955x/racing-wheel-racing-wheel-ps5-xbox-pc?platform=story_page&cta=racing%20wheel",
    },
    landing_page_attribution: {
      verdict: "pass",
      platforms: {
        youtube: {
          offer_tracking_url: "/go//undefined?platform=youtube&cta=racing+wheel",
        },
      },
    },
  });
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: "1tf955x",
    landing_page_route: "/p/forza-horizon-6-1tf955x",
    attribution_manifest: {
      verdict: "pass",
      platforms: {
        youtube: {
          offer_tracking_url: "/go//undefined?platform=youtube&cta=racing+wheel",
        },
      },
    },
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: "1tf955x",
    landing_page_attribution: {
      verdict: "pass",
      platforms: {
        youtube: {
          offer_tracking_url: "/go//undefined?platform=youtube&cta=racing+wheel",
        },
      },
    },
  });

  const applied = await repairGoalLandingAttribution({
    storyPackages: [{ story_id: "1tf955x", artifact_dir: artifactDir }],
    generatedAt: "2026-05-23T22:20:00.000Z",
    apply: true,
    backupRoot: path.join(tmp, "backups"),
  });

  assert.equal(applied.summary.repairable_count, 1);
  assert.equal(applied.summary.repaired_count, 1);
  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  assert.doesNotMatch(
    platform.landing_page_attribution.platforms.youtube.offer_tracking_url,
    /undefined|\/go\/\/undefined/,
  );
});

test("goal landing attribution repair CLI is wired into package scripts", () => {
  const args = parseGoalLandingAttributionRepairArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--out-dir",
    "output/goal-contract",
    "--apply",
  ]);

  assert.equal(args.apply, true);
  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(packageJson.scripts["ops:goal-landing-attribution-repair"], "node tools/goal-landing-attribution-repair.js");
});
