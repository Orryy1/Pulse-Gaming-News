// Tidying a whole index after a stretch is added (pure, and safe to run again and again): the things that can
// only be judged with the whole game in view.
//   - A name plate misread in one frame ("Roto", "Zeida") takes the spelling the game shows hundreds of times
//     ("Ruto", "Zelda"); a plate seen once or twice that is close to nothing else is a misread scrap and goes.
//   - A line cut in two (by a stretch boundary, or by a frame the reader got wrong) is one line again.
//   - A character card ("SARIA  Link's Childhood Friend") or a place card ("KOKIRI FOREST") names who or where
//     a shot is: the surest naming there is, straight from the game.

import { alike } from "./dialogue.ts";
import { knownName, mergeNames } from "./names.ts";
import { mergeCoverage, shotAt, type DialogueLine, type SceneIndex } from "./schema.ts";

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Edits between two short strings (insert, delete, swap one for another, swap two neighbours). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...new Array<number>(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

/**
 * Each speaker reading mapped to the spelling to keep, or to "" when it is a scrap. A reading seen five times or
 * more stands. A rarer one takes a standing name within two edits of it (one for a short name); otherwise it
 * stays when it is on the game's cast list or was seen at least three times, and goes when it was not.
 */
export function speakerSpellings(
  counts: Map<string, number>,
  cast: string[],
): Map<string, string> {
  const standing = [...counts]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1]);
  const known = new Set(cast.map(norm));
  const out = new Map<string, string>();
  for (const [name, n] of counts) {
    const k = norm(name);
    if (n >= 5) {
      out.set(name, name);
      continue;
    }
    const near = standing.find(([s]) => {
      const sk = norm(s);
      if (sk === k) return true;
      return (
        editDistance(sk, k) <= (Math.min(sk.length, k.length) >= 5 ? 2 : 1)
      );
    });
    if (near) out.set(name, near[0]);
    else out.set(name, known.has(k) || n >= 3 ? name : "");
  }
  return out;
}

/** Adjacent lines that are one line cut in two: the same words (or one the start of the other), less than a second apart. */
export function joinSplitLines<
  L extends Pick<
    DialogueLine,
    "start" | "end" | "text" | "speaker" | "via" | "words"
  >,
>(lines: L[]): L[] {
  const out: L[] = [];
  for (const line of [...lines].sort((a, b) => a.start - b.start)) {
    const prev = out[out.length - 1];
    const a = prev ? norm(prev.text) : "";
    const b = norm(line.text);
    const same =
      prev !== undefined &&
      line.start - prev.end <= 1 &&
      prev.via === line.via &&
      !prev.words &&
      !line.words &&
      (a === b ||
        alike(prev.text, line.text) >= 0.9 ||
        (Math.min(a.length, b.length) >= 8 &&
          (a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a))));
    if (!same) {
      out.push({ ...line });
      continue;
    }
    prev.end = Math.max(prev.end, line.end);
    if (b.length > a.length) prev.text = line.text;
    if (!prev.speaker && line.speaker) prev.speaker = line.speaker;
  }
  return out;
}

/** The names from a list that are written, whole, in a text ("SARIA Link's Childhood Friend" -> Saria, Link). */
export function namesWritten(text: string, list: string[]): string[] {
  const t = ` ${norm(text)} `;
  return list.filter((name) => {
    const k = norm(name);
    return k.length >= 4 && t.includes(` ${k} `);
  });
}

/**
 * A spoken line the game did not put a name to takes the one character in its shot (the shot at the middle of the
 * line), marked as a guess. Only characters count: the names the game's own plates show when it has plates,
 * otherwise anyone in the shot who is not a place. Two characters in the shot, or none: no guess.
 */
export function guessSpeakers(
  lines: DialogueLine[],
  shots: SceneIndex["shots"],
  plateNames: Set<string>,
  places: string[],
): DialogueLine[] {
  const placeSet = new Set(places.map(norm));
  return lines.map((l) => {
    if (l.speaker || l.via === "textbox") return l;
    const shot = shots[shotAt(shots, (l.start + l.end) / 2)];
    const people = (shot?.who ?? []).filter((w) =>
      plateNames.size ? plateNames.has(w) : !placeSet.has(norm(w)),
    );
    return people.length === 1 ? { ...l, speaker: people[0]!, speakerGuessed: true } : l;
  });
}

