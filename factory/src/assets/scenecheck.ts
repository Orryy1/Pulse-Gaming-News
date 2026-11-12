// SCENE_MATCH (owner, 12 Nov 2026): when a line names a moment ("Ganondorf rises"), the cut must land on that
// scene. The scene index (src/sceneindex/footage.ts) and the cutscene search (src/assets/cutscenes.ts) only find
// where the words point: a shot where someone says "Ganondorf" is not a shot of Ganondorf. This is the picture
// check both use: the free local vision model (LOCAL_VISION_MODEL through Ollama, never Claude, never a paid API)
// is shown the clip's own frames, from the one on the word to the one before the cut, and must see the named
// character (else place or thing) in them. A moment it does not confirm is not used; the line keeps the ordinary
// pick. With the local model down nothing is confirmed, so nothing unconfirmed slips through.

import fs from "node:fs/promises";
import path from "node:path";
import { runCapped } from "../lib/child.ts";
import { FFMPEG } from "../lib/bin.ts";
import { log } from "../lib/util.ts";
import { subjectFrames, type SubjectLook } from "./localvision.ts";
import type { Assignment, Candidate, FootageTarget } from "./clipscore.ts";

/** A frame counts as showing the subject from this certainty up. */
export const SUBJECT_CONFIDENCE = 0.6;

const LEADING = new Set(
  "a an and as at but by for from he her his how if in into it its now of on once or our over she so that the their then there these they this those to until when where while who why with yet you your i we".split(
    " ",
  ),
);
const titleWords = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * The names a line asks to see (pure), longest first: known names (the index's cast, places and the people it has
 * seen) found in the line or its keywords; without a list, the line's capitalised runs ("Princess Zelda", "Hyrule
 * Castle") minus a sentence's leading word and the game's own title. Nothing for a line that names nobody.
 */
