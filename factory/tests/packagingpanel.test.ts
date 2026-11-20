import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PACKAGING_PANEL,
  PACKAGING_VIEWER_SITE,
  REFERENCE_TITLES_FILE,
  loadReferenceTitles,
  packagingCandidates,
  packagingPanelEvent,
  packagingPanelLinesForReport,
  packagingPanelRuns,
  packagingPrompt,
  readPackaging,
  runPackagingPanel,
  type PackagingRead,
} from "../src/panel/packagingpanel.ts";
import { scoresFromEvent } from "../src/learn/judges.ts";
import { spearman } from "../src/analyticsloop.ts";
import { loadConfig } from "../src/config.ts";
import type { Llm } from "../src/editorial/llm.ts";
import type { Script } from "../src/editorial/schema.ts";
import { goodScript, tmpDir } from "./helpers.ts";

const longScript = (over: Partial<Script["youtube"]> = {}): Script =>
  goodScript({
    runtime: "long",
    youtube: {
      title: "The Ten Hardest Starfield Quests, Ranked",
      description: "A ranking.",
      tags: [],
      title_variants: [
        "Why Starfield's Hardest Quest Broke Players",
        "Starfield's 10 Hardest Quests in 2026",
      ],
      thumb_text: "HARDEST QUEST",
      ...over,
    },
  });

/** The lines of a critic's content: titles and thumbnail words with their labels. */
const listed = (content: string) => {
  const [titles, words = ""] = content.split("\n\nTHUMBNAIL WORDS\n");
  const parse = (block: string) =>
    block
      .split("\n")
      .filter((l) => /^[TW]\d+: /.test(l))
      .map((l) => ({
        label: l.slice(0, l.indexOf(":")),
        text: l.slice(l.indexOf(":") + 2),
      }));
  return { titles: parse(titles!), words: parse(words) };
};

const reader =
  (tapOf: (text: string) => number, seen: string[] = []) =>
  async (content: string): Promise<PackagingRead> => {
    seen.push(content);
    const l = listed(content);
    return {
      titles: l.titles.map((x) => ({
        label: x.label,
        tap: tapOf(x.text),
        why: "because",
      })),
      thumbs: l.words.map((x) => ({
        label: x.label,
        tap: tapOf(x.text),
        why: "because",
      })),
    };
  };

// ---------------------------------------------------------------- settings and off

test("settings default off; only check and on are read, and never on a Short", () => {
  const saved = process.env.PACKAGING_PANEL;
  delete process.env.PACKAGING_PANEL;
  try {
    assert.equal(loadConfig().packagingPanel, "off");
    process.env.PACKAGING_PANEL = "yes";
    assert.equal(loadConfig().packagingPanel, "off");
    process.env.PACKAGING_PANEL = "on";
    assert.equal(loadConfig().packagingPanel, "on");
  } finally {
    if (saved === undefined) delete process.env.PACKAGING_PANEL;
    else process.env.PACKAGING_PANEL = saved;
  }
  const sc = longScript();
  assert.equal(
    packagingPanelRuns("off", { long: true, script: sc }),
    false,
    "off changes nothing",
  );
  assert.equal(
    packagingPanelRuns("on", { long: false, script: sc }),
    false,
    "Shorts are never read",
  );
  assert.equal(packagingPanelRuns("check", { long: true, script: sc }), true);
  assert.equal(
    packagingPanelRuns("on", {
      long: true,
      script: { ...sc, packaging_panel: {} as never },
    }),
    false,
    "read once",
  );
  assert.deepEqual(
    packagingPanelLinesForReport([], spearman),
    [],
    "no record, no report line",
  );
});

// ---------------------------------------------------------------- candidates and references

