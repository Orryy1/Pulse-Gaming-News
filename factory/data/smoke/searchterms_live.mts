// Real autocomplete against real scripts: what SEARCH_TERMS would have added. Reads a saved /admin/export, changes nothing.
// Usage: node --import tsx data/smoke/searchterms_live.mts <export.json>
import fs from "node:fs";
import { searchSeeds, searchTermsFor } from "../../src/searchterms.ts";

const eps: any[] = JSON.parse(fs.readFileSync(process.argv[2]!, "utf8"));
let n = 0;
for (const e of eps) {
  const s = e.script_json;
  if (!s?.game_title || n >= 16) continue;
  n++;
  const text = [
    s.headline,
    s.hook,
    s.youtube?.title,
    s.youtube?.description,
    ...(s.beats ?? []).map((b: any) => b.narration),
    ...(s.entries ?? []).map((x: any) => JSON.stringify(x)),
  ].join(" ");
  console.log(
    s.youtube?.title?.slice(0, 48),
    "|",
    searchSeeds(s.game_title).join(" / "),
    "=>",
    (await searchTermsFor(s.game_title, text, fetch, s.youtube?.title ?? "", [s.headline, s.hook, s.youtube?.title].join(" "))).join("; "),
  );
}
process.exit(0);
