import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dropTagWords,
  extractVoiceTags,
  liftVoiceTags,
  stripVoiceTags,
  voiceTexts,
  voiceTagsIn,
  type VoiceTagMark,
} from "../src/voice/tags.ts";
import {
  wordsFromAlignment,
  requestBody,
  stabilityFor,
} from "../src/voice/elevenlabs.ts";
import { chunkTakes } from "../src/voice/elevenlabsLong.ts";
import { sparingSoundTags } from "../src/voice/breaths.ts";
import { micChainFilter, MIC_CHAIN } from "../src/voice/index.ts";
import {
  narrationOf,
  wordCount,
  type Script,
} from "../src/editorial/schema.ts";
import { validateScript } from "../src/editorial/editorial.ts";
import {
  voiceFor,
  VOICE_TAG_RULE,
  selfCorrections,
  SIGN_OFF,
  PULSE_VOICE,
} from "../src/editorial/voice.ts";
import { withVoiceTags, type Llm } from "../src/editorial/llm.ts";
import { checkNarration, heardSpeech } from "../src/qa/narration.ts";
import { loadConfig } from "../src/config.ts";
import { goodScript, testConfig } from "./helpers.ts";

// The owner's sample C (11 Nov 2026), as it was voiced.
const SAMPLE_C =
  "GTA 6 is already sitting in your PS5 download queue. [excited] Nine days early! PlayStation's own blog says it's the most pre-ordered game on the store, and honestly? [chuckles] I'm not even slightly surprised. Bought the code-in-box version? You can download too, once you've activated the code. Here's the catch, though... [sighs] downloading early isn't playing early. It still unlocks at midnight on November 19th, country by country. So start that download TONIGHT, because nothing ruins launch night like watching a progress bar crawl while everyone else is already driving round Vice City. [laughs] Are you downloading tonight, or waiting for launch day?";

test("tags come out of the text cleanly, and only the voice gets them back", () => {
  const clean = stripVoiceTags(SAMPLE_C);
  assert.doesNotMatch(clean, /\[|\]/);
  assert.match(
    clean,
    /queue\. Nine days early! .*honestly\? I'm not .*though\.\.\. downloading .*Vice City\. Are you/,
  );
  assert.equal(wordCount(SAMPLE_C), wordCount(clean), "a tag is never a word");
  const { text, marks } = extractVoiceTags(SAMPLE_C);
  assert.equal(text, clean);
  assert.deepEqual(
    marks.map((m) => m.tag),
    ["excited", "chuckles", "sighs", "laughs"],
  );
  assert.equal(
    voiceTexts([clean], marks)[0],
    SAMPLE_C,
    "the voice's text is the sample exactly",
  );
  assert.equal(
    stripVoiceTags("No tags  here,\n\n  kept as written."),
    "No tags  here,\n\n  kept as written.",
  );
  assert.equal(
    stripVoiceTags("Vice City [laughs]. [pause] Next."),
    "Vice City. Next.",
    "other cues go too",
  );
});

const TAGGED = (): Script =>
  goodScript({
    hook: "Starfield's second expansion has been delayed to early 2027. [sighs]",
    beats: [
      {
        ...goodScript().beats[0]!,
        narration:
          "[curious] Bethesda confirmed the move on Xbox Wire this morning and says the extra time will go on polish and performance across every platform.",
      },
      goodScript().beats[1]!,
    ],
    pulse_take: {
      ...goodScript().pulse_take,
      narration:
        "For us, Bethesda has delayed big content before and it usually lands in better shape, [chuckles] so this isn't a red flag yet.",
    },
    youtube: {
      ...goodScript().youtube,
      title: "[excited] Starfield Expansion Delayed To Early 2027",
    },
  });

