import { test } from "node:test";
import assert from "node:assert/strict";
import { speakable, numberWords } from "../src/voice/speakable.ts";
import { formatPrice } from "../src/assets/steam.ts";
import { inWindow } from "../src/lanes.ts";
import { otherCurrencies } from "../src/render/components/cards/helpers.ts";

test("prices are spoken in the currency on screen", () => {
  // Said the quick way (owner, 25 Oct 2026): "$69.99" is "seventy dollars"; the screen keeps the exact price.
  assert.equal(speakable("It costs $69.99 on PS5."), "It costs seventy dollars on PS5.");
  assert.equal(speakable("Now £59.99 in the UK"), "Now sixty pounds in the UK");
  assert.equal(speakable("€79.99 or 69,99€"), "eighty euros or seventy euros");
  assert.equal(speakable("a $70 game"), "a seventy dollars game");
  assert.equal(speakable("$1 deal"), "one dollar deal");
  assert.equal(speakable("a $1.5bn deal"), "a one point five billion dollars deal");
  assert.equal(speakable("$1,299.00"), "one thousand two hundred ninety-nine dollars");
  assert.equal(speakable("No prices, 2027 and 86%."), "No prices, twenty twenty-seven and 86%.");
  assert.equal(numberWords(105), "one hundred five");
  assert.equal(numberWords(3_000_042), "three million forty-two");
});

test("Steam prices format as symbol and two decimals whatever the store's own formatting", () => {
  assert.equal(formatPrice({ currency: "USD", final: 6999 }), "$69.99");
  assert.equal(formatPrice({ currency: "GBP", final: 5999 }), "£59.99");
  assert.equal(formatPrice({ currency: "EUR", final: 7999 }), "€79.99");
  assert.equal(formatPrice({ currency: "JPY", final: 7999 }), undefined);
});

test("a window may run past midnight", () => {
  const L = "Europe/London";
  assert.equal(inWindow(new Date("2026-10-18T23:30:00Z"), "07:00-03:00", L), true, "00:30 BST");
  assert.equal(inWindow(new Date("2026-10-18T03:30:00Z"), "07:00-03:00", L), false, "04:30 BST");
  assert.equal(inWindow(new Date("2026-10-18T10:00:00Z"), "07:00-03:00", L), true);
});

test("a price card shows the other currencies only when they are the same product's", () => {
  const steam = { usd: "$69.99", gbp: "£59.99", eur: "€79.99" };
  assert.deepEqual(otherCurrencies("$69.99", undefined, steam), ["£59.99", "€79.99"]);
  assert.deepEqual(otherCurrencies("$19.99", undefined, steam), [], "a DLC price never borrows the base game's");
  assert.deepEqual(otherCurrencies("$29.99", ["£24.99", "PS5"], steam), ["£24.99"], "the writer's own figures from the sources win");
});

import { speakTitles } from "../src/voice/speakable.ts";

test("game titles are spoken the way players say them", () => {
  assert.equal(speakTitles("Call of Duty: Modern Warfare III landed in 2023."), "Call of Duty Modern Warfare 3 landed in 2023.");
  assert.equal(speakTitles("Call of Duty: WWII went back to Normandy."), "Call of Duty World War Two went back to Normandy.");
  assert.equal(speakTitles("Grand Theft Auto V and GTA IV"), "Grand Theft Auto 5 and GTA 4");
  assert.equal(speakTitles("Final Fantasy XIV, Final Fantasy X and Mega Man X"), "Final Fantasy 14, Final Fantasy 10 and Mega Man X");
  assert.equal(speakTitles("I think it is VERY good, and DLC is out."), "I think it is VERY good, and DLC is out.");
  assert.equal(speakTitles("Civilization VI and Halo V"), "Civilization 6 and Halo 5");
  assert.equal(speakTitles("XCOM 2 and MIX"), "XCOM 2 and MIX");
});

import { speakYears } from "../src/voice/speakable.ts";
import { displayWords, displayText } from "../src/render/timeline.ts";

test("years are spoken as people say them and shown as digits; percent shows as %", () => {
  assert.equal(speakYears("It launched in 2016, then 2007 and 1997."), "It launched in twenty sixteen, then two thousand seven and nineteen ninety-seven.");
  assert.equal(speakYears("$2016 and 2016% and 12016"), "$2016 and 2016% and 12016");
  const w = (text: string, start: number) => ({ text, start, end: start + 0.3 });
  const shown = displayWords([w("In", 0), w("twenty", 0.4), w("sixteen,", 0.8), w("47", 1.2), w("percent", 1.5), w("liked", 1.9), w("two", 2.2), w("thousand", 2.5), w("seven.", 2.8)]);
  assert.deepEqual(shown.map((x) => x.text), ["In", "2016,", "47%", "liked", "2007."]);
  assert.equal(shown[1]!.start, 0.4);
  assert.equal(shown[1]!.end, 1.1);
  assert.equal(displayText("47 percent of players"), "47% of players");
});

