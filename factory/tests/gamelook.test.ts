import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  GAME_LOOKS,
  LOOK_FONTS,
  PULSE_LOOK,
  gameLookFor,
  lookFont,
  withAlpha,
} from "../src/render/gamelook.ts";
import {
  clusters,
  contrast,
  hintedColour,
  lookPalette,
  parseHex,
  readableOn,
  type Rgb,
} from "../src/render/lookpalette.ts";
import {
  fitLookText,
  lookTextWidth,
} from "../src/render/components/GameLookFrame.tsx";
import { lookMotif } from "../src/render/components/GameLookCard.tsx";
import { profilesSource } from "../src/tools/gamelook-build.ts";
import { COLOUR } from "../src/render/brand.ts";

/** A flat picture: `n` pixels of each colour. */
const art = (...parts: Array<[Rgb, number]>) =>
  parts.flatMap(([c, n]) => Array.from({ length: n }, () => c).flat());

test("the palette leads with the art's most vivid prominent colour, readable on a near-black ink", () => {
  const px = art(
    [[20, 20, 30], 5000],
    [[120, 120, 125], 3000],
    [[220, 40, 140], 1500],
    [[240, 200, 120], 500],
  );
  const p = lookPalette(px);
  const ink = parseHex(p.ink);
  assert.ok(
    contrast(parseHex(p.accent), ink) >= 4.5,
    `accent ${p.accent} on ${p.ink}`,
  );
  assert.ok(contrast(parseHex(p.paper), ink) >= 12, `paper ${p.paper}`);
  assert.ok(contrast(parseHex(p.muted), ink) >= 4.5, `muted ${p.muted}`);
  assert.ok(contrast(parseHex(p.accent2), ink) >= 3, `accent2 ${p.accent2}`);
  // The pink leads: red high, green low.
  const [r, g] = parseHex(p.accent);
  assert.ok(r > 180 && g < 140, p.accent);
  // The ink is close to black.
  assert.ok(Math.max(...ink) < 30, p.ink);
});

test("a hint picks a small vivid logo colour the art really has, and never invents one", () => {
  // A grey cover with a small red logo (1% of it).
  const px = art(
    [[90, 95, 100], 9000],
    [[30, 32, 36], 900],
    [[200, 30, 40], 100],
  );
  const red = lookPalette(px, "#c0202a");
  const [r, g, b] = parseHex(red.accent);
  assert.ok(r > g * 2 && r > b * 2, red.accent);
  assert.ok(hintedColour(px, 0));
  // No green in the art: a green hint finds nothing and the art's own colour leads instead.
  assert.equal(hintedColour(px, 120), undefined);
  const g2 = parseHex(lookPalette(px, "#20c040").accent);
  assert.ok(!(g2[1] > g2[0] * 1.5 && g2[1] > g2[2] * 1.5), "no invented green");
});

test("clusters are deterministic and readableOn only lifts a colour", () => {
  const px = art([[10, 10, 10], 100], [[200, 50, 50], 100]);
  assert.deepEqual(clusters(px, 2), clusters(px, 2));
  const dark: Rgb = [60, 20, 90];
  const ink: Rgb = [10, 8, 12];
  const up = readableOn(dark, ink, 4.5);
  assert.ok(contrast(up, ink) >= 4.5);
  assert.deepEqual(readableOn([250, 200, 60], ink, 4.5), [250, 200, 60]);
});

test("profiles are found by whole title, and Pulse's look is the default", () => {
  assert.equal(gameLookFor("GTA 6")?.id, "gta6");
  assert.equal(gameLookFor("Grand Theft Auto VI")?.id, "gta6");
  assert.equal(gameLookFor("Grand Theft Auto: Vice City"), undefined);
  assert.equal(gameLookFor("Breath of the Wild")?.id, "botw");
  assert.equal(gameLookFor(undefined), undefined);
  assert.equal(PULSE_LOOK.accent, COLOUR.amber);
  assert.equal(PULSE_LOOK.corner, "none");
  assert.equal(withAlpha("#ff6b1a", 0.5), "rgba(255,107,26,0.5)");
});

