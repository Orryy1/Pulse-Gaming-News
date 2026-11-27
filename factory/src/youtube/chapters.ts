// The chapter list YouTube reads from a description. The marks come from the render's own timeline
// (longChapters in src/pipeline.ts: the intro at 0:00, each chapter where its breather opens, the outro);
// this module is the last check before they go into the description, so a list YouTube would ignore is
// left out rather than shown broken: YouTube wants the first mark at 0:00, at least three marks, each ten
// seconds or more after the last, and it shows them only once. A title that names nothing a viewer would
// search for ("Part 3", "Chapter 2") loses that prefix, and a writer-made description that already carries
// timestamps keeps its own list instead of getting a second one.

/** A description line that already is a chapter mark: "0:00 Intro", "12:34 The Fall", "1:02:03 Legacy". */
const MARK = /^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s+\S/m;

/** True when the text already holds a chapter list (two or more timestamped lines). */
export function hasChapterMarks(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => MARK.test(l));
  return lines.length >= 2;
}

/** "m:ss" or "h:mm:ss" back to seconds. */
export function markSeconds(line: string): number {
  const stamp = line.trim().split(/\s+/)[0] ?? "";
  return stamp.split(":").reduce((a, b) => a * 60 + Number(b), 0);
}

/**
 * A chapter title as people search for it: no "Part 3", "Chapter 2:" or "Entry 4" in front, no trailing
 * full stop, and the words it is left with trimmed. Empty when nothing searchable remains.
 */
export function searchableTitle(title: string): string {
  return title
    .replace(
      /^\s*(?:part|chapter|entry|section|story|segment)\s*(?:\d+|[ivx]+)\s*[:.\-–]?\s*/i,
      "",
    )
    .replace(/\s*[.:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The chapter lines a description gets. Keeps the first mark at 0:00 (it is forced there when the first line
 * is within a second of it), drops marks closer than ten seconds to the previous one and titles that say
 * nothing, and returns nothing at all when fewer than three usable marks remain or the description body
 * already carries its own list.
 */
export function finishChapters(lines: string[], body = ""): string[] {
  if (hasChapterMarks(body)) return [];
  const out: string[] = [];
  let last = -Infinity;
  for (const [i, line] of lines.entries()) {
    const m = line.trim().match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$/);
    if (!m) continue;
    let t = markSeconds(line);
    if (i === 0 && t <= 1) t = 0;
    const title = searchableTitle(m[2]!);
    if (!title) continue;
    if (out.length === 0 && t !== 0) return [];
    if (t - last < 10) continue;
    out.push(`${stamp(t)} ${title}`);
    last = t;
  }
  return out.length >= 3 ? out : [];
}

/** Seconds as YouTube writes a mark: "m:ss", or "h:mm:ss" past an hour. */
export function stamp(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
