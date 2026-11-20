// Renders a few minutes of a sandbox long video with today's renderer: the pipeline prepares the render
// exactly as it would (plan, depth layers, details, props), then only the chosen frames are rendered.
// No API calls. Usage: node --import tsx data/smoke/excerpt.mts <sandbox dir> <episode id> <from s> <to s> <out.mp4>
const [DIR, ID, FROM, TO, OUT] = process.argv.slice(2) as [string, string, string, string, string];
process.loadEnvFile("C:/PulseFactory/factory/.env");
Object.assign(process.env, { DATA_DIR: DIR, DRY_RUN: "true", PORT: "0" });
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices } = await import("../../src/services.ts");
const { advance } = await import("../../src/pipeline.ts");
const { renderLong } = await import("../../src/render/render.ts");
const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
const s = createServices(db, cfg);
s.notify = async () => true;
const before = (await db.query<any>(`SELECT status, assets_json FROM episodes WHERE id = $1`, [ID]))[0];
if (!before) throw new Error(`no episode ${ID}`);
let captured: any;
s.renderLong = async (input) => {
  captured = input;
  throw new Error("captured for the excerpt");
};
await db.query(`UPDATE episodes SET status = 'voiced', attempts = 0, last_error = NULL, next_attempt_at = NULL WHERE id = $1`, [ID]);
const ep = (await db.query<any>(`SELECT * FROM episodes WHERE id = $1`, [ID]))[0];
try {
  await advance(s, ep);
} catch (err) {
  if (!captured) throw err;
}
// Leave the sandbox episode as it was.
await db.query(`UPDATE episodes SET status = $2, last_error = NULL WHERE id = $1`, [ID, before.status]);
await db.close();
if (!captured) throw new Error("the render was never reached");
const fps = 30;
const t0 = Date.now();
await renderLong({
  ...captured,
  outFile: OUT,
  posterFile: OUT.replace(/\.mp4$/, "_poster.jpg"),
  thumbFile: OUT.replace(/\.mp4$/, "_thumb.jpg"),
  thumbVariants: [],
  frameRange: [Math.round(Number(FROM) * fps), Math.round(Number(TO) * fps) - 1],
  gl: "angle",
});
console.log(`rendered ${Number(TO) - Number(FROM)} s in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
