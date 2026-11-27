// In-game reconstructions for documentary lines nothing filmed can show (the Noclip and Ahoy technique). A line
// about a real event is staged with the game's own world: "the team flew to New York to research the city"
// becomes a slow pass over in-game Liberty City, "crunch ran into the night" the in-game city at night, "they
// built a city you could drive anywhere in" a car pulling away down an in-game street. The only sources are
// clips the factory already licenses and labels: the chapter's official trailer moments and licensed gameplay,
// each described in a few words by the picture editor (assets.clips[].label, from rankStills in
// src/assets/fill.ts step 3b and src/assets/clipscore.ts). Nothing is generated and no model is called: the
// sentence and its shot note are read for the scene they describe (place, time of day, vehicle, crowd,
// skyline, interior), each clip label for what it shows, and the best match is offered with a confidence the
// integration step ranks against the other filler candidates. On screen the shot is framed as deliberate
// scene-setting and tagged RECONSTRUCTION · IN-GAME (src/render/components/recon/ReconShot.tsx).
//
// Honesty rules, in code below: stock footage is never a reconstruction (it is not the game); a clip with
// on-screen text, HUD, violence, a close-up or concept art is never used; a line about a named person or a
// team prefers a world with nobody in it, so a game character never stands in for a real person; a sensitive
// line (a lawsuit, a death, crime) is never staged; a line set in a real place the game's world does not model
// (Edinburgh, Dundee) is declined rather than shown as somewhere it is not.

import { namesPerson } from "./illustrate.ts";

/** Which area offers the candidate, for the integration step's ranking. */
export const RECON_AREA = "recon";

export type ReconTag =
  | "night"
  | "dusk"
  | "day"
  | "vehicle"
  | "aerial"
  | "skyline"
  | "street"
  | "coast"
  | "country"
  | "crowd"
  | "interior"
  | "city";

/** What a sentence asks to see, derived from the sentence and the writer's shot note only. */
export interface ReconScene {
  tags: ReconTag[];
  /** In-game worlds the line is set in ("vice city", "liberty city"), from a real place or the game's city. */
  worlds: string[];
  /** A research trip, an arrival, a city studied: any establishing shot of the place fits. */
  survey: boolean;
  /** The line is about people (a team, staff, a named person): a world with nobody in it is preferred. */
  people: boolean;
}

/** A sentence's moment as fill.ts knows it. */
export interface ReconMoment {
  show: string;
  person?: string;
  broll?: string;
  keywords?: string[];
  graphic?: { kind: string };
}

export interface ReconChapter {
  entry: number; // beatIndex of the chapter's clips
  game: string;
  year?: number;
  sentences: string[];
  /** Each sentence's start in seconds, when the voice is known; else estimated from word counts. */
  times?: number[];
}

/** A clip as the episode stores it (assets.clips[]). */
export interface ReconClip {
  file: string;
  label?: string;
  moment?: number;
  beatIndex?: number;
  stock?: boolean;
  durationSeconds?: number;
  credit?: string;
}

export interface ReconCandidate {
  area: typeof RECON_AREA;
  kind: "reconstruction";
  /** Index into the episode's clips. */
  clip: number;
  confidence: number;
  reason: string;
  scene: ReconScene;
  /** The clip is pinned to another sentence of the chapter (more than RECON_REUSE_SECONDS away). */
  reuse: boolean;
  /** Suggested playback rate (slow, smooth) and the longest shot it can fill at that rate. */
  rate: number;
  maxSeconds: number;
  /** A gameplay capture, so the game HUD is likely in its corners: ReconShot frames it tighter. */
  hud: boolean;
}

