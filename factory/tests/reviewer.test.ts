// Item 20: the reviewer-readiness pack (the AI line, a sources link, the private records) and the AI picture gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AI_LINE,
  aiImageLookAnswer,
  aiImageProblem,
  buildRecords,
  disclosureLine,
  gateAiImages,
  hasAiPicture,
  hasReviewerPack,
  sourcesUrl,
  syntheticMediaFor,
  writeRecords,
} from "../src/reviewer.ts";
import { reviewerPackFor, videoMetadata } from "../src/pipeline.ts";
import { sourcesPage, videoSources } from "../src/web/site.ts";
import { goodScript } from "./helpers.ts";

const ep = (over: Record<string, unknown> = {}): any => ({
  id: "news_20261114_ab12cd34",
  lane: "news",
  youtube_video_id: "VIDEO000001",
  story_json: {
    headline: "x",
    items: [{ source: "IGN", url: "https://ign.com/a", sourceKind: "outlet" }],
  },
  script_json: goodScript(),
  assets_json: {},
  publish_at: null,
  ...over,
});

test("the disclosure line: standard, and true to the gameplay lane", () => {
  assert.equal(disclosureLine(goodScript()), AI_LINE);
  assert.match(AI_LINE, /AI-generated synthetic voice/);
  assert.match(
    disclosureLine({ ...goodScript(), gameplay: { direct: {} } as never }),
    /Xbox Series X.*synthetic voice/,
  );
  assert.match(
    disclosureLine({ ...goodScript(), gameplay: {} as never }),
    /No AI voice/,
  );
  assert.doesNotMatch(AI_LINE, /—/);
});

test("the sources link: the website and the id's tail", () => {
  assert.equal(
    sourcesUrl("https://pulsegmg.com/", "news_20261114_ab12cd34"),
    "https://pulsegmg.com/sources/ab12cd34",
  );
  assert.equal(
    reviewerPackFor({
      reviewerPack: false,
      siteUrl: "https://pulsegmg.com",
      publicUrl: "",
    }),
    undefined,
  );
  assert.deepEqual(
    reviewerPackFor({
      reviewerPack: true,
      siteUrl: "",
      publicUrl: "https://f.example/",
    }),
    {
      siteBase: "https://f.example",
    },
  );
});

test("descriptions: the pack off changes nothing; on adds the AI line and the sources link, kept by the length cut", () => {
  const off = videoMetadata(ep(), "public", true);
  assert.equal(
    videoMetadata(ep(), "public", true, undefined, false, new Date(), undefined)
      .description,
    off.description,
  );
  const on = videoMetadata(ep(), "public", true, undefined, false, new Date(), {
    siteBase: "https://pulsegmg.com",
  });
  assert.match(on.description, /How this video is made: /);
  assert.match(
    on.description,
    /Sources and notes for this video: https:\/\/pulsegmg\.com\/sources\/ab12cd34/,
  );
  assert.ok(hasReviewerPack(on.description));
  assert.ok(!hasReviewerPack(off.description));
  const long = ep({
    script_json: {
      ...goodScript(),
      youtube: { ...goodScript().youtube, description: "word ".repeat(1500) },
    },
  });
  const cut = videoMetadata(
    long,
    "public",
    true,
    undefined,
    false,
    new Date(),
    { siteBase: "https://pulsegmg.com" },
  );
  assert.ok(cut.description.length <= 5000);
  assert.ok(
    hasReviewerPack(cut.description),
    "the fixed lines survive the cut",
  );
});

test("the altered-content flag: the voice, or a kept AI picture under the gate", () => {
  const sketchy = { images: [{ file: "a.png", kind: "sketch" }] };
  assert.equal(hasAiPicture(sketchy), true);
  assert.equal(
    hasAiPicture({
      images: [{ file: "a.png", kind: "hero", provenance: "Steam" }],
    }),
    false,
  );
  assert.equal(syntheticMediaFor(true, {}, false), true);
  assert.equal(
    syntheticMediaFor(false, sketchy, false),
    false,
    "gate off: as before",
  );
  assert.equal(syntheticMediaFor(false, sketchy, true), true);
});

test("the AI picture gate: official-looking, photographic or unscreened pictures go", async () => {
  assert.equal(
    aiImageProblem({ sketch: true, photoreal: false, official: false }),
    undefined,
  );
  assert.equal(
    aiImageProblem({ sketch: true, photoreal: false, official: true }),
    "could pass as official game material",
  );
  assert.equal(
    aiImageProblem({ sketch: false, photoreal: true, official: false }),
    "reads as a photograph",
  );
  assert.equal(aiImageProblem(undefined), "not screened");
  assert.equal(aiImageLookAnswer({ sketch: true }), undefined);
  const images = [
    { file: "hero.jpg", kind: "hero", provenance: "Steam key art" },
    { file: "s1.png", kind: "sketch" },
    { file: "s2.png", kind: "sketch" },
    { file: "s3.png", kind: "sketch" },
  ];
  const looks: Record<string, any> = {
    s1: { sketch: true, photoreal: false, official: false },
    s2: { sketch: false, photoreal: false, official: true },
  };
  const dropped = await gateAiImages(
    images,
    "/ep",
    async (f) => looks[path.basename(f, ".png")],
  );
  assert.deepEqual(
    images.map((i) => i.file),
    ["hero.jpg", "s1.png"],
  );
  assert.deepEqual(dropped, [
    { file: "s2.png", problem: "could pass as official game material" },
    { file: "s3.png", problem: "not screened" },
  ]);
});

test("the private records: production steps, footage ledger and claims log", async () => {
  const e = ep({
    assets_json: {
      clips: [
        {
          file: "c1.mp4",
          provenance: "Official Steam trailer",
          sourceUrl: "https://steam/x",
          durationSeconds: 6.24,
        },
        {
          file: "c2.mp4",
          provenance: "Concept sketch brought to life by a local video model",
          durationSeconds: 5,
        },
      ],
      images: [{ file: "s.png", kind: "sketch", provenance: "" }],
    },
    factcheck_json: { warnings: ["one line disputed"] },
  });
  const r = buildRecords(
    e,
    [{ kind: "selected", at: "2026-11-14T10:00:00Z" }],
    new Date("2026-11-14T12:00:00Z"),
  );
  assert.equal(r.production.steps[0]!.kind, "selected");
  assert.equal(r.footage.clip_seconds, 11.2);
  assert.deepEqual(
    r.footage.clips.map((c) => c.ai_made),
    [false, true],
  );
  assert.equal(r.footage.pictures[0]!.ai_made, true);
  assert.deepEqual(r.claims.fact_check_warnings, ["one line disputed"]);
  assert.ok(r.claims.sources.includes("https://ign.com/a"));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "records-"));
  const out = await writeRecords(dir, e, [], new Date());
  assert.deepEqual((await fs.readdir(out)).sort(), [
    "claims.json",
    "footage.json",
    "production.json",
  ]);
});

test("a video's own sources page lists its sources and how it was made, not indexed", () => {
  const e = ep({
    script_json: {
      ...goodScript(),
      sources: ["https://www.rockstargames.com/newswire/1"],
    },
  });
  assert.equal(videoSources(e).length, 2);
  const html = sourcesPage(e, "https://pulsegmg.com", AI_LINE);
  assert.match(html, /noindex/);
  assert.match(html, /id="sources"/);
  assert.match(html, /https:\/\/youtu\.be\/VIDEO000001/);
  assert.match(html, /How this video is made/);
});
