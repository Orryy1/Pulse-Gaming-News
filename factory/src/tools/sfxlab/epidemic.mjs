// Harvests music beds from the owner's Epidemic Sound subscription (Creator plan: unlimited downloads,
// Pulse's YouTube, TikTok, Facebook and Instagram safelisted against Content ID) through Epidemic's MCP
// server, with the API key in .env (EPIDEMIC_SOUND_MCP_API_KEY).
//
// For every mood it searches the catalogue, keeps instrumental tracks long enough to loop, and downloads
// each one's parts except the lead melody (drums, bass, the other instruments), mixed into one bed: a real
// composition that leaves the narrator's space clear. pickepidemic.py then measures them like every bed.
//
// Usage (from the factory dir): node src/tools/sfxlab/epidemic.mjs [--per 12] [--only tense]
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
process.loadEnvFile(".env");
const KEY = process.env.EPIDEMIC_SOUND_MCP_API_KEY;
if (!KEY) throw new Error("EPIDEMIC_SOUND_MCP_API_KEY is not set");
const URL_ = "https://www.epidemicsound.com/a/mcp-service/mcp";
const WORK = path.join("data", "sfxlab", "epidemic");

// What each mood searches for. The house beds carry the hook and the ordinary chapters.
const MOODS = {
  house: {
    terms: [
      "modern electronic documentary groove",
      "gaming news background electronic",
      "driving tech documentary",
    ],
    bpm: [92, 118],
  },
  tense: {
    terms: [
      "suspense investigative documentary",
      "dark tension pulse underscore",
      "mystery thriller underscore",
    ],
    bpm: [80, 115],
  },
  retro: {
    terms: [
      "synthwave",
      "retro 80s synth",
      "90s video game electronic",
      "retro arcade synth",
    ],
    bpm: [85, 118],
  },
  triumph: {
    terms: [
      "uplifting cinematic electronic",
      "triumphant inspiring documentary",
      "epic achievement build",
    ],
    bpm: [88, 120],
  },
  reflective: {
    terms: [
      "reflective ambient documentary",
      "nostalgic downtempo",
      "emotional thoughtful piano ambient",
    ],
    bpm: [70, 105],
  },
};

let session;
let nextId = 1;
async function post(body) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify(body),
  });
  session ??= r.headers.get("mcp-session-id") ?? undefined;
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return t;
}
async function rpc(method, params) {
  const t = await post({ jsonrpc: "2.0", id: nextId++, method, params });
  const m = [...t.matchAll(/^data: (\{.*)$/gm)]
    .map((x) => x[1])
    .find((x) => x.includes('"jsonrpc"'));
  const j = JSON.parse(m ?? t);
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}
async function call(name, args) {
  for (let attempt = 0; ; attempt++) {
    const r = await rpc("tools/call", { name, arguments: args });
    const text = (r.content ?? []).map((c) => c.text ?? "").join("");
    if (!r.isError) return JSON.parse(text);
    const wait = Number(
      text.match(/retryAfterSeconds"?\s*:\s*(\d+)/)?.[1] ?? 0,
    );
    if (/RETRY_LATER/.test(text) && attempt < 4) {
      await new Promise((ok) => setTimeout(ok, Math.max(5, wait) * 1000));
      continue;
    }
    throw new Error(`${name}: ${text.slice(0, 300)}`);
  }
}

async function search(term, bpm, first) {
  const r = await call("SearchRecordings", {
    query: { term },
    filter: {
      vocals: false,
      duration: { min: 120000 },
      bpm: { min: bpm[0], max: bpm[1] },
    },
    first,
  });
  return (r.data?.recordings?.nodes ?? []).map((n) => n.recording);
}

async function download(id, stemType, dest) {
  const r = await call("DownloadRecording", {
    id,
    options: { fileType: "WAV", stemType },
  });
  const url =
    r.data?.recordingDownload?.assetUrl ??
    Object.values(r.data ?? {})[0]?.assetUrl;
  if (!url) throw new Error(`no download URL for ${id} ${stemType}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

const argv = process.argv.slice(2);
const per = Number(argv[argv.indexOf("--per") + 1]) || 12;
const only = argv.includes("--only")
  ? argv[argv.indexOf("--only") + 1]
  : undefined;
await fs.mkdir(path.join(WORK, "stems"), { recursive: true });
await fs.mkdir(path.join(WORK, "mix"), { recursive: true });
await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "pulse-factory", version: "1" },
});
await post({ jsonrpc: "2.0", method: "notifications/initialized" });

const manifestPath = path.join(WORK, "manifest.json");
const manifest = JSON.parse(
  await fs.readFile(manifestPath, "utf8").catch(() => "{}"),
);
const seen = new Set(Object.keys(manifest));
for (const [mood, spec] of Object.entries(MOODS)) {
  if (only && mood !== only) continue;
  const picks = [];
  for (const term of spec.terms) {
    for (const rec of await search(term, spec.bpm, 15).catch(
      (e) => (console.log("search failed", term, e.message), []),
    )) {
      const parts = rec.stems
        .map((s) => s.type)
        .filter((t) => ["DRUMS", "BASS", "INSTRUMENTS"].includes(t));
      // A bed needs body without the melody: the other instruments plus drums or bass.
      if (
        !parts.includes("INSTRUMENTS") ||
        parts.length < 2 ||
        seen.has(rec.id)
      )
        continue;
      seen.add(rec.id);
      picks.push({ rec, parts });
    }
  }
  console.log(
    `${mood}: ${picks.length} candidates, taking ${Math.min(per, picks.length)}`,
  );
  for (const { rec, parts } of picks.slice(0, per)) {
    const slug = `${mood}_${rec.id.slice(0, 8)}`;
    const out = path.join(WORK, "mix", `es_${slug}.wav`);
    try {
      const files = [];
      for (const p of parts) {
        const f = path.join(WORK, "stems", `${slug}_${p.toLowerCase()}.wav`);
        await fs.access(f).catch(() => download(rec.id, p, f));
        files.push(f);
      }
      await run("ffmpeg", [
        "-v",
        "error",
        "-y",
        ...files.flatMap((f) => ["-i", f]),
        "-filter_complex",
        `amix=inputs=${files.length}:normalize=0:duration=longest`,
        "-ar",
        "48000",
        "-c:a",
        "pcm_s16le",
        out,
      ]);
      manifest[rec.id] = {
        mood,
        file: out,
        title: rec.title,
        artists: rec.credits
          .filter((c) => c.role === "MAIN_ARTIST")
          .map((c) => c.artist.name),
        bpm: rec.bpm,
        parts,
        tags: rec.tags.map((t) => `${t.dimension.name}:${t.displayName}`),
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 1));
      // The parts are 60 MB each: only the mixed bed is kept.
      for (const f of files) await fs.rm(f, { force: true });
      console.log(
        "  mixed",
        slug,
        rec.title,
        `(${parts.join("+").toLowerCase()})`,
      );
    } catch (e) {
      console.log("  failed", slug, rec.title, e.message);
    }
  }
}
