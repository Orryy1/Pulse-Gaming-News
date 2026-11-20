import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  gameMapFor,
  gameMapTables,
  markGameMaps,
  placesIn,
  stageGameMaps,
  wikiMapAllowed,
  type GameMapTable,
} from "../src/assets/gamemaps.ts";
import {
  FLY_FROM,
  FLY_TO,
  closeShot,
  drawableGameMap,
  type GameMapGraphic,
  pinWorld,
  planeSize,
  project,
  shotAt,
  wideShot,
} from "../src/render/gamemap.ts";
import { mergeSightings, tilesFor } from "../src/tools/gamemap-locate.ts";
import { gameMapUrls } from "../src/render/render.ts";
import { STYLES as MAP_STYLES } from "../src/render/components/packs/GfxMap.tsx";

const TABLE: GameMapTable = {
  id: "test",
  titles: ["Grand Theft Auto VI", "GTA 6"],
  name: "Leonida",
  map: {
    file: "test.jpg",
    url: "https://example.invalid/map.jpg",
    width: 2000,
    height: 3000,
    credit: "MAP: TEST",
    provenance: {
      kind: "official",
      page: "https://example.invalid",
      note: "test",
    },
  },
  places: [
    {
      name: "Vice City",
      x: 0.66,
      y: 0.52,
      kind: "city",
      located: "vision",
      checked: true,
    },
    {
      name: "Vice City International Airport",
      aliases: ["VCIA"],
      x: 0.56,
      y: 0.57,
      kind: "landmark",
      located: "vision",
      checked: true,
    },
    {
      name: "Port Gellhorn",
      x: 0.31,
      y: 0.36,
      kind: "city",
      located: "vision",
      checked: true,
    },
    {
      name: "Hamlet",
      x: 0.56,
      y: 0.68,
      kind: "city",
      located: "vision",
      checked: false,
    },
  ],
};

type G = { kind: string; primary: string; secondary: string; items: string[]; gameMap?: GameMapGraphic };
const none = (): { graphic: G; emphasis: string } => ({
  graphic: { kind: "none", primary: "", secondary: "", items: [] },
  emphasis: "x",
});

test("a game's map is found by whole title only, so Vice City the 2002 game never takes GTA VI's map", () => {
  assert.equal(gameMapFor("GTA 6", [TABLE])?.id, "test");
  assert.equal(gameMapFor("grand theft auto vi", [TABLE])?.id, "test");
  assert.equal(gameMapFor("Grand Theft Auto: Vice City", [TABLE]), undefined);
  assert.equal(gameMapFor("", [TABLE]), undefined);
});

test("places are matched as whole words, longest first, unchecked ones never", () => {
  assert.deepEqual(
    placesIn(
      "You land at Vice City International Airport and drive to Port Gellhorn.",
      TABLE,
    ).map((p) => p.name),
    ["Vice City International Airport", "Port Gellhorn"],
  );
  assert.deepEqual(
    placesIn("The VCIA runway sits beside Vice City.", TABLE).map(
      (p) => p.name,
    ),
    ["Vice City International Airport", "Vice City"],
  );
  // Hamlet is in the table but not checked: no pin, never a guess.
  assert.deepEqual(placesIn("Hamlet is quiet.", TABLE), []);
  // A name inside another word is not a mention.
  assert.deepEqual(placesIn("Vice Cityscape posters", TABLE), []);
});

