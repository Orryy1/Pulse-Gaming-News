// Real evidence on screen (owner's growth plan, move 3, 1 Nov 2026). The breakout faceless documentary ("How
// Cyberpunk 2077 Saved Itself From Dying", 2.55M views) cut, at every turning point, to the real record full
// frame: the studio's delay and apology letters, the review aggregate page, the stage presentation. Pulse's
// documentaries showed recreated clippings and illustrations there instead. This module finds the key beats in a
// chapter (an announcement, a delay, an apology, a review verdict, a sales milestone, a statement) and gives each
// one the record itself, full frame, with a clear credit:
//   - a statement page: the exact words of the statement as the source quotes them (a grounded "quote"), or the
//     source's own passage about it word for word (a "source"), never a paraphrase;
//   - an aggregate page: the review aggregator's number or verdict (Metacritic, OpenCritic) exactly as the source
//     reports it, credited to the aggregator and to where the figure came from.
// Honesty (the rule of src/render/components/docs/choose.ts documentFor): nothing is invented. Every word on the
// page is in the source text; the page is Pulse's own browser frame with the source credit, never a copy of a
// company's letterhead or a site's design; a beat with no record in the source gets no evidence page.
import type { WikiArticle } from "../discovery/wikipedia.ts";
import type { DocMoment } from "./documentary.ts";
import { sentencesOf } from "./longform.ts";

