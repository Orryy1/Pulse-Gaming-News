// Progressive naming (rule 1): the first mention says the full common name, later ones the short form people say
// ("Sid Meier's Civilization VII", then "Civ 7"), a nearby repeat may become "it", and a brand prefix ("Sid Meier's")
// is said once. A short form is never used where two things in the script would share it, a written-only alias
// ("TotK", "BG3") never reaches the voice, and a person gets a pronoun only where the dictionary gives one.
// Pure: segments in, segments out, with the changes listed.

import { type Entity } from "./aliases.ts";
import {
  atSentenceStart,
  escapeRe,
  maskQuotes,
  unmaskQuotes,
  wordsOf,
} from "./text.ts";

type FormKind = "long" | "short" | "nick" | "written";

interface Form {
  text: string;
  entity: Entity;
  kind: FormKind;
}

interface Mention {
  start: number;
  end: number;
  text: string;
  form: Form;
}

export interface NamingChange {
  segment: number;
  from: string;
  to: string;
  why: "short" | "pronoun" | "prefix" | "written-only" | "series";
}

export interface NamingResult {
  segments: string[];
  /** Full titles said again where a short form, a pronoun or no prefix would do. */
  repeatedFull: number;
  changes: NamingChange[];
  /** Short forms not used because two things in the script would share them. */
  ambiguous: string[];
}

export interface NamingOptions {
  entities: Entity[];
  /** Titles the script is about as games (ranking entries, the game title): a bare series name in it is that game. */
  games?: string[];
  /** Narration already said (earlier chapters): its mentions count, nothing in it is changed. */
  earlier?: string;
  /** Segments never edited (a character quote's beat); their mentions still count. */
  locked?: boolean[];
  /** False: report only, change nothing. */
  fix?: boolean;
}

const BRAND_PREFIXES = ["Sid Meier's", "Tom Clancy's", "Marvel's"];
const GENERIC_PREFIX = new RegExp(
  `(?<![\\w'’])(${BRAND_PREFIXES.map((p) => escapeRe(p).replace("'", "['’]")).join("|")})\\s+(?=[A-Z])`,
  "g",
);

function formsOf(entities: Entity[]): Form[] {
  const out: Form[] = [];
  const seen = new Set<string>();
  const add = (text: string, entity: Entity, kind: FormKind) => {
    const key = `${entity.id}|${text}`;
    if (!text.trim() || seen.has(key)) return;
    seen.add(key);
    out.push({ text, entity, kind });
  };
  for (const e of entities) {
    add(e.full, e, "long");
    for (const f of e.forms)
      add(
        f,
        e,
        f === e.short?.text ? "short" : f === e.nick?.text ? "nick" : "long",
      );
    for (const f of e.writtenOnly ?? []) add(f, e, "written");
    if (e.short) add(e.short.text, e, "short");
    if (e.nick) add(e.nick.text, e, "nick");
  }
  // A form that is no longer than the short form is the short form in another spelling ("Civ VII" for "Civ 7").
  for (const f of out)
    if (
      f.kind === "long" &&
      f.entity.short &&
      f.text.length <= f.entity.short.text.length
    )
      f.kind = "short";
  return out.sort((a, b) => b.text.length - a.text.length);
}

function formPattern(text: string): string {
  const body = escapeRe(text)
    .replace(/\\?\s+/g, "\\s+")
    .replace(/'/g, "['’]");
  // A name ending in a word may not run on into a number, a numeral or a subtitle ("Civilization" in "Civilization VI"
  // or "Civilization: Beyond Earth" is another game).
  const tail =
    /[A-Za-z]$/.test(text) && !/(^|\s)[IVX]+$/.test(text)
      ? `(?!\\s*(?:\\d|[IVX]{1,4}\\b))(?!:\\s*[A-Z])`
      : "";
  return `(?<![\\w'’-])${body}(?![\\w-])${tail}`;
}

function buildMatcher(forms: Form[]): (text: string) => Mention[] {
  if (!forms.length) return () => [];
  const re = new RegExp(
    forms.map((f) => `(${formPattern(f.text)})`).join("|"),
    "g",
  );
  return (text: string) => {
    const out: Mention[] = [];
    for (const m of text.matchAll(re)) {
      const i = m.slice(1).findIndex((g) => g !== undefined);
      out.push({
        start: m.index!,
        end: m.index! + m[0].length,
        text: m[0],
        form: forms[i]!,
      });
    }
    return out;
  };
}

const DETERMINERS = new Set(
  "the a an this that these those its their his her our your my every each no any some which what whose".split(
    " ",
  ),
);
// Words that may follow a name a pronoun replaces: punctuation aside, only verbs of being and having, modals and the
// small words that end an object ("I'd pick it because", "it is", "it keeps"). A plain noun after the name ("Civ 5
// armies") would leave "it armies", so nothing else qualifies.
const AFTER_OK = new Set(
  "is was has had does did will would can could should might may isn't wasn't hasn't doesn't didn't won't can't couldn't because for on in at with to over and but so instead again too now here there first still also just really never always only even today tomorrow tonight anyway yet".split(
    " ",
  ),
);