test("markGameMaps puts the map only on free sentences, spaced out, never the first, and clears the caption", () => {
  const sentences = [
    "Vice City opens the story.",
    "It is loud.",
    "Port Gellhorn is the other side of the state.",
    "Vice City again, too soon.",
    "More words.",
    "Nothing here.",
    "Back at Vice City at last.",
    "And Port Gellhorn once more.",
  ];
  const moments = sentences.map(none);
  moments[5] = {
    graphic: { kind: "stat", primary: "5", secondary: "", items: [] },
    emphasis: "",
  };
  const out = markGameMaps(moments, sentences, "GTA 6", { tables: [TABLE] });
  assert.deepEqual(out.added, ["3: Port Gellhorn", "7: Vice City"]);
  assert.equal(out.moments[0]!.graphic.kind, "none");
  const g = out.moments[2]!.graphic;
  assert.equal(g.kind, "map");
  assert.equal(g.primary, "Leonida");
  assert.deepEqual(g.items, ["Port Gellhorn"]);
  assert.deepEqual(g.gameMap?.pins, [
    { name: "Port Gellhorn", x: 0.31, y: 0.36, kind: "city" },
  ]);
  assert.equal(out.moments[2]!.emphasis, "");
  assert.equal(out.moments[5]!.graphic.kind, "stat");
  // A game with no table is left alone.
  assert.equal(
    markGameMaps(moments, sentences, "Halo", { tables: [TABLE] }).added.length,
    0,
  );
});

test("stageGameMaps copies the picture into the episode, and takes the map off when it cannot be had", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gamemaps-"));
  const cache = path.join(dir, "cache");
  fs.mkdirSync(cache);
  fs.writeFileSync(path.join(cache, "test.jpg"), Buffer.alloc(20_000, 1));
  const marked = markGameMaps(
    [none(), none(), none()],
    ["a.", "b.", "Vice City."],
    "GTA 6",
    { tables: [TABLE], gap: 1 },
  );
  const ok = await stageGameMaps(marked.moments, path.join(dir, "ep"), cache, {
    tables: [TABLE],
    fetchImage: async (t, c) => path.join(c, t.map.file),
  });
  assert.equal(ok.moments[2]!.graphic.gameMap?.file, "gamemaps/test.jpg");
  assert.ok(fs.existsSync(path.join(dir, "ep", "gamemaps", "test.jpg")));
  const bad = await stageGameMaps(
    marked.moments,
    path.join(dir, "ep2"),
    cache,
    {
      tables: [TABLE],
      fetchImage: async () => {
        throw new Error("offline");
      },
    },
  );
  assert.equal(bad.moments[2]!.graphic.kind, "none");
  assert.equal(bad.moments[2]!.graphic.gameMap, undefined);
  assert.equal(bad.failed.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a wiki map is allowed only when its file page says in-game or official, never fan-made or edited", () => {
  assert.ok(
    wikiMapAllowed(
      "{{FileInfo |summary= [[Map]] found in the [[Hateno School]], as seen in-game |type= Model }}",
    ),
  );
  assert.ok(
    wikiMapAllowed(
      "|summary= |type= Screenshot |source= {{Source|Original|Someone}} |game= BotW",
    ),
  );
  assert.ok(
    wikiMapAllowed(
      "|source= [https://zelda.com/skywardsword/ Official Skyward Sword webpage] |type= Map",
    ),
  );
  assert.ok(
    !wikiMapAllowed(
      "|summary= Map of [[Greater Hyrule]] |source= {{No Source}} |type= map",
    ),
  );
  assert.ok(
    !wikiMapAllowed(
      "|summary= in-game regions |source= Edited version of File:X.png by a user",
    ),
  );
  assert.ok(!wikiMapAllowed("A fan-made official-style map"));
});

test("every shipped table is sound: real provenance, pins inside the picture, only checked places pinnable", () => {
  const tables = gameMapTables();
  assert.ok(tables.length >= 2);
  for (const t of tables) {
    assert.ok(t.map.width > 0 && t.map.height > 0, t.id);
    assert.ok(
      /^https:\/\//.test(t.map.url) &&
        /^https:\/\//.test(t.map.provenance.page),
      t.id,
    );
    assert.ok(t.map.credit.startsWith("MAP: "), t.id);
    assert.ok(t.map.sha256 && /^[0-9a-f]{64}$/.test(t.map.sha256), t.id);
    const names = new Set<string>();
    for (const p of t.places) {
      assert.ok(!names.has(p.name), `${t.id}: ${p.name} twice`);
      names.add(p.name);
      if (p.checked) {
        assert.ok(
          p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1,
          `${t.id}: ${p.name} outside the map`,
        );
        assert.ok(p.check, `${t.id}: ${p.name} has no check record`);
      }
    }
    assert.ok(["official", "wiki"].includes(t.map.provenance.kind), t.id);
  }
  // Vice City districts and Leonida towns from Rockstar's own map; regions of Hyrule from the in-game map screen.
  assert.ok(gameMapFor("GTA 6")!.places.filter((p) => p.checked).length >= 8);
  assert.ok(gameMapFor("Breath of the Wild")!.places.filter((p) => p.checked).length >= 3);
  assert.ok(
    gameMapFor("GTA 6")?.places.some(
      (p) => p.checked && p.name === "Rockridge",
    ),
    "a Vice City district is pinnable",
  );
});

