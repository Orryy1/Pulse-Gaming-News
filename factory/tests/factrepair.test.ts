import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlocker, repairBlockers } from "../src/factrepair.ts";
import { applyFixes } from "../src/factvault/check.ts";
import { speakable, speakContext } from "../src/voice/speakable.ts";

const ctx = speakContext(undefined);
const speak = (t: string) => speakable(t, ctx);

// The real blockers that failed three ranking Shorts on 19 Nov 2026 and a Buy, Wait or Skip on 14 Nov.
const THIRTY =
  'Fact-check: "now costs thirty dollars." - The supplied Steam price is $29.99. The script states $30 without a rounding qualifier, and the exact price is not shown on screen. Say “about thirty dollars” or “$29.99.”';
const TWO =
  "Fact-check: \"CheapShark's lowest tracked price across stores was two dollars.\" - The supplied low is $1.99. This rounding is unqualified, and the exact historical low is not shown on screen. Say 'under two dollars' or '$1.99'.";
const MOST_LISTS =
  'Fact-check: "Most lists rank Grand Theft Auto 5 higher" - The supplied sources do not establish how most other lists rank GTA V. This asserts an unsupported consensus.';
const USUAL_ORDER =
  'Fact-check: "one pick goes against the usual order." - The supplied sources establish no usual or consensus ranking of these protagonists or their endings. This asserts an unsupported consensus.';

const HOOK = "Every 3D Grand Theft Auto map, ranked from worst to best.";

// A Short is about 130 spoken words; the cuts may take up to 15% of them.
const PAD =
  "Claude never speaks a word. Tommy wants the whole city. CJ goes home for a funeral and stays for the war. Niko came for a fresh start and found the same old debts. Johnny rides with a club that is falling apart. Luis works the doors of the best clubs in town. Michael, Franklin and Trevor share one ending you choose yourself, and that choice says a lot about you. Each one of these endings lands differently, and each one tells you what the series cared about at the time it was made.";

test("parseBlocker splits the quote from the problem", () => {
  assert.deepEqual(
    parseBlocker(MOST_LISTS)?.quote,
    "Most lists rank Grand Theft Auto 5 higher",
  );
  assert.match(parseBlocker(MOST_LISTS)!.problem, /unsupported consensus/);
  assert.equal(parseBlocker("Fact-check failed: the summary"), undefined);
});

test("a rounded price said as digits gets 'about' (the checker heard it spoken)", () => {
  const fields = [
    HOOK,
    "Liberty City still holds up, and the Complete Edition now costs $30. That is a lot of city for the money.",
  ];
  const r = repairBlockers(fields, [THIRTY], speak);
  assert.deepEqual(r.unrepaired, []);
  assert.equal(r.repairs[0]!.kind, "rounding");
  const out = applyFixes(
    { fields },
    r.fixes.map((f) => ({ ...f, factId: 0, why: "" })),
  );
  assert.match(out.value.fields[1]!, /now costs about \$30\./);
  assert.equal(out.applied, 1);
});

test("a rounded price said in words gets 'about'", () => {
  const fields = [
    HOOK,
    "CheapShark's lowest tracked price across stores was two dollars. So wait for a sale.",
  ];
  const r = repairBlockers(fields, [TWO], speak);
  assert.deepEqual(r.unrepaired, []);
  assert.equal(
    r.fixes[0]!.to,
    "CheapShark's lowest tracked price across stores was about two dollars.",
  );
});

test("an already hedged figure is left alone (not repairable, so the check still fails)", () => {
  const fields = [
    HOOK,
    "It now costs about thirty dollars on Steam. Plenty of city.",
  ];
  const r = repairBlockers(fields, [THIRTY], speak);
  assert.equal(r.fixes.length, 0);
  assert.deepEqual(r.unrepaired, [THIRTY]);
});