export const EVIDENCE_KINDS = [
  "announcement",
  "delay",
  "apology",
  "verdict",
  "sales",
  "statement",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** What a graphic carries when it is shown as the record itself (src/render/components/packs/pulse/evidence.ts). */
export interface Evidence {
  kind: EvidenceKind;
  /** "statement": the words as said or written; "aggregate": a review aggregator's figure or verdict. */
  page: "statement" | "aggregate";
  /** Who issued it, as the source names them, when it does. */
  issuer?: string;
  /** The on-screen credit: where these exact words come from. */
  credit: string;
}

// The cue words of each key beat, in the narration sentence. Order matters: the more specific beat wins.
const BEAT: Array<[EvidenceKind, RegExp]> = [
  [
    "apology",
    /\b(apolog\w*|sorry|regret\w*|refunds?|took responsibility|mea culpa)\b/i,
  ],
  [
    "delay",
    /\b(delay\w*|postpon\w*|pushed (it )?back|slipped|moved (the )?(release|launch)|new release date)\b/i,
  ],
  [
    "verdict",
    /\b(metacritic|opencritic|review aggregators?|aggregate (score|rating)|critics? (gave|scored|called|praised|panned)|reviews? (were|was|came in)|generally (favou?rable|positive|mixed|unfavou?rable)|scored \d+|\d+ out of (10|100))\b/i,
  ],
  [
    "sales",
    /\b(sold \w+|sales of|million (copies|units|players)|best-selling|fastest-selling|copies sold|sales milestone|record-breaking sales)\b/i,
  ],
  [
    "announcement",
    /\b(announc\w*|unveil\w*|revealed|reveal(ed)? (trailer|at)|on stage|press conference|keynote)\b/i,
  ],
  [
    "statement",
    /\b(statement|said in a|wrote|posted|open letter|letter to|told (investors|fans|players)|blog post|press release)\b/i,
  ],
];

/** The key beat a narration sentence is, or undefined. */
export function evidenceBeat(sentence: string): EvidenceKind | undefined {
  return BEAT.find(([, re]) => re.test(sentence))?.[0];
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[‘’“”"']/g, "")
    .replace(/[^a-z0-9%$£€.]+/g, " ")
    .trim();

/** The source's sentences, line by line: its "## Heading" lines are not part of any sentence. */
export function sourceSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .filter((l) => !/^\s*#+\s/.test(l))
    .flatMap((l) => sentencesOf(l.trim()));
}

export interface Aggregate {
  outlet: "Metacritic" | "OpenCritic";
  /** The figure as the source writes it ("86/100", "86 out of 100", "89%"), when it gives one. */
  score?: string;
  /** The aggregator's verdict words as the source quotes them ("generally favorable"), when it gives them. */
  verdict?: string;
  /** The source sentence, word for word. */
  passage: string;
}

// The figure as the source writes it, most specific first: "86/100" or "86 out of 100", then "76%", then "a score of 86".
const SCORES = [
  /\b\d{1,3}(?:\.\d)?\s*(?:\/|out of)\s*100\b/i,
  /\b\d{1,3}\s*%/,
  /\b(?:score|rating|average) of \d{1,3}(?:\.\d)?\b/i,
];
const VERDICT =
  /["“]?(universal acclaim|generally favou?rable|mixed or average|generally unfavou?rable|overwhelming dislike|mighty|strong|fair|weak)["”]?/i;

/** The review aggregate facts the source states, one per sentence that names an aggregator, in order. */
export function aggregatesIn(text: string): Aggregate[] {
  const out: Aggregate[] = [];
  for (const s of sourceSentences(text)) {
    const outlet = /\bOpenCritic\b/.test(s)
      ? "OpenCritic"
      : /\bMetacritic\b/.test(s)
        ? "Metacritic"
        : undefined;
    if (!outlet) continue;
    const score = SCORES.map((re) => s.match(re)?.[0])
      .find(Boolean)
      ?.replace(/^(score|rating|average) of /i, "");
    const verdict = s.match(VERDICT)?.[1];
    if (!score && !verdict) continue;
    out.push({
      outlet,
      ...(score ? { score } : {}),
      ...(verdict ? { verdict } : {}),
      passage: s.trim(),
    });
  }
  return out;
}

const STOP = new Set(
  "a an the of to in on at for and or but as by with from its it is was were be been his her their this that these those so then than into had has have he she they we you i also even just only very not no would could will".split(
    " ",
  ),
);
// Content words cut to their first five letters, so "delays" meets "delayed" and "announced" meets "announcement".
const content = (t: string) =>
  new Set(
    norm(t)
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  );

/**
 * The source's own passage for a beat: the sentence of the source (8-60 words) that shares the most content words
 * with the narration sentence, at least four, and carries the same beat. Undefined when the source has none.
 */
export function recordPassage(
  sentence: string,
  kind: EvidenceKind,
  sourceText: string,
): string | undefined {
  const want = content(sentence);
  const re = BEAT.find(([k]) => k === kind)![1];
  let best: { s: string; n: number } | undefined;
  for (const s of sourceSentences(sourceText)) {
    const words = s.split(/\s+/).length;
    if (words < 8 || words > 60 || !re.test(s)) continue;
    const have = content(s);
    let n = 0;
    for (const w of want) if (have.has(w)) n++;
    if (n >= 4 && (!best || n > best.n)) best = { s: s.trim(), n };
  }
  return best?.s;
}

/** The credit a page carries: the record's own words, and where Pulse read them. */
export function evidenceCredit(
  source: Pick<WikiArticle, "title">,
  issuer?: string,
): string {
  return issuer
    ? `${issuer}, as quoted in Wikipedia: ${source.title}`
    : `From the record: Wikipedia, ${source.title}`;
}

/** The writer's rule for the shot list (DOC_EVIDENCE): key beats show the record, word for word. */
export const EVIDENCE_RULE = `Evidence: on the chapter's key beats (an announcement, a delay, an apology, a review verdict, a sales milestone, a public statement) show the record itself rather than a picture. If the SOURCE quotes the statement, use a "quote" with those exact words and the speaker. If the SOURCE gives the review aggregate (Metacritic or OpenCritic), use "reviews" with rows like "Metacritic: 86/100" exactly as the SOURCE gives them. Otherwise use "source" with the SOURCE's own sentence about it word for word. Never invent or reword a statement, a score or a document.`;

const NONE = {
  kind: "none" as const,
  primary: "",
  secondary: "",
  items: [] as string[],
};

/** A moment's graphic with its evidence tag. */
export type EvidenceMoment = DocMoment & {
  graphic: DocMoment["graphic"] & { evidence?: Evidence };
};

/**
 * The chapter's key beats shown as the record. A grounded quote or source passage on a key beat is tagged as
 * evidence; a review verdict with no graphic gets the aggregate the source states; another key beat with no
 * graphic gets the source's own passage. Never two graphics in a row (the shot list's rule), never the chapter's
 * first sentence (it plays under the title card), at most `max` a chapter. Run after groundDocMoments, whose
 * grounding the tagged quotes have passed.
 */
export function markEvidence(
  moments: DocMoment[],
  sentences: string[],
  source: WikiArticle,
  opts: { max?: number } = {},
): { moments: EvidenceMoment[]; added: string[] } {
  const max = opts.max ?? 3;
  const out = moments.map((m) => ({
    ...m,
    graphic: { ...m.graphic },
  })) as EvidenceMoment[];
  const added: string[] = [];
  const aggregates = aggregatesIn(source.text);
  const hay = norm(source.text);
  const has = (i: number) => (out[i]?.graphic.kind ?? "none") !== "none";
  for (let i = 1; i < out.length && added.length < max; i++) {
    const kind = evidenceBeat(sentences[i] ?? "");
    if (!kind) continue;
    const g = out[i]!.graphic;
    // The writer's grounded quote is the statement itself.
    if (
      g.kind === "quote" &&
      g.primary &&
      hay.includes(norm(g.primary.replace(/^["“]|["”]$/g, "")))
    ) {
      const issuer = g.secondary.split(",")[0]!.trim() || undefined;
      g.evidence = {
        kind,
        page: "statement",
        ...(issuer ? { issuer } : {}),
        credit: evidenceCredit(source, issuer),
      };
      added.push(`${kind}: statement "${g.primary.slice(0, 60)}"`);
      continue;
    }
    if (g.kind === "source" && g.primary) {
      g.evidence = { kind, page: "statement", credit: evidenceCredit(source) };
      added.push(`${kind}: record "${g.primary.slice(0, 60)}"`);
      continue;
    }
    // An aggregate the writer already listed ("Metacritic: 86/100") becomes the aggregate page.
    if (
      g.kind === "reviews" &&
      g.items.length &&
      g.items.every((x) => /^(Metacritic|OpenCritic)\b/i.test(x))
    ) {
      g.evidence = {
        kind: "verdict",
        page: "aggregate",
        credit: evidenceCredit(source),
      };
      added.push(`verdict: aggregate ${g.items.join(", ")}`);
      continue;
    }
    if (g.kind !== "none" || has(i - 1) || has(i + 1)) continue;
    if (kind === "verdict") {
      // Each aggregator once, its figure where the source gives one, else its verdict words.
      const scored = aggregates.filter(
        (a, k) => aggregates.findIndex((b) => b.outlet === a.outlet) === k,
      );
      if (scored.some((a) => a.score)) {
        out[i]!.graphic = {
          kind: "reviews",
          primary: "Review aggregate",
          secondary: "",
          items: scored
            .slice(0, 2)
            .map((a) => `${a.outlet}: ${a.score ?? a.verdict}`),
          evidence: { kind, page: "aggregate", credit: evidenceCredit(source) },
        };
        added.push(
          `verdict: aggregate ${scored.map((a) => `${a.outlet} ${a.score ?? a.verdict}`).join(", ")}`,
        );
        continue;
      }
      const said = aggregates.find((a) => a.verdict);
      const words = said?.passage.split(/\s+/).length ?? 0;
      if (said && words >= 10 && words <= 70) {
        out[i]!.graphic = {
          kind: "source",
          primary: said.passage,
          secondary: `Wikipedia: ${source.title}`,
          items: [said.verdict!],
          evidence: { kind, page: "aggregate", credit: evidenceCredit(source) },
        };
        added.push(`verdict: ${said.outlet} "${said.verdict}"`);
        continue;
      }
    }
    const passage = recordPassage(sentences[i] ?? "", kind, source.text);
    if (!passage) continue;
    out[i]!.graphic = {
      ...NONE,
      kind: "source",
      primary: passage,
      secondary: `Wikipedia: ${source.title}`,
      items: [],
      evidence: { kind, page: "statement", credit: evidenceCredit(source) },
    };
    // A caption never sits beside a graphic.
    out[i]!.emphasis = "";
    added.push(`${kind}: record "${passage.slice(0, 60)}"`);
  }
  return { moments: out, added };
}

/** True when a graphic is to be drawn as the record itself. */
export function isEvidence(g: { evidence?: unknown } | undefined): boolean {
  return !!g?.evidence;
}
