// VERSUS_LONG (owner, 27 Nov 2026: "a huge inspiration"): the then-vs-now long video. GTAbites' "GTA 6 Can Do Things We
// Never Imagined in GTA 5" (26 min, 7.16M views from trailers alone, posted two weeks before launch on a channel three
// weeks old) is 27 one-minute chapters, each one system: what GTA 5 did, what GTA 6 does, what it means for you, and a
// verdict with one sharp comment question. Study: reports/frontier/GTAbites versus study 2026-11-27.md.
//
// Built on the GTA guide's machinery (src/gtaguide.ts) rather than as a lane of its own: a versus is a "longform"
// episode whose factcheck carries a gta_guide topic with a versus kind (VERSUS_KINDS), so the fact pack, the play
// evidence, the spoiler guard, the long ranking's fact-check, the chapter cards and index, the render and the release
// gate are the guide's, unchanged. What this file adds, all pure:
//   - the share of long slots (VERSUS_LONG off by default, VERSUS_SHARE decided per slot) and which pair is next;
//   - the chapter shape: 15-30 chapters, each built as old game, new game, what it means for you, the old game named
//     aloud and on screen in every chapter (its "old" moments are gathered from the old game's footage), a verdict
//     and one comment question;
//   - the bar for a chapter (a concrete system, both sides said, a real consequence), the title (varied, never copied),
//     the keyword lead, the text-free split-screen thumbnail's parts and the A/B verdict against the long rankings.

import { createHash } from "node:crypto";
import { sentencesOf } from "./editorial/longform.ts";
import { rehookProblems } from "./editorial/rehooks.ts";
import {
  stockSegueProblems,
  voiceProblems,
  writingProblems,
} from "./editorial/voice.ts";
import type { Script } from "./editorial/schema.ts";
import {
  FIRST_HAND,
  GTA_LAUNCH,
  GUIDE_REPEAT_DAYS,
  HARDWARE,
  HEDGE,
  META_FRAMING,
  META_TALK,
  RANKING_TALK,
  SIGHTSEEING,
  TANGIBLE,
  TRAILER_FAMOUS,
  VAGUE_PAYOFF,
  VERSUS_KINDS,
  countsSaid,
  gtaGuideVerdict,
  guideNarration,
  guideToScript,
  type GtaGuideMeta,
  type GuideDraft,
  type GuideKind,
} from "./gtaguide.ts";

/** About a minute a chapter at the channel's pace; a chapter may run longer when the system has more to it. */
export const VERSUS_ITEM_WORDS: [number, number] = [70, 210];
export const VERSUS_INTRO_WORDS: [number, number] = [40, 120];
export const VERSUS_OUTRO_WORDS: [number, number] = [60, 190];
/** Fifteen to thirty minutes spoken. */
export const VERSUS_WORDS: [number, number] = [2200, 4800];

/** The new game named in a line. */
export const NEW_GAME =
  /\b(gta ?(6|vi)|grand theft auto (6|vi)|leonida|vice city|jason|lucia)\b/i;

const DAY = 86_400_000;

// ---- The share of long slots ------------------------------------------------------------------------------------------

/**
 * Whether this long slot goes to a versus (pure). Off, or a share of 0: never, and the long lane is exactly as before.
 * The draw is keyed on the slot (and apart from GTA_GUIDE_SHARE's), so every tick that sees the slot agrees.
 */
export function versusSlot(
  cfg: { versusLong?: boolean; versusShare?: number },
  slot: Date,
): boolean {
  if (!cfg.versusLong) return false;
  const share = cfg.versusShare ?? 0;
  if (!(share > 0)) return false;
  if (share >= 1) return true;
  const n = createHash("sha1")
    .update(`versus:${slot.toISOString()}`)
    .digest()
    .readUInt16BE(0);
  return n / 65536 < share;
}

