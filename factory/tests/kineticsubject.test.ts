import { test } from "node:test";
import assert from "node:assert/strict";
import { keyWords } from "../src/render/components/kinetic/words.ts";

const shown = (s: string) => {
  const k = keyWords(s)!;
  return k.shown.map((i) => k.tokens[i]).join(" ");
};

test("a kept clause keeps its subject (the Need for Speed Short showed 'If sold 18 million', 4 Nov)", () => {
  const line = shown("If it sold 18 million, why does it feel abandoned?");
  assert.match(line, /^If it sold 18 million/);
  assert.ok(line.split(" ").length <= 6, line);
});

test("an object pronoun can still come off", () => {
  assert.equal(
    shown("Nobody outside the studio knows it yet."),
    "Nobody outside the studio knows yet.",
  );
});
