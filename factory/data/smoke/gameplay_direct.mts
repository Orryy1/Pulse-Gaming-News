// A real clip through the real gameplay lane with GAMEPLAY_DIRECT on: sandbox database, sandbox inbox, DRY_RUN, no
// upload and a printed Discord card instead of a post. It runs in two halves so the render can go on either machine:
//   node --import tsx data/smoke/gameplay_direct.mts words <sandbox> <clip dir> <review.json>
//     one vision call and two short takes of voice (needs the API keys in the environment); saves them as fixtures
//   node --import tsx data/smoke/gameplay_direct.mts render <sandbox> <clip dir> <review.json>
//     the whole lane from the fixtures: no model, no voice credit, ends on the Discord card. Runs on the Mac too.
// Leaves <sandbox>/data/episodes/<id>/short.mp4. Measure it with data/smoke/gameplay_measure.py.
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../src/config.ts";
import { createEmbeddedDb, migrate } from "../../src/db.ts";
import { createServices } from "../../src/services.ts";
import { advance, ingestGameplay } from "../../src/pipeline.ts";
import { getEpisode } from "../../src/episodes.ts";
import type { GameplayMeta, GameplayReview } from "../../src/gameplay.ts";
import {
  blackSpans,
  cleanLine,
  loopRepeatsHook,
  loopDangles,
  loopLeadIn,
  directClip,
  directFrames,
} from "../../src/gameplaydirect.ts";

const [mode, sandbox, clipDir, reviewFile] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
];
const review = JSON.parse(
  await fs.readFile(reviewFile, "utf8"),
) as GameplayReview;
const meta = JSON.parse(
  await fs.readFile(path.join(clipDir, "meta.json"), "utf8"),
) as GameplayMeta;
const fix = path.join(sandbox, "fixtures", meta.id);
await fs.mkdir(fix, { recursive: true });

if (mode === "words") {
  process.loadEnvFile("C:/PulseFactory/factory/.env");
  const cfg = {
    ...loadConfig(),
    dryRun: true,
    dataDir: path.join(sandbox, "pcdata"),
  };
  const db = await createEmbeddedDb(path.join(sandbox, "pcdb"));
  await migrate(db);
  const s = createServices(db, cfg);
  const clip = path.join(clipDir, meta.clip.file || "clip.mp4");
  // A direction already paid for is reused.
  const saved = path.join(fix, "direction.json");
  const direction = (await fs.stat(saved).catch(() => undefined))
    ? JSON.parse(await fs.readFile(saved, "utf8"))
    : await directClip(
        s.llm,
        await directFrames(clip, meta.clip.seconds, path.join(fix, "look")),
        review,
        await blackSpans(clip),
      );
  for (const k of ["hook", "setup", "payoff_line", "loop_line"] as const) direction[k] = cleanLine(direction[k]);
  if (loopRepeatsHook(direction.loop_line, direction.hook) || loopDangles(direction.loop_line))
    direction.loop_line = loopLeadIn(meta.id);
  console.log(JSON.stringify(direction, null, 2));
  await fs.writeFile(
    path.join(fix, "direction.json"),
    JSON.stringify(direction, null, 2),
  );
  const { fitLines, directCut } = await import("../../src/gameplaydirect.ts");
  const cut = directCut(direction, await blackSpans(clip), meta.clip.seconds);
  const lines = fitLines(direction, cut.payoffAt);
  const voice = { id: cfg.elevenLabsVoiceId, name: cfg.narratorName };
  const { speakable, speakContext } = await import("../../src/voice/speakable.ts");
  const ctx = speakContext();
  const takes: Record<string, unknown> = {};
  for (const [name, text] of [
    ["a", [lines.hook, lines.setup].filter(Boolean).join(" ")],
    [
      "b",
      [direction.payoff_line, direction.loop_line].filter(Boolean).join(" "),
    ],
  ] as const) {
    const out = path.join(fix, `take_${name}.mp3`);
    const n = await s.synthesise(speakable(text, ctx), out, voice, {
      minWpm: 185,
    });
    takes[name] = { ...n, file: out };
    console.log(
      name,
      n.durationSeconds,
      n.voice?.provider,
      text.length,
      "chars",
    );
  }
  await fs.writeFile(
    path.join(fix, "takes.json"),
    JSON.stringify(takes, null, 2),
  );
  await db.close();
  process.exit(0);
}

