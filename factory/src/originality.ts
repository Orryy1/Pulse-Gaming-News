// The pre-review audit (owner's growth plan, move 6, 1 Nov 2026). Partner Programme reviewers reportedly look at a
// channel's main theme, its most-viewed videos and its newest ones, and since July 2025 YouTube's "inauthentic
// content" rule covers "AI-generated content made with generic or unoriginal templates giving the impression of mass
// production", judged on the channel as a whole. A rejection costs at least 30 days before Pulse can reapply. This
// ranks the 20 most-viewed and 20 newest uploads by originality risk, from three things the factory can measure:
//   - trailer share: how much of the video's running time is official trailer footage (the factory's clip
//     provenance); unknown for uploads made before the factory;
//   - templated structure: how many other uploads share the title's skeleton (names and numbers taken out) or open
//     with the same words;
//   - near-duplicate titles: the closest other title by shared words.
// Read-only: it writes a markdown list for the owner and changes nothing on YouTube. Unlisting (never deleting) is
// the owner's call.

export interface Upload {
  videoId: string;
  title: string;
  views: number;
  /** Seconds; Shorts are 60 s or less. */
  duration?: number;
  /** Position in the channel's newest-first listing (0 is newest). */
  order: number;
}

export interface FactoryFacts {
  /** Seconds of official trailer footage on screen, and the video's length. */
  trailerSeconds: number;
  durationSeconds: number;
  /** The spoken opener, for the opener check. */
  hook?: string;
  lane?: string;
}

export interface Risk {
  upload: Upload;
  trailerShare?: number;
  /** How many other uploads share the title's skeleton or opener. */
  templateMates: number;
  /** The closest other title and how close (0-1). */
  nearest?: { title: string; similarity: number };
  score: number;
  band: "high" | "medium" | "low";
  advice: string;
}

const STOP = new Set(
  "a an the of to in on at for and or but is are was were be it its this that with from by as just now new".split(
    " ",
  ),
);
const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));

const NUMBER_WORD =
  /^(\d[\d,.]*\w*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)$/;

/** Words that appear in at least `min` of the titles: a template's fixed words ("slips", "weeks", "ranked"). */
export function commonWords(titles: string[], min = 3): Set<string> {
  const n = new Map<string, number>();
  for (const t of titles)
    for (const w of new Set(
      t
        .toLowerCase()
        .replace(/[^a-z0-9' ]/g, " ")
        .split(/\s+/),
    ))
      if (w && !NUMBER_WORD.test(w)) n.set(w, (n.get(w) ?? 0) + 1);
  return new Set([...n].filter(([, c]) => c >= min).map(([w]) => w));
}

/**
 * What a template leaves behind once its names and numbers are taken out: the channel's common words stay, every
 * run of other words becomes X ("X slips X to X" for "Witchbrook Slips Two Weeks to March 3").
 */
export function titleSkeleton(
  title: string,
  common: ReadonlySet<string>,
): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (common.has(w) && !NUMBER_WORD.test(w) ? w : "X"))
    .join(" ")
    .replace(/X( X)+/g, "X");
}

/** Shared words over all words (Jaccard). */
export function titleSimilarity(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / (x.size + y.size - n);
}

/** Official trailer seconds from the factory's clip provenance (Steam store trailers, publisher trailers). */
export function trailerSecondsOf(
  clips: ReadonlyArray<{
    provenance?: string;
    sourceUrl?: string;
    durationSeconds?: number;
  }>,
): number {
  return clips
    .filter((c) =>
      /trailer/i.test(`${c.provenance ?? ""} ${c.sourceUrl ?? ""}`),
    )
    .reduce((n, c) => n + (c.durationSeconds ?? 0), 0);
}

