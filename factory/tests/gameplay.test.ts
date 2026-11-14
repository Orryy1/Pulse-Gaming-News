import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gameplayTitleFits,
  isoSeconds,
  gameplayCredit,
} from "../src/assets/gameplay.ts";
import { footageCredits } from "../src/pipeline.ts";
import { goodScript } from "./helpers.ts";

test("gameplay titles: the game itself, gameplay not commentary videos", () => {
  assert.equal(
    gameplayTitleFits(
      "Call of Duty 4: Modern Warfare Campaign - Act I - Night Vision Mission",
      "Call of Duty 4: Modern Warfare",
      "Call of Duty",
    ),
    true,
  );
  assert.equal(
    gameplayTitleFits(
      "Call of Duty Black Ops 6 Review",
      "Call of Duty: Black Ops 6",
      "Call of Duty",
    ),
    false,
  );
  assert.equal(
    gameplayTitleFits(
      "Grand Theft Auto Vice City #02 [GamePlay Only]",
      "Grand Theft Auto: Vice City",
      "Grand Theft Auto",
    ),
    true,
  );
  assert.equal(
    gameplayTitleFits(
      "GTA Vice City trailer",
      "Grand Theft Auto: Vice City",
      "Grand Theft Auto",
    ),
    false,
  );
  assert.equal(
    gameplayTitleFits(
      "Grand Theft Auto 2 gameplay",
      "Grand Theft Auto",
      "Grand Theft Auto",
    ),
    false,
  );
});

test("durations and credits", () => {
  assert.equal(isoSeconds("PT1H2M3S"), 3723);
  assert.equal(isoSeconds("PT9M"), 540);
  assert.equal(
    gameplayCredit({ channelTitle: "UnseeableNinja", kind: "cc" }),
    "GAMEPLAY: UNSEEABLENINJA / CC BY",
  );
  const desc = footageCredits(
    goodScript({
      entries: [
        {
          rank: 1,
          game_title: "Call of Duty 4",
          steam_search_term: "",
          year: 2007,
          platforms: "PC",
        },
      ],
    }),
    [
      {
        provenance:
          'Gameplay "Night Vision" by UnseeableNinja, Creative Commons Attribution licence (CC BY) (https://www.youtube.com/watch?v=abc), 4.8s at 12.0s of the downloaded section, muted',
      },
    ],
    undefined,
    undefined,
    "x",
  );
  assert.match(
    desc,
    /Gameplay: UnseeableNinja, licensed CC BY \(https:\/\/www\.youtube\.com\/watch\?v=abc\)\./,
  );
});

import { scopeOf } from "../src/pipeline.ts";
import { NOT_CAMPAIGN } from "../src/assets/clipscore.ts";

test("a campaign ranking keeps multiplayer out of every pick", () => {
  assert.equal(scopeOf(goodScript({ headline: "Call of Duty Campaigns Ranked", criterion: "strength of the single-player story" })), "campaign");
  assert.equal(scopeOf(goodScript({ headline: "GTA 6 delayed" })), undefined);
  assert.ok(NOT_CAMPAIGN.test("Multiplayer Reveal Trailer"));
  assert.ok(NOT_CAMPAIGN.test("Season 1 Battle Pass"));
  assert.ok(NOT_CAMPAIGN.test("Zombies Gameplay Trailer"));
  assert.ok(!NOT_CAMPAIGN.test("Campaign Launch Trailer"));
});

import { namedThings } from "../src/assets/gameplay.ts";

test("named missions are found in the shot list, missions first, the game's own name never", () => {
  const t = (key: string, text: string, keywords: string[]) => ({ key, text, want: "gameplay" as const, energy: "medium" as const, keywords });
  const named = namedThings([
    t("beat:9#m2", "Price leads the squad (show: Captain Price briefing)", ["Captain Price", "briefing"]),
    t("beat:9#m1", "The crawl through Pripyat (show: All Ghillied Up mission in ghillie suits)", ["All Ghillied Up", "ghillie suit", "Modern Warfare"]),
  ], "Call of Duty 4: Modern Warfare", "Call of Duty");
  assert.deepEqual(named.map((n) => n.name), ["All Ghillied Up", "Captain Price"]);
  assert.deepEqual(named[0]!.keys, ["beat:9#m1"]);
});

