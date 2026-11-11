import { test } from "node:test";
import assert from "node:assert/strict";
import { testConfig, goodScript } from "./helpers.ts";
import {
  lengthFormatOf,
  overInstagramLength,
  parseShortLengths,
  SHORT_NARRATION_CAP_SECONDS,
  SHORT_WORDS_PER_SECOND,
  shortLengthsSummary,
  shortTarget,
} from "../src/shortlengths.ts";
import { WORDS_PER_SECOND } from "../src/assets/footagefirst.ts";
import {
  scriptPrompt,
  validateScript,
  WORDS_MAX,
  WORDS_MIN,
} from "../src/editorial/editorial.ts";
import { redactedConfig } from "../src/config.ts";

const lanes = parseShortLengths("news=22-35, why=22-35, strand=60-75");

test("SHORT_LENGTHS parses a band per format and drops anything it cannot use", () => {
  assert.deepEqual(lanes, {
    news: { min: 22, max: 35 },
    why: { min: 22, max: 35 },
    strand: { min: 60, max: 75 },
  });
  assert.deepEqual(parseShortLengths(""), {});
  assert.deepEqual(
    parseShortLengths(
      "news=35-22,why=5-20,ranking=20-30,strand=60-400,news2=1-2",
    ),
    {},
    "backwards, too short, unknown format, too long",
  );
});

test("off: no lane, so every Short keeps 25-40 seconds, 70-100 words, two to four beats and the 58 s cap", () => {
  const cfg = testConfig("/tmp/x");
  assert.deepEqual(cfg.shortLengths, {});
  assert.equal(cfg.instagramMaxSeconds, 0);
  for (const f of ["news", "why", "strand"] as const)
    assert.equal(shortTarget(cfg.shortLengths, f), undefined);
  const prompt = scriptPrompt(true);
  assert.equal(prompt, scriptPrompt(true, undefined));
  assert.match(
    prompt,
    new RegExp(
      `Write a 25-40 second vertical Short script \\(${WORDS_MIN}-${WORDS_MAX} spoken words`,
    ),
  );
  assert.match(prompt, /2\. beats: two to four short fact beats/);
  assert.equal(SHORT_NARRATION_CAP_SECONDS, 58);
  assert.equal(overInstagramLength(cfg.instagramMaxSeconds, 52), false);
  assert.equal(redactedConfig(cfg).shortLengths, "off (25-40s)");
});

test("each Short is in its lane: news, why, or the strand's long lane only on own footage", () => {
  const news = { lane: "news", story_json: {} };
  assert.equal(lengthFormatOf(news), "news");
  assert.equal(
    lengthFormatOf({ lane: "news_breaking", story_json: {} }),
    "news",
  );
  assert.equal(
    lengthFormatOf({ lane: "news", story_json: { why: { question: "q" } } }),
    "why",
  );
  assert.equal(
    lengthFormatOf({
      lane: "news",
      story_json: { strand: { ownFootage: true } },
    }),
    "strand",
  );
  assert.equal(
    lengthFormatOf({
      lane: "news",
      story_json: { strand: { ownFootage: false } },
    }),
    "news",
  );
  for (const lane of ["evergreen", "gameplay", "cutdown", "longform"])
    assert.equal(lengthFormatOf({ lane, story_json: {} }), undefined, lane);
});

test("the word budget follows the seconds at the narrator's own pace", () => {
  assert.equal(
    SHORT_WORDS_PER_SECOND,
    WORDS_PER_SECOND,
    "the pace the footage planner times lines by",
  );
  // The old 25-40 seconds and 70-100 words came from the same pace.
  assert.ok(Math.abs(25 * SHORT_WORDS_PER_SECOND - WORDS_MIN) <= 6);
  assert.ok(Math.abs(40 * SHORT_WORDS_PER_SECOND - WORDS_MAX) <= 6);
  assert.deepEqual(shortTarget(lanes, "news"), {
    format: "news",
    seconds: { min: 22, max: 35 },
    wordsMin: 57,
    wordsMax: 91,
    beatsMax: 4,
    capSeconds: 58,
  });
  assert.deepEqual(shortTarget(lanes, "strand"), {
    format: "strand",
    seconds: { min: 60, max: 75 },
    wordsMin: 156,
    wordsMax: 195,
    beatsMax: 6,
    capSeconds: 80,
  });
  // "why" without its own band follows news; so does the strand when its lane is not set.
  const newsOnly = parseShortLengths("news=22-35");
  assert.equal(shortTarget(newsOnly, "why")?.wordsMax, 91);
  assert.equal(shortTarget(newsOnly, "strand")?.format, "news");
  assert.equal(shortTarget(newsOnly, "strand")?.capSeconds, 58);
  assert.equal(
    shortTarget(parseShortLengths("strand=60-75"), "news"),
    undefined,
  );
  assert.equal(
    shortLengthsSummary(lanes, 35),
    "news 22-35s, why 22-35s, strand 60-75s; Instagram up to 35s",
  );
});

test("the writer and the checks hold a Short to its lane", () => {
  const news = shortTarget(lanes, "news")!;
  assert.match(
    scriptPrompt(true, news),
    /Write a 22-35 second vertical Short script \(57-91 spoken words/,
  );
  const strand = shortTarget(lanes, "strand")!;
  const long = scriptPrompt(false, strand);
  assert.match(
    long,
    /Write a 60-75 second vertical Short script \(156-195 spoken words/,
  );
  assert.match(long, /2\. beats: two to six short fact beats/);
  // The fixture runs about 85 words: inside the old rule and the news lane, far under the strand lane.
  const words = (p: string[]) => p.filter((x) => /Spoken word count/.test(x));
  assert.deepEqual(words(validateScript(goodScript())), []);
  assert.deepEqual(words(validateScript(goodScript(), undefined, news)), []);
  assert.match(
    words(validateScript(goodScript(), undefined, strand))[0]!,
    /must be 156-195/,
  );
  // Six beats pass in the long lane only.
  const six = goodScript({
    beats: Array.from({ length: 6 }, () => goodScript().beats[0]!),
  });
  const beats = (p: string[]) => p.filter((x) => /beats\.$/.test(x));
  assert.deepEqual(beats(validateScript(six)), [
    "There must be two to four beats.",
  ]);
  assert.deepEqual(beats(validateScript(six, undefined, strand)), []);
});

test("INSTAGRAM_MAX_SECONDS keeps a longer Short off Instagram; 0 is no limit", () => {
  assert.equal(overInstagramLength(35, 36), true);
  assert.equal(overInstagramLength(35, 35), false);
  assert.equal(
    overInstagramLength(35, undefined),
    false,
    "unknown length: not held back",
  );
  assert.equal(overInstagramLength(0, 70), false);
});