test("every shipped profile reads: accent and text contrast on its ink, a shipped OFL face, four eras and genres", () => {
  assert.ok(GAME_LOOKS.length >= 4);
  for (const l of GAME_LOOKS) {
    const ink = parseHex(l.ink);
    assert.ok(contrast(parseHex(l.accent), ink) >= 4.5, `${l.id} accent`);
    assert.ok(contrast(parseHex(l.paper), ink) >= 12, `${l.id} paper`);
    assert.ok(contrast(parseHex(l.muted), ink) >= 4.5, `${l.id} muted`);
    const f = LOOK_FONTS[l.display];
    assert.ok(f, `${l.id}: face ${l.display}`);
    assert.equal(f!.licence, "OFL");
    assert.ok(l.corner !== "none" && l.hud !== "none", `${l.id} has a frame`);
    assert.ok(l.source?.art.startsWith("https://"), `${l.id} records its art`);
  }
  assert.deepEqual(GAME_LOOKS.map((l) => l.id).sort(), [
    "botw",
    "gta6",
    "re4remake",
    "sonic1991",
  ]);
});

test("every look face ships in public/fonts with its licence, and is never a game's own font", () => {
  const dir = path.join(import.meta.dirname, "..", "public", "fonts");
  const files = fs.readdirSync(dir);
  for (const f of Object.values(LOOK_FONTS)) {
    assert.ok(files.includes(f.file), f.file);
    assert.ok(
      !/pricedown|hylia|triforce|sega|nintendo|rockstar|capcom/i.test(
        f.file + f.family,
      ),
      f.file,
    );
  }
  for (const lic of [
    "OFL-BebasNeue.txt",
    "OFL-Cinzel.txt",
    "OFL-PressStart2P.txt",
    "OFL-IMFellEnglishSC.txt",
  ]) {
    assert.ok(files.includes(lic), lic);
    assert.match(
      fs.readFileSync(path.join(dir, lic), "utf8"),
      /SIL OPEN FONT LICENSE/i,
    );
  }
});

test("a heading in a look's face fits its width in two lines, at the largest size that does", () => {
  for (const l of GAME_LOOKS) {
    const font = lookFont(l);
    const fit = fitLookText(
      "THE STATE OF LEONIDA AND EVERY ROAD IN IT",
      font,
      1180,
      [132, 116, 100, 88, 76, 64, 54, 46],
    );
    assert.ok(fit.lines.length <= 2, `${l.id}: ${fit.lines.length} lines`);
    for (const line of fit.lines)
      assert.ok(
        lookTextWidth(line, font, fit.size) <= 1180,
        `${l.id}: ${line}`,
      );
  }
  // The pixel face is far wider than Anton: the same words come out smaller.
  const pixel = fitLookText(
    "VICE CITY",
    LOOK_FONTS.pressstart!,
    600,
    [132, 100, 76, 54], 1,
  );
  const anton = fitLookText(
    "VICE CITY",
    LOOK_FONTS.anton!,
    600,
    [132, 100, 76, 54], 1,
  );
  assert.ok(pixel.size < anton.size);
});

test("a look's motif keeps the hand-made motif's styles and takes the look's card", () => {
  const look = gameLookFor("GTA 6")!;
  const base = {
    id: "gta",
    name: "GTA",
    matches: () => true,
    styles: { Panels: {} as never },
  };
  const m = lookMotif(look, base);
  assert.equal(m.id, "look:gta6");
  assert.equal(m.styles, base.styles);
  assert.ok(m.card);
  assert.equal(
    lookMotif(look, undefined).card,
    m.card,
    "one card component per look",
  );
});

test("the builder writes a module the profiles load from", () => {
  const src = profilesSource([{ ...PULSE_LOOK, id: "x" }]);
  assert.match(src, /^\/\/ Generated by src\/tools\/gamelook-build\.ts/);
  assert.match(src, /export const PROFILES: GameLook\[\] = \[/);
});
