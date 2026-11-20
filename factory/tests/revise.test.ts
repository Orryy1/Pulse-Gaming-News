// A rejected draft is fixed by edits instead of a second full draft (29 Oct 2026: Opus output was most
// of the Claude bill), and falls back to a full rewrite whenever the edits do not land.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits } from "../src/editorial/revise.ts";
import { writeScript } from "../src/editorial/editorial.ts";
import { jobOf, type Llm } from "../src/editorial/llm.ts";
import { voiceFor } from "../src/editorial/voice.ts";
import { ScriptSchema } from "../src/editorial/schema.ts";
import { goodScript, item } from "./helpers.ts";

test("edits land on every text field they quote and leave the rest alone", () => {
  const draft = goodScript();
  const out = applyEdits(draft, [
    { find: "early 2027", replace: "spring 2027" },
    {
      find: "this isn't a red flag yet.",
      replace: "we'd hold off on calling it trouble.",
    },
  ])!;
  assert.equal(
    out.loop_line,
    "So if you're waiting, mark spring 2027 for Starfield's second expansion.",
  );
  assert.match(out.desk_question!, /spring 2027/);
  assert.match(
    out.pulse_take.narration,
    /we'd hold off on calling it trouble\.$/,
  );
  // Untouched lines stay word for word; case matters, so "Early 2027" on the card is not an edit target.
  assert.equal(out.beats[0]!.visual.primary, "Early 2027");
  assert.equal(out.beats[1]!.narration, draft.beats[1]!.narration);
  assert.equal(out.is_rumour, false);
  assert.ok(ScriptSchema.safeParse(out).success);
});

test("an edit that quotes text the draft does not have, or no edits at all, sends it back for a full rewrite", () => {
  const draft = goodScript();
  assert.equal(
    applyEdits(draft, [{ find: "not in the draft", replace: "x" }]),
    undefined,
  );
  assert.equal(
    applyEdits(draft, [
      { find: "early 2027", replace: "spring 2027" },
      { find: "not in the draft", replace: "x" },
    ]),
    undefined,
  );
  assert.equal(applyEdits(draft, []), undefined);
});

test("a quote copied with its JSON escapes still lands", () => {
  const out = applyEdits(goodScript(), [
    { find: "so this isn\\u0027t a red flag", replace: "so it's no red flag" },
  ]);
  assert.match(out!.pulse_take.narration, /so it's no red flag yet/);
});

const cluster = {
  hash: "story-hash",
  items: [item("Starfield expansion delayed", "IGN")],
} as never;

test("the news writer fixes a rejected draft by edits on the same instructions", async () => {
  const calls: Array<{ system: string; content: string }> = [];
  const llm = {
    structured: async (req: { system: string; content: string }) => {
      calls.push(req);
      return {
        edits: [
          {
            find: "this isn't a red flag yet",
            replace: "it's no red flag yet",
          },
        ],
      };
    },
  } as unknown as Llm;
  const out = await writeScript(llm, cluster, [], {
    mustLabelRumour: false,
    feedback: ['Fact-check: "red flag" - too strong'],
    draft: goodScript(),
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.content, /YOUR DRAFT \(JSON\)/);
  assert.match(calls[0]!.content, /- Fact-check: "red flag" - too strong/);
  assert.doesNotMatch(calls[0]!.content, /A previous draft was rejected/);
  assert.match(out.pulse_take.narration, /it's no red flag yet/);
  assert.equal(out.hook, goodScript().hook);
});

test("edits that miss, or a rumour-labelling problem, get a full rewrite as before", async () => {
  for (const [feedback, edits] of [
    [
      ['Fact-check: "x" - unsupported'],
      [{ find: "not in the draft", replace: "y" }],
    ],
    [["Rumour labelling is inadequate."], []],
  ] as const) {
    const contents: string[] = [];
    const llm = {
      structured: async (req: { content: string }) => {
        contents.push(req.content);
        return req.content.includes("YOUR DRAFT")
          ? { edits }
          : goodScript({ hook: "A fresh draft." });
      },
    } as unknown as Llm;
    const out = await writeScript(llm, cluster, [], {
      mustLabelRumour: false,
      feedback: [...feedback],
      draft: goodScript(),
    });
    assert.equal(out.hook, "A fresh draft.");
    assert.match(contents.at(-1)!, /A previous draft was rejected/);
  }
});

test("the usage log names a writer by its format, not by the shared house style", () => {
  assert.match(
    jobOf(`${voiceFor("news")}\n\nMore rules.`),
    /^This is a news Short/,
  );
  assert.match(jobOf(`${voiceFor("documentary")}`), /^This is a documentary/);
  assert.equal(
    jobOf("You check results.\n\nKeep only videos."),
    "Keep only videos.",
  );
});
