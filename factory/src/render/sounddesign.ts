// What the documentary's mix will do, said plainly (30 Oct 2026): the beats the writer marked and the era
// beds the chapters open on, counted for the episode's log and one Discord line, so nothing about the
// sound changes without the owner hearing of it. Pure; the pipeline's render step calls it once.
import { eraBed, type EraBed } from "./soundscape.ts";

export interface SoundDesignSummary {
  beats: {
    reveal: number;
    key: number;
    record: number;
    turn: number;
    quiet: number;
  };
  total: number;
  eras: Partial<Record<EraBed, number>>;
  chapters: number;
}

export function soundDesignSummary(
  moments: Array<Array<{ beat?: string } | undefined>>,
  years: Array<number | undefined>,
  eraBeds: boolean,
): SoundDesignSummary {
  const beats = { reveal: 0, key: 0, record: 0, turn: 0, quiet: 0 };
  for (const entry of moments)
    for (const m of entry) {
      const b = m?.beat;
      if (b && b in beats) beats[b as keyof typeof beats]++;
    }
  const eras: Partial<Record<EraBed, number>> = {};
  let chapters = 0;
  if (eraBeds)
    for (const y of years) {
      const e = eraBed(y);
      if (!e) continue;
      eras[e] = (eras[e] ?? 0) + 1;
      chapters++;
    }
  const total = Object.values(beats).reduce((a, b) => a + b, 0);
  return { beats, total, eras, chapters };
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** The Discord line for a documentary whose mix follows at least one beat or plays an era bed. */
export function soundDesignLine(
  headline: string,
  s: SoundDesignSummary,
): string {
  const parts = [
    s.beats.reveal ? plural(s.beats.reveal, "reveal") : "",
    s.beats.key ? plural(s.beats.key, "key line") : "",
    s.beats.record ? plural(s.beats.record, "record sting") : "",
    s.beats.turn ? plural(s.beats.turn, "turn") : "",
    s.beats.quiet ? plural(s.beats.quiet, "quiet breath") : "",
  ].filter(Boolean);
  const eras = (Object.entries(s.eras) as Array<[EraBed, number]>)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  const mix = s.total
    ? `the mix follows ${plural(s.total, "beat")} the writer marked (${parts.join(", ")})`
    : "the writer marked no beats for the mix";
  const beds = s.chapters
    ? `; era beds open ${plural(s.chapters, "chapter")} (${eras})`
    : "";
  return `🎚️ "${headline}": ${mix}${beds}.`;
}
