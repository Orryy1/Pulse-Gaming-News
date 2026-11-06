// The one-off catch-up for the series playlists (src/seriesplaylists.ts). It asks the running factory to do the work,
// because only the factory may open the database. Without --apply it is a dry run: it reads what each playlist holds
// and which videos are public, prints what it would add and adds nothing. Run it again any time: what is already on a
// shelf is skipped, and what today's quota could not take waits for the next run. Never changes a video.
// Usage (from factory\): node --import tsx src/tools/series-playlists.ts [--apply] [--max=40]
process.loadEnvFile(".env");

const apply = process.argv.includes("--apply");
const max = Number(
  process.argv.find((a) => a.startsWith("--max="))?.slice(6) ?? 40,
);
const port = process.env.PORT || "8080";
const res = await fetch(
  `http://127.0.0.1:${port}/admin/series-playlists?apply=${apply ? 1 : 0}&max=${max}`,
  { method: "POST", headers: { "x-admin-key": process.env.ADMIN_TOKEN ?? "" } },
);
if (!res.ok) throw new Error(`series playlists failed: HTTP ${res.status}`);
console.log(JSON.stringify(await res.json(), null, 2));
console.log(apply ? "Applied." : "Dry run: nothing was added. Add --apply.");