export function namedSubjects(
  target: Pick<FootageTarget, "text" | "keywords">,
  known: readonly string[],
  gameTitle = "",
): string[] {
  const game = new Set(titleWords(gameTitle));
  const isGame = (name: string) => titleWords(name).every((w) => game.has(w));
  const hay = ` ${titleWords([target.text, ...target.keywords].join(" ")).join(" ")} `;
  const out: string[] = [];
  if (known.length) {
    const names = [
      ...new Set(
        known.map((n) => n.trim()).filter((n) => n.length >= 3 && !isGame(n)),
      ),
    ].sort((a, b) => b.length - a.length);
    let rest = hay;
    for (const n of names) {
      const words = titleWords(n).join(" ");
      if (!words || words.length < 3) continue;
      // A shorter name inside a longer one already found ("Deku Tree" in "Great Deku Tree") is the same subject.
      if (!rest.includes(` ${words} `) || out.some((o) => ` ${titleWords(o).join(" ")} `.includes(` ${words} `))) continue;
      out.push(n);
      rest = rest.split(` ${words} `).join(` ${"_".repeat(words.length)} `);
    }
    return out;
  }
  const runs = [target.text, ...target.keywords].flatMap(
    (t) =>
      t.match(
        /\b[A-Z][\p{L}0-9'’-]*(?:\s+(?:of\s+|the\s+)?[A-Z][\p{L}0-9'’-]*)*/gu,
      ) ?? [],
  );
  for (let r of runs) {
    const words = r.split(/\s+/);
    while (words.length && LEADING.has(words[0]!.toLowerCase())) words.shift();
    r = words.join(" ").replace(/['’]s$/, "");
    if (r.length < 3 || isGame(r) || out.includes(r)) continue;
    out.push(r);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Where a clip's frames are looked at (pure): on the word, in the middle, just before the cut. */
export function checkTimes(seconds: number): number[] {
  const s = Math.max(0.5, seconds);
  return [0.15, s / 2, Math.max(0.3, s - 0.35)].map(
    (t) => Math.round(t * 100) / 100,
  );
}

/**
 * Whether the looks confirm the moment (pure): the frame on the word must show it, and so must most of the clip
 * (two of three frames), each at SUBJECT_CONFIDENCE or more. Any frame the model could not judge counts against.
 */
export function confirmedBy(
  looks: ReadonlyArray<SubjectLook | undefined>,
): boolean {
  const yes = (l: SubjectLook | undefined) =>
    Boolean(l?.shows && l.confidence >= SUBJECT_CONFIDENCE);
  if (!looks.length || !yes(looks[0])) return false;
  return looks.filter(yes).length * 3 >= looks.length * 2;
}

async function grabFrames(
  file: string,
  times: number[],
  dir: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const [i, t] of times.entries()) {
    const jpg = path.join(
      dir,
      `${path.basename(file, path.extname(file))}_check_${i}.jpg`,
    );
    await runCapped(
      FFMPEG,
      [
        "-v",
        "error",
        "-y",
        "-ss",
        t.toFixed(2),
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "scale=-2:540",
        "-q:v",
        "3",
        jpg,
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    out.push(jpg);
  }
  return out;
}

export interface SubjectAsk {
  game: string;
  line: string;
  names: string[];
}

export interface ClipCheck {
  ok: boolean;
  looks: Array<SubjectLook | undefined>;
  times: number[];
}

/**
 * The picture check on a cut clip: three of its frames to the local model. `deps.look` stands in for the model
 * (tests); `keepFrames` leaves the frames beside the clip for a contact sheet.
 */
export async function checkClip(
  file: string,
  seconds: number,
  ask: SubjectAsk,
  deps: {
    look?: (
      files: string[],
      ask: SubjectAsk,
    ) => Promise<Array<SubjectLook | undefined>>;
    grab?: (file: string, times: number[], dir: string) => Promise<string[]>;
    keepFrames?: boolean;
  } = {},
): Promise<ClipCheck> {
  const times = checkTimes(seconds);
  const dir = path.dirname(file);
  let frames: string[] = [];
  try {
    frames = await (deps.grab ?? grabFrames)(file, times, dir);
    const looks = await (deps.look ?? subjectFrames)(frames, ask);
    const ok = confirmedBy(looks);
    log(
      "info",
      ok
        ? "scene match: moment confirmed"
        : "scene match: moment not confirmed",
      {
        game: ask.game,
        names: ask.names,
        seen: looks.map(
          (l) => l && `${l.shows ? "yes" : "no"} ${l.confidence}: ${l.seen}`,
        ),
      },
    );
    return { ok, looks, times };
  } catch (err) {
    log("warn", "scene match: picture check failed", {
      game: ask.game,
      error: String(err),
    });
    return { ok: false, looks: [], times };
  } finally {
    if (!deps.keepFrames)
      for (const f of frames)
        await fs.rm(f, { force: true }).catch(() => undefined);
  }
}

/**
 * The located-scene reviewer for the cutscene search (src/assets/clipscore.ts verifySceneAssignments) on the local
 * model: every offered keyframe of a line's section is asked whether it shows what the line names, and the surest
 * yes wins. A line that names nobody, or where no frame is a sure yes, gets no pick (the spread pick stays).
 */
export function localSceneReview(
  gameTitle: string,
  deps: {
    look?: (
      files: string[],
      ask: SubjectAsk,
    ) => Promise<Array<SubjectLook | undefined>>;
  } = {},
): (
  targets: FootageTarget[],
  candidates: Candidate[],
) => Promise<Assignment[]> {
  return async (targets, candidates) => {
    const out: Assignment[] = [];
    for (const t of targets) {
      const names = namedSubjects(t, [], gameTitle);
      if (!names.length || !candidates.length) continue;
      const looks = await (deps.look ?? subjectFrames)(
        candidates.map((c) => c.frame),
        { game: gameTitle, line: t.text, names },
      );
      let best: { i: number; look: SubjectLook } | undefined;
      for (const [i, look] of looks.entries())
        if (
          look?.shows &&
          look.confidence >= SUBJECT_CONFIDENCE &&
          (!best || look.confidence > best.look.confidence)
        )
          best = { i, look };
      if (best)
        out.push({
          key: t.key,
          candidate: candidates[best.i]!.index,
          confidence: best.look.confidence,
          reason: `local picture check: ${best.look.seen || names.join(", ")}`,
          label: best.look.seen || names.join(", "),
        });
    }
    return out;
  };
}