import { smoothTitleColons } from "../src/voice/speakable.ts";
import { titleLines } from "../src/render/longplan.ts";

test("a colon inside a game title gets no pause; a colon in a sentence keeps it", () => {
  assert.equal(smoothTitleColons("Call of Duty: Ghosts arrived."), "Call of Duty Ghosts arrived.");
  assert.equal(smoothTitleColons("Halo: Reach is next."), "Halo Reach is next.");
  assert.equal(smoothTitleColons("Here's the thing: Ghosts had a dog."), "Here's the thing: Ghosts had a dog.");
  assert.equal(smoothTitleColons("Verdict: Rushed and thin."), "Verdict: Rushed and thin.");
  assert.deepEqual(titleLines("Call of Duty Campaigns Ranked"), ["Call of Duty", "Campaigns Ranked"]);
});

import { loopLineUnfinished, tidyLoopLine } from "../src/editorial/schema.ts";

test("a last line never hangs on 'because'", () => {
  assert.equal(loopLineUnfinished("And that spark starts now, because"), true);
  assert.equal(loopLineUnfinished("So which match are you booking first?"), false);
  assert.equal(tidyLoopLine("And that spark starts now, because"), "And that spark starts now.");
  assert.equal(tidyLoopLine("The wait is over…"), "The wait is over.");
  assert.equal(tidyLoopLine("Which one are you playing first?"), "Which one are you playing first?");
});

test("counts and decimals are spoken in words and shown as figures again in the captions", async () => {
  const { speakable } = await import("../src/voice/speakable.ts");
  const { displayWords } = await import("../src/render/timeline.ts");
  const roundTrip = (text: string) => {
    const spoken = speakable(text);
    const words = spoken.split(/\s+/).map((t, k) => ({ text: t, start: k, end: k + 0.5 }));
    return { spoken, shown: displayWords(words).map((w) => w.text).join(" ") };
  };
  const cases: Array<[string, string, string]> = [
    ["32,619 Steam users are playing.", "almost thirty-three thousand Steam users are playing.", "almost 33,000 Steam users are playing."],
    ["More than 32,619 Steam users are playing.", "More than thirty-two thousand six hundred nineteen Steam users are playing.", "More than 32,619 Steam users are playing."],
    ["It holds 4.5 out of 5.", "It holds four point five out of 5.", "It holds 4.5 out of 5."],
    ["47.5% of players finished it.", "forty-seven point five percent of players finished it.", "47.5% of players finished it."],
    ["It sold 1.2 million copies.", "It sold one point two million copies.", "It sold 1.2 million copies."],
    ["Over 1,000,000 downloads.", "Over one million downloads.", "Over 1 million downloads."],
    ["2,000 players joined.", "two thousand players joined.", "2,000 players joined."],
    ["376,411 reviews at 90 percent.", "almost three hundred eighty thousand reviews at 90 percent.", "almost 380,000 reviews at 90%."],
  ];
  for (const [text, spoken, shown] of cases) {
    const r = roundTrip(text);
    assert.equal(r.spoken, spoken, `voice: ${text}`);
    assert.equal(r.shown, shown, `captions: ${text}`);
  }
  // Names, small numbers, prices and years keep their own handling.
  assert.equal(speakable("Xbox 360 and the RTX 4090"), "Xbox 360 and the RTX 4090");
  assert.equal(roundTrip("One of the best, and one hundred percent worth it.").shown, "One of the best, and 100% worth it.");
  // The captions show what is said: a price said the quick way is captioned the quick way.
  assert.equal(roundTrip("It costs $49.99 today.").shown, "It costs $50 today.");
  assert.equal(roundTrip("Down to $1.19 now.").shown, "Down to $1.19 now.");
  assert.equal(roundTrip("It came out in 2007.").shown, "It came out in 2007.");
});

test("Series X|S is said as Series X and S and shown as X|S", () => {
  assert.equal(speakTitles("on PS5 and Xbox Series X|S, three generations"), "on PS5 and Xbox Series X and S, three generations");
  assert.equal(speakTitles("Xbox Series X/S"), "Xbox Series X and S");
  assert.equal(speakTitles("Mega Man X and Series X"), "Mega Man X and Series X");
  const w = (text: string, start: number) => ({ text, start, end: start + 0.2 });
  const shown = displayWords([w("Xbox", 0), w("Series", 0.3), w("X", 0.6), w("and", 0.8), w("S,", 1), w("three", 1.3)]);
  assert.deepEqual(shown.map((x) => x.text), ["Xbox", "Series", "X|S,", "three"]);
  assert.equal(shown[2]!.start, 0.6);
  assert.equal(shown[2]!.end, 1.2);
});