test("text at one edge of a clip is cropped away, text at both loses the clip", async () => {
  const { textVerdict, cropEdge } = await import("../src/assets/gameplay.ts");
  assert.equal(textVerdict(true, false), "text-top");
  assert.equal(textVerdict(false, true), "text-bottom");
  assert.equal(textVerdict(true, true), "text-both");
  assert.equal(textVerdict(false, false), undefined);
  // A real crop on a generated clip: white band on top, the rest dark; the top crop removes the band.
  const { execFileSync } = await import("node:child_process");
  const { FFMPEG, FFPROBE } = await import("../src/lib/bin.ts");
  const os = await import("node:os");
  const path = await import("node:path");
  const file = path.join(os.tmpdir(), `pulse_crop_${process.pid}.mp4`);
  execFileSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=640x360:d=1", "-vf", "drawbox=x=0:y=0:w=iw:h=60:color=white:t=fill", "-pix_fmt", "yuv420p", file]);
  assert.ok(await cropEdge(file, "top"));
  const size = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" }).trim();
  assert.equal(size, "640,266");
  const luma = execFileSync(FFMPEG, ["-v", "info", "-i", file, "-vf", "crop=iw:20:0:0,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const yavg = Number(luma.match(/YAVG=([\d.]+)/)?.[1] ?? 255);
  assert.ok(yavg < 40, `the top of the cropped clip is dark (YAVG ${yavg}), the white band is gone`);
});

test("edits inside a gameplay clip: isolated spikes and hard cuts, not fast motion", async () => {
  const { clipJumps, longestRun } = await import("../src/assets/gameplay.ts");
  const rows = (scenes: Record<number, number>, base = 0.02) =>
    Array.from({ length: 240 }, (_, i) => ({ time: i / 30, scene: scenes[i] ?? base }));
  // The GTA 9:59 jump: a 0.15 spike in a calm drive.
  assert.deepEqual(clipJumps(rows({ 113: 0.15 })).map((t) => t.toFixed(2)), ["3.77"]);
  // A turn or an explosion: a run of moderate scores is motion, not an edit.
  const run: Record<number, number> = {};
  for (let i = 120; i < 140; i++) run[i] = 0.14;
  assert.deepEqual(clipJumps(rows(run, 0.08)), []);
  // A hard cut always counts, however busy the footage around it.
  assert.equal(clipJumps(rows({ 81: 0.42 }, 0.12)).length, 1);
  // The first and last frames are the clip's own edges.
  assert.deepEqual(clipJumps(rows({ 1: 0.5, 239: 0.5 })), []);
  // The longest unbroken stretch, a frame clear of each edit.
  const [from, len] = longestRun([3.77], 8);
  assert.ok(Math.abs(from - (3.77 + 1 / 30)) < 1e-6 && Math.abs(len - (8 - 3.77 - 1 / 30)) < 1e-6);
  assert.deepEqual(longestRun([], 8), [0, 8]);
});

test("a trailer or clip naming a different entry in the series is never accepted (audit, 24 Oct 2026)", async () => {
  const { wrongEntry, entryNumber, seriesName, judgeGameplay } = await import("../src/assets/gameplay.ts");
  assert.equal(seriesName("Grand Theft Auto VI"), "Grand Theft Auto");
  assert.equal(seriesName("Call of Duty: Modern Warfare II"), "Call of Duty: Modern Warfare");
  assert.equal(entryNumber("GTA 6 Trailer 2", "GTA"), "6");
  assert.equal(entryNumber("Hades gameplay part 2", "Hades"), undefined);
  const wrong = [
    ["Grand Theft Auto VI", "Grand Theft Auto V Official Trailer"],
    ["Grand Theft Auto VI", "GTA 5 gameplay 4K"],
    ["Call of Duty: Modern Warfare II", "Modern Warfare III campaign"],
    ["Hades II", "Hades gameplay"],
    ["Hades", "Hades II gameplay"],
    ["Grand Theft Auto: Vice City", "GTA 5 gameplay"],
  ];
  for (const [g, t] of wrong) assert.equal(wrongEntry(g!, t!), true, `${g} <= ${t}`);
  const fine = [
    ["Grand Theft Auto VI", "GTA 6 Trailer 2"],
    ["Grand Theft Auto VI", "GTA VI gameplay 2026 4K"],
    ["Call of Duty: Modern Warfare II", "COD MW2 campaign mission 4"],
    ["Resident Evil 4", "Resident Evil 4 Remake gameplay"],
    ["Hades", "Hades gameplay part 2"],
    ["Halo Infinite", "Halo Infinite campaign 1080p"],
    ["Grand Theft Auto III", "Grand Theft Auto III: 10 Year Anniversary Edition"],
    ["Grand Theft Auto: Vice City", "GTA Vice City gameplay"],
  ];
  for (const [g, t] of fine) assert.equal(wrongEntry(g!, t!), false, `${g} <= ${t}`);
  // The model's opinion cannot override the rule in either direction.
  const llm = { structured: async () => ({ keep: [0, 1] }) } as never;
  const kept = await judgeGameplay(llm, "Grand Theft Auto VI", 2026, [
    { title: "Grand Theft Auto V Official Trailer", description: "", channelTitle: "Rockstar" },
    { title: "GTA VI Trailer 2", description: "", channelTitle: "Rockstar" },
  ]);
  assert.deepEqual(kept, [1]);
});
