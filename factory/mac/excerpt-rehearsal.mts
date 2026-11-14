// A few minutes of a real long video rendered on the Mac, with the pipeline preparing it exactly as it would (plan,
// depth layers, details, props), then only the chosen frames rendered. In the sandbox only: no API calls, no gameplay
// lane, no uploads, nothing posted.
// Usage: REHEARSAL_DATA=<sandbox> node --import tsx mac/excerpt-rehearsal.mts <episode id> <from s> <to s> <out.mp4>
import path from "node:path";

const DATA = process.env.REHEARSAL_DATA;
if (!DATA) throw new Error("REHEARSAL_DATA must name a sandbox folder");
const [ID, FROM, TO, OUT] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
];
process.loadEnvFile(path.join(DATA, ".env"));
Object.assign(process.env, {
  DATA_DIR: DATA,
  DRY_RUN: "true",
  GAMEPLAY_ENABLED: "false",
  PORT: "0",
});
const { loadConfig } = await import("../src/config.ts");
const { openDb, migrate } = await import("../src/db.ts");
const { createServices } = await import("../src/services.ts");
const { advance } = await import("../src/pipeline.ts");
const { renderLong } = await import("../src/render/render.ts");
const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
const s = createServices(db, cfg);
s.notify = async () => true;
let captured: Parameters<typeof renderLong>[0] | undefined;
s.renderLong = async (input) => {
  captured = input;
  throw new Error("captured for the excerpt");
};
await db.query(
  `UPDATE episodes SET status = 'voiced', attempts = 0, last_error = NULL, next_attempt_at = NULL WHERE id = $1`,
  [ID],
);
const [ep] = await db.query<any>(`SELECT * FROM episodes WHERE id = $1`, [ID]);
if (!ep) throw new Error(`no episode ${ID}`);
const t0 = Date.now();
try {
  await advance(s, ep);
} catch (err) {
  if (!captured) throw err;
}
await db.close();
if (!captured) throw new Error("the render was never reached");
console.log(`prepared in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const t1 = Date.now();
await renderLong({
  ...captured,
  outFile: OUT,
  posterFile: OUT.replace(/\.mp4$/, "_poster.jpg"),
  thumbFile: OUT.replace(/\.mp4$/, "_thumb.jpg"),
  thumbVariants: [],
  frameRange: [Math.round(Number(FROM) * 30), Math.round(Number(TO) * 30) - 1],
});
console.log(
  `rendered ${Number(TO) - Number(FROM)} s in ${((Date.now() - t1) / 1000).toFixed(0)} s`,
);
process.exit(0);
