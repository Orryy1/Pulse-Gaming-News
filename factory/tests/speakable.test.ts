import { test } from "node:test";
import assert from "node:assert/strict";
import { speakable, numberWords } from "../src/voice/speakable.ts";
import { formatPrice } from "../src/assets/steam.ts";
import { inWindow } from "../src/lanes.ts";
import { otherCurrencies } from "../src/render/components/cards/helpers.ts";

test("prices are spoken in the currency on screen", () => {
  assert.equal(speakable("It costs $69.99 on PS5."), "It costs sixty-nine dollars ninety-nine on PS5.");
  assert.equal(speakable("Now £59.99 in the UK"), "Now fifty-nine pounds ninety-nine in the UK");
  assert.equal(speakable("€79.99 or 69,99€"), "seventy-nine euros ninety-nine or sixty-nine euros ninety-nine");
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
    ["32,619 Steam users are playing.", "thirty-two thousand six hundred nineteen Steam users are playing.", "32,619 Steam users are playing."],
    ["It holds 4.5 out of 5.", "It holds four point five out of 5.", "It holds 4.5 out of 5."],
    ["47.5% of players finished it.", "forty-seven point five percent of players finished it.", "47.5% of players finished it."],
    ["It sold 1.2 million copies.", "It sold one point two million copies.", "It sold 1.2 million copies."],
    ["Over 1,000,000 downloads.", "Over one million downloads.", "Over 1,000,000 downloads."],
    ["2,000 players joined.", "two thousand players joined.", "2,000 players joined."],
    ["376,411 reviews at 90 percent.", "three hundred seventy-six thousand four hundred eleven reviews at 90 percent.", "376,411 reviews at 90%."],
  ];
  for (const [text, spoken, shown] of cases) {
    const r = roundTrip(text);
    assert.equal(r.spoken, spoken, `voice: ${text}`);
    assert.equal(r.shown, shown, `captions: ${text}`);
  }
  // Names, small numbers, prices and years keep their own handling.
  assert.equal(speakable("Xbox 360 and the RTX 4090"), "Xbox 360 and the RTX 4090");
  assert.equal(roundTrip("One of the best, and one hundred percent worth it.").shown, "One of the best, and 100% worth it.");
  assert.equal(roundTrip("It costs $49.99 today.").shown, "It costs $49.99 today.");
  assert.equal(roundTrip("It came out in 2007.").shown, "It came out in 2007.");
});