test("the camera starts on the whole map and ends with every pin in frame, clear of the edges", () => {
  const { w, h } = planeSize(2805, 3840);
  assert.ok(Math.abs(h - 10) < 1e-9 && w < h);
  const wide = wideShot(2805, 3840);
  // The whole map's corners are on screen in the opening shot.
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const p = project(pinWorld({ x, y }, 2805, 3840), wide);
    assert.ok(
      p.z > 0 && p.x > -5 && p.x < 1925 && p.y > -5 && p.y < 1085,
      `corner ${x},${y}: ${JSON.stringify(p)}`,
    );
  }
  for (const pins of [
    [{ x: 0.66, y: 0.52 }],
    [
      { x: 0.2, y: 0.3 },
      { x: 0.7, y: 0.75 },
    ],
    [{ x: 0.05, y: 0.05 }],
  ]) {
    const world = pins.map((p) => pinWorld(p, 2805, 3840));
    const close = closeShot(world);
    for (const f of [FLY_TO, FLY_TO + 100]) {
      const s = shotAt(f, wide, close, FLY_TO + 150);
      for (const p of world) {
        const q = project([p[0], 0.7, p[2]], s);
        assert.ok(
          q.x > 100 && q.x < 1820 && q.y > 100 && q.y < 980,
          `pin ${JSON.stringify(pins)} at frame ${f}: ${JSON.stringify(q)}`,
        );
      }
    }
  }
  // Before the flight the camera holds the wide shot.
  assert.ok(
    Math.abs(shotAt(FLY_FROM - 2, wide, closeShot([[0, 0, 0]]), 200).distance - wide.distance) < 1e-9,
  );
});

test("only a game map with a picture and one to three pins is drawable, and only by Map/Game3D", () => {
  const gameMap = {
    map: "t",
    game: "g",
    file: "gamemaps/t.jpg",
    width: 10,
    height: 10,
    credit: "MAP: T",
    pins: [{ name: "A", x: 0.5, y: 0.5, kind: "city" as const }],
  };
  const g = {
    kind: "map" as const,
    primary: "Leonida",
    secondary: "",
    items: ["Miami"],
    gameMap,
  };
  assert.ok(drawableGameMap(g));
  assert.ok(!drawableGameMap({ gameMap: { ...gameMap, file: undefined } }));
  assert.ok(!drawableGameMap({ gameMap: { ...gameMap, pins: [] } }));
  assert.ok(
    !drawableGameMap({
      gameMap: {
        ...gameMap,
        pins: [{ name: "A", x: 1.2, y: 0.5, kind: "city" }],
      },
    }),
  );
  // "Miami" is a real place, but this graphic is the game's own map: the world map must not draw it.
  assert.equal(MAP_STYLES.World!.fits!(g), false);
  assert.equal(MAP_STYLES.Game3D!.fits!(g), true);
});

test("the render's props carry each staged map picture as a URL", () => {
  const ms = [
    [
      { graphic: { kind: "map", gameMap: { file: "gamemaps/a b.jpg" } } },
      { graphic: { kind: "none" } },
    ],
  ];
  const out = gameMapUrls(ms as never, "http://127.0.0.1:9");
  assert.match(
    (out[0]![0] as any).graphic.gameMap.src,
    /^http:\/\/127\.0\.0\.1:9\/gamemaps\/a(%20| )b\.jpg$/,
  );
  assert.equal((out[0]![1] as any).graphic.gameMap, undefined);
});

