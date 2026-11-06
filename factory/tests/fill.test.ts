import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignFromBin,
  coverageShare,
  coveredMoments,
  photoMatches,
  titleWords,
} from "../src/assets/fill.ts";

test("a Commons photo counts only when its title names what was searched", () => {
  assert.equal(photoMatches("File:Sam Houser 2011.jpg", { person: "Sam Houser", words: [] }), true);
  assert.equal(photoMatches("File:Edinburgh street.jpg", { person: "Sam Houser", words: [] }), false);
  const words = titleWords("PlayStation 2 console on a desk");
  assert.deepEqual(words, ["playstation", "console", "desk"]);
  assert.equal(photoMatches("File:PS2 PlayStation-2 slim.png", { words }), true);
  assert.equal(photoMatches("File:Random office.jpg", { words }), false);
});

test("a sentence is covered by its own picture or clip, or a graphic", () => {
  const moments = [{ show: "a" }, { show: "b", graphic: { kind: "stat" } }, { show: "c" }, { show: "d", graphic: { kind: "none" } }];
  const images = [{ beatIndex: 0, moment: 0 }, { beatIndex: 1, moment: 2 }];
  const clips = [{ beatIndex: 0, moment: 2 }];
  assert.deepEqual([...coveredMoments(0, moments, images, clips)].sort(), [0, 1, 2]);
  assert.equal(coverageShare([{ entry: 0, game: "", moments, sentences: [] }], images, clips), 0.75);
});

test("the bin pass gives each open sentence one unused, fitting item and leaves 'none' bare", async () => {
  const llm = {
    structured: async () => ({
      picks: [
        { sentence: 1, item: "c0", fit: "fits it" },
        { sentence: 2, item: "c0", fit: "shows it" }, // the same clip twice: refused
        { sentence: 3, item: "i0", fit: "none" },
        { sentence: 9, item: "i0", fit: "shows it" }, // a sentence not asked about: refused
      ],
    }),
  } as never;
  const images = [{ file: "a.jpg", kind: "screenshot", beatIndex: 0, label: "Tommy on Ocean Drive" } as { file: string; kind: string; beatIndex: number; label: string; moment?: number }];
  const clips = [{ beatIndex: 0, label: "briefcases of cash" } as { beatIndex: number; label: string; moment?: number }];
  const moments = [{ show: "x" }, { show: "y" }, { show: "z" }, { show: "w" }];
  const n = await assignFromBin(llm, { entry: 0, game: "Vice City", moments, sentences: ["s0", "s1", "s2", "s3"] }, [1, 2, 3], images, clips);
  assert.equal(n, 1);
  assert.equal(clips[0]!.moment, 1);
  assert.equal(images[0]!.moment, undefined);
});

import { graphicFitsSentence } from "../src/assets/fill.ts";

test("a graphic only carries figures and quotes its own sentence says", () => {
  const s = ["It slipped.", "Production was meant to end on July 1, 1996.", 'Penn said "nobody wants to be the cop".', "Then it shipped."];
  const text = s.join(" ") + " Gary Penn, creative director.";
  const g = (kind: string, primary: string, secondary = "", items: string[] = []) => ({ kind, primary, secondary, items });
  assert.equal(graphicFitsSentence(g("date", "July 1, 1996"), s, 1, text), true);
  assert.equal(graphicFitsSentence(g("date", "December 16, 2021"), s, 1, text), false);
  assert.equal(graphicFitsSentence(g("quote", "nobody wants to be the cop", "Gary Penn, creative director"), s, 2, text), true);
  // The narrator's own words are not a quote, and a speaker the chapter never names is refused.
  assert.equal(graphicFitsSentence(g("quote", "Then it shipped", "Gary Penn"), s, 2, text), false);
  assert.equal(graphicFitsSentence(g("quote", "nobody wants to be the cop", "Rockstar mission dialogue"), s, 2, text), false);
});

import { igdbNameOf, otherGames } from "../src/assets/fill.ts";

