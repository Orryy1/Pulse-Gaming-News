// VERSUS_LONG's results reader (src/versus.ts versusVerdict): reads the "versus" arm records and the published long
// videos' 7-day views and thumbnail CTR, and prints the verdict against the long rankings made while it was on.
// Read only. On the Mac mini, from the factory folder:
//   node --import tsx src/tools/versus-results.ts [--env=<factory .env>] [--json]
// Pass mark: at least 6 published videos per arm, and the versus's median 7-day views AND median CTR (when both arms
// have 6 CTR readings) above the rankings'. "waiting" until then; a "fail" means VERSUS_SHARE goes back to 0.

const args = process.argv.slice(2);
const envFile = args.find((a) => a.startsWith("--env="))?.slice(6);
if (envFile) process.loadEnvFile(envFile);

const { loadConfig } = await import("../config.ts");
const { openDb } = await import("../db.ts");
const { versusResults } = await import("../gtaguidestep.ts");
const { versusVerdict } = await import("../versus.ts");

const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
try {
  const results = await versusResults(db);
  const v = versusVerdict(results);
  if (args.includes("--json"))
    console.log(JSON.stringify({ ...v, results }, null, 2));
  else {
    const side = (
      name: string,
      x: { n: number; views: number; ctr?: number },
    ) =>
      `${name}: ${x.n} published, median ${Math.round(x.views).toLocaleString("en-GB")} views in 7 days${x.ctr !== undefined ? `, median CTR ${(x.ctr * 100).toFixed(1)}%` : ""}`;
    console.log(`Versus verdict: ${v.verdict}`);
    console.log(side("Versus", v.versus));
    console.log(side("Long rankings", v.ranking));
    console.log(
      `VERSUS_LONG is ${cfg.versusLong ? "on" : "off"}, VERSUS_SHARE ${cfg.versusShare}.`,
    );
  }
} finally {
  await db.close();
}