test("an unsupported consensus clause before 'but' is cut and the stance stays", () => {
  const fields = [
    HOOK,
    "Most lists rank Grand Theft Auto 5 higher, but I put Vice City first for its ending. It still lands.",
    PAD,
  ];
  const r = repairBlockers(fields, [MOST_LISTS], speak);
  assert.deepEqual(r.unrepaired, []);
  assert.equal(r.repairs[0]!.kind, "drop_clause");
  assert.equal(r.fixes[0]!.to, "I put Vice City first for its ending.");
});

test("an unsupported side sentence is cut whole, with its spacing", () => {
  const fields = [
    HOOK,
    "Seven endings, seven men. One pick goes against the usual order. Let's start with Claude.",
    PAD,
  ];
  const r = repairBlockers(fields, [USUAL_ORDER], speak);
  assert.deepEqual(r.unrepaired, []);
  assert.equal(r.repairs[0]!.kind, "drop_sentence");
  const out = applyFixes(
    fields,
    r.fixes.map((f) => ({ ...f, factId: 0, why: "" })),
  );
  assert.equal(
    out.value[1],
    "Seven endings, seven men. Let's start with Claude.",
  );
});

test("a closing clause after a comma is cut", () => {
  const fields = [
    HOOK,
    "Seven endings and seven men, and one pick goes against the usual order. Let's start with Claude.",
    PAD,
  ];
  const r = repairBlockers(fields, [USUAL_ORDER], speak);
  assert.deepEqual(r.unrepaired, []);
  assert.equal(r.fixes[0]!.to, "Seven endings and seven men.");
});

test("both of the night's blockers in one script are mended together", () => {
  const fields = [
    HOOK,
    "Most lists rank Grand Theft Auto 5 higher, but I put Vice City first. And the Complete Edition now costs $30. Start there.",
    PAD,
  ];
  const r = repairBlockers(fields, [MOST_LISTS, THIRTY], speak);
  assert.deepEqual(r.unrepaired, []);
  assert.equal(r.fixes.length, 2);
});

test("never cuts the hook", () => {
  const fields = [
    "Most lists rank Grand Theft Auto 5 higher than this.",
    "Here is why that is wrong. Let's go.",
  ];
  const r = repairBlockers(fields, [MOST_LISTS], speak);
  assert.deepEqual(r.unrepaired, [MOST_LISTS]);
});

test("never cuts a rank announcement", () => {
  const fields = [
    HOOK,
    "Number one is Grand Theft Auto 5, and most lists rank Grand Theft Auto 5 higher. Done.",
    PAD,
  ];
  const r = repairBlockers(fields, [MOST_LISTS], speak);
  assert.deepEqual(r.unrepaired, [MOST_LISTS]);
});

test("never empties a whole field", () => {
  const fields = [HOOK, "One pick goes against the usual order.", PAD];
  const r = repairBlockers(fields, [USUAL_ORDER], speak);
  assert.deepEqual(r.unrepaired, [USUAL_ORDER]);
});

test("more blockers than the cap: nothing is repaired", () => {
  const fields = [
    HOOK,
    "Most lists rank Grand Theft Auto 5 higher, but I disagree. One pick goes against the usual order. It costs $30.",
    PAD,
  ];
  const r = repairBlockers(fields, [MOST_LISTS, USUAL_ORDER, THIRTY], speak);
  assert.equal(r.fixes.length, 0);
  assert.equal(r.unrepaired.length, 3);
});

test("a cut bigger than the share cap is refused", () => {
  const fields = [
    HOOK,
    "Short line here. One pick goes against the usual order. End.",
  ];
  const r = repairBlockers(fields, [USUAL_ORDER], speak, { maxCutShare: 0.1 });
  assert.deepEqual(r.unrepaired, [USUAL_ORDER]);
});

test("a quote that is not in the script is not repairable", () => {
  const r = repairBlockers(
    [HOOK, "Nothing like it here. At all."],
    [USUAL_ORDER],
    speak,
  );
  assert.deepEqual(r.unrepaired, [USUAL_ORDER]);
});

