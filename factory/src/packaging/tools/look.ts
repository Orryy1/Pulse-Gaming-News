// The local vision model's look at a list of pictures, for the Packaging Lab's thumbnail model (free: the PC's own
// qwen3-vl through src/assets/localvision.ts packagingLook; refused or paused looks are skipped, never sent elsewhere).
//   npx tsx src/packaging/tools/look.ts --thumbs <dir> --ids <file with one video id per line> --out <vision.json>
// Resumable: ids already in the output file are skipped. Run it through the PC orchestrator (class gpu, priority 20).
import fs from "node:fs";
import path from "node:path";
import { packagingLook } from "../../assets/localvision.ts";
import { lookFeatures } from "../image.ts";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const thumbs = arg("thumbs");
const idsFile = arg("ids");
const out = arg("out");
if (!thumbs || !idsFile || !out) {
  console.error("--thumbs, --ids and --out are required");
  process.exit(2);
}
const done: Record<string, unknown> = fs.existsSync(out)
  ? JSON.parse(fs.readFileSync(out, "utf8"))
  : {};
const ids = fs
  .readFileSync(idsFile, "utf8")
  .split(/\r?\n/)
  .map((x) => x.trim())
  .filter(Boolean);
let n = 0;
let missed = 0;
for (const id of ids) {
  if (id in done) continue;
  const file = path.join(thumbs, `${id}.jpg`);
  if (!fs.existsSync(file)) continue;
  const look = await packagingLook(file);
  if (!look) {
    missed++;
    if (missed >= 5 && n === 0) {
      console.error(
        "local vision is not answering; stopping (nothing was sent anywhere else)",
      );
      break;
    }
    continue;
  }
  done[id] = { ...look, ...lookFeatures(look) };
  if (++n % 20 === 0) fs.writeFileSync(out, JSON.stringify(done));
}
fs.writeFileSync(out, JSON.stringify(done));
console.log(
  `looked at ${n} pictures, ${missed} unanswered, ${Object.keys(done).length} in ${out}`,
);