/** The next pair (pure): the first versus kind not made in GUIDE_REPEAT_DAYS; none before the launch. */
export function pickVersusKind(
  made: Array<{ kind: string; at: string | Date }>,
  now: Date,
  kinds: readonly GuideKind[] = VERSUS_KINDS,
): GuideKind | undefined {
  if (now.getTime() < Date.parse(`${GTA_LAUNCH}T00:00:00Z`)) return undefined;
  const recent = new Set(
    made
      .filter(
        (m) =>
          now.getTime() - new Date(m.at).getTime() < GUIDE_REPEAT_DAYS * DAY,
      )
      .map((m) => m.kind),
  );
  return kinds.find((k) => k.versus && !recent.has(k.key));
}

// ---- Packaging --------------------------------------------------------------------------------------------------------

/** Title shapes per pair: the "can do what the old one never could" promise, varied, never GTAbites' own words. */
export const VERSUS_TITLES: Record<string, Array<(n: number) => string>> = {
  "vs-gta5": [
    (n) => `GTA 6 Can Do ${n} Things GTA 5 Never Could`,
    (n) => `GTA 5 Veterans: ${n} Things GTA 6 Does Differently`,
    (n) => `GTA 6 vs GTA 5: ${n} Changes You'll Feel Straight Away`,
    (n) => `GTA 6 Changed ${n} Things From GTA 5 (Every One Compared)`,
  ],
  "vs-rdr2": [
    (n) => `GTA 6 Took ${n} Ideas From Red Dead 2, and Changed Them`,
    (n) => `Red Dead 2 Is Hiding Inside GTA 6: ${n} Systems Compared`,
    (n) => `GTA 6 vs Red Dead 2: ${n} Systems Compared`,
  ],
};

/** The title (pure): one of the pair's shapes, chosen by a seed (the draft's own opening), so each episode keeps its own. */
export function versusTitleFor(
  kind: GuideKind,
  n: number,
  seed: string,
): string {
  const shapes = VERSUS_TITLES[kind.key] ?? [kind.title];
  const i =
    createHash("sha1").update(seed).digest().readUInt16BE(0) % shapes.length;
  return shapes[i]!(n).replace(/\s+/g, " ").trim();
}

const BANNED_ASK =
  /let me know|comment below|in the comments|subscribe|like (this|the) video|smash|hit the bell/i;

/** The pinned comment's question (pure): the writer's own when it is one sharp question, else the pair's. */
export function versusQuestion(
  writer: string | undefined,
  kind: GuideKind,
): string {
  const q = (writer ?? "").replace(/\s+/g, " ").trim();
  const words = q.split(" ").filter(Boolean).length;
  const ok =
    q.endsWith("?") &&
    (q.match(/\?/g) ?? []).length === 1 &&
    words >= 6 &&
    words <= 30 &&
    !BANNED_ASK.test(q) &&
    !/—|\s–\s/.test(q);
  return ok ? q : kind.question;
}

// The description's first lines (the searches a versus is found by) are src/editorial/seo.ts keywordLead's.

/** The game names the release's vision check is told: a versus shows both games on purpose (pure). */
export function qaGameTitle(
  script: Pick<Script, "game_title" | "gta_guide">,
): string {
  const v = script.gta_guide?.versus;
  return v
    ? `${script.game_title} and ${v.old} (a comparison video that shows both games)`
    : script.game_title;
}

// ---- The bar for a chapter --------------------------------------------------------------------------------------------

const STOP = new Set(
  "the a an and or but to of in on at for with your you it its is are be this that these those from into when what how why do does not never can will one every all any more most just only get gta game now then".split(
    " ",
  ),
);
const contentWords = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9$' ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
const wordCount = (t: string | undefined) =>
  (t ?? "").trim().split(/\s+/).filter(Boolean).length;

/** A chapter as the plan has it: "then" is the old game's side, "how" the new game's, "payoff" what it means for you. */
export interface VersusPlanItem {
  title: string;
  then?: string;
  how?: string;
  payoff?: string;
  notes?: string;
  chip?: string;
  basis?: string;
}

/**
 * What makes one chapter too thin (pure): a side not said, the two sides the same, a mood for a consequence, a console
 * feature, or scenery with nothing at stake.
 */