test("a writer's answer is lifted clean: captions, titles and counts read plain words, the voice keeps the tags", async () => {
  const fake: Llm = { structured: async () => TAGGED() as never };
  const s = (await withVoiceTags(fake).structured({
    system: "",
    content: "",
    schema: undefined as never,
  })) as Script;
  assert.doesNotMatch(
    JSON.stringify({ ...s, voice_tags: undefined }),
    /\[(sighs|curious|chuckles|excited)\]/,
  );
  assert.equal(s.youtube.title, "Starfield Expansion Delayed To Early 2027");
  assert.equal(
    narrationOf(s),
    narrationOf(goodScript()),
    "every other reader gets the untagged narration",
  );
  assert.equal(wordCount(narrationOf(s)), wordCount(narrationOf(goodScript())));
  const voiced = narrationOf(s, { tags: true });
  assert.match(voiced, /early twenty twenty-seven\. \[sighs\] Bethesda/);
  assert.doesNotMatch(
    voiced,
    /\[curious\]/,
    "straight after the sigh: two in a row, dropped",
  );
  assert.match(voiced, /\[chuckles\] so this isn't/);
  assert.doesNotMatch(
    voiced,
    /\[excited\]/,
    "a title's tag never reaches the voice",
  );
  // Lifting again changes nothing, and the marks survive a converter that collects them.
  assert.deepEqual(liftVoiceTags(s), s);
  assert.equal(
    voiceTagsIn({ chapters: [{ chapter: s }] }).length,
    s.voice_tags!.length,
  );
});

test("a tagged script passes validation, lifted or not", () => {
  assert.deepEqual(validateScript(liftVoiceTags(TAGGED())), []);
  assert.deepEqual(
    validateScript(TAGGED()),
    [],
    "no check trips over a bracket left inline",
  );
});

test("ElevenLabs alignment with tag characters gives clean word timings", () => {
  const text = "And honestly? [chuckles] I'm not surprised.";
  const chars = [...text];
  const words = wordsFromAlignment({
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i * 0.05),
    character_end_times_seconds: chars.map((_, i) => i * 0.05 + 0.05),
  });
  assert.deepEqual(
    dropTagWords(words).map((w) => w.text),
    ["And", "honestly?", "I'm", "not", "surprised."],
  );
});

test("tag density: one every two sentences at most, never two in a row, never inside a quote", () => {
  const text =
    'One fact here. Two facts here. Three facts here. They said "it is coming soon" today. Five.';
  const marks: VoiceTagMark[] = [
    { tag: "excited", after: "", before: "One fact here." },
    { tag: "laughs", after: "One fact here.", before: "Two facts here." }, // one sentence after the last: dropped
    { tag: "sighs", after: "Two facts here.", before: "Three facts here." }, // two after: kept
    { tag: "curious", after: 'They said "it', before: 'is coming soon"' }, // inside a quotation: dropped
  ];
  assert.equal(
    voiceTexts([text], marks)[0],
    '[excited] One fact here. Two facts here. [sighs] Three facts here. They said "it is coming soon" today. Five.',
  );
  // The gap counts across fields too: a tag opening the next field right after one is dropped.
  const [a, b] = voiceTexts(
    ["Short line. [laughs]", "Next line."].map(stripVoiceTags),
    [
      { tag: "laughs", after: "Short line.", before: "" },
      { tag: "sighs", after: "", before: "Next line." },
    ],
  );
  assert.equal(`${a} ${b}`, "Short line. [laughs] Next line.");
  // A rewritten sentence loses its tag rather than putting it somewhere else.
  assert.deepEqual(voiceTexts(["A different sentence entirely."], marks), [
    "A different sentence entirely.",
  ]);
});

test("the writers' prompt carries the tag rule only when VOICE_TAGS is on, and only for narration", () => {
  assert.ok(voiceFor("news", true).endsWith(VOICE_TAG_RULE));
  assert.ok(voiceFor("documentary", true).includes(VOICE_TAG_RULE));
  assert.ok(!voiceFor("news", false).includes(VOICE_TAG_RULE));
  assert.ok(!voiceFor("community", true).includes(VOICE_TAG_RULE));
  assert.ok(!voiceFor("reply", true).includes(VOICE_TAG_RULE));
  for (const t of [
    "[excited]",
    "[chuckles]",
    "[laughs]",
    "[sighs]",
    "[whispers]",
    "[curious]",
    "[sarcastic]",
  ])
    assert.ok(VOICE_TAG_RULE.includes(t), t);
  assert.match(VOICE_TAG_RULE, /never two in a row/);
  assert.match(VOICE_TAG_RULE, /never inside a quotation/);
  assert.doesNotMatch(VOICE_TAG_RULE + PULSE_VOICE, /\u2014/, "no em dashes");
});

test("long takes split without parting a tag from its line", () => {
  const sentence = (i: number): string =>
    `Sentence number ${i} talks about the game for a while longer.`;
  const parts: string[] = [];
  for (let i = 0; i < 120; i++)
    parts.push(i % 3 === 0 ? `${sentence(i)} [chuckles]` : sentence(i));
  const text = parts.join(" ");
  const takes = chunkTakes(text, 600);
  assert.ok(takes.length > 5);
  for (const [i, t] of takes.entries()) {
    assert.equal(
      (t.match(/\[/g) ?? []).length,
      (t.match(/\]/g) ?? []).length,
      `take ${i} cuts a tag`,
    );
    if (i < takes.length - 1)
      assert.doesNotMatch(t, /\]\s*$/, `take ${i} ends on a tag`);
    assert.ok(t.length <= 620);
  }
  assert.equal(takes.join(" ").match(/\[chuckles\]/g)!.length, 40);
  assert.equal(stripVoiceTags(takes.join(" ")), stripVoiceTags(text));
});

