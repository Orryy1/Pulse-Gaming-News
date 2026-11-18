import { test } from "node:test";
import assert from "node:assert/strict";
import { videoMetadata } from "../src/pipeline.ts";
import { goodScript } from "./helpers.ts";
import { polishTitle } from "../src/editorial/seo.ts";

const ep = (why?: Record<string, unknown>): any => ({
  id: "e",
  lane: "news",
  story_json: {
    headline: "x",
    items: [{ source: "Xbox Wire", url: "https://news.xbox.com/a", sourceKind: "official" }],
    ...(why ? { why } : {}),
  },
  script_json: goodScript({ youtube: { ...goodScript().youtube, title: "Why GTA 6 lets you keep your Xbox One" } }),
  assets_json: {},
  publish_at: null,
});

test("a launch-run Why goes up under the title the run planned, word for word", () => {
  const planned = "How to Play GTA 6 Without a PS5 or Series X";
  const m = videoMetadata(ep({ question: "q", angle: "a", title: planned }), "public");
  assert.equal(m.title, planned);
});

test("without a planned title the writer's polished title stands", () => {
  const e = ep({ question: "q", angle: "a" });
  assert.equal(videoMetadata(e, "public").title, polishTitle(e.script_json));
});
