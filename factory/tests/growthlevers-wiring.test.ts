// The growth levers joined to the factory: off changes nothing, on does what src/reach.ts, src/searchterms.ts and
// src/shortthumb.ts promise.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { designShortThumb, videoMetadata } from "../src/pipeline.ts";
import { handleRoutine } from "../src/routines.ts";
import { goodScript, testConfig } from "./helpers.ts";

const ep = (assets: Record<string, unknown>): any => ({
  id: "e",
  lane: "news",
  story_json: {
    headline: "x",
    items: [{ source: "IGN", url: "https://ign.com/a", sourceKind: "outlet" }],
  },
  script_json: goodScript(),
  assets_json: assets,
  publish_at: null,
});

test("search terms: a tag and one description line when there are some, nothing at all when there aren't", () => {
  const off = videoMetadata(ep({}), "public", true);
  const none = videoMetadata(ep({ searchTerms: [] }), "public", true);
  assert.equal(none.description, off.description);
  assert.deepEqual(none.tags, off.tags);
  const on = videoMetadata(
    ep({ searchTerms: ["oot remake", "ocarina of time switch 2"] }),
    "public",
    true,
  );
  assert.match(
    on.description,
    /Covers: oot remake, ocarina of time switch 2\./,
  );
  assert.ok(on.tags!.includes("oot remake"));
  // YouTube refuses more than 500 characters of tags, quotes included.
  const big = videoMetadata(
    ep({
      searchTerms: Array.from({ length: 80 }, (_, i) => `term number ${i}`),
    }),
    "public",
    true,
  );
  const chars = big.tags!.reduce(
    (n, t) => n + t.length + (t.includes(" ") ? 2 : 0) + 1,
    0,
  );
  assert.ok(chars <= 510, String(chars));
});

const thumbServices = (share: number, render: (i: any) => Promise<void>) =>
  ({
    cfg: testConfig(fs.mkdtempSync(path.join(os.tmpdir(), "lev-")), {
      shortSearchThumbShare: share,
    }),
    renderShortThumb: render,
  }) as any;

const script = (thumb?: string, rumour = false) =>
  ({
    ...goodScript(),
    is_rumour: rumour,
    youtube: { ...goodScript().youtube, thumb_text: thumb },
  }) as any;

test("search thumbnail: off by default and renders nothing", async () => {
  let called = 0;
  const assets: any = { images: [{ file: "a.jpg", kind: "hero", aspect: 1 }] };
  const s = thumbServices(0, async () => {
    called++;
  });
  await designShortThumb(s, "ep_1", "/tmp", script("BIG WORDS"), assets, 0);
  assert.equal(called, 0);
  assert.equal(assets.shortThumbArm, undefined);
  assert.equal(assets.shortThumb, undefined);
});

test("search thumbnail: on the designed side it becomes the Short's thumbnail; a rumour says so", async () => {
  const inputs: any[] = [];
  const assets: any = {
    shortThumb: "thumb_short.jpg",
    images: [{ file: "a.jpg", kind: "hero", aspect: 1 }],
  };
  const s = thumbServices(1, async (i) => {
    inputs.push(i);
  });
  await designShortThumb(
    s,
    "ep_1",
    "/tmp",
    script("big words", true),
    assets,
    0,
  );
  assert.equal(assets.shortThumbArm, "designed");
  assert.equal(assets.shortThumb, "thumb_search.jpg");
  assert.equal(inputs[0].words, "BIG WORDS");
  assert.equal(inputs[0].label, "REPORTED");
});

test("search thumbnail: no words, no picture or a failed render stays on the first frame, scored that way", async () => {
  for (const [sc, images, render] of [
    [
      script(undefined),
      [{ file: "a.jpg", kind: "hero", aspect: 1 }],
      async () => {},
    ],
    [script("WORDS"), [], async () => {}],
    [
      script("WORDS"),
      [{ file: "a.jpg", kind: "hero", aspect: 1 }],
      async () => {
        throw new Error("no chrome");
      },
    ],
  ] as const) {
    const assets: any = { shortThumb: "thumb_short.jpg", images };
    await designShortThumb(
      thumbServices(1, render as any),
      "ep_1",
      "/tmp",
      sc,
      assets,
      0,
    );
    assert.equal(assets.shortThumbArm, "frame");
    assert.equal(assets.shortThumb, "thumb_short.jpg");
  }
});

test("/routine/abtest: replaced uploads only drop out when AB_QUEUE_CLEAN is on", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lev-"));
  fs.mkdirSync(path.join(dir, "abtests"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "abtests", "pending.json"),
    JSON.stringify([
      {
        videoId: "OLD",
        episode: "e1",
        thumbs: [],
        publishAt: "2026-10-01T00:00:00Z",
      },
      {
        videoId: "AAA",
        episode: "e2",
        thumbs: [],
        publishAt: "2026-10-01T00:00:00Z",
      },
    ]),
  );
  const db = { query: async () => [] };
  const ids = async (abQueueClean: boolean): Promise<string[]> => {
    const ctx: any = {
      db,
      cfg: testConfig(dir, { abQueueClean }),
      now: () => new Date("2026-11-05T00:00:00Z"),
      channelLongs: async () => [{ id: "AAA", title: "A long video" }],
    };
    const srv = http.createServer(async (rq, rs) => {
      if (!(await handleRoutine(rq, rs, new URL(rq.url!, "http://local"), ctx)))
        rs.writeHead(404).end();
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    try {
      const r = await fetch(
        `http://127.0.0.1:${(srv.address() as AddressInfo).port}/routine/abtest`,
      );
      const j = (await r.json()) as { tests: Array<{ videoId: string }> };
      return j.tests.map((t) => t.videoId);
    } finally {
      srv.close();
    }
  };
  assert.deepEqual(await ids(false), ["OLD", "AAA"]);
  assert.deepEqual(await ids(true), ["AAA"]);
});
