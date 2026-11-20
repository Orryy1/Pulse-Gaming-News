import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consoleOf,
  fitsPulseConsole,
  isHardwareRow,
} from "../src/render/components/packs/pulse/PulseConsole.tsx";
import { STYLES } from "../src/render/components/packs/pulse/consoles.ts";
import { inEra } from "../src/render/components/packs/types.ts";
import type { MomentGraphic } from "../src/render/components/LongMoments.tsx";

const specs = (
  primary: string,
  items: string[],
  secondary = "",
): MomentGraphic => ({
  kind: "specs",
  primary,
  secondary,
  items,
});

test("each era gets its own Pulse console, with the boundaries where the brief puts them", () => {
  const at = (y: number) => consoleOf(y).gen;
  assert.equal(at(1980), "tempo");
  assert.equal(at(1993), "tempo");
  assert.equal(at(1994), "prism");
  assert.equal(at(1999), "prism");
  assert.equal(at(2000), "basalt");
  assert.equal(at(2005), "basalt");
  assert.equal(at(2006), "comet");
  assert.equal(at(2012), "comet");
  assert.equal(at(2013), "facet");
  assert.equal(at(2019), "facet");
  assert.equal(at(2020), "spire");
  assert.equal(at(2026), "spire");
});

test("no generation name echoes a real console", () => {
  const names = [1985, 1996, 2002, 2008, 2016, 2024].map(
    (y) => consoleOf(y).name,
  );
  assert.equal(new Set(names).size, 6);
  for (const n of names)
    assert.doesNotMatch(
      n,
      /station|box|64|cube|wii|switch|genesis|drive|system|boy|cast|saturn|entertainment/i,
    );
});

test("the console style is a specs style from 1980 on", () => {
  const s = STYLES.PulseConsole!;
  assert.equal(s.kind, "specs");
  assert.equal(inEra(s, 1979), false);
  assert.equal(inEra(s, 1980), true);
  assert.equal(inEra(s, 2026), true);
});

test("hardware rows are parts of a machine or figures in hardware units", () => {
  assert.equal(isHardwareRow({ a: "CPU", b: "294 MHz" }), true);
  assert.equal(isHardwareRow({ a: "Main memory", b: "32 MB" }), true);
  assert.equal(isHardwareRow({ a: "Output", b: "4K" }), true);
  assert.equal(isHardwareRow({ a: "Launch", b: "4 March 2000" }), false);
  assert.equal(isHardwareRow({ a: "Map size", b: "75 km" }), false);
});

test("a machine's spec sheet fits", () => {
  assert.equal(
    fitsPulseConsole(
      specs("The machine GTA III ran on", [
        "CPU: 294 MHz",
        "RAM: 32 MB",
        "Video RAM: 4 MB",
        "Media: DVD",
      ]),
    ),
    true,
  );
  assert.equal(
    fitsPulseConsole(specs("Under the hood", ["CPU: 3.2 GHz", "RAM: 512 MB"])),
    true,
  );
  // A heading naming the console lets one hardware row carry a launch date and a price.
  assert.equal(
    fitsPulseConsole(
      specs("PlayStation 2 at launch", [
        "Launch: March 2000",
        "Price: $299",
        "CPU: 294 MHz",
      ]),
    ),
    true,
  );
});

test("specs about a game or a studio never come up as a console", () => {
  assert.equal(
    fitsPulseConsole(
      specs("GTA V by the numbers", [
        "Map size: 81 km",
        "Team size: 1,000",
        "Budget: $265 million",
      ]),
    ),
    false,
  );
  // Gigabytes alone do not make it hardware when the row is the game's install size.
  assert.equal(
    fitsPulseConsole(
      specs("Red Dead Redemption 2", ["Install size: 150 GB", "Discs: 2"]),
    ),
    false,
  );
  assert.equal(
    fitsPulseConsole(specs("The RAGE engine", ["Engine: RAGE", "RAM: 8 GB"])),
    false,
  );
  // Without a console in the heading, one hardware row in three is not enough.
  assert.equal(
    fitsPulseConsole(
      specs("Launch day", [
        "Launch: March 2000",
        "Price: $299",
        "CPU: 294 MHz",
      ]),
    ),
    false,
  );
});

test("the rows must be 2-6 short 'label: value' pairs under a short heading", () => {
  assert.equal(fitsPulseConsole(specs("Hardware", ["CPU: 294 MHz"])), false);
  assert.equal(
    fitsPulseConsole(
      specs("Hardware", [
        "CPU: 1",
        "GPU: 2",
        "RAM: 3 MB",
        "VRAM: 4 MB",
        "Storage: 5 GB",
        "Audio: 6",
        "Disc: DVD",
      ]),
    ),
    false,
  );
  assert.equal(
    fitsPulseConsole(specs("Hardware", ["CPU 294 MHz", "RAM: 32 MB"])),
    false,
  );
  assert.equal(
    fitsPulseConsole(
      specs("Hardware", ["CPU: a custom 128-bit Emotion Engine", "RAM: 32 MB"]),
    ),
    false,
  );
  assert.equal(
    fitsPulseConsole(
      specs("The extraordinary hardware behind the sixth generation", [
        "CPU: 294 MHz",
        "RAM: 32 MB",
      ]),
    ),
    false,
  );
});