/** The index with its speakers respelt, its split lines joined and its cards read into who and where. */
export function tidyIndex(index: SceneIndex): SceneIndex {
  const counts = new Map<string, number>();
  // A speaker guessed from the picture on an earlier pass is guessed afresh below, not counted as shown.
  const shown = index.lines.map((l) => {
    if (!l.speakerGuessed) return l;
    const { speaker: _speaker, speakerGuessed: _guessed, ...rest } = l;
    return rest as DialogueLine;
  });
  for (const l of shown)
    if (l.speaker) counts.set(l.speaker, (counts.get(l.speaker) ?? 0) + 1);
  const spell = speakerSpellings(counts, index.cast);
  const respelt: DialogueLine[] = shown.map((l) => {
    const { speaker, ...rest } = l;
    const s = speaker ? spell.get(speaker) : undefined;
    return s ? { ...rest, speaker: s } : rest;
  });
  const joined = joinSplitLines(respelt);
  // In a game that names the speaker of nearly every line, a line with no speaker and no voice is not dialogue:
  // it is a card or a message from the game itself ("You got the Master Sword!"). It still says what the moment
  // is, so it moves to the writing on screen of the shot it appears in.
  // Judged on the lines that were also heard when the game is voiced (its credits roll is read too, and would
  // drown the count), on all of them when it is not.
  const voiced = joined.filter((l) => l.via === "both");
  const judged = voiced.length >= joined.length * 0.5 ? voiced : joined;
  const named = judged.filter((l) => l.speaker).length;
  const cards =
    judged.length >= 20 && named / judged.length >= 0.85
      ? joined.filter((l) => !l.speaker && l.via === "textbox")
      : [];
  const cardText = new Map<number, string[]>();
  const cardTimes = new Map<number, Array<{ from: number; to: number }>>();
  for (const c of cards) {
    const at = shotAt(index.shots, c.start);
    cardText.set(at, [...(cardText.get(at) ?? []), c.text]);
    // A message can stay up across a cut: every shot it is over knows when.
    for (let i = at; i < index.shots.length && index.shots[i]!.start < c.end; i++)
      cardTimes.set(i, [...(cardTimes.get(i) ?? []), { from: c.start, to: c.end }]);
  }
  const lines = joined
    .filter((l) => !cards.includes(l))
    .map((l, i) => ({
      ...l,
      id: i,
      shot: shotAt(index.shots, l.start),
    }));
  const speakers = [
    ...new Set(lines.flatMap((l) => (l.speaker ? [l.speaker] : []))),
  ].filter((s) => (counts.get(s) ?? 0) >= 3);
  // The name plates the game itself shows, again and again, are the surest cast list there is.
  const cast = mergeNames(index.cast, speakers);
  // The credits: after the last line anyone says, a run of shots most of which carry writing. A cast list scrolling
  // past is not footage and must not answer a lookup for the characters it names.
  const spoken = lines.filter((l) => l.speaker && (voiced.length < joined.length * 0.5 || l.via !== "textbox"));
  const lastSaid = spoken.length ? spoken[spoken.length - 1]!.end : Infinity;
  const tail = index.shots.filter((s) => s.start >= lastSaid + 5);
  const lettered = (t: string) => t.replace(/[^\p{L}]/gu, "").length >= 10;
  const wordy = (s: { id: number; text: string }) =>
    lettered(s.text) || (cardText.get(s.id) ?? []).some(lettered);
  const credits = new Set(
    tail.length >= 8 && tail.filter(wordy).length / tail.length >= 0.3
      ? tail.filter(wordy).map((s) => s.id)
      : [],
  );
  const shots = index.shots.map((shot) => {
    const extra = (cardText.get(shot.id) ?? []).filter(
      (t) => !norm(shot.text).includes(norm(t)),
    );
    const times = cardTimes.get(shot.id);
    const timed = times
      ? { ...shot, written: mergeCoverage([...(shot.written ?? []), ...times]) }
      : shot;
    const s = extra.length
      ? { ...timed, text: [shot.text, ...extra].filter(Boolean).join(" / ").slice(0, 200) }
      : timed;
    if (!s.text) return s;
    if (credits.has(s.id)) return { ...s, menu: true };
    // The first name on a card is whose card it is ("SARIA  Link's Childhood Friend" is Saria's, not Link's).
    const low = ` ${norm(s.text)} `;
    const written = namesWritten(s.text, cast).sort(
      (a, b) => low.indexOf(` ${norm(a)} `) - low.indexOf(` ${norm(b)} `),
    );
    const first = s.text.trim().split(/\s+/)[0] ?? "";
    const card =
      written[0] ?? (first.length >= 4 ? knownName(first, cast) : undefined);
    const who = card ? [card] : [];
    const where = namesWritten(s.text, index.places)[0];
    return {
      ...s,
      who: mergeNames(s.who, who),
      where: s.where || where || "",
    };
  });
  return { ...index, cast, shots, lines: guessSpeakers(lines, shots, new Set(speakers), index.places) };
}

/**
 * The cast list the vision model is given (pure): the names the game itself uses, in its dialogue, on its name
 * plates and on its cards, plus the first few of the list whatever happens (the plot's leads, who may go unnamed
 * for a while: nobody says "Link" in the first minutes). Wikipedia's article about a series' characters also lists
 * people from its other games; a name this game never says is not offered, so the model cannot pin it on anyone.
 */
export function groundedCast(index: Pick<SceneIndex, "cast" | "lines" | "shots">, lead = 5): string[] {
  const said = ` ${norm(
    [
      ...index.lines.flatMap((l) => [l.speaker ?? "", l.text]),
      ...index.shots.map((sh) => sh.text),
    ].join(" "),
  )} `;
  return index.cast.filter((name, i) => i < lead || said.includes(` ${norm(name)} `));
}
