// 31 Oct 2026: the filmed-screen check (src/assets/footagefirst.ts filmedScreen) run over a proof's kept clips
// (<proof dir>/added.json and <proof dir>/ep/...), with the real frame and thumbnail calls. Prints, per channel, how
// many clips trip it and whether the whole video would be dropped (more than half its segments). Reads only the
// proof folder; writes frames to <proof dir>/screen_check and deletes nothing else. Run it through the orchestrator.
// Usage: node --import tsx data/smoke/footage_screen.mts <proof dir>
import fs from "node:fs";
import path from "node:path";
const F = await import("../../src/assets/footagefirst.ts");
const { footageFirstDeps } = await import("../../src/assets/footagedeps.ts");
const proof = process.argv[2]!;
const added: any[] = JSON.parse(fs.readFileSync(path.join(proof, "added.json"), "utf8"));
const deps = footageFirstDeps({ ytdlp: "yt-dlp", lease: false });
const work = path.join(proof, "screen_check");
fs.mkdirSync(work, { recursive: true });
const verdicts: Array<{ source: string; reason?: string }> = [];
const by = new Map<string, { channel: string; game: number; n: number; tripped: number }>();
for (const [i, c] of added.entries()) {
  const file = path.join(proof, "ep", c.file);
  const frames = await deps.frames(file, 0, c.durationSeconds, path.join(work, `c${i}`));
  const g = await deps.grays!([frames[0]!, frames[Math.floor(frames.length / 2)]!, frames[frames.length - 1]!]);
  const trip = F.filmedScreen(g);
  verdicts.push({ source: c.sourceUrl, reason: trip ? F.FILMED : undefined });
  const channel = String(c.provenance).split(" by ")[1]?.split(",")[0] ?? "?";
  const m = by.get(c.sourceUrl) ?? { channel, game: c.beatIndex, n: 0, tripped: 0 };
  m.n++;
  if (trip) m.tripped++;
  by.set(c.sourceUrl, m);
}
const dropped = F.condemnedSources(verdicts);
let gone = 0;
for (const [url, m] of [...by].sort((a, b) => a[1].game - b[1].game)) {
  const out = dropped.has(url) ? m.n : m.tripped;
  gone += out;
  console.log(`chapter ${m.game}  ${m.channel.padEnd(32)} ${m.tripped}/${m.n} tripped${dropped.has(url) ? "  -> whole video dropped" : ""}  ${url}`);
}
console.log(`${added.length} kept clips: ${gone} would go`);