test("a sentence that names another game asks for that game's pictures, exact titles only", () => {
  const m = { show: "GTA 2 top-down", keywords: ["Grand Theft Auto 2", "Ocean Drive", "top-down"], person: "" };
  assert.deepEqual(
    otherGames(m, "Grand Theft Auto", "Grand Theft Auto", "Grand Theft Auto 2 arrived in October 1999."),
    ["Grand Theft Auto 2"],
  );
  // The chapter's own game is not "another" game, and a title the sentence never says is skipped.
  assert.deepEqual(otherGames({ show: "", keywords: ["Grand Theft Auto"] }, "Grand Theft Auto", "Grand Theft Auto", "Grand Theft Auto shipped."), []);
  assert.equal(igdbNameOf('IGDB screenshot for "Grand Theft Auto 2" (1999), publisher material via igdb.com'), "grand theft auto 2");
});

import { outletOf } from "../src/render/components/packs/screen/PhoneStory.tsx";
import { storyYear } from "../src/render/components/packs/screen/OldWeb.tsx";
import { inEra } from "../src/render/components/packs/types.ts";

test("a press story's card names its outlet and keeps to its own era", () => {
  assert.equal(outletOf("The Guardian, 1997"), "The Guardian");
  assert.equal(outletOf("Chris Carter, Destructoid, 2013", "quote"), "Destructoid");
  assert.equal(outletOf("Keith Hamilton, project leader", "quote"), "NEWS");
  const g = (secondary: string) => ({ kind: "headline", primary: "MP calls for ban", secondary, items: [] }) as never;
  assert.equal(storyYear(g("The Guardian, 1997")), 1997);
  assert.equal(storyYear(g("BBC"), 2013), 2013);
  const phone = { kind: "headline", component: () => null, era: { from: 2012 } } as never;
  assert.equal(inEra(phone, 1997), false);
  assert.equal(inEra(phone, 2023), true);
  assert.equal(inEra(phone, undefined), true);
});

import { browserOf, phoneLook } from "../src/render/components/packs/screen/pulse.tsx";

test("every device is a Pulse one of the story's era", () => {
  assert.equal(outletOf("IGN, 2006", "source"), "IGN");
  assert.deepEqual(
    [1996, 2002, 2006, 2010].map((y) => browserOf(y).name),
    ["Pulse Navigator", "Pulse Explorer", "Pulse Fox", "Pulse Sphere"],
  );
  assert.deepEqual(phoneLook(2013, 0), { gen: "classic", skin: "orbit", network: "4G" });
  assert.deepEqual(phoneLook(2017, 1), { gen: "slim", skin: "droid", network: "4G" });
  assert.deepEqual(phoneLook(2023, 0), { gen: "edge", skin: "orbit", network: "5G" });
});

import { groundedCredit } from "../src/editorial/documentary.ts";

test("a quote keeps where it was said only when the source says so", () => {
  assert.equal(groundedCredit("Leslie Benzies, on Twitter, 2013", "benzies wrote on twitter that"), "Leslie Benzies, on Twitter, 2013");
  assert.equal(groundedCredit("Leslie Benzies, on Twitter, 2013", "benzies told the guardian"), "Leslie Benzies, 2013");
  assert.equal(groundedCredit("Dan Houser, in an internal e-mail", "an internal e mail from houser"), "Dan Houser, in an internal e-mail");
  assert.equal(groundedCredit("Dan Houser, Rockstar co-founder", "anything"), "Dan Houser, Rockstar co-founder");
});

import { tornPages, parseDate } from "../src/render/components/packs/paper/Calendar.tsx";

test("the tear-off calendar counts up to the date, across a month's end", () => {
  assert.deepEqual(
    tornPages(parseDate("March 3, 2009")).map((p) => `${p.head} ${p.big}`),
    ["February 27", "February 28", "March 1", "March 2"],
  );
  assert.deepEqual(tornPages(parseDate("February 2017")).map((p) => p.big), ["October", "November", "December", "January"]);
  assert.deepEqual(tornPages(parseDate("2009")).map((p) => p.big), ["2005", "2006", "2007", "2008"]);
});
