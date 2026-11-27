// 31 Oct 2026: runs the breath remover on a COPY of a published Short's voice with its stored word timings,
// to measure the fix on real audio. Usage: node --import tsx data/smoke/breath_trial.mts <db copy> <episode> <out.mp3>
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { quietBreaths } from "../../src/voice/breaths.ts";

const [dbDir, id, out] = process.argv.slice(2) as [string, string, string];
const db = new PGlite(dbDir);
const [ep] = (await db.query<any>(`SELECT assets_json FROM episodes WHERE id = $1`, [id])).rows;
await db.close();
const words = ep.assets_json.words ?? ep.assets_json.voice?.words;
if (!words?.length) throw new Error(`no word timings; keys: ${Object.keys(ep.assets_json).join(",")}`);
await fs.copyFile(`C:/PulseFactory/factory/data/episodes/${id}/voice.mp3`, out);
console.log("spans turned down:", await quietBreaths(out, words), "of", words.length, "words");
