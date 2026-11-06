import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregatesIn,
  evidenceBeat,
  markEvidence,
  recordPassage,
} from "../src/editorial/evidence.ts";
import type { DocMoment } from "../src/editorial/documentary.ts";
import { evidenceStyle } from "../src/render/components/packs/pulse/evidence.ts";
import {
  aggregateRows,
  evidenceAddress,
} from "../src/render/components/packs/pulse/PulseEvidence.tsx";

const SOURCE = {
  title: "Cyberpunk 2077",
  url: "https://en.wikipedia.org/wiki/Cyberpunk_2077",
  text: [
    "In January 2020, CD Projekt announced that the game had been delayed to September 2020, saying it needed more time to finish testing, fixing and polishing.",
    'The co-founder Marcin Iwiński released a video apology, saying "we did not show the game on base last-gen consoles and that, of course, made many of you not able to make an informed decision about your purchase."',
    "Cyberpunk 2077 received generally favorable reviews on PC according to review aggregator Metacritic, which gave it a score of 86/100.",
    "On OpenCritic, 76% of critics recommended the game.",
    "Sony removed the game from the PlayStation Store on December 18, 2020, and offered full refunds to players who had bought it there.",
  ].join("\n"),
};

const bare = (show: string): DocMoment => ({
  show,
  keywords: [],
  broll: "",
  graphic: { kind: "none", primary: "", secondary: "", items: [] },
  emphasis: "",
  person: "",
});

test("the key beats are read from the narration sentence", () => {
  assert.equal(
    evidenceBeat("Then the studio apologized to every player."),
    "apology",
  );
  assert.equal(
    evidenceBeat("The launch was delayed again, to September."),
    "delay",
  );
  assert.equal(evidenceBeat("Critics gave it an 86 on Metacritic."), "verdict");
  assert.equal(evidenceBeat("It sold 13 million copies in ten days."), "sales");
  assert.equal(
    evidenceBeat("Keanu Reeves walked on stage and announced it."),
    "announcement",
  );
  assert.equal(evidenceBeat("Night City was full of neon."), undefined);
});

test("aggregates are taken from the source as written, with the aggregator named", () => {
  const a = aggregatesIn(SOURCE.text);
  assert.deepEqual(
    a.map((x) => [x.outlet, x.score, x.verdict]),
    [
      ["Metacritic", "86/100", "generally favorable"],
      ["OpenCritic", "76%", undefined],
    ],
  );
});

test("a key beat's record is the source sentence that shares its words and its beat", () => {
  const p = recordPassage(
    "Sony pulled Cyberpunk 2077 from the PlayStation Store and offered refunds.",
    "apology",
    SOURCE.text,
  );
  assert.match(p ?? "", /^Sony removed the game from the PlayStation Store/);
  assert.equal(
    recordPassage(
      "The studio apologized for the weather.",
      "apology",
      SOURCE.text,
    ),
    undefined,
  );
});

test("markEvidence tags a grounded quote, builds the aggregate page and the record, never two in a row", () => {
  const sentences = [
    "Cyberpunk 2077 had been promised for years.",
    "Then CD Projekt delayed it to September 2020 to finish testing, fixing and polishing.",
    "The game was set in Night City.",
    "Critics on PC were kind, and Metacritic's score said so.",
    "Players walked the neon streets.",
    "Iwiński recorded an apology.",
    "Sony pulled Cyberpunk 2077 from the PlayStation Store and offered full refunds.",
  ];
  const moments = sentences.map((x) => bare(x));
  moments[5]!.graphic = {
    kind: "quote",
    primary: "we did not show the game on base last-gen consoles",
    secondary: "Marcin Iwiński, CD Projekt co-founder",
    items: [],
  };
  const { moments: out, added } = markEvidence(moments, sentences, SOURCE, {
    max: 5,
  });
  // The delay: no graphic, neighbours bare, so the source's own sentence goes up as the record.
  assert.equal(out[1]!.graphic.kind, "source");
  assert.match(
    out[1]!.graphic.primary,
    /^In January 2020, CD Projekt announced/,
  );
  assert.equal(out[1]!.graphic.evidence?.page, "statement");
  // The verdict: the aggregate page with the figures exactly as the source gives them.
  assert.equal(out[3]!.graphic.kind, "reviews");
  assert.deepEqual(out[3]!.graphic.items, [
    "Metacritic: 86/100",
    "OpenCritic: 76%",
  ]);
  assert.equal(out[3]!.graphic.evidence?.page, "aggregate");
  // The apology quote, already grounded, becomes the statement with its issuer.
  assert.equal(out[5]!.graphic.evidence?.issuer, "Marcin Iwiński");
  // Sentence 6 sits beside the quote: no second graphic in a row.
  assert.equal(out[6]!.graphic.kind, "none");
  assert.equal(added.length, 3);
  // Nothing invented: every word on an evidence page is in the source.
  for (const m of out.filter((x) => x.graphic.evidence))
    for (const piece of [
      m.graphic.primary,
      ...m.graphic.items.map((i) => i.split(": ")[1]!),
    ])
      if (piece && m.graphic.kind !== "reviews")
        assert.ok(SOURCE.text.includes(piece), piece);
});

test("a quote the source does not carry is never tagged as a statement", () => {
  const sentences = ["Intro line here.", "The studio apologized to everyone."];
  const moments = sentences.map((x) => bare(x));
  moments[1]!.graphic = {
    kind: "quote",
    primary: "we are so very sorry about everything",
    secondary: "CD Projekt",
    items: [],
  };
  const { moments: out } = markEvidence(moments, sentences, SOURCE);
  assert.equal(out[1]!.graphic.evidence, undefined);
});

test("only tagged graphics take the evidence page, and the address bar names the article read", () => {
  const plain = {
    kind: "quote" as const,
    primary: "a quote of several words here",
    secondary: "Someone",
    items: [],
  };
  assert.equal(evidenceStyle(plain), undefined);
  const tagged = {
    ...plain,
    evidence: {
      kind: "apology",
      page: "statement" as const,
      credit: "From the record: Wikipedia, Cyberpunk 2077",
    },
  };
  assert.ok(evidenceStyle(tagged));
  assert.equal(
    evidenceAddress(tagged.evidence.credit),
    "en.wikipedia.org/wiki/Cyberpunk_2077",
  );
  assert.equal(aggregateRows(["Metacritic: 86/100"])?.[0]?.score, "86/100");
  assert.equal(aggregateRows(["IGN: 9/10"]), undefined);
});

test("a source's heading lines never join a sentence, and a record matches word stems", async () => {
  const { sourceSentences } = await import("../src/editorial/evidence.ts");
  const text = "Concern arose over review copies.\n## Post-release\nThe PC release received \"generally favorable\" reviews according to review aggregator website Metacritic.\nThis was delayed to 17 September, then 19 November, and finally 10 December.";
  assert.deepEqual(sourceSentences(text)[1], 'The PC release received "generally favorable" reviews according to review aggregator website Metacritic.');
  assert.equal(aggregatesIn(text)[0]!.passage.startsWith("The PC release"), true);
  assert.match(recordPassage("Then came the delays, first to September and then to November and December.", "delay", text) ?? "", /^This was delayed/);
});