/** Whether a capitalised word between two mentions might be another thing a pronoun could point at. */
function otherNameBetween(text: string, from: number, to: number): boolean {
  const between = text.slice(from, to);
  for (const m of between.matchAll(/(?<![\w'’])[A-Z][\w'’-]*/g)) {
    const at = from + m.index!;
    if (/^I(?:['’](?:m|d|ll|ve))?$/.test(m[0])) continue;
    if (atSentenceStart(text, at)) continue;
    return true;
  }
  return false;
}

/**
 * Progressive naming over a script's spoken segments, in order (pure). With `fix: false` the segments come back
 * unchanged and only the counts are filled in.
 */
export function progressiveNaming(
  segments: string[],
  opts: NamingOptions,
): NamingResult {
  const fix = opts.fix !== false;
  const forms = formsOf(opts.entities);
  const match = buildMatcher(forms);
  const masked = segments.map((s) => maskQuotes(s));
  const earlier = opts.earlier ? maskQuotes(opts.earlier).text : "";

  // Who is mentioned, in order. A short or nick form alone only counts as a mention once its entity has had a long
  // mention earlier, or when the short form is known cold: "Epic", "Jason" or "Vice City" (the GTA 6 city) alone is
  // not enough to know the game or company is meant.
  const allText = [earlier, ...masked.map((m) => m.text)];
  const longSoFar = new Set<string>();
  const eligible: Mention[][] = allText.map((t) =>
    match(t).filter((m) => {
      if (m.form.kind === "long" || m.form.kind === "written") {
        longSoFar.add(m.form.entity.id);
        return true;
      }
      return (
        longSoFar.has(m.form.entity.id) ||
        (m.form.kind === "short" && !!m.form.entity.short?.cold) ||
        (m.form.kind === "nick" && !!m.form.entity.nick?.cold)
      );
    }),
  );
  const mentioned = new Map<string, Entity>();
  for (const list of eligible)
    for (const m of list) mentioned.set(m.form.entity.id, m.form.entity);

  // A short form two mentioned things would share is ambiguous for both ("Red Dead" with both Red Dead games).
  const byShort = new Map<string, Set<string>>();
  for (const e of mentioned.values())
    for (const a of [e.short, e.nick])
      if (a)
        byShort.set(
          a.text.toLowerCase(),
          new Set([...(byShort.get(a.text.toLowerCase()) ?? []), e.id]),
        );
  // A short form that is also another mentioned thing's full name or form is ambiguous too ("Switch" with "Switch 2" is not,
  // the matcher keeps those apart; "Vegas" with a city would be, but the city is never in the dictionary).
  const games = new Set((opts.games ?? []).map((g) => g.toLowerCase()));
  const siblings = new Set(
    [...mentioned.values()].filter((e) => e.series).map((e) => e.series!),
  );
  const ambiguous = new Set<string>();
  /** Whether a short form may stand in (pure); `record` notes the ambiguous ones for the report. */
  const shortOk = (
    e: Entity,
    a: { text: string } | undefined,
    record = true,
  ): boolean => {
    if (!a) return false;
    const shared = (byShort.get(a.text.toLowerCase())?.size ?? 0) > 1;
    // A bare series name that is also one of the games (the first Civilization in a Civ ranking), or a series whose
    // numbered games are in the script, keeps its name: its short form would blur into theirs.
    const blurred =
      e.kind === "series" &&
      (siblings.has(e.id) ||
        games.has(e.full.toLowerCase()) ||
        e.forms.some((f) => games.has(f.toLowerCase())));
    if ((shared || blurred) && record) ambiguous.add(a.text);
    return !shared && !blurred;
  };

  const count = new Map<string, number>();
  const seriesSeen = new Set<string>();
  const prefixSeen = new Set<string>();
  const note = (m: Mention) => {
    count.set(m.form.entity.id, (count.get(m.form.entity.id) ?? 0) + 1);
    if (m.form.entity.kind === "series") seriesSeen.add(m.form.entity.id);
    if (m.form.entity.series) seriesSeen.add(m.form.entity.series);
    for (const p of BRAND_PREFIXES) if (m.text.startsWith(p)) prefixSeen.add(p);
  };
  for (const m of eligible[0]!) note(m);
  for (const m of earlier.matchAll(GENERIC_PREFIX)) prefixSeen.add(m[1]!);

  let repeatedFull = 0;
  const changes: NamingChange[] = [];
  const out = masked.map((seg, si) => {
    const text = seg.text;
    const locked = opts.locked?.[si] ?? false;
    let last:
      | { id: string; end: number; pronoun: boolean; subject: boolean }
      | undefined;
    const pieces: string[] = [];
    let cursor = 0;
    const mentions = eligible[si + 1]!;
    // A brand prefix on a title the dictionary doesn't know is still said once ("Sid Meier's Pirates!", then "Pirates!").
    const generic = [...text.matchAll(GENERIC_PREFIX)]
      .filter(
        (g) => !mentions.some((m) => g.index! >= m.start && g.index! < m.end),
      )
      .map((g) => ({
        start: g.index!,
        end: g.index! + g[0].length,
        prefix: g[1]!,
      }));
    const events = [
      ...mentions.map((m) => ({
        start: m.start,
        mention: m as Mention | undefined,
        prefix: undefined as string | undefined,
        end: m.end,
      })),
      ...generic.map((g) => ({
        start: g.start,
        mention: undefined as Mention | undefined,
        prefix: g.prefix,
        end: g.end,
      })),
    ].sort((a, b) => a.start - b.start);
    for (const ev of events) {
      if (!ev.mention) {
        const p = ev.prefix!;
        if (!prefixSeen.has(p)) {
          prefixSeen.add(p);
          continue;
        }
        repeatedFull++;
        if (!locked && fix) {
          pieces.push(text.slice(cursor, ev.start));
          cursor = ev.end;
          changes.push({ segment: si, from: p, to: "", why: "prefix" });
        }
        continue;
      }
      const m = ev.mention;
      const e = m.form.entity;
      const k = count.get(e.id) ?? 0;
      const longForm = m.form.kind === "long";
      const prefix = BRAND_PREFIXES.find((p) => m.text.startsWith(p));
      const seriesKnown = !!e.series && seriesSeen.has(e.series);
      const canShort =
        longForm &&
        !!e.short?.spoken &&
        m.text !== e.short.text &&
        shortOk(e, e.short, false);
      // The repeat count the report gives: a long form said again where a short form would do, a numbered game named
      // in full after its series, or a brand prefix said again.
      if (
        (canShort && (k >= 1 || seriesKnown)) ||
        (!!prefix && prefixSeen.has(prefix))
      )
        repeatedFull++;
      let to: string | undefined;
      let why: NamingChange["why"] | undefined;
      if (!locked && fix) {
        const possessive = /^['’]s\b/.test(text.slice(m.end));
        const before = text.slice(0, m.start);
        const prevWord = (
          before.match(/([A-Za-z'’]+)\W*$/)?.[1] ?? ""
        ).toLowerCase();
        const after = text.slice(m.end + (possessive ? 2 : 0));
        const nextWord = (
          after.match(/^\s+([A-Za-z'’]+)/)?.[1] ?? ""
        ).toLowerCase();
        const endsHere = /^\s*(?:[,.;:!?]|$)/.test(after);
        const distance = last
          ? wordsOf(text.slice(last.end, m.start)).length
          : Infinity;
        const pronounOk =
          k >= 1 &&
          e.pronoun === "it" &&
          last?.id === e.id &&
          !last.pronoun &&
          distance <= 15 &&
          !otherNameBetween(text, last.end, m.start) &&
          !DETERMINERS.has(prevWord) &&
          // Across a full stop only when the earlier mention opened its sentence as the subject ("Civ 5 wins. I'd pick it");
          // otherwise the same sentence only.
          (!/[.!?]/.test(text.slice(last.end, m.start)) || last.subject) &&
          (possessive
            ? /^\s+[a-z]/.test(after)
            : endsHere || AFTER_OK.has(nextWord));
        if (m.form.kind === "written" && k === 0) {
          to = e.full;
          why = "written-only";
        } else if (m.form.kind === "written" && e.short?.spoken) {
          to = e.short.text;
          why = "written-only";
        } else if (pronounOk) {
          to = possessive ? "its" : "it";
          why = "pronoun";
        } else if (
          longForm &&
          k >= 1 &&
          e.short?.spoken &&
          shortOk(e, e.short) &&
          m.text !== e.short.text
        ) {
          to = e.short.text;
          why = "short";
        } else if (
          longForm &&
          k === 0 &&
          seriesKnown &&
          e.short?.spoken &&
          shortOk(e, e.short) &&
          m.text !== e.short.text
        ) {
          to = e.short.text;
          why = "series";
        } else if (prefix && prefixSeen.has(prefix)) {
          to = m.text.slice(prefix.length).trimStart();
          why = "prefix";
        }
        if (to !== undefined && why) {
          if (atSentenceStart(text, m.start))
            to = to[0]!.toUpperCase() + to.slice(1);
          pieces.push(text.slice(cursor, m.start), to);
          cursor = m.end + (why === "pronoun" && possessive ? 2 : 0);
          changes.push({ segment: si, from: m.text, to, why });
        }
      }
      note(m);
      last = {
        id: e.id,
        end: m.end,
        pronoun: why === "pronoun",
        subject:
          atSentenceStart(text, m.start) && !/^['’]s/.test(text.slice(m.end)),
      };
    }
    pieces.push(text.slice(cursor));
    return unmaskQuotes(pieces.join(""), seg.quotes);
  });
  return {
    segments: fix ? out : segments,
    repeatedFull,
    changes,
    ambiguous: [...ambiguous],
  };
}