test("the locator's tiles cover the picture, and a name seen in two places is dropped", () => {
  const tiles = tilesFor(2805, 3840, 1275);
  const covered = (x: number, y: number) =>
    tiles.some((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
  for (const [x, y] of [
    [0, 0],
    [2804, 3839],
    [1400, 1900],
    [2804, 0],
  ] as const)
    assert.ok(covered(x, y));
  const merged = mergeSightings(
    [
      { name: "Vice City", x: 0.66, y: 0.52 },
      { name: "Vice City", x: 0.661, y: 0.521 },
      { name: "Capri", x: 0.28, y: 0.52 },
      { name: "Capri", x: 0.8, y: 0.2 },
    ],
    2805,
    3840,
  );
  assert.ok(merged.has("Vice City"));
  assert.ok(!merged.has("Capri"));
});

test("names match as printed: ordinary words, game titles and longer names are never pinned", () => {
  const t: GameMapTable = {
    ...TABLE,
    places: [
      { name: "Vice City", x: 0.66, y: 0.52, kind: "city", located: "vision", checked: true },
      { name: "Vice City International Airport", x: 0.56, y: 0.57, kind: "landmark", located: "vision", checked: false },
      { name: "Crosstown", x: 0.69, y: 0.49, kind: "district", located: "vision", checked: true, ambiguous: true },
      { name: "Lanayru", x: 0.7, y: 0.5, kind: "region", located: "vision", checked: true },
    ],
  };
  const names = (s: string) => placesIn(s, t).map((p) => p.name);
  // Case as printed.
  assert.deepEqual(names("a long vice city drive"), []);
  // An ambiguous name needs a place word before it.
  assert.deepEqual(names("Traffic was crosstown chaos."), []);
  assert.deepEqual(names("Crosstown traffic is a joke."), []);
  assert.deepEqual(names("You walk through Crosstown at night."), ["Crosstown"]);
  // The 2002 game, and a longer name the table knows but has not checked.
  assert.deepEqual(names("Grand Theft Auto: Vice City sold millions."), []);
  assert.deepEqual(names("GTA Vice City was the start."), []);
  assert.deepEqual(names("Planes leave Vice City International Airport hourly."), []);
  // A name run on into another capitalised word is another thing.
  assert.deepEqual(names("Lanayru Wetlands flood each spring."), []);
  assert.deepEqual(names("Vice City Stories came later."), []);
  assert.deepEqual(names("The story moves to Vice City, then north."), ["Vice City"]);
});

test("markGameMaps leaves sentences with a filler shot or a person alone", () => {
  const sentences = ["Start.", "Port Gellhorn sits west.", "x", "y", "z", "And Port Gellhorn again."];
  const moments = sentences.map(none) as Array<{ graphic: G; emphasis: string; filler?: unknown; person?: string }>;
  moments[1] = { ...moments[1]!, person: "Jason Duval" };
  moments[5] = { ...moments[5]!, filler: { kind: "kinetic" } };
  assert.equal(markGameMaps(moments, sentences, "GTA 6", { tables: [TABLE] }).added.length, 0);
});

test("a map whose picture cannot be had gives the sentence back as it was, caption and all", async () => {
  const before = [none(), none(), { ...none(), emphasis: "Port Gellhorn" }];
  const marked = markGameMaps(before, ["a.", "b.", "To Port Gellhorn."], "GTA 6", { tables: [TABLE], gap: 1 });
  assert.equal(marked.moments[2]!.emphasis, "");
  const out = await stageGameMaps(marked.moments, os.tmpdir(), os.tmpdir(), {
    tables: [TABLE],
    before,
    fetchImage: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(out.moments[2], before[2]);
  assert.equal(out.moments[2]!.emphasis, "Port Gellhorn");
});