export function versusItemProblems(
  x: VersusPlanItem,
  kind: GuideKind,
  tag = `"${x.title}"`,
): string[] {
  const old = kind.versus?.oldShort ?? "the old game";
  const p: string[] = [];
  if (wordCount(x.then) < 3)
    p.push(`${tag} does not say what ${old} did (then).`);
  if (wordCount(x.how) < 3)
    p.push(`${tag} does not say what GTA 6 does now (now).`);
  if (wordCount(x.payoff) < 3)
    p.push(`${tag} does not say what it means for how you play (means).`);
  else if (
    VAGUE_PAYOFF.test((x.payoff ?? "").trim()) &&
    !TANGIBLE.test(x.payoff ?? "")
  )
    p.push(
      `${tag}: "${x.payoff}" is a mood, not what changes for you; name the consequence or drop the chapter.`,
    );
  if (HARDWARE.test(`${x.title} ${x.then ?? ""} ${x.how ?? ""}`))
    p.push(
      `${tag} is a console, controller or display feature, not a game system: drop it.`,
    );
  if (
    (SIGHTSEEING.test(x.title.trim()) || TRAILER_FAMOUS.test(x.title)) &&
    !TANGIBLE.test(`${x.how ?? ""} ${x.payoff ?? ""}`)
  )
    p.push(
      `${tag} is scenery or a trailer headline; compare a system with a real consequence instead.`,
    );
  const a = new Set(contentWords(x.then ?? ""));
  const b = contentWords(x.how ?? "");
  if (
    a.size &&
    b.length &&
    b.filter((w) => a.has(w)).length / Math.max(a.size, b.length) > 0.8
  )
    p.push(
      `${tag}: the then and now say the same thing; a chapter is a change.`,
    );
  return p;
}

/** Chapter quality across a finished draft (pure), recorded as style warnings. */
export function versusQualityWarnings(
  d: Pick<GuideDraft, "items">,
  kind: GuideKind,
): string[] {
  return d.items.flatMap((x) =>
    versusItemProblems(x, kind, `Chapter ${x.number} ("${x.title}")`),
  );
}

/** The first sentence's misses (pure): chapter 1 itself, both games named, no greeting. */
function openingProblems(
  first: string,
  one: { title: string } | undefined,
  kind: GuideKind,
): string[] {
  const p: string[] = [];
  const v = kind.versus!;
  if (one) {
    const got = new Set(contentWords(first));
    if (!contentWords(one.title).some((w) => got.has(w)))
      p.push(
        `The first sentence must be chapter 1 ("${one.title}") as a then-vs-now contrast: "${first}" does not deliver it.`,
      );
  }
  if (!v.oldNames.test(first) || !NEW_GAME.test(first))
    p.push(
      `The first sentence must name both games (${v.oldShort} and GTA 6) in one contrast: "${first}".`,
    );
  if (
    /\b(welcome|pulse gaming|today we|in this video|hey|what's up)\b/i.test(
      first,
    )
  )
    p.push(
      `The first sentence opens with a greeting or the channel ("${first}"); it is chapter 1.`,
    );
  return p;
}

/** The plan's own misses (pure), sent back once before any chapter is paid for. */
export function versusPlanProblems(
  plan: {
    intro: { narration: string };
    description?: string;
    question?: string;
    items: VersusPlanItem[];
  },
  kind: GuideKind,
  evidence: readonly string[],
): string[] {
  const p: string[] = [];
  const [lo, hi] = kind.items;
  if (plan.items.length < lo || plan.items.length > hi)
    p.push(
      `There are ${plan.items.length} chapters; a versus has ${lo}-${hi}.`,
    );
  p.push(
    ...openingProblems(
      sentencesOf(plan.intro.narration)[0] ?? "",
      plan.items[0],
      kind,
    ),
  );
  if (!evidence.length && plan.items.some((x) => x.basis === "my playthrough"))
    p.push(
      'There is no play evidence this time: no chapter may rest on "my playthrough"; use the fact pack.',
    );
  plan.items.forEach((x, i) =>
    p.push(...versusItemProblems(x, kind, `Chapter ${i + 1} ("${x.title}")`)),
  );
  for (const c of countsSaid(plan.intro.narration))
    if (c !== plan.items.length)
      p.push(
        `The intro says ${c}; the plan has ${plan.items.length} chapters.`,
      );
  const framing = `${plan.intro.narration} ${plan.description ?? ""}`;
  const meta = framing.match(META_TALK) ?? framing.match(META_FRAMING);
  if (meta)
    p.push(
      `"${meta[0]}" talks about the sources; the viewer hears only the games.`,
    );
  if (
    versusQuestion(plan.question, kind) !==
    (plan.question ?? "").replace(/\s+/g, " ").trim()
  )
    p.push(
      `The comment question must be one sharp question of 6-30 words ending in "?", no "let me know" or subscribe: "${plan.question ?? ""}".`,
    );
  return p;
}

