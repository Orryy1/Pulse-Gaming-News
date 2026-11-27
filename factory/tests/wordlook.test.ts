import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fittingLooks,
  pickWordLook,
  remember,
  wordSoundCue,
  RECENT_KEEP,
  type RecentLook,
} from "../src/render/wordlook.ts";
import {
  W_STYLES,
  DEFAULT_LOOK,
} from "../src/render/components/wordmoment/index.ts";
import {
  isDate,
  isPrice,
  isDelay,
} from "../src/render/components/wordmoment/kit.tsx";

const DAY = "2026-10-30";
const confirm = { text: "NOV 19", sub: "CONFIRMED", tone: "confirm" };
const delayed = { text: "DELAYED", sub: "TO 2027", tone: "alert" };
const price = { text: "$49.99", sub: "", tone: "price" };
const free = { text: "FREE", sub: "", tone: "price" };
const offline = { text: "OFFLINE", sub: "NO DATE", tone: "alert" };

test("the suite has at least sixteen looks beyond the rubber stamp, each with a sound", () => {
  const ids = Object.keys(W_STYLES);
  assert.ok(ids.includes("Stamp"));
  assert.ok(ids.length >= 17, `${ids.length} looks`);
  for (const id of ids) {
    assert.equal(typeof W_STYLES[id]!.component, "function", id);
    assert.ok(
      ["land", "glint", "air", "vhs", "static", "tvon"].includes(
        W_STYLES[id]!.sound,
      ),
      id,
    );
  }
});

test("fits, tone and era filter the looks: a price gets the price gun, a date the passport, an old game the VHS", () => {
  assert.ok(fittingLooks(price, {}).includes("PriceGun"));
  assert.ok(!fittingLooks(confirm, {}).includes("PriceGun"));
  assert.ok(fittingLooks(confirm, {}).includes("Passport"));
  assert.ok(!fittingLooks(offline, {}).includes("Passport"));
  assert.ok(fittingLooks(confirm, {}).includes("WaxSeal"));
  assert.ok(!fittingLooks(delayed, {}).includes("WaxSeal"));
  assert.ok(fittingLooks(delayed, {}).includes("FileStamp"));
  assert.ok(!fittingLooks(confirm, {}).includes("FileStamp"));
  assert.ok(fittingLooks(offline, { year: 1998 }).includes("Vhs"));
  assert.ok(!fittingLooks(offline, { year: 2015 }).includes("Vhs"));
  assert.ok(!fittingLooks(offline, {}).includes("Vhs"));
  assert.ok(!fittingLooks(offline, { year: 1998 }).includes("Metal"));
  // The rubber stamp fits everything, so there is always a look.
  for (const st of [confirm, delayed, price, free, offline])
    assert.ok(fittingLooks(st, {}).includes("Stamp"), st.text);
});

test("the text shapes read as the looks need them", () => {
  for (const d of [
    "NOV 19",
    "March 2027",
    "Q1 2027",
    "2027",
    "19 Nov",
    "Spring 2027",
    "Early 2027",
  ])
    assert.ok(isDate(d), d);
  for (const d of ["DELAYED", "FREE", "OFFLINE", "$49.99"])
    assert.ok(!isDate(d), d);
  for (const p of ["$49.99", "£59", "FREE", "€69.99", "70 USD"])
    assert.ok(isPrice(p), p);
  for (const p of ["NOV 19", "DELAYED", "$49.99 EACH"])
    assert.ok(!isPrice(p), p);
  assert.ok(isDelay({ at: 0, colour: "", text: "PUSHED", sub: "TO 2027" }));
  assert.ok(isDelay({ at: 0, colour: "", text: "MAY 26", sub: "DELAYED" }));
  assert.ok(!isDelay({ at: 0, colour: "", text: "NOV 19", sub: "CONFIRMED" }));
});

test("the pick is deterministic and never the previous Short's look", () => {
  const ctx = { day: DAY, seed: 3 };
  const a = pickWordLook(confirm, ctx, []);
  assert.equal(a, pickWordLook(confirm, ctx, []));
  const b = pickWordLook(confirm, ctx, [{ look: a, day: "2026-10-29" }]);
  assert.notEqual(b, a);
  // Even when only two looks fit and one was just used, the other is taken.
  const prev = fittingLooks(free, {})[0]!;
  const c = pickWordLook(free, ctx, [{ look: prev, day: "2026-10-29" }]);
  assert.notEqual(c, prev);
});

test("a look is not used twice in one day while another fits, and unused looks come before used ones", () => {
  const ctx = { day: DAY, seed: 1 };
  const used: RecentLook[] = [];
  const seen = new Set<string>();
  const fits = fittingLooks(confirm, {});
  for (let i = 0; i < fits.length; i++) {
    const look = pickWordLook(confirm, ctx, used);
    assert.ok(
      !seen.has(look),
      `${look} twice on ${DAY} after ${[...seen].join(",")}`,
    );
    seen.add(look);
    used.unshift({ look, day: DAY });
    used.splice(RECENT_KEEP);
  }
  // Once every fitting look has been used today, the day rule yields and the least recent comes back.
  const again = pickWordLook(confirm, ctx, used);
  assert.ok(fits.includes(again));
  assert.notEqual(again, used[0]!.look);
  // With a memory of twelve, looks not in it are preferred to the ones in it.
  const recent = fits.slice(0, 5).map((look) => ({ look, day: "2026-10-20" }));
  const pick = pickWordLook(confirm, ctx, recent);
  assert.ok(
    !recent.some((r) => r.look === pick),
    `${pick} is in the recent list`,
  );
});

test("a motif steers the pick towards a look that suits it", () => {
  const ctx = { day: DAY, seed: 7, motif: "scifi" };
  const pick = pickWordLook(price, ctx, []);
  assert.ok(
    W_STYLES[pick]!.motifs?.includes("scifi"),
    `${pick} does not suit scifi`,
  );
  const seal = pickWordLook(
    confirm,
    { day: DAY, seed: 7, motif: "reddead" },
    [],
  );
  assert.ok(
    W_STYLES[seal]!.motifs?.includes("reddead"),
    `${seal} does not suit reddead`,
  );
  // The motif never beats the memory: a suiting look used yesterday loses to an unused one.
  const yesterday = Object.keys(W_STYLES)
    .filter((id) => W_STYLES[id]!.motifs?.includes("scifi"))
    .map((look) => ({ look, day: "2026-10-29" }));
  const other = pickWordLook(price, ctx, yesterday);
  assert.ok(!yesterday.some((r) => r.look === other));
});

test("the memory keeps the newest twelve and the sound follows the look", () => {
  let recent: RecentLook[] = [];
  for (let i = 0; i < 15; i++) recent = remember(recent, `L${i}`, DAY);
  assert.equal(recent.length, RECENT_KEEP);
  assert.equal(recent[0]!.look, "L14");
  assert.equal(recent[11]!.look, "L3");
  assert.equal(wordSoundCue("Stamp").name, "v3/land");
  assert.equal(wordSoundCue("Vhs").name, "retro/vhs");
  assert.equal(wordSoundCue("Neon").name, "v3/tick");
  assert.equal(wordSoundCue(undefined).name, "v3/land");
  assert.equal(wordSoundCue("NoSuchLook").name, "v3/land");
  assert.equal(
    pickWordLook({ text: "X", tone: "nonsense" }, { day: DAY }, []) !== "",
    true,
  );
  assert.equal(DEFAULT_LOOK, "Stamp");
});
