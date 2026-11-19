import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BEST_MEAN,
  PANEL,
  panelContent,
  panelPick,
  runPanel,
  seededShuffle,
  type PanelCandidate,
  type PanelCritic,
  type PanelEvent,
  type PanelVerdict,
} from "../src/panel/panel.ts";
import { pickDraft, ROOM_PICK_RULE } from "../src/editorial/room.ts";
import {
  roomCriticRequests,
  roomRunRequests,
} from "./fixtures/make_room_critic_snapshot.ts";

const cands = (...ids: string[]): PanelCandidate[] =>
  ids.map((id) => ({ id, view: `view of ${id}` }));

const verdict = (
  marks: Record<string, number>,
  o: { pick?: string; drop?: string[] } = {},
): PanelVerdict => ({
  reads: Object.entries(marks).map(([id, overall]) => ({
    id,
    marks: { overall },
    overall,
    fault: `fault in ${id}`,
    ...(o.drop?.includes(id) ? { drop: true } : {}),
  })),
  ...(o.pick ? { pick: o.pick } : {}),
});

const critic = (
  name: string,
  v: PanelVerdict | (() => Promise<PanelVerdict>),
  required = false,
  seen: string[][] = [],
): PanelCritic => ({
  name,
  required,
  judge: async (cs) => {
    seen.push(cs.map((c) => c.view));
    return typeof v === "function" ? v() : v;
  },
});

// ---------------------------------------------------------------- the pick rule

test("pick: the best mean overall over the critics that marked it", () => {
  const p = panelPick(
    ["a", "b", "c"],
    [
      { critic: "editor", verdict: verdict({ a: 6, b: 8, c: 7 }) },
      { critic: "viewer", verdict: verdict({ a: 9, b: 6, c: 9 }) },
    ],
    BEST_MEAN,
  );
  assert.equal(p.pick, "c");
  assert.equal(p.means.c, 8);
  assert.match(p.why, /^c: best mean overall, 8 \(editor 7, viewer 9\)/);
});

test("pick: a candidate a required critic did not mark cannot win", () => {
  const p = panelPick(
    ["a", "b"],
    [
      { critic: "editor", required: true, verdict: verdict({ a: 5 }) },
      { critic: "viewer", verdict: verdict({ a: 5, b: 10 }) },
    ],
    BEST_MEAN,
  );
  assert.equal(p.pick, "a");
  assert.equal(p.means.b, undefined);
  const none = panelPick(
    ["a"],
    [{ critic: "editor", required: true }],
    BEST_MEAN,
  );
  assert.equal(none.pick, undefined);
});

