// Runs on the PC (every 10 minutes, the "Pulse routine files" task from install-routine-files-pull.cmd).
// The factory runs on the Mac mini and the Studio browser routines run in the PC's Brave, whose file upload
// takes a path on the PC. The Mac cannot write to the PC's disk, so this asks the factory's LAN routine port
// which pictures the routines will attach (A/B test thumbnails, the community post picture) and fetches the
// new or changed ones into ROUTINE_PC_DIR, the folder the routine pages name. Files the factory no longer
// lists go after two weeks. Plain Node, no packages; nothing here is secret.
//
//   node pull-routine-files.mjs [http://pulse-mac.local:8081]
import fs from "node:fs/promises";
import path from "node:path";

const BASE = (
  process.argv[2] ||
  process.env.ROUTINE_BASE ||
  "http://pulse-mac.local:8081"
).replace(/\/+$/, "");
const DIR = process.env.ROUTINE_PC_DIR || "C:\\PulseFactory\\routine-files";
const KEEP_MS = 14 * 86_400_000;
const LOG = path.join(DIR, "pull.log");
// When the factory last answered. A blip (a deploy restarting the factory, a dropped Wi-Fi packet) retries
// inside the run and, failing that, waits for the next run; only an outage longer than OUTAGE_MS ends the
// run with an error code, so the PC watchdog flags real outages and not every restart.
const LAST_OK = path.join(DIR, "last-ok.txt");
const OUTAGE_MS = 60 * 60_000;
const RETRY_WAITS_MS = (process.env.ROUTINE_RETRY_WAITS_MS ?? "15000,30000")
  .split(",")
  .filter(Boolean)
  .map(Number);

async function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(" ")}\n`;
  process.stdout.write(line);
  try {
    await fs.mkdir(DIR, { recursive: true });
    const st = await fs.stat(LOG).catch(() => undefined);
    if (st && st.size > 256 * 1024) await fs.rm(LOG, { force: true });
    await fs.appendFile(LOG, line, "utf8");
  } catch {
    /* logging is best effort */
  }
}

// "fetch failed" hides the real reason (refused, reset, name not found) in err.cause.
const why = (err) => {
  const c = err?.cause;
  const detail = c ? ` (${c.code ?? c.name ?? ""}${c.message ? ` ${c.message}` : ""})` : "";
  return `${err?.message ?? err}${detail}`;
};

// A refused or reset connection, a timeout, or a 5xx: what a factory restart looks like.
const isNetwork = (err) =>
  !!err?.network || err?.name === "TypeError" || err?.name === "TimeoutError";

// Fetches and reads the body inside the retry loop, so a connection cut mid-download is retried too.
async function get(url, as) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        // 5xx while the factory starts up is worth another go; 4xx is not.
        throw Object.assign(new Error(`${url} answered ${res.status}`), {
          network: res.status >= 500,
        });
      }
      return as === "json" ? await res.json() : Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (!isNetwork(err) || attempt >= RETRY_WAITS_MS.length) throw err;
      await new Promise((r) => setTimeout(r, RETRY_WAITS_MS[attempt]));
    }
  }
}

// "folder/name": each part plain characters, never "." or "..".
const safeRel = (rel) =>
  typeof rel === "string" &&
  /^[\w.-]+\/[\w.-]+$/.test(rel) &&
  rel.split("/").every((p) => p !== "." && p !== "..");

async function main() {
  const list = await get(`${BASE}/routine/pc-files`, "json");
  if (String(list.dir).toLowerCase() !== DIR.toLowerCase()) {
    // The pages would name paths this puller does not fill.
    await log(
      `factory names ${list.dir} but this puller fills ${DIR}: set ROUTINE_PC_DIR to match`,
    );
    process.exitCode = 2;
    return;
  }
  const wanted = new Set();
  let fetched = 0;
  for (const f of list.files ?? []) {
    if (!safeRel(f.rel) || !/^[0-9a-f]{16}$/.test(String(f.id))) {
      await log(`skipped an odd entry: ${JSON.stringify(f).slice(0, 200)}`);
      continue;
    }
    const dest = path.join(DIR, ...f.rel.split("/"));
    wanted.add(path.resolve(dest).toLowerCase());
    const have = await fs.stat(dest).catch(() => undefined);
    const same =
      have && have.size === f.size && Math.abs(have.mtimeMs - f.mtimeMs) < 2000;
    if (same && f.fetched) continue;
    const body = await get(`${BASE}/routine/pc-file?id=${encodeURIComponent(f.id)}`, "buffer");
    if (body.length !== f.size) {
      // Usually the factory rewrote the picture between the list and the fetch; the next run gets it.
      await log(`${f.rel}: got ${body.length} bytes, expected ${f.size}; trying again next run`);
      continue;
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(`${dest}.part`, body);
    await fs.rename(`${dest}.part`, dest);
    const t = new Date(f.mtimeMs);
    await fs.utimes(dest, t, t);
    fetched++;
  }
  // Tidy: what the factory stopped listing, once two weeks old, and any half-written copy.
  let removed = 0;
  for (const sub of await fs.readdir(DIR, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const folder = path.join(DIR, sub.name);
    for (const name of await fs.readdir(folder)) {
      const file = path.join(folder, name);
      if (wanted.has(path.resolve(file).toLowerCase())) continue;
      const st = await fs.stat(file).catch(() => undefined);
      if (!st?.isFile()) continue;
      if (name.endsWith(".part") || Date.now() - st.mtimeMs > KEEP_MS) {
        await fs.rm(file, { force: true });
        removed++;
      }
    }
    if (!(await fs.readdir(folder)).length) await fs.rmdir(folder);
  }
  if (fetched || removed)
    await log(`listed ${wanted.size}, fetched ${fetched}, removed ${removed}`);
  await fs.writeFile(LAST_OK, new Date().toISOString(), "utf8").catch(() => {});
}

main().catch(async (err) => {
  // The Mac off or the factory restarting: the next run catches up. Only a long outage is an error, and
  // anything that is not a network fault (a disk error, a 404, a bad answer) is an error straight away.
  const last = Date.parse(await fs.readFile(LAST_OK, "utf8").catch(() => ""));
  const outage = !isNetwork(err) || !Number.isFinite(last) || Date.now() - last > OUTAGE_MS;
  await log(
    `failed: ${why(err)}${outage ? "" : "; the factory answered within the hour, so the next run catches up"}`,
  );
  process.exitCode = outage ? 1 : 0;
});