/**
 * What breaks the versus shape (pure); empty when it holds. Mirrors the guide's checks (src/gtaguide.ts guideProblems)
 * with a versus's lengths, plus: both games in the first line and the verdict, the old game named aloud in every
 * chapter, and every chapter's shot list showing both games (an "old" moment on a line that names the old game, and a
 * "new" one).
 */
export function versusProblems(
  d: GuideDraft,
  ctx: { kind: GuideKind; evidence: readonly string[]; introMax?: number },
): string[] {
  const p: string[] = [];
  const v = ctx.kind.versus!;
  const [lo, hi] = ctx.kind.items;
  const n = d.items.length;
  if (n < lo || n > hi)
    p.push(`There are ${n} chapters; a versus has ${lo}-${hi}.`);
  if (d.items.some((x, i) => x.number !== i + 1))
    p.push("Chapters must be numbered 1..N in the order they are spoken.");
  p.push(
    ...openingProblems(
      sentencesOf(d.intro.narration)[0] ?? "",
      d.items[0],
      ctx.kind,
    ),
  );
  const iw = wordCount(d.intro.narration);
  const introHi = Math.min(
    VERSUS_INTRO_WORDS[1],
    ctx.introMax ?? VERSUS_INTRO_WORDS[1],
  );
  if (iw < VERSUS_INTRO_WORDS[0] || iw > introHi)
    p.push(
      `The intro is ${iw} words; it must be ${VERSUS_INTRO_WORDS[0]}-${introHi}.`,
    );
  const ow = wordCount(d.outro.narration);
  if (ow < VERSUS_OUTRO_WORDS[0] || ow > VERSUS_OUTRO_WORDS[1])
    p.push(
      `The verdict is ${ow} words; it must be ${VERSUS_OUTRO_WORDS[0]}-${VERSUS_OUTRO_WORDS[1]}.`,
    );
  if (!v.oldNames.test(d.outro.narration) || !NEW_GAME.test(d.outro.narration))
    p.push(
      `The verdict must weigh both games by name (${v.oldShort} and GTA 6).`,
    );
  for (const x of d.items) {
    const tag = `Chapter ${x.number} ("${x.title}")`;
    const w = wordCount(x.narration);
    if (w < VERSUS_ITEM_WORDS[0] || w > VERSUS_ITEM_WORDS[1])
      p.push(
        `${tag} has ${w} words; it must be ${VERSUS_ITEM_WORDS[0]}-${VERSUS_ITEM_WORDS[1]}.`,
      );
    if (!x.claims.length)
      p.push(
        `${tag} lists no claims; every chapter names its claims with a label.`,
      );
    if (
      x.claims.some((c) => c.label !== "confirmed") &&
      !HEDGE.test(x.narration)
    )
      p.push(
        `${tag} carries a reported or rumoured claim but never says so aloud ("reportedly", "a rumour says").`,
      );
    const play =
      x.claims.some((c) => c.source === "my playthrough") ||
      x.basis === "my playthrough";
    if (FIRST_HAND.test(x.narration) && !play)
      p.push(
        `${tag} speaks first-hand ("${x.narration.match(FIRST_HAND)?.[0]}") without a "my playthrough" claim behind it.`,
      );
    if (play && !ctx.evidence.length)
      p.push(
        `${tag} rests on "my playthrough", but there is no play evidence this time.`,
      );
    const said = sentencesOf(x.narration);
    if (x.moments.length !== said.length)
      p.push(
        `${tag} has ${said.length} sentences but ${x.moments.length} moments.`,
      );
    if (!x.chip.trim() || wordCount(x.chip) > 4)
      p.push(`${tag}: the chip must be 1-4 words.`);
    if (!v.oldNames.test(x.narration))
      p.push(
        `${tag} never says what ${v.oldShort} did; every chapter starts from the old game.`,
      );
    const oldOnLine = x.moments.some(
      (m, k) => oldMoment(m) && v.oldNames.test(`${said[k] ?? ""} ${m.show}`),
    );
    if (!oldOnLine)
      p.push(
        `${tag} shows no ${v.oldShort} footage: mark the line that says what ${v.oldShort} did as game "old".`,
      );
    if (!x.moments.some((m) => !oldMoment(m)))
      p.push(
        `${tag} shows no GTA 6 footage: the new game's lines are game "new".`,
      );
  }
  for (const c of countsSaid(
    `${d.intro.narration} ${d.outro.narration} ${d.description}`,
  ))
    if (c !== n)
      p.push(
        `The intro, verdict or description says ${c}; there are ${n} chapters. Say ${n}.`,
      );
  const all = guideNarration(d);
  const ranked = all.match(RANKING_TALK);
  if (ranked)
    p.push(
      `"${ranked[0]}" is ranking talk; a versus compares, it never ranks.`,
    );
  const meta =
    `${all} ${d.description}`.match(META_TALK) ??
    `${d.intro.narration} ${d.description}`.match(META_FRAMING);
  if (meta)
    p.push(
      `"${meta[0]}" talks about the sources; the viewer hears only the games.`,
    );
  if (/—/.test(JSON.stringify(d)))
    p.push("An em dash is in the text; the channel never uses them.");
  if (FIRST_HAND.test(d.intro.narration) && !ctx.evidence.length)
    p.push(
      `The intro speaks first-hand ("${d.intro.narration.match(FIRST_HAND)?.[0]}") with no play evidence.`,
    );
  const total = wordCount(all);
  if (total < VERSUS_WORDS[0] || total > VERSUS_WORDS[1])
    p.push(
      `Spoken word count is ${total}; it must be ${VERSUS_WORDS[0]}-${VERSUS_WORDS[1]}.`,
    );
  const openings = d.items.map((x) =>
    x.narration.toLowerCase().split(/\s+/).slice(0, 3).join(" "),
  );
  if (new Set(openings).size < openings.length)
    p.push("Two chapters open with the same words; vary the openings.");
  p.push(...voiceProblems(all));
  p.push(...writingProblems(all, { long: true }));
  p.push(...stockSegueProblems(all));
  p.push(
    ...rehookProblems([
      d.intro.narration,
      ...d.items.map((x) => x.narration),
      d.outro.narration,
    ]),
  );
  if (
    /let me know in the comments|like and subscribe|without further ado|smash that/i.test(
      all,
    )
  )
    p.push("Banned phrase.");
  return p;
}

