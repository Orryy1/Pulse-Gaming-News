// Plans the "related video" link for each recent Short (set by hand-like clicks in YouTube Studio; the
// Data API cannot set it). The rules live in src/routines.ts (planRelated), which also serves the
// same plan to the Studio browser routine at /routine/related.
// Prints JSON: [{ short, title, target, targetTitle, reason }]. Skips Shorts already in
// data/admin/related_done.json (written by whoever sets the links).
// Usage: node --import tsx src/tools/related-plan.ts [days=3]
process.loadEnvFile(".env");
import fs from "node:fs";
import { channelLongs, planRelated, type RelatedRow } from "../routines.ts";

const days = Number(process.argv[2] ?? 3);
const port = process.env.PORT || "8080";
const key = process.env.ADMIN_TOKEN ?? "";
const res = await fetch(`http://127.0.0.1:${port}/admin/export?days=${days}`, {
  headers: { "x-admin-key": key },
});
if (!res.ok) throw new Error(`export failed: HTTP ${res.status}`);
const body = (await res.json()) as RelatedRow[] | Record<string, RelatedRow[]>;
const rows: RelatedRow[] = Array.isArray(body)
  ? body
  : (Object.values(body).find(Array.isArray) ?? []);

const doneFile = "data/admin/related_done.json";
const done = new Set<string>(
  fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, "utf8")) : [],
);

const plan = planRelated(rows, await channelLongs()).filter(
  (p) => !done.has(p.short),
);
console.log(JSON.stringify(plan, null, 2));
