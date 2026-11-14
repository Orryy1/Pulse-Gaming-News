// CREDIT_SCRUB: invented credits come off before the fact check (the real drops of 12-14 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CREDIT_RULE, scrubCredits, scrubScriptCredits } from "../src/editorial/credits.ts";

const given = ["Wikipedia", "Rockstar Games"];

test("a credit to an outlet the writer was not given comes off and the fact stays", () => {
  const a = scrubCredits(
    "GameSpot's twenty twenty-one coverage of Xbox's Power On documentary says executives doubted Rockstar could pull off the move to 3D.",
    given,
  );
  assert.equal(a.text, "Executives doubted Rockstar could pull off the move to 3D.");
  assert.equal(a.removed.length, 1);
  const b = scrubCredits("It shipped broken. Bethesda's update notes say the patch fixed the save bug.", given);
  assert.equal(b.text, "It shipped broken. The patch fixed the save bug.");
  const c = scrubCredits("According to IGN, the map is twice the size.", given);
  assert.equal(c.text, "The map is twice the size.");
  const d = scrubCredits("The map is twice the size, according to Kotaku.", given);
  assert.equal(d.text, "The map is twice the size.");
  const e = scrubCredits("GameSpot's review said the combat felt heavy.", given);
  assert.equal(e.text, "The combat felt heavy.");
  const f = scrubCredits("As Eurogamer noted, the frame rate dips in the city.", given);
  assert.equal(f.text, "The frame rate dips in the city.");
});

test("a credit to a given source stays, and so does a studio speaking for itself", () => {
  const keep = [
    "Rockstar Games's own post says the trailer lands Tuesday.",
    "According to IGN, the map is twice the size.",
    "Rockstar says the game is on track.",
  ];
  assert.equal(scrubCredits(keep[0]!, given).removed.length, 0);
  assert.equal(scrubCredits(keep[1]!, ["IGN"]).removed.length, 0);
  assert.equal(scrubCredits(keep[2]!, []).removed.length, 0);
  assert.equal(scrubCredits("The game sold ten million copies.", []).removed.length, 0);
});

test("every spoken line of a Short is scrubbed; an untouched script comes back as it was", () => {
  const script = {
    hook: "GTA 3 almost never went 3D.",
    beats: [{ narration: "According to IGN, Rockstar doubted it." }, { narration: "It shipped in 2001." }],
    pulse_take: { narration: "Kotaku reported that it nearly broke the team." },
    loop_line: "And that is why.",
  };
  const r = scrubScriptCredits(script, given);
  assert.equal(r.removed.length, 2);
  assert.equal(r.script.beats[0]!.narration, "Rockstar doubted it.");
  assert.equal(r.script.pulse_take.narration, "It nearly broke the team.");
  assert.equal(scrubScriptCredits(r.script, given).script, r.script);
  assert.match(CREDIT_RULE, /name only sources you were actually given/);
});