// Review cases (19 Nov): each of these once produced a wrong or damaging mend.
const fc = (quote: string, problem: string) =>
  `Fact-check: "${quote}" - ${problem}`;
const ROUND = "The source says otherwise; this rounding is unqualified.";
const CONSENSUS = "This asserts an unsupported consensus.";

test("hedges only the quoted figure, never a neighbour", () => {
  const fields = [
    HOOK,
    "It sold 350,000 copies in a week at $30. That is a lot.",
    PAD,
  ];
  const r = repairBlockers(
    fields,
    [
      fc(
        "sold 350,000 copies",
        "The source says 346,258; this is rounded without a qualifier.",
      ),
    ],
    speak,
  );
  assert.equal(
    r.fixes[0]!.to,
    "It sold about 350,000 copies in a week at $30.",
  );
  const none = repairBlockers(
    [HOOK, "It sold a lot of copies at $30. Fine.", PAD],
    [fc("sold a lot of copies", ROUND)],
    speak,
  );
  assert.equal(none.fixes.length, 0);
});

test("a wrong figure ('not a rounding difference') is never just hedged", () => {
  const fields = [HOOK, "It now costs $30 on Steam. Fine.", PAD];
  const r = repairBlockers(
    fields,
    [
      fc(
        "costs $30",
        "This is not a rounding difference; the price is $19.99.",
      ),
    ],
    speak,
  );
  assert.equal(r.fixes.length, 0);
});

test("hedge wording: 'a hundred', US$, and a sentence that opens on the figure", () => {
  const a = repairBlockers(
    [HOOK, "The bundle costs a hundred dollars now. Fine.", PAD],
    [fc("costs a hundred dollars", ROUND)],
    speak,
  );
  assert.equal(
    a.fixes[0]!.to,
    "The bundle costs about one hundred dollars now.",
  );
  const b = repairBlockers(
    [HOOK, "It costs US$30 in the store. Fine.", PAD],
    [fc("US$30", ROUND)],
    speak,
  );
  assert.equal(b.fixes[0]!.to, "It costs about US$30 in the store.");
  const c = repairBlockers(
    [HOOK, "Fine so far. $30 buys the whole map.", PAD],
    [fc("$30 buys the whole map", ROUND)],
    speak,
  );
  assert.equal(c.fixes[0]!.to, "About $30 buys the whole map.");
});

test("never cuts an ordinal rank line", () => {
  for (const line of [
    "In third place, the most loved map of all, Vice City.",
    "Coming in fourth is the fan favourite.",
  ]) {
    const r = repairBlockers(
      [HOOK, `Fine so far. ${line} Next.`, PAD],
      [fc(line, CONSENSUS)],
      speak,
    );
    assert.equal(r.fixes.length, 0, line);
  }
});

test("a bare 'and' is no clause boundary: the claim is not kept under a new subject", () => {
  const r = repairBlockers(
    [
      HOOK,
      "Fine so far. Most critics and fans agree it is the best. Next.",
      PAD,
    ],
    [fc("Most critics", CONSENSUS)],
    speak,
  );
  assert.equal(r.fixes.length, 0);
});

test("a plain comma is no clause boundary: no fragment is left", () => {
  const r = repairBlockers(
    [
      HOOK,
      "Fine so far. Released in 2004, it was the best-selling game ever. Next.",
      PAD,
    ],
    [fc("it was the best-selling game ever", CONSENSUS)],
    speak,
  );
  assert.equal(r.fixes.length, 0);
});

test("a quote in two sentences is ambiguous and left alone", () => {
  const r = repairBlockers(
    [
      HOOK,
      "The usual order is odd. Fine. One pick goes against the usual order. Next.",
      PAD,
    ],
    [fc("the usual order", CONSENSUS)],
    speak,
  );
  assert.equal(r.fixes.length, 0);
});