// ---- The script -------------------------------------------------------------------------------------------------------

/**
 * The common Script shape (pure): the guide's, so every long-ranking device applies, with the versus title, no
 * thumbnail words (the split screen carries none), the old game for the gather and the thumbnail, and the question.
 */
export function versusToScript(d: GuideDraft, kind: GuideKind): Script {
  const v = kind.versus!;
  const sc = guideToScript(d, kind);
  const n = d.items.length;
  const title = versusTitleFor(kind, n, d.intro.narration);
  const base = sc.gta_guide!;
  const meta: GtaGuideMeta = {
    ...base,
    thumb: { big: "", small: "" },
    question: versusQuestion(d.question, kind),
    versus: { old: v.old, oldShort: v.oldShort, oldYear: v.oldYear, ...(v.steamYear ? { steamYear: v.steamYear } : {}) },
    list: (base.list ?? []).map((l, i) => ({
      ...l,
      then: d.items[i]?.then ?? "",
    })),
  };
  return {
    ...sc,
    headline: title,
    attribution:
      "Sources: Rockstar Games, Take-Two, the games themselves, Pulse's own play",
    youtube: { ...sc.youtube, title, thumb_text: "" },
    criterion: kind.name,
    gta_guide: meta,
  } as Script;
}

/** A moment that shows the old game (pure). */
export function oldMoment(m: unknown): boolean {
  return (m as { game?: string } | undefined)?.game === "old";
}