test("big counts are rounded the way people say them", async () => {
  const { roundCounts } = await import("../src/voice/speakable.ts");
  assert.equal(roundCounts("from 346,258 reviews"), "from almost 350,000 reviews");
  assert.equal(roundCounts("a peak of 233,409 players"), "a peak of over 230,000 players");
  assert.equal(roundCounts("9,799 players and 8,049 reviews"), "almost 10,000 players and over 8,000 reviews");
  assert.equal(roundCounts("sold 1,250,000 copies"), "sold almost 1.3 million copies");
  assert.equal(roundCounts("2,000 players"), "2,000 players");
  assert.equal(roundCounts("more than 346,258 reviews"), "more than 346,258 reviews");
  assert.equal(roundCounts("costs $1,299 and 1,250.50 points"), "costs $1,299 and 1,250.50 points");
});

test("storage and frequency units are said in full and captioned as symbols", async () => {
  const { speakUnits } = await import("../src/voice/speakable.ts");
  assert.equal(speakUnits("Phantom Blade Zero needs 134GB of space"), "Phantom Blade Zero needs 134 gigabytes of space");
  assert.equal(speakUnits("a 1 TB drive, 16 GB of RAM and a 1.5GB patch at 120Hz"), "a 1 terabyte drive, 16 gigabytes of RAM and a 1.5 gig patch at 120 hertz");
  assert.equal(speakUnits("the GB in GBA and 4K"), "the GB in GBA and 4K");
  assert.equal(speakable("It needs 134GB."), "It needs 134 gigabytes.");
  const w = (text: string, start: number) => ({ text, start, end: start + 0.2 });
  assert.deepEqual(displayWords([w("needs", 0), w("134", 0.3), w("gigabytes.", 0.6)]).map((x) => x.text), ["needs", "134GB."]);
  assert.deepEqual(displayWords([w("one", 0), w("point", 0.3), w("five", 0.6), w("gigabytes", 0.9)]).map((x) => x.text), ["1.5GB"]);
});

test("a lone V or X is read as a numeral after a numbered series, and left alone elsewhere", () => {
  assert.equal(speakTitles("Metal Gear Solid V was the last one."), "Metal Gear Solid 5 was the last one.");
  assert.equal(speakTitles("Mega Man X is great"), "Mega Man X is great");
  assert.equal(speakTitles("the Xbox Series X and the X button"), "the Xbox Series X and the X button");
});

test("a Roman numeral before a possessive or a hyphen is still a number", () => {
  assert.equal(speakTitles("Grand Theft Auto VI's launch trailer is out"), "Grand Theft Auto 6's launch trailer is out");
  assert.equal(speakTitles("GTA VI’s map"), "GTA 6’s map");
  assert.equal(speakTitles("a GTA VI-sized launch"), "a GTA 6-sized launch");
  assert.equal(speakTitles("VIP passes"), "VIP passes");
});

test("prices are said the quick way; cheap ones that do not end in .9x keep their cents", async () => {
  const { speakable } = await import("../src/voice/speakable.ts");
  assert.equal(speakable("It costs $29.99."), "It costs thirty dollars.");
  assert.equal(speakable("Down to $4.99 today."), "Down to five dollars today.");
  assert.equal(speakable("Or $1.19 for the bundle."), "Or one dollar nineteen for the bundle.");
  assert.equal(speakable("£59.99 and 69,99€."), "sixty pounds and seventy euros.");
  assert.equal(speakable("$1.5 billion in sales"), "one point five billion dollars in sales");
});

test("a possessive digit is said as one word and a rank before a name is not stressed as a title", () => {
  // The Modern Warfare Short (Os_yeSFpGh0, 25 Oct 2026) paused before "4's" and leaned on "Marine".
  assert.equal(speakable("Modern Warfare 4's first DLC stars a real Marine."), "Modern Warfare four's first DLC stars a real marine.");
  assert.equal(speakable("to help save fellow Marine Nick Eufrazio."), "to help save fellow marine Nick Eufrazio.");
  assert.equal(speakable("The Marine Corps and the 1990's"), "The Marine Corps and the nineteen ninety's");
  assert.equal(speakable("GTA 6's map and the PS5's fans"), "GTA six's map and the PS5's fans");
});