test("the breath softener leaves a chuckle's span alone", () => {
  const words = [
    { text: "honestly?", start: 0, end: 0.5 },
    { text: "[chuckles]", start: 0.5, end: 0.6 },
    { text: "I'm", start: 1.4, end: 1.6 },
    { text: "not.", start: 1.6, end: 2 },
    { text: "Then", start: 2.6, end: 2.8 },
  ];
  assert.deepEqual(
    sparingSoundTags(
      [
        [0.6, 1.3],
        [2.1, 2.5],
      ],
      words,
    ),
    [[2.1, 2.5]],
  );
  assert.deepEqual(sparingSoundTags([[0.6, 1.3]], dropTagWords(words)), [
    [0.6, 1.3],
  ]);
});

test("the narration check ignores the sounds Whisper writes as cues", () => {
  const meant = [
    { text: "honestly?", start: 0, end: 0.5 },
    { text: "I'm", start: 1.4, end: 1.6 },
  ];
  const heard = [
    { text: "honestly?", start: 0, end: 0.5 },
    { text: "(chuckles)", start: 0.6, end: 1.2 },
    { text: "I'm", start: 1.4, end: 1.6 },
  ];
  assert.equal(heardSpeech(heard).length, 2);
  assert.deepEqual(checkNarration(meant, heard).issues, []);
});

test("the mic chain is sample C's, levelled back for the mix, and only when VOICE_MIC_CHAIN is on", () => {
  const on = micChainFilter(testConfig("/tmp", { voiceMicChain: true }))!;
  assert.ok(on.startsWith(MIC_CHAIN));
  for (const f of [
    "highpass=f=80",
    "equalizer=f=180:t=q:w=1:g=2",
    "equalizer=f=4500:t=q:w=1.2:g=3",
    "acompressor=threshold=-20dB:ratio=3:attack=5:release=80:makeup=3",
    "aecho=0.8:0.85:22:0.06",
  ])
    assert.ok(on.includes(f), f);
  assert.match(
    on,
    /loudnorm=I=-17:/,
    "back to the polish's level: the master sets the final loudness",
  );
  assert.doesNotMatch(on, /I=-14/);
  assert.equal(
    micChainFilter(testConfig("/tmp", { voiceMicChain: false })),
    undefined,
  );
});

test("settings default to sample C", () => {
  const keys = ["VOICE_STABILITY", "VOICE_TAGS", "VOICE_MIC_CHAIN"];
  const saved = keys.map((k) => process.env[k]);
  for (const k of keys) delete process.env[k];
  try {
    const cfg = loadConfig();
    assert.equal(cfg.voiceStability, 0.5);
    assert.equal(cfg.voiceTags, true);
    assert.equal(cfg.voiceMicChain, true);
    assert.equal(
      cfg.shortSpeed >= 1,
      true,
      "SHORT_SPEED is left to the Mac's .env",
    );
    process.env.VOICE_STABILITY = "nonsense";
    assert.equal(loadConfig().voiceStability, 0.5);
  } finally {
    keys.forEach((k, i) =>
      saved[i] === undefined
        ? delete process.env[k]
        : (process.env[k] = saved[i]),
    );
  }
  assert.equal(
    (
      requestBody("Hi.", { modelId: "eleven_v3" }).voice_settings as {
        stability: number;
      }
    ).stability,
    0.5,
  );
  assert.equal(
    stabilityFor("eleven_v3", 0.7),
    0.5,
    "eleven_v3 takes 0, 0.5 or 1",
  );
  assert.equal(stabilityFor("eleven_multilingual_v2", 0.7), 0.7);
});

test("human touches are allowances: two self-corrections in a Short are sent back", () => {
  assert.equal(
    selfCorrections(
      "It's out on the 18th... well, the 19th if you're in the US.",
    ),
    1,
  );
  const once = goodScript({
    hook: "Starfield's second expansion is out in 2027... well, early 2027 at the latest.",
  });
  assert.ok(
    !validateScript(once).some((p) => /corrects itself/.test(p)),
    "one is natural",
  );
  const twice = goodScript({
    hook: "Starfield's second expansion is out in 2027... well, early 2027 at the latest.",
    loop_line:
      "So if you're waiting, mark spring, or rather early 2027, for the expansion.",
  });
  assert.ok(
    validateScript(twice).some((p) => /corrects itself 2 times/.test(p)),
  );
  assert.ok(
    PULSE_VOICE.includes(SIGN_OFF),
    "the sign-off is the existing line, unchanged",
  );
});