/** True for a clip gathered from the old game's footage (the gather puts them under entry_N/old/). */
export function oldGameFile(file: string): boolean {
  return /(^|[\\/])old[\\/]/.test(file);
}

/**
 * The pictures with every pin that would put the wrong game on a line taken off (pure): a GTA 6 clip or still pinned
 * to a line marked "old" (the cutscene, stream, still and fill passes pin by key across every line), and an old-game
 * clip pinned to a GTA 6 line. Unpinned pictures stay in the chapter as fill; each line keeps only its own game's pin.
 * `moments` is the shot list per entry in on-screen order, so `moments[beatIndex][moment]` is the clip's line.
 */
export function versusPins<T extends { file: string; beatIndex?: number; moment?: number }>(
  items: T[],
  moments: ReadonlyArray<ReadonlyArray<unknown>>,
): T[] {
  return items.map((c) => {
    if (c.beatIndex === undefined || c.moment === undefined) return c;
    const m = moments[c.beatIndex]?.[c.moment];
    if (m === undefined) return c;
    return oldMoment(m) === oldGameFile(c.file) ? c : { ...c, moment: undefined };
  });
}

/** An old-game clip kept for the edit (pure): never a murky one (the guide's floor for the owner's play, 45 of 255). */
export function versusClipKept(c: { luma?: number }): boolean {
  return !(typeof c.luma === "number" && c.luma < 45);
}

// ---- The thumbnail ----------------------------------------------------------------------------------------------------

/** A game library still as the thumbnail picker reads it (src/assets/gamelib.ts LibItem). */
export interface ArtItem {
  kind: string;
  file: string;
  provenance?: string;
}

/**
 * The thumbnail's candidate pictures for one game (pure), best first: official key art, then official screenshots,
 * then store screenshots; pictures only (a zip or a video is never a candidate).
 */
export function keyArtCandidates(items: readonly ArtItem[]): ArtItem[] {
  const rank = (i: ArtItem) => {
    const p = i.provenance ?? "";
    if (/key art|artwork/i.test(p)) return 0;
    if (/official rockstar|rockstar games/i.test(p)) return 1;
    if (/screenshot/i.test(p)) return 2;
    return 3;
  };
  return items
    .filter((i) => i.kind === "still" && /\.(jpe?g|png|webp)$/i.test(i.file))
    .map((i, k) => ({ i, k }))
    .sort((a, b) => rank(a.i) - rank(b.i) || a.k - b.k)
    .map(({ i }) => i);
}

/** The split-screen design's props (pure): the old game on the left, the new on the right, both logos, no words. */
export function versusThumb(o: {
  oldFile: string;
  newFile: string;
  oldLogo?: string;
  newLogo?: string;
}): Record<string, unknown> & {
  layout: "vsplit";
  imageFile: string;
  image2File: string;
  headline: string;
} {
  return {
    layout: "vsplit",
    headline: "",
    kicker: "",
    game: "",
    accent: "#FF6B1A",
    imageFile: o.oldFile,
    image2File: o.newFile,
    logoFile: o.oldLogo ?? null,
    logo2File: o.newLogo ?? null,
  };
}

// ---- The verdict ------------------------------------------------------------------------------------------------------

export interface VersusResult {
  arm: "versus" | "ranking";
  views7d: number;
  ctr?: number;
}

/**
 * The versus's pass mark (pure), the guide's: with at least 6 published videos per arm, the versus's median 7-day views
 * AND median CTR (where both arms have 6 readings) beat the long rankings'. Until then "waiting".
 */
export function versusVerdict(results: VersusResult[], perArm = 6) {
  const r = gtaGuideVerdict(
    results.map((x) => ({
      ...x,
      arm: x.arm === "versus" ? ("guide" as const) : ("ranking" as const),
    })),
    perArm,
  );
  return { verdict: r.verdict, versus: r.guide, ranking: r.ranking };
}
