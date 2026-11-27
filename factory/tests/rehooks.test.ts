import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRehook,
  quotedSentences,
  rehooksOf,
  longestRehookGap,
  rehookProblems,
  REHOOK_GAP_MAX_WORDS,
  REHOOK_RULE,
} from "../src/editorial/rehooks.ts";
import {
  validateChapter,
  chapterPrompt,
} from "../src/editorial/documentary.ts";
import { longformPrompt } from "../src/editorial/longform.ts";

/** A plain statement of n words, never a re-hook. */
const plain = (n: number, seed = "Studio") =>
  Array.from({ length: n }, (_, i) => (i === 0 ? seed : `w${i}`)).join(" ") +
  ".";

test("re-hook detector: questions, turns and teases count", () => {
  for (const s of [
    "So why did Rockstar wait twelve years?",
    "Would it be enough?",
    "But that wasn't the strangest part.",
    "But it would not last.",
    "And that is where it started to go wrong.",
    "Which is why the next decision mattered so much.",
    "Here's the thing nobody at Sega had planned for.",
    "Here’s where the money went.",
    "What happened next took everyone by surprise.",
    "There was just one problem.",
    "There was a catch.",
    "That's when the leaks began.",
    "That was only the beginning.",
    "Nobody knew it yet, but the console was already doomed.",
    "The real question was who would pay for it.",
    "Or so the studio thought.",
    "The studio was about to lose its biggest name.",
    "It would not stay that way for long.",
    "That decision would cost them a generation.",
    "We'll come back to that number later.",
  ])
    assert.equal(isRehook(s), true, s);
});

test("re-hook detector: plain statements, long contrasts and quotations do not", () => {
  for (const s of [
    "The game sold 17 million copies in its first year.",
    "Rockstar North moved into a new office in Edinburgh in 2002.",
    "But the game sold four million copies in its first week, beating every forecast the publisher had made.",
    "However, the PC port arrived a year later.",
    'Houser said, "Who is this game even for?"',
    "“Why would anyone buy it?” asked one reviewer.",
    '"What a mess," wrote one critic.',
    'He called it "only the beginning" in an interview.',
    "",
  ])
    assert.equal(isRehook(s), false, s);
  // A sentence that starts inside a quotation is the speaker's, not the narrator's.
  assert.equal(isRehook("Why did we bother?", true), false);
});

test("sentences know when they start inside a quotation", () => {
  const got = quotedSentences(
    'The memo was blunt. "We are out of money. Why are we still building this?" Nobody replied.',
  );
  assert.deepEqual(
    got.map((x) => x.text),
    [
      "The memo was blunt.",
      '"We are out of money.',
      'Why are we still building this?"',
      "Nobody replied.",
    ],
  );
  assert.deepEqual(
    got.map((x) => x.inQuote),
    [false, false, true, false],
  );
  // A question inside the quotation is not the narrator's re-hook.
  assert.deepEqual(
    rehooksOf([
      'The memo was blunt. "We are out of money. Why are we still building this?" Nobody replied.',
    ]),
    [],
  );
  // A quotation opened and left open by a question does not count either.
  assert.deepEqual(
    rehooksOf(['"Who is this for? We had no answer," he said.']),
    [],
  );
});

test("the gap is the longest run of words between re-hooks, across passages", () => {
  assert.deepEqual(longestRehookGap([]), { words: 0, from: "" });
  const a = plain(100, "First");
  const b = plain(150, "Second");
  const c = plain(120, "Third");
  // Before the first re-hook, between two, and after the last all count.
  assert.deepEqual(
    longestRehookGap([`${a} But it would not last. ${b}`, `${c} So why?`]),
    { words: 270, from: b },
  );
  assert.equal(longestRehookGap([`${a} ${b}`]).words, 250);
  // The re-hook itself is not part of a stretch.
  assert.equal(longestRehookGap(["Why did it fail?"]).words, 0);
  assert.deepEqual(rehooksOf([`${a} But it would not last.`, "So why?"]), [
    "But it would not last.",
    "So why?",
  ]);
});

test("re-hook problems: a stretch past the limit, and a line used twice", () => {
  const ok = [
    plain(200),
    "But that wasn't the strangest part.",
    plain(200),
    "So why did they wait?",
    plain(200),
  ];
  assert.deepEqual(rehookProblems(ok), []);
  const quiet = [plain(250, "Long"), plain(200, "Longer"), "So why?"];
  const p = rehookProblems(quiet);
  assert.equal(p.length, 1);
  assert.match(p[0]!, /450 words without a re-hook/);
  assert.match(p[0]!, /from "Long w1 w2/);
  assert.ok(450 > REHOOK_GAP_MAX_WORDS);
  assert.deepEqual(rehookProblems(quiet, 500), []);
  const twice = rehookProblems([
    "So why did they wait?",
    plain(50),
    "So why did they wait?",
  ]);
  assert.equal(twice.length, 1);
  assert.match(twice[0]!, /used twice/);
});

test("the writers ask for re-hooks and the chapter check reports a quiet chapter", () => {
  assert.ok(chapterPrompt().includes(REHOOK_RULE));
  assert.ok(longformPrompt().includes(REHOOK_RULE));
  assert.ok(!/[—]/.test(REHOOK_RULE));
  const para = (narration: string) => ({
    narration,
    callout: { kind: "none" as const, primary: "", secondary: "" },
    footage: { want: "gameplay" as const, keywords: ["x"] },
  });
  const quiet = {
    paragraphs: Array.from({ length: 5 }, (_, i) => para(plain(90, `P${i}`))),
    claims: [],
  };
  assert.ok(validateChapter(quiet).some((p) => /without a re-hook/.test(p)));
  quiet.paragraphs[2] = para(`${plain(84, "P2")} But it would not last.`);
  assert.ok(!validateChapter(quiet).some((p) => /re-hook/.test(p)));
});