test("candidates: the current title first, then the variants or the lab's top five; thumbnail words drawn from the video", () => {
  const sc = longScript();
  const plain = packagingCandidates(sc);
  assert.equal(plain.source, "variants");
  assert.deepEqual(
    plain.titles.map((t) => t.origin),
    ["current", "variant", "variant"],
  );
  assert.equal(plain.thumbs[0]!.text, "HARDEST QUEST");
  assert.ok(plain.thumbs.length <= PACKAGING_PANEL.thumbsMax);
  const lab = packagingCandidates(
    sc,
    Array.from({ length: 7 }, (_, i) => ({
      text: `Starfield Lab Title ${i}`,
      origin: "lab",
    })),
  );
  assert.equal(lab.source, "lab");
  assert.equal(lab.titles.length, PACKAGING_PANEL.titlesMax);
  assert.equal(
    lab.titles[0]!.text,
    sc.youtube.title,
    "the current title is always among them",
  );
});

test("reference titles: absent or malformed reads as none; good rows are kept", async () => {
  const dir = await tmpDir();
  assert.deepEqual(loadReferenceTitles(dir), []);
  fs.mkdirSync(path.join(dir, "frontier"), { recursive: true });
  fs.writeFileSync(path.join(dir, REFERENCE_TITLES_FILE), "{not json");
  assert.deepEqual(loadReferenceTitles(dir), []);
  fs.writeFileSync(
    path.join(dir, REFERENCE_TITLES_FILE),
    JSON.stringify([
      { title: " Every  Zelda Ranked ", channel: "Other", views: 900000 },
      { nope: 1 },
      { title: "" },
    ]),
  );
  assert.deepEqual(loadReferenceTitles(dir), [
    { title: "Every Zelda Ranked", channel: "Other", views: 900000 },
  ]);
});

// ---------------------------------------------------------------- the read

test("check: one blind call, our titles shuffled among references, the order recorded beside the factory's; nothing changes", async () => {
  const sc = longScript();
  const seen: string[] = [];
  const refs = Array.from({ length: 12 }, (_, i) => ({
    title: `Reference Title ${i}`,
    channel: `C${i}`,
    views: 1000,
  }));
  const r = await runPackagingPanel({
    script: sc,
    mode: "check",
    episodeId: "ep-long",
    candidates: packagingCandidates(sc),
    references: refs,
    read: reader(
      (t) =>
        t.startsWith("Why") ? 9 : t.startsWith("Reference Title 3") ? 10 : 5,
      seen,
    ),
  });
  assert.equal(seen.length, 1);
  const shown = listed(seen[0]!);
  assert.equal(shown.titles.length, 3 + PACKAGING_PANEL.referencesMax);
  assert.ok(!seen[0]!.includes("C1"), "no channel names: blind");
  assert.notEqual(
    shown.titles[0]!.text,
    sc.youtube.title,
    "ours do not come first (this seed)",
  );
  assert.equal(r.script, sc);
  assert.equal(r.record.changed, false);
  assert.equal(r.record.references, PACKAGING_PANEL.referencesMax);
  assert.equal(
    r.record.panel.title,
    "Why Starfield's Hardest Quest Broke Players",
    "never a reference title",
  );
  assert.equal(r.record.titles.length, 3, "only our own in the order");
  assert.equal(r.record.used.title, sc.youtube.title);
  assert.equal(r.record.used_rank, 2);
  assert.equal(r.record.used_tap, 5);
  assert.ok(r.record.reference_mean! > 5);
  assert.equal(r.record.factory.title, sc.youtube.title);
});

test("on: the panel's first choice among our own is used, the old title kept first in the Test & compare", async () => {
  const sc = longScript();
  const r = await runPackagingPanel({
    script: sc,
    mode: "on",
    episodeId: "ep-long",
    candidates: packagingCandidates(sc),
    references: [{ title: "Reference Title That Wins", views: 1 }],
    read: reader((t) =>
      t === "Reference Title That Wins"
        ? 10
        : t.startsWith("Why")
          ? 8
          : t === "STARFIELD HARDEST"
            ? 9
            : 5,
    ),
  });
  assert.equal(r.record.changed, true);
  assert.equal(
    r.script.youtube.title,
    "Why Starfield's Hardest Quest Broke Players",
  );
  assert.deepEqual(r.script.youtube.title_variants, [
    sc.youtube.title,
    "Starfield's 10 Hardest Quests in 2026",
  ]);
  assert.equal(
    sc.youtube.title,
    "The Ten Hardest Starfield Quests, Ranked",
    "the input script is not mutated",
  );
  assert.equal(r.record.used_rank, 1);
  assert.equal(r.record.used_tap, 8);
  const ev = packagingPanelEvent(r.record);
  assert.equal(ev.tap, 8);
  assert.equal(ev.changed, true);
});