test("ties: named tie-breaks in order, then the earlier candidate; why names the tie-break", () => {
  const both = [
    { critic: "editor", verdict: verdict({ a: 7, b: 8 }, { pick: "a" }) },
    { critic: "viewer", verdict: verdict({ a: 8, b: 7 }) },
  ];
  const byPick = panelPick(["a", "b"], both, {
    name: "r",
    ties: [{ by: "criticPick", critic: "editor" }],
  });
  assert.equal(byPick.pick, "a");
  assert.match(byPick.why, /tie broken by the editor's own pick/);
  const byMark = panelPick(["a", "b"], both, {
    name: "r",
    ties: [{ by: "critic", critic: "editor" }],
  });
  assert.equal(byMark.pick, "b");
  assert.match(byMark.why, /editor's higher mark/);
  const byPrefer = panelPick(["a", "b"], both, {
    name: "r",
    ties: [
      { by: "prefer", id: "b" },
      { by: "critic", critic: "viewer" },
    ],
  });
  assert.equal(byPrefer.pick, "b", "the current version wins ties");
  assert.match(byPrefer.why, /preferred candidate \(b\)/);
  const byOrder = panelPick(["a", "b"], both, BEST_MEAN);
  assert.equal(byOrder.pick, "a");
  assert.match(byOrder.why, /earlier candidate/);
});

test("drop: only when every critic in the panel read the pick and said drop", () => {
  const all = panelPick(
    ["a"],
    [
      { critic: "editor", verdict: verdict({ a: 3 }, { drop: ["a"] }) },
      { critic: "viewer", verdict: verdict({ a: 3 }, { drop: ["a"] }) },
    ],
    BEST_MEAN,
  );
  assert.equal(all.drop, true);
  const one = panelPick(
    ["a"],
    [
      { critic: "editor", verdict: verdict({ a: 3 }, { drop: ["a"] }) },
      { critic: "viewer" },
    ],
    BEST_MEAN,
  );
  assert.equal(one.drop, false, "a critic with no read never drops it");
});

// ---------------------------------------------------------------- the run, caps and the recorder

test("run: critics in order, blind views only, marks per critic per candidate, the recorder sees each step", async () => {
  const seen: string[][] = [];
  const events: PanelEvent[] = [];
  const r = await runPanel({
    candidates: cands("a", "b"),
    critics: [
      critic("editor", verdict({ a: 6, b: 7, zz: 10 }), true, seen),
      critic("viewer", verdict({ a: 8, b: 6 }), false, seen),
    ],
    recorder: (e) => events.push(e),
  });
  assert.deepEqual(seen, [
    ["view of a", "view of b"],
    ["view of a", "view of b"],
  ]);
  assert.equal(r.pick, "a");
  assert.equal(r.calls, 2);
  assert.deepEqual(r.callsBy, { editor: 1, viewer: 1 });
  assert.equal(r.marks.length, 4, "a read of a candidate not shown is ignored");
  assert.deepEqual(
    r.marks.map((m) => `${m.critic}:${m.id}:${m.overall}`),
    ["editor:a:6", "editor:b:7", "viewer:a:8", "viewer:b:6"],
  );
  assert.deepEqual(
    events.map((e) => e.kind),
    ["call", "read", "call", "read", "pick"],
  );
});

test("caps: the total, each critic's own and the candidates shown; the panel's own ceiling holds", async () => {
  const seen: string[][] = [];
  const r = await runPanel({
    candidates: cands("a", "b", "c"),
    critics: [
      critic("editor", verdict({ a: 6, b: 7, c: 9 }), true, seen),
      critic("viewer", verdict({ a: 6, b: 7 }), false, seen),
    ],
    caps: { calls: 1, candidates: 2 },
  });
  assert.equal(r.calls, 1);
  assert.deepEqual(r.skipped, ["viewer"]);
  assert.deepEqual(seen, [["view of a", "view of b"]]);
  assert.equal(r.pick, "b", "c was never shown");
  const own = await runPanel({
    candidates: cands("a"),
    critics: [
      critic("editor", verdict({ a: 6 }), true),
      critic("viewer", verdict({ a: 6 })),
    ],
    caps: { perCritic: { viewer: 0 } },
  });
  assert.deepEqual(own.skipped, ["viewer"]);
  assert.equal(own.pick, "a");
  const many = await runPanel({
    candidates: cands("a"),
    critics: Array.from({ length: 12 }, (_, i) =>
      critic(`c${i}`, verdict({ a: 5 })),
    ),
    caps: { calls: 99 },
  });
  assert.equal(many.calls, PANEL.callsMax);
});

test("a required critic's failure stops the panel; an optional one's only leaves its marks out", async () => {
  let viewerCalled = false;
  const failed = await runPanel({
    candidates: cands("a"),
    critics: [
      critic("editor", async () => Promise.reject(new Error("down")), true),
      {
        name: "viewer",
        judge: async () => ((viewerCalled = true), verdict({ a: 9 })),
      },
    ],
  });
  assert.equal(failed.pick, undefined);
  assert.equal(failed.failed.editor, "down");
  assert.equal(failed.callsBy.editor, 1, "a failed call still counts");
  assert.equal(viewerCalled, false);
  const optional = await runPanel({
    candidates: cands("a", "b"),
    critics: [
      critic("editor", verdict({ a: 6, b: 7 }), true),
      critic("viewer", async () => Promise.reject(new Error("slow"))),
    ],
  });
  assert.equal(optional.pick, "b");
  assert.equal(optional.failed.viewer, "slow");
});

test("a recorder that throws never breaks a run; faults are cut to one line", async () => {
  const r = await runPanel({
    candidates: cands("a"),
    critics: [
      {
        name: "editor",
        judge: async () => ({
          reads: [
            { id: "a", marks: {}, overall: 5, fault: "two\nlines  here" },
          ],
        }),
      },
    ],
    recorder: () => {
      throw new Error("bad recorder");
    },
  });
  assert.equal(r.pick, "a");
  assert.equal(r.marks[0]!.fault, "two lines here");
});

test("content and shuffle: views joined by a blank line; the shuffle is stable per seed", () => {
  assert.equal(panelContent(cands("a", "b")), "view of a\n\nview of b");
  const xs = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(seededShuffle(xs, "ep-1"), seededShuffle(xs, "ep-1"));
  assert.deepEqual(
    [...seededShuffle(xs, "ep-1")].sort((a, b) => a - b),
    xs,
  );
  assert.notDeepEqual(seededShuffle(xs, "ep-1"), seededShuffle(xs, "ep-2"));
});

// ---------------------------------------------------------------- the writers' room on the panel

test("the room's pick on the panel: best mean, then the editor's own pick, its higher mark, the earlier draft", () => {
  assert.equal(ROOM_PICK_RULE.ties[0]!.by, "criticPick");
  const e = (label: string, overall: number) => ({ label, overall });
  assert.equal(pickDraft([e("A", 6), e("B", 7)], [e("A", 9), e("B", 7)]), 0);
  assert.equal(
    pickDraft([e("A", 7), e("B", 7)], [e("A", 7), e("B", 7)], "B"),
    1,
  );
  assert.equal(pickDraft([e("A", 6), e("B", 8)], [e("A", 8), e("B", 6)]), 1);
  assert.equal(pickDraft([e("A", 7), e("B", 7)], undefined), 0);
  assert.equal(pickDraft([], undefined), -1);
});

test("the room's requests to room.critic and room.viewer are byte for byte what they were before the panel", async () => {
  const snapshot = JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "fixtures", "room_critic_requests.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await roomCriticRequests())),
    snapshot.direct,
  );
  const run = JSON.parse(JSON.stringify(await roomRunRequests()));
  assert.equal(
    run.length,
    6,
    "three drafts read, then two edits each read by both critics",
  );
  assert.deepEqual(run, snapshot.run);
});
