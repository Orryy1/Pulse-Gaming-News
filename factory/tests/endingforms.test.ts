import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENDING_FORMS,
  endingArmFor,
  endingFormProblems,
  endingFormRule,
  endingRecord,
  pickEndingForm,
  recentEndingForms,
  verdictLeadsIn,
} from "../src/editorial/endingforms.ts";
import { loadConfig } from "../src/config.ts";
import { logEvent } from "../src/episodes.ts";
import { goodScript, testDb } from "./helpers.ts";

test("ending arm: off at share 0, half at 0.5, by the hash", () => {
  assert.equal(endingArmFor(0.1, 0), "verdict");
  assert.equal(endingArmFor(0.1, 0.5), "forms");
  assert.equal(endingArmFor(0.7, 0.5), "verdict");
  assert.equal(endingArmFor(0.99, 1), "forms");
});

test("ENDING_FORMS_SHARE reads into the config, clamped, default 0", () => {
  const before = process.env.ENDING_FORMS_SHARE;
  const share = (v: string | undefined) => {
    if (v === undefined) delete process.env.ENDING_FORMS_SHARE;
    else process.env.ENDING_FORMS_SHARE = v;
    return loadConfig().endingFormsShare;
  };
  try {
    assert.equal(share(undefined), 0);
    assert.equal(share("0.5"), 0.5);
    assert.equal(share("3"), 1);
    assert.equal(share("x"), 0);
  } finally {
    share(before);
  }
});

test("pick: a retry keeps its form", () => {
  assert.equal(
    pickEndingForm(0.9, ["punchline", "punchline"], "punchline"),
    "punchline",
  );
});

test("pick: never a form used twice today while another is free", () => {
  const used = [
    "callback",
    "callback",
    "consequence",
    "consequence",
    "punchline",
  ];
  for (const h of [0, 0.3, 0.6, 0.99]) {
    const f = pickEndingForm(h, used);
    assert.ok(f === "fact" || f === "punchline", `hash ${h} gave ${f}`);
    // The least used wins: fact (0) over punchline (1).
    assert.equal(f, "fact");
  }
});

test("pick: across a busy day no form closes more than twice while the four have room", () => {
  const used: string[] = [];
  for (let i = 0; i < 8; i++) used.push(pickEndingForm((i * 0.37) % 1, used));
  for (const f of ENDING_FORMS)
    assert.equal(used.filter((u) => u === f).length, 2, f);
});

test("pick: every form is reachable with nothing used", () => {
  const seen = new Set([0, 0.26, 0.51, 0.76].map((h) => pickEndingForm(h, [])));
  assert.equal(seen.size, 4);
});

test("pick: an unknown kept form is ignored", () => {
  assert.ok(
    (ENDING_FORMS as readonly string[]).includes(
      pickEndingForm(0, [], "verdict"),
    ),
  );
});

test("rule names the form and bans the lead-ins", () => {
  const r = endingFormRule("callback");
  assert.match(r, /callback/);
  assert.match(r, /My verdict/);
  assert.match(r, /loop_line still follows/);
});

test("lead-ins are caught in their spoken forms", () => {
  for (const t of [
    "It costs more. My verdict: wait for reviews.",
    "My verdict? Skip it.",
    "My call: wait.",
    "Bottom line: it's a rumor.",
    "It's cheap. The bottom line is you wait.",
    "Here's my take, it's fine.",
    "Here’s my take, it's fine.",
    "Pulse check, faint.",
    "Verdict: buy it.",
    "It's cheap. Verdict: buy it.",
    "So my verdict on this one: buy it.",
    "My take: skip the deluxe.",
    "My verdict is simple: wait.",
    "Honestly, my verdict, wait.",
  ])
    assert.ok(verdictLeadsIn(t).length > 0, t);
});

test("ordinary endings are not lead-ins", () => {
  for (const t of [
    "The judges gave their verdict in 2019, and nobody liked it.",
    "That's the call Rockstar has to make next.",
    "On the call, Take-Two said the date holds.",
    "Sony made the call.",
    "It's the final call.",
    "After a quick call, Nintendo confirmed it.",
    "Fans now wait for the verdict.",
    "You'll pay $70 either way.",
    "Turns out the boat was the getaway car all along.",
    "The bottom line of the menu is greyed out.",
  ])
    assert.deepEqual(verdictLeadsIn(t), [], t);
});

test("problems: a forms-side Short that still says My verdict goes back to the writer", () => {
  const s = goodScript();
  const bad = { ...s, pulse_take: { ...s.pulse_take, narration: "It's pricier than it looks. My verdict: wait." } };
  assert.equal(endingFormProblems(bad).length, 1);
  assert.match(endingFormProblems(bad)[0]!, /My verdict/);
  const good = { ...s, pulse_take: { ...s.pulse_take, narration: "It's pricier than it looks, so the deluxe edition can wait." } };
  assert.deepEqual(endingFormProblems(good), []);
  const loop = { ...good, loop_line: "Bottom line: watch the price." };
  assert.equal(endingFormProblems(loop).length, 1);
});

test("record: the side, the form asked for and whether a lead-in slipped through", () => {
  const s = goodScript();
  const clean = { ...s, pulse_take: { ...s.pulse_take, narration: "So the deluxe edition can wait." } };
  assert.deepEqual(endingRecord("forms", "fact", clean), { arm: "forms", form_asked: "fact", lead_in: false });
  const said = { ...s, pulse_take: { ...s.pulse_take, narration: "My verdict: wait." } };
  assert.deepEqual(endingRecord("verdict", undefined, said), { arm: "verdict", lead_in: true });
});

test("recent forms: last day only, one per episode; this episode's own kept with no time window", async () => {
  const db = await testDb();
  await logEvent(db, null, "ending_forms", { arm: "forms", form: "fact" });
  await logEvent(db, null, "ending_forms", { arm: "verdict" });
  await db.query(
    `INSERT INTO events (episode_id, kind, detail, created_at) VALUES (NULL, 'ending_forms', $1, now() - interval '30 hours')`,
    [JSON.stringify({ arm: "forms", form: "callback" })],
  );
  await logEvent(db, "ep_a", "ending_forms", { arm: "forms", form: "punchline" });
  await logEvent(db, "ep_a", "ending_forms", { arm: "forms", form: "punchline" });
  await logEvent(db, "ep_b", "ending_forms", { arm: "forms", form: "consequence" });
  await db.query(
    `INSERT INTO events (episode_id, kind, detail, created_at) VALUES ('ep_old', 'ending_forms', $1, now() - interval '3 days')`,
    [JSON.stringify({ arm: "forms", form: "callback" })],
  );
  const r = await recentEndingForms(db, "ep_b", new Date());
  assert.equal(r.kept, "consequence");
  assert.deepEqual([...r.used].sort(), ["consequence", "fact", "punchline"].filter((f) => f !== "consequence"));
  const late = await recentEndingForms(db, "ep_old", new Date());
  assert.equal(late.kept, "callback");
});