/** A clip pinned to another sentence of the same chapter may be reused only this far away from it. */
export const RECON_REUSE_SECONDS = 30;
/** Below this the integration step should not take the candidate. */
export const RECON_MIN_CONFIDENCE = 0.6;
/** Shorter clips cannot carry a slow move. */
export const RECON_MIN_CLIP_SECONDS = 2;
/** Reconstructions play a little slow: never slower than this, so the motion stays smooth. */
export const RECON_MIN_RATE = 0.75;
export const RECON_RATE = 0.85;
/** Narration pace for estimating sentence times when the voice's word timings are not given. */
const WORDS_PER_SECOND = 2.6;

// --- what a sentence describes ------------------------------------------------------------------------

const LINE_TAGS: Array<[ReconTag, RegExp]> = [
  [
    "night",
    /\b(night|nights|nighttime|overnight|midnight|evenings?|after dark|neon|crunch\w*|all-nighters?|\d+-hour days|long hours|late (at night|into|nights?|hours|evenings?)|(working|worked|stayed|stay) late)\b/i,
  ],
  ["dusk", /\b(sunset|sunsets|dusk|dawn|sunrise|golden hour|twilight)\b/i],
  ["day", /\b(daylight|sunny|sunshine|midday|afternoon|summer)\b/i],
  [
    "vehicle",
    /\b(drive|drives|drove|driven|driving|car|cars|road|roads|highway|highways|freeway|traffic|taxi|taxis|cab|cabs|rode|ride around|motorbikes?)\b/i,
  ],
  [
    "aerial",
    /\b(flew|fly|flying|flight|from the air|aerial|overhead|bird'?s[- ]eye|map|maps|times the size|size of|sprawl\w*|whole city|across the city|over the city)\b/i,
  ],
  ["skyline", /\b(skyline|skylines|skyscrapers?|towers)\b/i],
  [
    "street",
    /\b(street|streets|neighbou?rhoods?|blocks|sidewalks?|downtown|avenues?|walked|walking|on foot|street corners?)\b/i,
  ],
  [
    "coast",
    /\b(beach|beaches|ocean|coast|coastline|coastal|seafront|waterfront|harbou?r|pier|bay|islands?|palm trees?)\b/i,
  ],
  [
    "country",
    /\b(desert|deserts|mountains?|countryside|hills|rural|farmland|forests?)\b/i,
  ],
  [
    "crowd",
    /\b(crowds?|crowded|queues?|queued|queueing|queuing|lined up|fans|shoppers|the public)\b/i,
  ],
  [
    "interior",
    /\b(bars?|nightclubs?|clubs?|restaurants?|diners?|apartments?|mansions?|hotels?|bowling)\b/i,
  ],
  ["city", /\b(city|cities|town)\b/i],
];

const SURVEY =
  /\b(research\w*|photograph\w*|scout\w*|studied|study|trips?|travel\w*|visited|visit|toured|went to|flew to|flown to|came to|moved to|arrived|footage of|real (city|model|place|streets?))\b/i;

const PEOPLE =
  /\b(team|teams|staff|developers?|artists?|crew|employees?|members|designers?|programmers?|writers?|founders?|actors?|producers?|police officers|officers)\b/i;

// Real places and the in-game worlds that model them.
const REAL_PLACES: Array<{ real: RegExp; world?: string }> = [
  { real: /\b(miami|florida)\b/i, world: "vice city" },
  {
    real: /\b(new york|manhattan|brooklyn|queens|the bronx|harlem|washington heights|times square)\b/i,
    world: "liberty city",
  },
  {
    real: /\b(los angeles|hollywood|southern california|compton|venice beach|santa monica)\b/i,
    world: "los santos",
  },
  { real: /\b(las vegas|vegas)\b/i, world: "las venturas" },
  { real: /\b(san francisco)\b/i, world: "san fierro" },
  // Real places no GTA world models: a line set there is not staged in the game.
  {
    real: /\b(edinburgh|dundee|scotland|scottish|london|england|britain|leeds|glasgow|tokyo|japan|kyoto|seattle|montreal|toronto|paris)\b/i,
  },
];

const IN_GAME_PLACES: Array<[RegExp, string]> = [
  [/\bvice city\b/i, "vice city"],
  [/\bliberty city\b/i, "liberty city"],
  [/\blos santos\b/i, "los santos"],
  [/\blas venturas\b/i, "las venturas"],
  [/\bsan fierro\b/i, "san fierro"],
];

/** The in-game worlds a chapter's game shows, from its title; empty for a game this table does not know. */
export function gameWorlds(game: string): string[] {
  const g = game.toLowerCase();
  if (/vice city|\b(grand theft auto|gta) (vi|6)\b/.test(g))
    return ["vice city"];
  if (/san andreas/.test(g))
    return ["los santos", "san fierro", "las venturas"];
  if (
    /\b(grand theft auto|gta) (v|5)\b|\b(grand theft auto|gta) online\b/.test(g)
  )
    return ["los santos"];
  if (
    /liberty city|chinatown wars|\b(grand theft auto|gta) (iii|iv|3|4)\b/.test(
      g,
    )
  )
    return ["liberty city"];
  if (/^grand theft auto$/.test(g.trim()))
    return ["liberty city", "vice city", "san andreas"];
  return [];
}

// A figure, a share, a price: a line a graphic card may serve better.
const FIGURE =
  /(\d[\d,.]*\s*(million|billion|thousand|percent|per cent|copies|units)|[$£€]\s?\d|\b\d+\s*%|\b\d{1,3}(,\d{3})+\b|\b\d+(?:\s+(to|or)\s+\d+)?(?:\s+[A-Z]\w+){0,3}\s+(people|staff|employees|developers|testers|members|actors)\b)/i;

// The sensitive-line rule of fill.ts and illustrate.ts: never staged.
const SENSITIVE =
  /\b(lawsuit|lawsuits|sued|suing|court|courtroom|trial|judge|verdict|settlement|murder\w*|kill\w*|shoot\w*|stabb\w*|violen\w*|assault\w*|rape|racis\w*|racial|african americans?|discriminat\w*|protest\w*|objection|controvers\w*|scandal\w*|tragedy|tragic|died|death|deaths|dead|suicide|overdos\w*|drugs?|cocaine|crime|crimes|criminal\w*|gang\w*|guns?|weapons?|hot coffee|sex\w*|strip club|prostitut\w*|porn\w*|harass\w*|abuse\w*|terror\w*|bomb\w*|war|hostage|arrest\w*|prison|jail)\b/i;

/** Harmless phrases that hold a sensitive word: a game title, a design term, a photo shoot. */
export function unsensitive(text: string): string {
  return text
    .replace(/\bred dead( redemption)?\b/gi, "")
    .replace(/\bdead (spots?|zones?|ends?|air)\b/gi, "")
    .replace(
      /\bshoot(s|ing)? (photos?|pictures?|video|footage|reference)\b/gi,
      "",
    )
    .replace(/\bphoto ?shoots?\b/gi, "");
}

// A shot note that asks for an object, a document or a screen: the other filler areas show those.
const OBJECT_NOTE =
  /\b(logo|logos|box|boxes|shelf|shelves|cover art|box art|review|reviews|page|pages|chart|charts|graph|menu|menus|error|loading screen|screens?|trophy|trophies|awards?|consoles?|controller|discs?|cards?|documents?|headline|newspaper|magazine|website|tweet|quote|budget|money|cash|price|sales|stamp|calendar|contract|e-?mail|letter|phone|tv|televisions?|booth|code|keyboard)\b/i;

/**
 * Whether the text uses one of the words as a plain word: a capitalised match inside a line is part of a
 * name ("Flying Lotus", "the Flight School update") and does not count.
 */
export function saysWord(text: string, re: RegExp): boolean {
  const g = new RegExp(
    re.source,
    re.flags.includes("g") ? re.flags : `${re.flags}g`,
  );
  for (const m of text.matchAll(g)) {
    const before = text.slice(0, m.index).trimEnd();
    const lineStart = !before || /[\n.!?:]$/.test(before);
    if (lineStart || !/^[A-Z]/.test(m[0])) return true;
  }
  return false;
}

/** Sentence and shot note with the tag words found, and the worlds named or implied. */
export function sceneOf(
  sentence: string,
  moment: ReconMoment,
  game: string,
): ReconScene & { elsewhere?: string } {
  const text = `${sentence} \n ${moment.show ?? ""} \n ${moment.broll ?? ""}`;
  const tags = LINE_TAGS.filter(([, re]) => saysWord(text, re)).map(([t]) => t);
  const own = gameWorlds(game);
  const worlds = new Set<string>();
  let elsewhere: string | undefined;
  let elsewhereIn = false;
  for (const p of REAL_PLACES) {
    const m = p.real.exec(text);
    if (!m) continue;
    if (p.world && own.includes(p.world)) worlds.add(p.world);
    else {
      elsewhere ??= m[0];
      // "Back in Scotland", "at the Edinburgh office": the line happens there.
      if (
        new RegExp(`\\b(in|at|inside|back in)\\s+(the\\s+)?${m[0]}`, "i").test(
          text,
        )
      )
        elsewhereIn = true;
    }
  }
  // Another game's city ("Los Santos skyline teasing GTA V" in the GTA IV chapter): about that game, not this one.
  for (const [re, w] of IN_GAME_PLACES)
    if (re.test(text)) {
      if (own.includes(w)) worlds.add(w);
      else elsewhere ??= w.replace(/\b\w/g, (x) => x.toUpperCase());
    }
  if (worlds.size && !tags.includes("city")) tags.push("city");
  return {
    tags,
    worlds: [...worlds],
    survey: SURVEY.test(text),
    people:
      PEOPLE.test(sentence) ||
      namesPerson(sentence, { show: moment.show ?? "", person: moment.person }),
    ...(elsewhere && (!worlds.size || elsewhereIn) ? { elsewhere } : {}),
  };
}

// --- what a clip shows, from its label ----------------------------------------------------------------

const CLIP_TAGS: Array<[ReconTag, RegExp]> = [
  ["night", /\b(night|nighttime|dark|neon|lit|moonlit|evening)\b/i],
  ["dusk", /\b(dusk|sunset|sunrise|dawn|sun|golden)\b/i],
  ["day", /\b(sunny|daylight|day|bright)\b/i],
  [
    "vehicle",
    /\b(car|cars|taxi|taxis|truck|trucks|suv|van|wagon|bikes?|biking|bicycle|motorcycl\w*|quad|jet|helicopter|plane|biplane|boat|jet ski|driving|drives|traffic|vehicles)\b/i,
  ],
  [
    "aerial",
    /\b(aerial|from above|overhead|top-down|over city|over the city|over los santos|flying|clouds|helipad)\b/i,
  ],
  ["skyline", /\b(skyline|skyscrapers?|towers?|high-rise)\b/i],
  [
    "street",
    /\b(street|streets|road|roads|(?<!bowling )alley|highway|intersection|avenue|plaza|neighbou?rhood|boulevard|elevated rail)\b/i,
  ],
  [
    "coast",
    /\b(coast|coastal|beach|ocean|sea|pier|water|bay|harbou?r|jet ski|palm)\b/i,
  ],
  ["country", /\b(desert|mountain|trail|dirt road|countryside|hills?)\b/i],
  ["crowd", /\b(crowd|crowds|pedestrians|people|fans|group)\b/i],
  [
    "interior",
    /\b(interior|office|room|house|bar|store|garage|bowling|lane|counter|club)\b/i,
  ],
  [
    "city",
    /\b(city|vice city|los santos|liberty city|chinatown|downtown|buildings?|ocean beach)\b/i,
  ],
];

const FIGURE_IN_CLIP =
  /\b(man|men|woman|women|character|player|tommy|cj|niko|figure|prisoner|officer|stuntman|motorcyclist|big smoke|person|people|guy|masked|bearded|crowd|pedestrians|fans|group)\b/i;
const VIOLENT_CLIP =
  /\b(explod\w*|explosion|fire|blood|weapon|guns?|bat|robbery|wasted|masked|swinging|chas\w*|prisoner|wreck\w*|crash\w*|overturned|debris|armou?red|fight\w*|shoot\w*|cash register|briefcases|gang)\b/i;
const TEXT_IN_CLIP =
  /\b(tutorial|subtitles?|instructions|overlay|text|phone shown|radar|menu|hud|caption|streamer|screen|poster|signs?|logo|mission|capture|match)\b/i;
const NOT_WORLD_CLIP =
  /\b(artwork|stylized|stylised|illustration|concept art|blurry|blur|close-up|closeup|portrait|engraving|disc)\b/i;

const AIRCRAFT_SUBJECT =
  /^(a |an |the )?(\w+ )?(helicopter|jet|plane|biplane|airplane|aircraft|blimp|chopper)\b/i;
const AERIAL_VIEW =
  /\b(aerial|view|from above|overhead|top-down|bird'?s-eye)\b/i;

/** What a clip's label says it shows; undefined for a clip a reconstruction never uses, with the reason. */
export function clipTags(
  label: string | undefined,
):
  | { tags: ReconTag[]; figures: boolean; cutscene: boolean }
  | { refuse: string } {
  const l = (label ?? "").trim();
  if (!l) return { refuse: "no label" };
  if (TEXT_IN_CLIP.test(l)) return { refuse: "text or HUD on screen" };
  if (VIOLENT_CLIP.test(l)) return { refuse: "violence or a chase" };
  if (NOT_WORLD_CLIP.test(l)) return { refuse: "not a shot of the world" };
  let tags = CLIP_TAGS.filter(([, re]) => re.test(l)).map(([t]) => t);
  // "Helicopter flying over building" names an aircraft in shot, not a view from the air (31 Oct 2026 sheet:
  // it was a close-up of the helicopter's underside). Only a label that says it is a view shows the place.
  if (AIRCRAFT_SUBJECT.test(l) && !AERIAL_VIEW.test(l))
    tags = tags.filter((t) => t === "vehicle" || t === "night" || t === "dusk" || t === "day");
  return {
    tags,
    figures: FIGURE_IN_CLIP.test(l),
    cutscene: /\bcutscene\b/i.test(l),
  };
}

// --- matching ------------------------------------------------------------------------------------------

const WEIGHT: Record<ReconTag, number> = {
  night: 0.3,
  dusk: 0.3,
  day: 0.1,
  vehicle: 0.25,
  aerial: 0.3,
  skyline: 0.25,
  street: 0.2,
  coast: 0.25,
  country: 0.25,
  crowd: 0.25,
  interior: 0.3,
  city: 0.1,
};

/** Clip tags that satisfy a line's tag (an aerial line is happy with a skyline, a street line with a car on a road). */
const SATISFIES: Record<ReconTag, ReconTag[]> = {
  night: ["night"],
  dusk: ["dusk"],
  day: ["day"],
  vehicle: ["vehicle"],
  aerial: ["aerial", "skyline"],
  skyline: ["skyline", "aerial"],
  street: ["street"],
  coast: ["coast"],
  country: ["country"],
  crowd: ["crowd"],
  interior: ["interior"],
  city: ["city", "street", "skyline", "aerial"],
};

/** Each sentence's start in seconds: the voice's timings when given, else from word counts. */
export function sentenceTimes(ch: ReconChapter): number[] {
  if (ch.times && ch.times.length === ch.sentences.length) return ch.times;
  const out: number[] = [];
  let t = 0;
  for (const s of ch.sentences) {
    out.push(t);
    t += s.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND;
  }
  return out;
}

/** The playback rate for a clip filling a shot: slow, but never so slow the motion steps. */
export function reconRate(clipSeconds: number, shotSeconds: number): number {
  if (!(shotSeconds > 0)) return RECON_RATE;
  return Math.max(
    RECON_MIN_RATE,
    Math.min(RECON_RATE, clipSeconds / shotSeconds),
  );
}

/** The longest shot a clip can fill at the slowest rate. */
export function reconMaxSeconds(clipSeconds: number): number {
  return Math.round((clipSeconds / RECON_MIN_RATE) * 100) / 100;
}

const HUD_CREDIT = /^gameplay\b/i;
const HUD_FILE = /(^|[\\/])(gameplay|own)_[^\\/]*$/i;

/** A licensed gameplay capture or the owner's own recording (the HUD is on), not an official trailer moment. */
export function hasHud(c: ReconClip): boolean {
  return HUD_CREDIT.test(c.credit ?? "") || HUD_FILE.test(c.file);
}

export type ReconJudgement =
  | { candidate: ReconCandidate; decline?: undefined }
  | { candidate?: undefined; decline: string };

/**
 * The reconstruction a sentence could take, or why it declines. `sentence` is the sentence's index in the
 * chapter (its text is chapter.sentences[sentence]) or its text; given only the text, no pinned clip is reused.
 * `used` holds clips already serving a reconstruction anywhere in the video: a clip stages one scene per
 * video (31 Oct 2026 review: one helicopter clip was offered for three lines). `refused` holds clips whose
 * pictures failed the frame check (src/assets/reconcheck.ts).
 */
export function judgeRecon(
  sentence: number | string,
  moment: ReconMoment,
  chapter: ReconChapter,
  clips: ReconClip[],
  opts: { used?: Set<number>; refused?: Set<number> } = {},
): ReconJudgement {
  const k =
    typeof sentence === "number"
      ? sentence
      : chapter.sentences.indexOf(sentence);
  const text =
    typeof sentence === "number" ? (chapter.sentences[k] ?? "") : sentence;
  if (!text.trim()) return { decline: "no sentence" };
  if (k === 0)
    return { decline: "the chapter's first line plays under its title card" };
  if (moment.graphic && moment.graphic.kind !== "none")
    return { decline: "has a graphic" };
  if (
    SENSITIVE.test(unsensitive(text)) ||
    SENSITIVE.test(unsensitive(moment.show ?? ""))
  )
    return { decline: "sensitive subject: never staged" };
  if (/["“][^"”]{3,}["”]/.test(text))
    return { decline: "a quote: the quote card shows it" };
  if (OBJECT_NOTE.test(moment.show ?? ""))
    return {
      decline: `the shot note asks for an object or document (${OBJECT_NOTE.exec(moment.show)![0]})`,
    };
  const scene = sceneOf(text, moment, chapter.game);
  if (scene.elsewhere)
    return {
      decline: `set in ${scene.elsewhere}, which this chapter's game does not show`,
    };
  const wanted = scene.tags.filter((t) => t !== "city");
  if (!wanted.length && !scene.survey && !scene.worlds.length)
    return { decline: "no scene to stage (no place, time, vehicle or crowd)" };

  // An abstract line ("Nobody outside the studio knows it yet") says no scene itself; only the shot note
  // does. It is staged only when the clip's label matches at least two of the note's scene words, never on
  // a mood alone (31 Oct 2026 review: a dark street under that line read as filler).
  const own = sceneOf(text, { show: "" }, chapter.game);
  // A shot note naming a research trip to the game's real city ("staff on a New York research trip") is a
  // scene, not a mood, even when the sentence only says "there".
  const abstract =
    !own.tags.some((t) => t !== "city") &&
    !own.survey &&
    !own.worlds.length &&
    !(scene.survey && scene.worlds.length);

  const times = sentenceTimes(chapter);
  const now = k >= 0 ? (times[k] ?? 0) : undefined;
  const figure = FIGURE.test(text);
  let best: ReconCandidate | undefined;
  let bestWhy = "no clip of the chapter shows that scene";
  for (const [i, c] of clips.entries()) {
    if (c.beatIndex !== chapter.entry || c.stock) continue;
    if (opts.used?.has(i) || opts.refused?.has(i)) continue;
    // A clip the picture editor pinned to another sentence may be reused only 30 seconds or more away.
    const pinned = c.moment;
    if (pinned !== undefined) {
      if (pinned === k || now === undefined) continue;
      if (Math.abs((times[pinned] ?? 0) - now) < RECON_REUSE_SECONDS) continue;
    }
    const seconds = Number(c.durationSeconds ?? 0);
    if (seconds < RECON_MIN_CLIP_SECONDS) continue;
    const look = clipTags(c.label);
    if ("refuse" in look) continue;
    if (
      scene.people &&
      look.figures &&
      namesPerson(text, { show: moment.show ?? "", person: moment.person })
    )
      continue; // a game character never stands in for a named real person
    const matched: ReconTag[] = [];
    let score = 0.3;
    for (const t of scene.tags)
      if (SATISFIES[t].some((x) => look.tags.includes(x))) {
        matched.push(t);
        score += WEIGHT[t];
      }
    // A research trip or arrival takes any establishing shot of the place: outdoors, the city itself.
    const establishing =
      !look.tags.includes("interior") &&
      look.tags.some((t) =>
        ["aerial", "skyline", "street", "city"].includes(t),
      );
    if (scene.survey && establishing && !matched.some((t) => t !== "city"))
      score += 0.2;
    if (!matched.some((t) => t !== "city") && !(scene.survey && establishing))
      continue;
    if (abstract && matched.filter((t) => t !== "city").length < 2) {
      bestWhy =
        "an abstract line: no clip matches its shot note closely enough to stage it";
      continue;
    }
    // The game's own model of the real place the line names.
    if (scene.worlds.length) score += 0.15;
    // Time of day that contradicts the line.
    if (
      scene.tags.includes("night") &&
      (look.tags.includes("day") || look.tags.includes("dusk")) &&
      !look.tags.includes("night")
    )
      score -= 0.15;
    if (scene.tags.includes("day") && look.tags.includes("night")) score -= 0.1;
    if (look.figures) score -= scene.people ? 0.2 : 0.05;
    if (look.cutscene) score -= 0.1;
    // An official trailer moment has no HUD; a gameplay capture usually does and is framed tighter.
    const hud = hasHud(c);
    if (hud) score -= 0.05;
    if (seconds < 3) score -= 0.05;
    if (pinned !== undefined) score -= 0.05;
    if (figure) score -= 0.15;
    const confidence =
      Math.round(Math.max(0, Math.min(0.92, score)) * 100) / 100;
    if (best && confidence <= best.confidence) continue;
    const parts = [
      `"${c.label}" shows ${matched.length ? matched.join(", ") : "an establishing shot"}`,
      scene.worlds.length ? `in ${scene.worlds.join("/")}` : "",
      scene.survey ? "for a research or travel line" : "",
      pinned !== undefined ? `reused from sentence ${pinned}` : "",
      figure ? "the line states a figure, a card may serve it better" : "",
      look.figures ? "someone in frame" : "",
    ].filter(Boolean);
    best = {
      area: RECON_AREA,
      kind: "reconstruction",
      clip: i,
      confidence,
      reason: parts.join("; "),
      scene: {
        tags: scene.tags,
        worlds: scene.worlds,
        survey: scene.survey,
        people: scene.people,
      },
      reuse: pinned !== undefined,
      rate: RECON_RATE,
      maxSeconds: reconMaxSeconds(seconds),
      hud,
    };
    bestWhy = best.reason;
  }
  if (!best) return { decline: bestWhy };
  if (best.confidence < RECON_MIN_CONFIDENCE)
    return {
      decline: `best match too weak (${best.confidence}): ${best.reason}`,
    };
  return { candidate: best };
}

/** The reconstruction a bare sentence could take, or undefined. Pure: nothing in `clips` is changed. */
export function reconFor(
  sentence: number | string,
  moment: ReconMoment,
  chapter: ReconChapter,
  clips: ReconClip[],
): ReconCandidate | undefined {
  return judgeRecon(sentence, moment, chapter, clips).candidate;
}

/**
 * Candidates for several bare sentences of one chapter at once, most confident first. Every clip stages at
 * most one reconstruction: a clip picked here is added to `used` (pass the same set for every chapter of a
 * video). Pure apart from `used`: returns sentence index to candidate.
 */
export function reconForChapter(
  chapter: ReconChapter,
  moments: ReconMoment[],
  bare: number[],
  clips: ReconClip[],
  used: Set<number> = new Set(),
  refused: Set<number> = new Set(),
): Map<number, ReconCandidate> {
  const out = new Map<number, ReconCandidate>();
  const left = new Set(bare);
  while (left.size) {
    let pick: { k: number; c: ReconCandidate } | undefined;
    for (const k of left) {
      const m = moments[k];
      if (!m) continue;
      const r = judgeRecon(k, m, chapter, clips, { used, refused }).candidate;
      if (r && (!pick || r.confidence > pick.c.confidence)) pick = { k, c: r };
    }
    if (!pick) break;
    out.set(pick.k, pick.c);
    used.add(pick.c.clip);
    left.delete(pick.k);
  }
  return out;
}

/** Looks at a clip's pictures (src/assets/reconcheck.ts checkReconClip, or a stand-in in tests). */
export type ReconClipCheck = (
  clip: ReconClip,
  index: number,
) => Promise<{ ok: boolean; reason: string }>;

export interface ReconVideoChapter {
  chapter: ReconChapter;
  moments: ReconMoment[];
  bare: number[];
}

/**
 * Reconstructions for a whole video: each chapter's picks, one clip per reconstruction across the video, and
 * every picked clip verified from three of its frames before it is accepted. A clip that fails is refused
 * and its chapter chosen again without it. Returns per chapter (by entry) sentence index to candidate, and
 * the clips refused with the reason.
 */
export async function reconForVideo(
  chapters: ReconVideoChapter[],
  clips: ReconClip[],
  check: ReconClipCheck,
): Promise<{
  picks: Map<number, Map<number, ReconCandidate>>;
  refused: Map<number, string>;
}> {
  const used = new Set<number>();
  const refusedSet = new Set<number>();
  const refused = new Map<number, string>();
  const verdicts = new Map<number, boolean>();
  const picks = new Map<number, Map<number, ReconCandidate>>();
  for (const ch of chapters) {
    for (;;) {
      const tryUsed = new Set(used);
      const got = reconForChapter(
        ch.chapter,
        ch.moments,
        ch.bare,
        clips,
        tryUsed,
        refusedSet,
      );
      let failed = false;
      for (const c of got.values()) {
        if (!verdicts.has(c.clip)) {
          const v = await check(clips[c.clip]!, c.clip).catch((err) => ({
            ok: false,
            reason: err instanceof Error ? err.message : String(err),
          }));
          verdicts.set(c.clip, v.ok);
          if (!v.ok) refused.set(c.clip, v.reason);
        }
        if (!verdicts.get(c.clip)) {
          refusedSet.add(c.clip);
          failed = true;
        }
      }
      if (failed) continue;
      for (const c of got.values()) used.add(c.clip);
      picks.set(ch.chapter.entry, got);
      break;
    }
  }
  return { picks, refused };
}
