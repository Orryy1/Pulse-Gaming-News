// Item 18's finish (FUNNEL_ALL_LONGS): funnel cuts from every long strand with chapters, not only the weekly guide,
// each saying and showing the right kind of link; rankings keep their own cutdowns.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUNNEL_CTA,
  FUNNEL_LINE,
  funnelCta,
  funnelKind,
  funnelLine,
  funnelParent,
  funnelScript,
} from "../src/funnel.ts";
import { pinnedComment } from "../src/editorial/seo.ts";
import type { Script } from "../src/editorial/schema.ts";

const chapter = (n: number, title: string) => ({
  kind: "chapter",
  primary: title,
  secondary: "Anthem",
  value_a: n,
  items: [],
});
const none = { kind: "none", primary: "", secondary: "" };

const doc = {
  story_type: "other",
  game_title: "Anthem",
  steam_search_term: "Anthem",
  headline: "How Anthem Lost Its Players",
  hook: "It had everything.",
  beats: [
    {
      narration: "The reveal was huge. Everyone watched.",
      visual: chapter(1, "The Reveal"),
    },
    { narration: "More of the reveal.", visual: none },
    {
      narration: "Launch day came. The servers buckled.",
      visual: chapter(2, "Launch Day"),
    },
    { narration: "More of launch day.", visual: none },
  ],
  pulse_take: { label: "OUR READ", narration: "", on_screen: "" },
  loop_line: "",
  is_rumour: false,
  attribution: "",
  youtube: {
    title: "How Anthem Lost 90% of Its Players in 3 Months",
    description: "",
    tags: ["Anthem"],
  },
  claims: [],
  runtime: "long",
  evergreen_format: "documentary",
} as unknown as Script;

const copy = {
  overlay_title: "ANTHEM: LAUNCH DAY",
  youtube_title: "Anthem's Launch Day: Why the Servers Buckled",
  description: "The day it went wrong.",
  question: "Did you play it at launch?",
};

test("the parent's kind: a guide, a documentary-shaped film, else a video", () => {
  assert.equal(funnelKind(doc, true), "guide");
  assert.equal(funnelKind(doc, false), "documentary");
  assert.equal(
    funnelKind(
      { ...doc, evergreen_format: undefined, every_game: {} as never },
      false,
    ),
    "documentary",
  );
  assert.equal(
    funnelKind({ ...doc, evergreen_format: undefined }, false),
    "video",
  );
});

test("the guide keeps its line and card; other kinds say what they are", () => {
  assert.equal(funnelLine("guide"), FUNNEL_LINE);
  assert.equal(funnelCta(), FUNNEL_CTA);
  assert.equal(
    funnelLine("documentary"),
    "The full documentary is linked just below.",
  );
  assert.equal(funnelCta("documentary"), "FULL DOCUMENTARY: LINK BELOW");
});

test("which long videos take funnel cuts", () => {
  assert.equal(funnelParent(doc, true, false), true, "the weekly guide always");
  assert.equal(
    funnelParent(doc, false, false),
    false,
    "others only under FUNNEL_ALL_LONGS",
  );
  assert.equal(funnelParent(doc, false, true), true);
  assert.equal(
    funnelParent({ ...doc, evergreen_format: "ranking" }, false, true),
    false,
    "a ranking keeps its own cutdowns",
  );
  assert.equal(
    funnelParent({ ...doc, beats: doc.beats.slice(0, 2) }, false, true),
    false,
    "one chapter is not enough",
  );
});

test("a documentary's cut says, shows and pins the documentary link; the control has none", () => {
  const link = funnelScript(doc, 2, copy, "LONGDOC0001", "link", "documentary");
  assert.equal(link.loop_line, "The full documentary is linked just below.");
  assert.match(
    link.youtube.description,
    /The full documentary: https:\/\/youtu\.be\/LONGDOC0001/,
  );
  assert.equal(link.cutdown?.kind, "documentary");
  assert.equal(link.pulse_take.label, "CHAPTER");
  assert.match(
    pinnedComment(link),
    /The full documentary: https:\/\/youtu\.be\/LONGDOC0001/,
  );
  const control = funnelScript(
    doc,
    2,
    copy,
    "LONGDOC0001",
    "none",
    "documentary",
  );
  assert.equal(control.loop_line, "");
  assert.doesNotMatch(control.youtube.description, /youtu\.be/);
  assert.doesNotMatch(pinnedComment(control), /youtu\.be/);
  const guideCut = funnelScript(doc, 2, copy, "LONGDOC0001", "link");
  assert.equal(guideCut.cutdown?.kind, undefined, "a guide's cut is as before");
  assert.equal(guideCut.loop_line, FUNNEL_LINE);
});