test("on: the current title wins ties, and a candidate the caller holds out is never used", async () => {
  const sc = longScript();
  const tie = await runPackagingPanel({
    script: sc,
    mode: "on",
    episodeId: "ep-tie",
    candidates: packagingCandidates(sc),
    references: [],
    read: reader(() => 6),
  });
  assert.equal(tie.record.changed, false);
  assert.equal(tie.script.youtube.title, sc.youtube.title);
  const held = await runPackagingPanel({
    script: sc,
    mode: "on",
    episodeId: "ep-held",
    candidates: packagingCandidates(sc),
    references: [],
    read: reader((t) =>
      t.startsWith("Why") ? 9 : t.startsWith("Starfield's 10") ? 8 : 5,
    ),
    eligible: { title: (t) => !t.startsWith("Why"), thumb: () => false },
  });
  assert.equal(
    held.script.youtube.title,
    "Starfield's 10 Hardest Quests in 2026",
  );
  assert.equal(
    held.record.panel.title,
    "Why Starfield's Hardest Quest Broke Players",
    "the read still records it",
  );
  assert.equal(held.script.youtube.thumb_text, "HARDEST QUEST");
});

test("a failed read leaves the packaging as it was, recorded", async () => {
  const sc = longScript();
  const r = await runPackagingPanel({
    script: sc,
    mode: "on",
    episodeId: "ep-fail",
    candidates: packagingCandidates(sc),
    references: [],
    read: async () => Promise.reject(new Error("quota")),
  });
  assert.equal(r.script, sc);
  assert.equal(r.record.changed, false);
  assert.equal(r.record.error, "quota");
  assert.equal(r.record.calls, 1);
});

test("the read helper: packaging.viewer, mid tier, a blind prompt with no em dash", async () => {
  const seen: any[] = [];
  const llm = {
    structured: async (req: any) => (
      seen.push(req),
      { titles: [], thumbs: [] }
    ),
  } as unknown as Llm;
  await readPackaging(llm, "TITLES\nT1: x");
  assert.equal(seen[0].site, PACKAGING_VIEWER_SITE);
  assert.equal(seen[0].tier, "mid");
  assert.ok(!/[—–]/.test(packagingPrompt()));
});

// ---------------------------------------------------------------- calibration

test("calibration: the tap mark goes to the judge ledger and the weekly line sets it against click-through", () => {
  const [score] = scoresFromEvent({
    id: 9,
    episode_id: "ep-long",
    kind: "packaging_panel",
    detail: { mode: "check", tap: 7, rank: 2, changed: false },
    created_at: "2026-11-19T10:00:00Z",
  });
  assert.equal(score!.judge, "packaging_panel");
  assert.equal(score!.score, 7);
  const few = packagingPanelLinesForReport(
    [{ mode: "check", agreed: true, tap: 7, ctr: 0.05 }],
    spearman,
  );
  assert.match(
    few[0]!,
    /matched the factory's title on 1 of 1; tap mark against click-through: 1 of 20 videos so far/,
  );
  const many = packagingPanelLinesForReport(
    Array.from({ length: 21 }, (_, i) => ({
      mode: "on",
      agreed: false,
      tap: 1 + (i % 10),
      ctr: 0.01 * (1 + (i % 10)),
    })),
    spearman,
  );
  assert.match(many[0]!, /rank correlation 1\.00 over 21 videos/);
});
