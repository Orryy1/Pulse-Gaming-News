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
  assert.equal(speakable("No prices, 2027 and 86%."), "No prices, 2027 and 86%.");
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
