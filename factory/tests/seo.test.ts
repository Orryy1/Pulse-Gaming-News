import { test } from "node:test";
import assert from "node:assert/strict";

test("tags stay inside YouTube's 500 characters counting the quotes around multi-word tags", async () => {
  const { buildTags, tagChars } = await import("../src/editorial/seo.ts");
  const { goodScript } = await import("./helpers.ts");
  const many = Array.from({ length: 40 }, (_, k) => `Grand Theft Auto ranking term ${k}`);
  const tags = buildTags({ ...goodScript(), runtime: "long", youtube: { ...goodScript().youtube, tags: many } } as any);
  assert.ok(tagChars(tags) <= 500, `${tagChars(tags)} characters`);
  assert.equal(tagChars(["GTA", "Grand Theft Auto"]), 3 + 18 + 1);
  assert.ok(!buildTags({ ...goodScript(), youtube: { ...goodScript().youtube, tags: ["a, b"] } } as any).some((t) => t.includes(",")));
});