test("sizes are said like a person says them: gigabytes once, then gigs, and a 210 gig download", async () => {
  const { speakUnits } = await import("../src/voice/speakable.ts");
  const { displayWords } = await import("../src/render/timeline.ts");
  assert.equal(
    speakUnits("It needs 210GB. The PS5 version is 150GB and the patch adds 20GB."),
    "It needs 210 gigabytes. The PS5 version is 150 gigs and the patch adds 20 gigs.",
  );
  assert.equal(speakUnits("Grab the 120GB download now"), "Grab the 120 gig download now");
  assert.equal(speakUnits("a 1GB file and then 1GB more"), "a 1 gig file and then 1 gig more");
  const show = (t: string) => displayWords(t.split(" ").map((text, i) => ({ text, start: i, end: i + 1 }))).map((w) => w.text).join(" ");
  assert.equal(show("is 150 gigs and a 210 gig download"), "is 150GB and a 210GB download");
  const { tokens } = await import("../src/qa/narration.ts");
  assert.deepEqual(tokens("gigs"), tokens("gigabytes"), "the narration check hears them as one word");
});

test("one Short shares its units: gigabytes in the hook, gigs in the take", async () => {
  const { segmentInputs } = await import("../src/pipeline.ts");
  const { narrationOf } = await import("../src/editorial/schema.ts");
  const script = {
    hook: "GTA 6 needs 210GB.",
    beats: [{ narration: "The PS5 copy is 150GB.", visual: "x" }],
    pulse_take: { narration: "Clear 20GB more." },
    loop_line: "Is 210GB worth it?",
  } as never;
  const segs = segmentInputs(script).map((s) => s.text).join(" ");
  assert.match(segs, /210 gigabytes.*150 gigs.*20 gigs.*210 gigs/);
  assert.match(String(narrationOf(script)), /210 gigabytes.*150 gigs/);
});

test("counts that name something stay exact, and a single bound is still rounded", () => {
  assert.equal(speakable("It grew to 346,258 players."), "It grew to almost three hundred fifty thousand players.");
  assert.equal(speakable("from 1,200 to 1,500 players"), "from one thousand two hundred to one thousand five hundred players");
  assert.equal(speakable("ticket number 500,001"), "ticket number five hundred thousand one");
  assert.equal(speakable("No. 1,024 on the list"), "No. one thousand twenty-four on the list");
});

test("US dollars, names ending in a dollar sign, NvN and store titles in capitals", () => {
  assert.equal(speakable("a US$265 million deal"), "a two hundred sixty-five million dollars deal");
  assert.equal(speakable("Lapsus$ hacked them"), "Lapsus hacked them");
  assert.equal(speakable("a 10v10 mode, Halo vs Destiny"), "a 10 versus 10 mode, Halo versus Destiny");
  assert.equal(speakable("TEKKEN 7 and FINAL FANTASY XIV"), "Tekken 7 and Final Fantasy 14");
  assert.equal(speakable("JRPGS on the SNES and an MMORPG"), "JRPGS on the SNES and an MMORPG");
});

test("a year the aligner split into three words is still one figure on screen", async () => {
  // The Astro Bot Short (ep_20261028_9547f065) captioned "twenty twenty four's" as "2020".
  const { displayWords } = await import("../src/render/timeline.ts");
  const show = (t: string) => displayWords(t.split(" ").map((text, i) => ({ text, start: i, end: i + 1 }))).map((w) => w.text).join(" ");
  assert.equal(show("cameo in twenty twenty four's Astro Bot,"), "cameo in 2024's Astro Bot,");
  assert.equal(show("cameo in twenty twenty-four's Astro Bot,"), "cameo in 2024's Astro Bot,");
  assert.equal(show("back in twenty twenty four"), "back in 2024");
});

test("polish (a finish) is respelt so the voice never says Polish (from Poland); captions show polish", async () => {
  // A GTA documentary read "for more polish" as the nationality (owner, 29 Oct 2026).
  assert.equal(speakable("pushed to September 17 for more polish."), "pushed to September 17 for more pollish.");
  assert.equal(speakable("Polish solo developer SaikingS and polished combat"), "Polish solo developer SaikingS and polished combat");
  const { displayWords } = await import("../src/render/timeline.ts");
  const show = (t: string) => displayWords(t.split(" ").map((text, i) => ({ text, start: i, end: i + 1 }))).map((w) => w.text).join(" ");
  assert.equal(show("for more pollish."), "for more polish.");
  const { tokens } = await import("../src/qa/narration.ts");
  assert.deepEqual(tokens("pollish"), tokens("polish"));
});
