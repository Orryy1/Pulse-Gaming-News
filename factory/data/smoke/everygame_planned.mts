// The footage plan of an every-game Short before any render (no Chromium, no encode): for each beat, the pictures
// the gather keeps (src/everygamestep.ts), read from IGDB by title and year and matched to the files already in
// the sandbox. Writes footage_plan.json in the shape data/smoke/everygame_sheet.mts reads.
//   node --import tsx data/smoke/everygame_planned.mts <sandbox dir>
process.loadEnvFile(process.env.SHOW_ENV ?? "C:/PulseFactory/factory/.env");
import fs from "node:fs/promises";
import path from "node:path";
import { findIgdbGame } from "../../src/assets/igdb.ts";
import { eraTrue, HARDWARE_PROVENANCE } from "../../src/editorial/everygame.ts";
import { EVERY_SCREENS, footageBeat } from "../../src/everygamestep.ts";

const [SANDBOX] = process.argv.slice(2);
const { script } = JSON.parse(await fs.readFile(path.join(SANDBOX!, "script.json"), "utf8"));
const epDir = path.join(SANDBOX!, "episodes", (await fs.readdir(path.join(SANDBOX!, "episodes")))[0]!);
const creds = { clientId: process.env.TWITCH_CLIENT_ID!, secret: process.env.TWITCH_CLIENT_SECRET! };
const beats = [];
for (const [i, meta] of script.every_game.beats.entries()) {
  const game = await findIgdbGame(creds, meta.title, meta.year);
  const own = Boolean(game && eraTrue({ game: game.name, year: game.year }, meta));
  const have = new Set(await fs.readdir(path.join(epDir, `entry_${i}`, "assets")).catch(() => []));
  const shots = own ? game!.screenshots.slice(0, EVERY_SCREENS + 1).filter((id) => have.has(`igdb-${id}.jpg`)) : [];
  const prov = (kind: string) => `IGDB ${kind} for "${game?.name}"${game?.year ? ` (${game.year})` : ""}, publisher material via igdb.com`;
  const keep = meta.handheld ? shots.slice(0, 2) : shots.slice(0, 2);
  const planned = keep.length
    ? keep.map((id) => ({ type: "image", file: path.join(`entry_${i}`, "assets", `igdb-${id}.jpg`), provenance: meta.handheld ? `${prov("screenshot")}, shown ${HARDWARE_PROVENANCE}` : prov("screenshot"), beatIndex: i }))
    : own && game!.cover
      ? [{ type: "image", file: path.join(`entry_${i}`, "assets", `igdb-${game!.cover}.jpg`), provenance: `${prov("cover")}, shown ${HARDWARE_PROVENANCE}`, beatIndex: i }]
      : [];
  beats.push({
    beat: i + 1, title: meta.title, year: meta.year, platforms: meta.platforms, device: meta.device, handheld: meta.handheld, year_stamp: meta.stamp,
    line: script.beats[i].narration, caption: script.beats[i].visual.secondary,
    shows: planned.length ? (meta.handheld || !keep.length ? "hardware" : "pictures") : "empty",
    trailer_moment: footageBeat(script.every_game.beats, i, new Date().getUTCFullYear()) ? "the publisher's own trailer of this game, inside its cap" : null,
    shots: planned,
  });
}
await fs.writeFile(path.join(SANDBOX!, "footage_plan.json"), JSON.stringify({ title: script.youtube.title, planned: true, beats }, null, 1));
console.log(beats.map((b) => `${b.beat}. ${b.year} ${b.title}: ${b.shows}, ${b.shots.length} pictures${b.trailer_moment ? " + trailer" : ""}`).join("\n"));