// ------------------------------------------------------------------ render: the lane itself, from the fixtures
const root = path.join(sandbox, "root");
const dir = path.join(root, "inbox", meta.id);
await fs.mkdir(path.join(dir, "frames"), { recursive: true });
await fs.cp(clipDir, dir, { recursive: true });
await fs.writeFile(
  path.join(dir, "meta.json"),
  JSON.stringify(
    { ...meta, status: "new", review: undefined, rehearsal: true },
    null,
    2,
  ),
);
await fs.mkdir(path.join(root, "docs"), { recursive: true });
const cfg = {
  ...loadConfig(),
  dataDir: path.join(sandbox, "data", meta.id),
  gameplayRoot: root,
  gameplayEnabled: true,
  gameplayDirect: true,
  gameplayOneTap: true,
  gameplayMinScore: 1,
  dryRun: true,
  publicUrl: "https://sandbox.invalid",
  appSecret: "sandbox",
};
const db = await createEmbeddedDb(path.join(sandbox, "db", meta.id));
await migrate(db);
const s = createServices(db, cfg);
const direction = JSON.parse(
  await fs.readFile(path.join(fix, "direction.json"), "utf8"),
);
const takes = JSON.parse(
  await fs.readFile(path.join(fix, "takes.json"), "utf8"),
);
s.llm = {
  structured: async (o: { system?: string }) =>
    o.system?.startsWith("You cut")
      ? direction
      : { ...review, keep: true, spoiler: false, strong_language: false },
} as never;
s.hearClip = async () => [];
let take = 0;
s.synthesise = (async (_text: string, out: string) => {
  const n = take++ === 0 ? takes.a : takes.b;
  await fs.copyFile(path.join(fix, path.win32.basename(n.file)), out);
  return n;
}) as never;
s.checkNarration = undefined;
s.notify = async (m) => {
  console.log(
    "DISCORD CARD (not sent):\n" +
      JSON.stringify(m.embeds?.[0] ?? m.content, null, 2),
  );
  return true;
};
const made = await ingestGameplay(s);
if (!made.length) throw new Error("not kept");
const id = made[0]!;
for (let i = 0; i < 8; i++) {
  const ep = await getEpisode(db, id);
  if (!ep || ["awaiting_approval", "rejected", "failed"].includes(ep.status))
    break;
  const started = Date.now();
  const moved = await advance(s, ep);
  console.log(
    ep.status,
    "->",
    (await getEpisode(db, id))?.status,
    `${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  if (!moved) break;
}
const ep = await getEpisode(db, id);
console.log("status:", ep?.status, ep?.last_error ?? "");
console.log("direct:", JSON.stringify(ep?.script_json?.gameplay?.direct));
console.log("timing:", JSON.stringify(ep?.assets_json?.gameplayShort));
console.log("seconds:", ep?.assets_json?.durationSeconds);
console.log(
  "words:",
  JSON.stringify(
    ep?.assets_json?.words?.map((w) => [w.text, Math.round(w.start * 10) / 10]),
  ),
);
console.log(
  "description:",
  (ep?.script_json?.youtube.description ?? "").slice(0, 300),
);
await fs.writeFile(
  path.join(cfg.dataDir, "result.json"),
  JSON.stringify(
    {
      id,
      video: path.join(cfg.dataDir, "episodes", id, "short.mp4"),
      gameplay: ep?.script_json?.gameplay,
      timing: ep?.assets_json?.gameplayShort,
      words: ep?.assets_json?.words,
      seconds: ep?.assets_json?.durationSeconds,
    },
    null,
    2,
  ),
);
console.log("video:", path.join(cfg.dataDir, "episodes", id, "short.mp4"));
await db.close();