/** Every upload's risk, against the whole channel listing (templates and twins are channel-wide). */
export function originalityRisks(
  all: Upload[],
  facts: ReadonlyMap<string, FactoryFacts>,
): Map<string, Risk> {
  const common = commonWords(all.map((u) => u.title));
  const skeletonOf = (t: string) => titleSkeleton(t, common);
  const skeletons = new Map<string, number>();
  for (const u of all) {
    const k = skeletonOf(u.title);
    skeletons.set(k, (skeletons.get(k) ?? 0) + 1);
  }
  const openers = new Map<string, number>();
  const opener = (h?: string) => (h ? words(h).slice(0, 3).join(" ") : "");
  for (const f of facts.values()) {
    const o = opener(f.hook);
    if (o) openers.set(o, (openers.get(o) ?? 0) + 1);
  }
  const out = new Map<string, Risk>();
  for (const u of all) {
    const f = facts.get(u.videoId);
    const trailerShare =
      f && f.durationSeconds > 0
        ? Math.min(1, f.trailerSeconds / f.durationSeconds)
        : undefined;
    const templateMates = Math.max(
      // A skeleton of bare X (no fixed words at all) is no template.
      skeletonOf(u.title) === "X"
        ? 0
        : (skeletons.get(skeletonOf(u.title)) ?? 1) - 1,
      f?.hook ? (openers.get(opener(f.hook)) ?? 1) - 1 : 0,
    );
    let nearest: Risk["nearest"];
    for (const v of all) {
      if (v.videoId === u.videoId) continue;
      const s = titleSimilarity(u.title, v.title);
      if (!nearest || s > nearest.similarity)
        nearest = { title: v.title, similarity: Math.round(s * 100) / 100 };
    }
    // Unknown trailer share (made before the factory) counts as middling, neither cleared nor condemned.
    const trailer = trailerShare ?? 0.35;
    const template = Math.min(1, templateMates / 4);
    const twin = nearest ? Math.max(0, (nearest.similarity - 0.3) / 0.5) : 0;
    // A title the channel has already used, word for word or nearly, is a duplicate whatever else it scores.
    const duplicate = (nearest?.similarity ?? 0) >= 0.9;
    const raw =
      Math.round(
        (0.45 * trailer + 0.3 * template + 0.25 * Math.min(1, twin)) * 100,
      ) / 100;
    const score = duplicate ? Math.max(raw, 0.5) : raw;
    const band = score >= 0.5 ? "high" : score >= 0.3 ? "medium" : "low";
    const short = (u.duration ?? 0) <= 60;
    const advice =
      band === "high"
        ? duplicate
          ? "A near-identical title is already on the channel: consider unlisting (never deleting) one of them."
          : short
          ? "Consider unlisting (never deleting) before the review: trailer-led or templated, close to others."
          : "Repackage or add an original take before the review."
        : band === "medium"
          ? "Keep; make sure it carries a visible take beyond the source."
          : "Keep: reads as original work.";
    out.set(u.videoId, {
      upload: u,
      trailerShare,
      templateMates,
      nearest,
      score,
      band,
      advice,
    });
  }
  return out;
}

const pct = (x?: number) =>
  x === undefined ? "unknown" : `${Math.round(x * 100)}%`;
const cell = (t: string) => t.replace(/\|/g, "/").replace(/\s+/g, " ");

/** The owner's list: the 20 most viewed and the 20 newest, each ranked riskiest first. */
export function auditMarkdown(
  risks: Map<string, Risk>,
  all: Upload[],
  when: Date,
  top = 20,
): string {
  const table = (rows: Risk[]) =>
    [
      "| Risk | Score | Views | Title | Trailer share | Shares a template with | Closest other title | What to do |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...rows
        .sort((a, b) => b.score - a.score)
        .map(
          (r) =>
            `| ${r.band} | ${r.score} | ${r.upload.views.toLocaleString("en-GB")} | [${cell(r.upload.title)}](https://youtu.be/${r.upload.videoId}) | ${pct(r.trailerShare)} | ${r.templateMates} | ${r.nearest ? `${cell(r.nearest.title)} (${r.nearest.similarity})` : ""} | ${r.advice} |`,
        ),
    ].join("\n");
  const mostViewed = [...all].sort((a, b) => b.views - a.views).slice(0, top);
  const newest = [...all].sort((a, b) => a.order - b.order).slice(0, top);
  const pick = (us: Upload[]) =>
    us.map((u) => risks.get(u.videoId)!).filter(Boolean);
  const both = [...pick(mostViewed), ...pick(newest)];
  const high = new Set(
    both.filter((r) => r.band === "high").map((r) => r.upload.videoId),
  );
  return `# Pre-review originality audit, ${when.toISOString().slice(0, 10)}

Read-only. Nothing on YouTube was changed. Partner Programme reviewers reportedly look at a channel's theme, its most-viewed videos and its newest ones, and YouTube's inauthentic-content rule ("generic or unoriginal templates giving the impression of mass production") is judged on the channel as a whole. This list ranks those two groups by originality risk so the most original work is what a reviewer sees. Unlisting is reversible; deleting is not, so never delete.

How the score is made (0 to 1, higher is riskier): 45% trailer share (how much of the running time is official trailer footage, from the factory's clip records; "unknown" for uploads made before the factory, counted as middling), 30% templated structure (other uploads with the same title skeleton once names and numbers are taken out, or the same spoken opener), 25% near-duplicate title (shared words with the closest other title). High is 0.5 or more, medium 0.3 or more.

**${high.size} upload${high.size === 1 ? "" : "s"} in these two groups ${high.size === 1 ? "scores" : "score"} high.**

## The 20 most-viewed uploads

${table(pick(mostViewed))}

## The 20 newest uploads

${table(pick(newest))}
`;
}