test("the last sentence of a field is cut with the space before it", () => {
  const fields = [
    HOOK,
    PAD,
    "That is my list. Most lists rank Grand Theft Auto 5 higher than I do.",
  ];
  const r = repairBlockers(fields, [MOST_LISTS], speak);
  assert.deepEqual(r.unrepaired, []);
  const out = applyFixes(
    fields,
    r.fixes.map((f) => ({ ...f, factId: 0, why: "" })),
  );
  assert.equal(out.value[2], "That is my list.");
});

// 21 Nov 2026: the Elder Scrolls long ranking was lost on three lines, one of them an absolute the checker
// itself offered a softer word for.
const ALWAYS =
  'Fact-check: "The quest marker always shows you where to go, so you\'re never lost the way Morrowind leaves you." - “Always” is inaccurate: Skyrim includes objectives without location markers, such as locating the Stones of Barenziah. Use “usually.”';
const SWITCH_MODS =
  'Fact-check: "Granted, Skyrim still has modding on every modern console." - Skyrim on Nintendo Switch does not support mods. Restrict this claim to supported PlayStation and Xbox versions.';
const MOD_MOST =
  "Fact-check: \"It's the bigger cultural moment, and it's still the one people mod most.\" - “The one people mod most” asserts a current comparative fact without supporting data or a defined metric.";
// A long video: well over LONG_SCRIPT_WORDS spoken words.
const LONG_PAD = Array.from({ length: 8 }, () => PAD).join(" ");

test("an absolute the checker names is softened in place, even on a rank line", () => {
  const line =
    "Number two is Skyrim. The quest marker always shows you where to go. That made it friendly.";
  const r = repairBlockers(
    [HOOK, line, PAD],
    [
      'Fact-check: "The quest marker always shows you where to go." - “Always” is inaccurate. Use “usually.”',
    ],
    speak,
  );
  assert.deepEqual(r.unrepaired, []);
  assert.equal(r.repairs[0]!.kind, "soften");
  assert.equal(
    r.fixes[0]!.to,
    "The quest marker usually shows you where to go.",
  );
});

test("an absolute with two absolutes in the quote is not softened (it falls back to a cut)", () => {
  const r = repairBlockers(
    [
      HOOK,
      `${PAD} The quest marker always shows you where to go, so you're never lost the way Morrowind leaves you.`,
    ],
    [ALWAYS],
    speak,
  );
  assert.ok(r.repairs.every((x) => x.kind !== "soften"));
});

test("a plainly wrong line is not softened when the problem is not about an absolute", () => {
  const r = repairBlockers(
    [HOOK, `${PAD} Chell never fires a gun in the first room.`],
    [
      'Fact-check: "Chell never fires a gun in the first room." - Chell has no gun in the first room at all.',
    ],
    speak,
  );
  assert.ok(r.repairs.every((x) => x.kind !== "soften"));
});

test("a long video may mend up to four lines; a Short still stops at two", () => {
  const body =
    "Granted, Skyrim still has modding on every modern console. It's the bigger cultural moment, and it's still the one people mod most. The quest marker always shows you where to go, so you're never lost the way Morrowind leaves you. Most lists rank Grand Theft Auto 5 higher, but I disagree.";
  const long = repairBlockers(
    [HOOK, `${LONG_PAD} ${body}`, "That is the list."],
    [SWITCH_MODS, MOD_MOST, ALWAYS, MOST_LISTS],
    speak,
  );
  assert.deepEqual(long.unrepaired, []);
  assert.equal(long.fixes.length, 4);
  const five = repairBlockers(
    [HOOK, `${LONG_PAD} ${body}`],
    [SWITCH_MODS, MOD_MOST, ALWAYS, MOST_LISTS, THIRTY],
    speak,
  );
  assert.equal(five.fixes.length, 0);
  const short = repairBlockers(
    [HOOK, `${PAD} ${body}`],
    [SWITCH_MODS, MOD_MOST, ALWAYS],
    speak,
  );
  assert.equal(short.fixes.length, 0);
  assert.equal(short.unrepaired.length, 3);
});
