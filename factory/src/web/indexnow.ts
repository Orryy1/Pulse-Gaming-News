// IndexNow: tells Bing (and the other engines that share it) about new pages the moment they
// exist, so the site is crawled without waiting on a sitemap fetch. The key is public by design:
// it is served at /<key>.txt to prove the site owns the pings.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";

interface State {
  key: string;
  sent: string[];
}

const file = (cfg: Config) => path.join(cfg.dataDir, "site", "indexnow.json");

function load(cfg: Config): State {
  try {
    const s = JSON.parse(fs.readFileSync(file(cfg), "utf8")) as State;
    if (/^[a-f0-9]{32}$/.test(s.key)) return { key: s.key, sent: s.sent ?? [] };
  } catch {
    // first run
  }
  const s = { key: crypto.randomBytes(16).toString("hex"), sent: [] };
  save(cfg, s);
  return s;
}

function save(cfg: Config, s: State): void {
  fs.mkdirSync(path.dirname(file(cfg)), { recursive: true });
  fs.writeFileSync(file(cfg), JSON.stringify(s));
}

export const indexNowKey = (cfg: Config): string => load(cfg).key;

/** Sends the pages not yet announced. Returns how many went. */
export async function announce(
  cfg: Config,
  base: string,
  urls: string[],
): Promise<number> {
  const s = load(cfg);
  const seen = new Set(s.sent);
  const fresh = [...new Set(urls)].filter((u) => !seen.has(u)).slice(0, 10_000);
  if (!fresh.length) return 0;
  const host = new URL(base).host;
  const res = await fetchWithTimeout(
    "https://api.indexnow.org/indexnow",
    {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key: s.key,
        keyLocation: `${base}/${s.key}.txt`,
        urlList: fresh,
      }),
    },
    30_000,
  );
  // 200 and 202 both mean accepted; anything else is retried on the next pass.
  if (res.status !== 200 && res.status !== 202)
    throw new Error(
      `IndexNow ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  save(cfg, { key: s.key, sent: [...s.sent, ...fresh].slice(-20_000) });
  return fresh.length;
}

/** Every 20 minutes, announces new site pages (live only on the site's own domain). */
export function startIndexNow(
  cfg: Config,
  urls: () => Promise<string[]>,
  base: string,
): void {
  if (!cfg.siteUrl || cfg.dryRun || process.env.NODE_TEST_CONTEXT) return;
  const pass = async () => {
    try {
      const n = await announce(cfg, base, await urls());
      if (n) log("info", "indexnow announced", { pages: n });
    } catch (err) {
      log("warn", "indexnow failed", { error: errorMessage(err) });
    }
  };
  setTimeout(() => void pass(), 90_000);
  setInterval(() => void pass(), 20 * 60 * 1000);
}
