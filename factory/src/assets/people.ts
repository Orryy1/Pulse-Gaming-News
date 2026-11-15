// The real people a Short names, and a freely licensed photo of each (PEOPLE_INSETS, owner 15 Nov 2026): "when a
// Short names real people (the artists Lana Del Rey, Playboi Carti, Keith Richards), a small picture-in-picture photo
// of each should pop in on the line where they are named". No model call:
// - the names come from the writer's `people` list and `person`, and from runs of capitalised words in the spoken
//   lines ("Lana Del Rey", "Blackpink's Jennie"), with outlets, the game and its studio left out;
// - each is checked against Wikidata: the first item whose label or alias is exactly that name must be a human
//   (instance of Q5), or a qualified single name ("Blackpink's Jennie") is looked up on Wikipedia with its qualifier;
// - the photo is that person's own Wikidata image (P18, always a Wikimedia Commons file), used only under a clear free
//   licence (public domain, CC0, CC BY, CC BY-SA) and never a cover, logo, poster, press or agency picture; no such
//   photo, no inset;
// - it is cropped to a square on the face (Apple Vision's face finder on the Mac mini, a head-and-shoulders guess
//   elsewhere).
// The tracklist card's songs come from the writer's `tracklist`, else from the script's own checked claims.
// The render side (timing and layout) is src/render/people.ts.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { MAX_PEOPLE, MAX_TRACKS, type Track } from "../render/people.ts";

const run = promisify(execFile);
const UA =
  "PulseGamingFactory/1.0 (https://pulse.orryy.com; licensed photo research)";

/** A person found in a Short, with their photo once fetched. */
export interface PersonPortrait {
  /** The name as the Short says it. */
  name: string;
  /** Wikidata item. */
  qid: string;
  /** The square face crop, relative to the episode folder. */
  file: string;
  artist: string;
  license: string;
  /** The Commons file page. */
  pageUrl: string;
  /** "Photo: Jane Doe, CC BY-SA 4.0" */
  credit: string;
}

/** A name a Short says, with the word that qualifies a single name ("Blackpink" for "Jennie"). */
export interface NameCandidate {
  name: string;
  qualifier?: string;
  /** From the writer's own list (trusted to be a person once Wikidata agrees). */
  listed?: boolean;
}

// ---- Names in the narration --------------------------------------------------------------------------------

/** Small words inside a name: "Lana Del Rey", "Ludwig van Beethoven". */
const PARTICLE = new Set([
  "del",
  "de",
  "van",
  "von",
  "der",
  "da",
  "di",
  "la",
  "le",
  "du",
  "bin",
  "al",
  "dos",
  "das",
  "ter",
]);

/** Capitalised words that start a sentence or name a thing, never a person on their own. */
const NOT_A_NAME = new Set(
  (
    "The A An And But Or So Yet If When While Then Now Here There This That These Those It Its It's They Their We Our You Your I " +
    "He She His Her Him Who What Why How Which Insider Gaming Rolling Stone Billboard Reuters Bloomberg Variety Kotaku IGN " +
    "GameSpot Eurogamer Polygon Verge PC Gamer VGC Xbox PlayStation Nintendo Switch Steam Epic Sony Microsoft Rockstar Games " +
    "Grand Theft Auto GTA Vice City Leonida Miami Florida January February March April May June July August September October " +
    "November December Monday Tuesday Wednesday Thursday Friday Saturday Sunday Wire Twitter Reddit YouTube TikTok Spotify Apple Music"
  ).split(" "),
);

const isCap = (w: string) =>
  /^[A-Z][\p{L}'’.-]*$/u.test(w) &&
  !/^[A-Z]{2,}$/.test(w.replace(/[’'.-]/g, ""));

/**
 * Runs of capitalised words in spoken text that could be a person's name (pure): two to four words, small particles
 * allowed inside ("Lana Del Rey"), possessives trimmed ("Rey's"), and a single name after a capitalised possessive kept
 * with that qualifier ("Blackpink's Jennie"). Words in `exclude` (the game's title, outlets) end a run.
 */
export function nameCandidates(
  text: string,
  exclude: string[] = [],
): NameCandidate[] {
  const ex = new Set(
    exclude
      .flatMap((x) => x.split(/[\s:/-]+/))
      .map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, ""))
      .filter(Boolean),
  );
  const out: NameCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: NameCandidate) => {
    const k = c.name.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };
  for (const sentence of text.split(/(?<=[.!?;:])\s+|\n+/)) {
    const toks = sentence.split(/\s+/).filter(Boolean);
    const clean = (w: string) => w.replace(/^[("“‘']+|[)"”’',.!?;:]+$/g, "");
    const bare = (w: string) => clean(w).replace(/[’']s$/, "");
    const usable = (w: string) => {
      const b = bare(w);
      return (
        isCap(b) &&
        !NOT_A_NAME.has(b) &&
        !ex.has(b.toLowerCase().replace(/[^a-z0-9]/g, ""))
      );
    };
    for (let i = 0; i < toks.length; i++) {
      if (!usable(toks[i]!)) continue;
      // The run: capitalised words and particles between them, ended by punctuation after a word or a possessive.
      const run: string[] = [bare(toks[i]!)];
      let j = i;
      let ended =
        /[,.!?;:)"”]$/.test(toks[i]!) ||
        /[’']s[,.!?;:]?$/.test(clean(toks[i]!));
      while (!ended && j + 1 < toks.length) {
        const nx = toks[j + 1]!;
        const b = bare(nx);
        if (
          PARTICLE.has(b.toLowerCase()) &&
          j + 2 < toks.length &&
          usable(toks[j + 2]!)
        ) {
          run.push(b);
          j++;
          continue;
        }
        if (!usable(nx)) break;
        run.push(b);
        j++;
        ended = /[,.!?;:)"”]$/.test(nx) || /[’']s[,.!?;:]?$/.test(clean(nx));
      }
      // "Blackpink's Jennie": a possessive name before one capitalised word qualifies it.
      if (
        run.length === 1 &&
        /[’']s$/.test(clean(toks[i]!)) &&
        toks[i + 1] &&
        usable(toks[i + 1]!)
      ) {
        const next = [bare(toks[i + 1]!)];
        let k = i + 1;
        while (
          k + 1 < toks.length &&
          !/[,.!?;:]$/.test(toks[k]!) &&
          usable(toks[k + 1]!)
        ) {
          next.push(bare(toks[k + 1]!));
          k++;
        }
        push(
          next.length === 1
            ? { name: next[0]!, qualifier: run[0]! }
            : { name: next.join(" ") },
        );
        i = k;
        continue;
      }
      if (
        run.length >= 2 &&
        run.length <= 4 &&
        !PARTICLE.has(run[run.length - 1]!.toLowerCase())
      )
        push({ name: run.join(" ") });
      i = j;
    }
  }
  return out;
}

/** What the people finder reads from a script (any lane's script fits). */
export interface PeopleScript {
  hook: string;
  beats: Array<{ narration: string }>;
  pulse_take?: { narration: string };
  loop_line?: string;
  person?: string;
  people?: string[];
  game_title?: string;
  attribution?: string;
}

/** The spoken lines in order. */
export const spokenText = (s: PeopleScript): string =>
  [
    s.hook,
    ...s.beats.map((b) => b.narration),
    s.pulse_take?.narration ?? "",
    s.loop_line ?? "",
  ].join(" ");

/**
 * The names worth checking, in the order the Short says them (pure): the writer's list and `person` first, then
 * names in the spoken lines; only names actually spoken count (the inset lands on the word). At most twice MAX_PEOPLE
 * go to Wikidata.
 */
export function peopleCandidates(s: PeopleScript): NameCandidate[] {
  const spoken = spokenText(s);
  const lower = ` ${spoken
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")} `;
  const said = (n: string) =>
    lower.includes(
      ` ${n
        .toLowerCase()
        .replace(/\([^)]*\)/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()} `,
    );
  const exclude = [
    s.game_title ?? "",
    (s.attribution ?? "").replace(/^sources?:\s*/i, ""),
  ];
  const found = nameCandidates(spoken, exclude);
  const listed = [...(s.people ?? []), s.person ?? ""]
    .map((n) => n.trim())
    .filter(Boolean)
    .filter((n) => said(n))
    .map((n): NameCandidate => {
      const f = found.find((x) => x.name.toLowerCase() === n.toLowerCase());
      return {
        name: n,
        listed: true,
        ...(f?.qualifier ? { qualifier: f.qualifier } : {}),
      };
    });
  const all = [
    ...listed,
    ...found.filter(
      (f) => !listed.some((l) => l.name.toLowerCase() === f.name.toLowerCase()),
    ),
  ];
  const at = (n: string) =>
    lower.indexOf(
      ` ${n
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()} `,
    );
  return all.sort((a, b) => at(a.name) - at(b.name)).slice(0, MAX_PEOPLE * 2);
}

// ---- Licence rules ------------------------------------------------------------------------------------------

const FREE =
  /^(cc0|cc[ -]by(-sa)?([ -][\d.]+)?(\s+\w+)?|public domain|pd\b|pd-)/i;
/** Never a cover, logo, poster or screenshot: only a photo of the person. */
const NOT_A_PORTRAIT =
  /logo|icon|cover|album|single|poster|screenshot|box ?art|artwork|signature|\.svg|\.gif|flag of|coat of arms|banner|ticket|vinyl|record sleeve/i;
/** Agency, press and promotional pictures: never, whatever licence a page claims for them. */
const PRESS =
  /getty|shutterstock|alamy|wireimage|filmmagic|afp|reuters|associated press|\bap photo|press (photo|image|kit)|promotional|publicity|courtesy of|epa\b|invision|rex features|splash news/i;

/** What a Commons file page says about a photo. */
export interface PortraitMeta {
  title: string;
  license: string;
  artist: string;
  credit?: string;
  usageTerms?: string;
  categories?: string;
  description?: string;
  width: number;
  height: number;
}

/** Whether a Commons photo may be used as a person's inset, and why not (pure). */
export function portraitAllowed(
  m: PortraitMeta,
): { ok: true } | { ok: false; why: string } {
  const lic = m.license.trim();
  if (!lic) return { ok: false, why: "no licence stated" };
  if (
    /fair use|non-free|all rights reserved|\bnc\b|noncommercial|\bnd\b|noderiv/i.test(
      `${lic} ${m.usageTerms ?? ""}`,
    )
  )
    return { ok: false, why: `licence not free for this use (${lic})` };
  if (!FREE.test(lic))
    return { ok: false, why: `licence not clearly free (${lic})` };
  if (NOT_A_PORTRAIT.test(m.title))
    return { ok: false, why: `not a photo of the person (${m.title})` };
  if (
    /album covers?|book covers?|logos|posters|screenshots/i.test(
      m.categories ?? "",
    )
  )
    return { ok: false, why: "filed as a cover, logo, poster or screenshot" };
  if (PRESS.test(`${m.artist} ${m.credit ?? ""} ${m.description ?? ""}`))
    return { ok: false, why: "a press, agency or promotional picture" };
  if (!/\.(jpe?g|png|webp|tiff?)$/i.test(m.title))
    return { ok: false, why: "not a photo file" };
  if (Math.min(m.width, m.height) < 300) return { ok: false, why: "too small" };
  return { ok: true };
}

/** The tiny credit under an inset: "Photo: Jane Doe, CC BY-SA 4.0". */
export function insetCredit(artist: string, license: string): string {
  let a = artist.replace(/\s+/g, " ").trim() || "Unknown author";
  // Flickr-style "Mike Monaghan from Seattle, United States": the person, not the place.
  if (a.length > 28) a = a.split(/\s+from\s+|\s*[,(|]\s*/)[0]!.trim() || a;
  if (a.length > 34) a = `${a.slice(0, 34).replace(/\s+\S*$/, "")}…`;
  return `Photo: ${a}, ${license.trim()}`;
}

// ---- The face crop -----------------------------------------------------------------------------------------

/**
 * The square to cut from a photo w x h (pure): around a face box (fractions, origin top-left) at about 2.4 times the
 * face, a little above its centre so the shoulders show; without a face, a head-and-shoulders guess (a portrait's
 * subject sits high and central). Always inside the picture.
 */
export function faceSquare(
  w: number,
  h: number,
  face?: { x: number; y: number; w: number; h: number },
): { x: number; y: number; size: number } {
  const most = Math.min(w, h);
  if (face && face.w > 0 && face.h > 0) {
    const fw = face.w * w;
    const fh = face.h * h;
    const size = Math.round(Math.min(most, Math.max(fw, fh) * 2.4));
    const cx = (face.x + face.w / 2) * w;
    const cy = (face.y + face.h / 2) * h + fh * 0.25;
    const x = Math.round(Math.min(w - size, Math.max(0, cx - size / 2)));
    const y = Math.round(Math.min(h - size, Math.max(0, cy - size / 2)));
    return { x, y, size };
  }
  const size = Math.round(h > w ? w : Math.min(h, w * 0.75));
  const x = Math.round((w - size) / 2);
  const y = Math.round(h > w ? Math.min(h - size, h * 0.06) : 0);
  return { x, y, size };
}

// ---- Wikidata and Commons ----------------------------------------------------------------------------------

type Fetch = typeof fetch;

async function getJson(url: string, fetchFn: Fetch): Promise<any> {
  const res = await fetchFn(url, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

const normName = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]/g, "");

/** A Wikidata entity's human check and portrait file (pure, on wbgetentities' entity). */
export function humanWithImage(entity: any): {
  human: boolean;
  image?: string;
  label?: string;
} {
  const p31 = (entity?.claims?.P31 ?? []).map(
    (c: any) => c?.mainsnak?.datavalue?.value?.id,
  );
  const image = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value as
    | string
    | undefined;
  return {
    human: p31.includes("Q5"),
    ...(image ? { image } : {}),
    label: entity?.labels?.en?.value,
  };
}

/**
 * The Wikidata person a spoken name means, or undefined (network). Wikipedia's article of exactly that title (else
 * Wikidata's first exact hit) decides: its item must be a human; a single qualified name ("Jennie", "Blackpink") goes through a
 * Wikipedia search with its qualifier and the page's item must be a human whose label starts with the name.
 */
export async function resolvePerson(
  c: NameCandidate,
  fetchFn: Fetch = fetch,
): Promise<{ qid: string; image?: string; label?: string } | undefined> {
  const entity = async (qid: string) =>
    (
      await getJson(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|labels&languages=en&format=json`,
        fetchFn,
      )
    )?.entities?.[qid];
  const single = !c.name.includes(" ");
  if (!single) {
    // Wikipedia's article of that exact title (its primary topic: "Dua Lipa" the singer, not her album; "Rolling
    // Stone" the magazine): a person when its item is a human. A disambiguation page or no article: Wikidata's first
    // hit whose label or alias is exactly the name decides.
    const pp = new URLSearchParams({ action: "query", prop: "pageprops", titles: c.name, redirects: "1", format: "json" });
    const page = (Object.values((await getJson(`https://en.wikipedia.org/w/api.php?${pp}`, fetchFn))?.query?.pages ?? {}) as any[])[0];
    const wq = page?.pageprops?.wikibase_item as string | undefined;
    if (wq && page?.pageprops?.disambiguation === undefined) {
      const r = humanWithImage(await entity(wq));
      return r.human ? { qid: wq, image: r.image, label: r.label } : undefined;
    }
    const q = new URLSearchParams({ action: "wbsearchentities", search: c.name, language: "en", type: "item", limit: "7", format: "json" });
    const hits: any[] = (await getJson(`https://www.wikidata.org/w/api.php?${q}`, fetchFn))?.search ?? [];
    const exact = hits.find((h) => normName(h?.match?.text ?? h?.label ?? "") === normName(c.name));
    if (!exact?.id) return undefined;
    const r = humanWithImage(await entity(exact.id));
    return r.human ? { qid: exact.id, image: r.image, label: r.label } : undefined;
  }
  if (!c.qualifier && !c.listed) return undefined;
  const q = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: [c.name, c.qualifier].filter(Boolean).join(" "),
    srlimit: "3",
    format: "json",
  });
  const titles: string[] = (
    (await getJson(`https://en.wikipedia.org/w/api.php?${q}`, fetchFn))?.query
      ?.search ?? []
  ).map((x: any) => x.title);
  for (const title of titles) {
    if (!normName(title).startsWith(normName(c.name))) continue;
    const pp = new URLSearchParams({
      action: "query",
      prop: "pageprops",
      titles: title,
      redirects: "1",
      format: "json",
    });
    const pages = Object.values(
      (await getJson(`https://en.wikipedia.org/w/api.php?${pp}`, fetchFn))
        ?.query?.pages ?? {},
    ) as any[];
    const qid = pages[0]?.pageprops?.wikibase_item as string | undefined;
    if (!qid) continue;
    const r = humanWithImage(await entity(qid));
    if (r.human) return { qid, image: r.image, label: r.label };
  }
  return undefined;
}

/** A Commons file's licence facts and a rendition about `width` wide (network). */
export async function commonsFile(
  file: string,
  fetchFn: Fetch = fetch,
  width = 900,
): Promise<
  | (PortraitMeta & {
      url: string;
      thumbWidth: number;
      thumbHeight: number;
      pageUrl: string;
    })
  | undefined
> {
  const q = new URLSearchParams({
    action: "query",
    titles: `File:${file}`,
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: String(width),
    format: "json",
  });
  const pages = Object.values(
    (await getJson(`https://commons.wikimedia.org/w/api.php?${q}`, fetchFn))
      ?.query?.pages ?? {},
  ) as any[];
  const p = pages[0];
  const info = p?.imageinfo?.[0];
  if (!info) return undefined;
  const meta = info.extmetadata ?? {};
  const strip = (t: unknown) =>
    String(t ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  return {
    title: String(p.title ?? `File:${file}`),
    license: strip(meta.LicenseShortName?.value),
    artist: strip(meta.Artist?.value).slice(0, 80) || "Unknown author",
    credit: strip(meta.Credit?.value),
    usageTerms: strip(meta.UsageTerms?.value),
    categories: strip(meta.Categories?.value),
    description: strip(meta.ImageDescription?.value).slice(0, 300),
    width: Number(info.width ?? 0),
    height: Number(info.height ?? 0),
    url: String(info.thumburl ?? info.url),
    thumbWidth: Number(info.thumbwidth ?? info.width ?? 0),
    thumbHeight: Number(info.thumbheight ?? info.height ?? 0),
    pageUrl: String(
      info.descriptionurl ??
        `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(p.title))}`,
    ),
  };
}

/** The faces Apple Vision finds in a picture (the Mac mini); none elsewhere. */
type FaceFinder = (
  file: string,
) => Promise<Array<{ x: number; y: number; w: number; h: number; c?: number }>>;

/**
 * A person's inset photo in the episode folder (network): resolved on Wikidata, their own image checked against the
 * licence rules, downloaded and cut to a 480 px square on the face. Undefined when any step says no.
 */
export async function personPortrait(
  c: NameCandidate,
  dir: string,
  slot: number,
  deps: { fetchFn?: Fetch; faces?: FaceFinder } = {},
): Promise<PersonPortrait | undefined> {
  const fetchFn = deps.fetchFn ?? fetch;
  try {
    const who = await resolvePerson(c, fetchFn);
    if (!who) return undefined;
    if (!who.image) {
      log("info", "person inset: no Wikidata photo", {
        name: c.name,
        qid: who.qid,
      });
      return undefined;
    }
    const meta = await commonsFile(who.image, fetchFn);
    if (!meta) return undefined;
    const ok = portraitAllowed(meta);
    if (!ok.ok) {
      log("info", "person inset: photo refused", {
        name: c.name,
        file: who.image,
        why: ok.why,
      });
      return undefined;
    }
    const res = await fetchFn(meta.url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return undefined;
    await fs.mkdir(path.join(dir, "assets"), { recursive: true });
    const raw = path.join(dir, "assets", `person_inset_${slot}_src.jpg`);
    await fs.writeFile(raw, Buffer.from(await res.arrayBuffer()));
    const face = (await deps.faces?.(raw).catch(() => []))?.sort(
      (a, b) => b.w * b.h - a.w * a.h,
    )[0];
    // The rendition Commons sends can differ from the size it reports: the file itself decides.
    const probed = await run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", raw]);
    const [pw, ph] = probed.stdout.trim().split(",").map(Number);
    if (!pw || !ph || Math.min(pw, ph) < 240) return undefined;
    const sq = faceSquare(pw, ph, face);
    const file = path.join("assets", `person_inset_${slot}.jpg`);
    await run(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-i",
      raw,
      "-vf",
      `crop=${sq.size}:${sq.size}:${sq.x}:${sq.y},scale=480:480:flags=lanczos`,
      "-q:v",
      "3",
      path.join(dir, file),
    ]);
    await fs.rm(raw, { force: true });
    return {
      name: c.name,
      qid: who.qid,
      file,
      artist: meta.artist,
      license: meta.license,
      pageUrl: meta.pageUrl,
      credit: insetCredit(meta.artist, meta.license),
    };
  } catch (err) {
    log("warn", "person inset failed", {
      name: c.name,
      error: errorMessage(err),
    });
    return undefined;
  }
}

// ---- The tracklist -----------------------------------------------------------------------------------------

/** What the tracklist finder reads from a script. */
export interface TrackScript extends PeopleScript {
  headline?: string;
  claims?: Array<{ claim: string }>;
  tracklist?: Array<{ artist: string; title?: string }>;
}

const titleCase = (t: string) => {
  const ws = t.trim().split(/\s+/);
  return (
    ws.length >= 1 &&
    ws.length <= 7 &&
    /^[A-Z0-9"“]/.test(ws[0]!) &&
    ws.every(
      (w, k) =>
        k === 0 ||
        /^[A-Z0-9("“]/.test(w) ||
        /^(a|an|the|of|in|on|at|to|for|and|or|from|with|by|my|your|me|is)$/.test(
          w,
        ),
    )
  );
};
const splitList = (t: string) =>
  t
    .split(/,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/)
    .map((x) =>
      x
        .trim()
        .replace(/^["“]|["”]$/g, "")
        .replace(/[.;:]+$/, ""),
    )
    .filter(Boolean);

/**
 * The songs a soundtrack story names (pure): the writer's `tracklist` when given; otherwise from the script's own
 * claims and lines, which the fact check has passed: quoted titles with their artist ("Starting from Zero" by Justice,
 * Justice's "Flower in a Hurricane"), titles listed after an artist's songs or collaborations ("two Justice
 * collaborations, Starting from Zero and Flower in a Hurricane"), and artists listed on the album with no song named
 * yet ("the listing includes Dua Lipa, Blackpink's Jennie and Lana Del Rey"). At most MAX_TRACKS, titled songs first.
 */
export function tracksFromScript(s: TrackScript): Track[] {
  const clean = (t: Track): Track | undefined => {
    const artist = t.artist.replace(/^[^']*'s\s+(?=[A-Z])/, "").trim();
    const title = t.title?.trim().replace(/^["“]|["”]$/g, "");
    return artist ? { artist, ...(title ? { title } : {}) } : undefined;
  };
  if (s.tracklist?.length)
    return s.tracklist
      .map(clean)
      .filter((t): t is Track => !!t)
      .slice(0, MAX_TRACKS);
  const texts = [
    ...(s.claims ?? []).map((c) => c.claim),
    ...s.beats.map((b) => b.narration),
  ];
  const titled: Track[] = [];
  const artistsOnly: string[] = [];
  const name =
    "([A-Z][\\p{L}'’.&-]*(?:\\s+(?:(?:del|de|van|von|da|la)\\s+)?[A-Z][\\p{L}'’.&-]*){0,3})";
  for (const t of texts) {
    for (const m of t.matchAll(
      new RegExp(`["“]([^"”]{2,60})["”]\\s+by\\s+${name}`, "gu"),
    ))
      titled.push({ artist: m[2]!, title: m[1]! });
    for (const m of t.matchAll(
      new RegExp(`${name}[’']s\\s+["“]([^"”]{2,60})["”]`, "gu"),
    ))
      titled.push({ artist: m[1]!, title: m[2]! });
    for (const m of t.matchAll(
      new RegExp(
        `${name}\\s+(?:collaborations?|songs?|tracks?|singles?)\\s*(?:,|:|called|titled|named)\\s*([^.;]+)`,
        "gu",
      ),
    )) {
      const artist = m[1]!
        .split(/\s+/)
        .filter((w) => !/^(two|three|four|five|new|the|a|an)$/i.test(w))
        .join(" ");
      for (const title of splitList(m[2]!))
        if (titleCase(title)) titled.push({ artist, title });
    }
    if (/\b(album|listing|tracklist|track ?list|soundtrack|vinyl)\b/i.test(t))
      for (const m of t.matchAll(
        /\b(?:includes?|including|lists?|features?|featuring|with)\s+(?=[A-Z])([^.;]+)/g,
      )) {
        const items = splitList(
          m[1]!.replace(/\b(?:reportedly|on the [\w\s]+|among others).*$/i, ""),
        );
        if (items.length < 2) continue;
        for (const it of items) {
          const a = it.replace(/^[A-Z][\p{L}]*[’']s\s+(?=[A-Z])/u, "");
          if (
            titleCase(a) &&
            a.split(/\s+/).length <= 4 &&
            !/\b(songs?|tracks?|collaborations?|album)\b/i.test(a)
          )
            artistsOnly.push(a);
        }
      }
  }
  const out: Track[] = [];
  const key = (t: Track) =>
    `${t.artist.toLowerCase()}|${(t.title ?? "").toLowerCase()}`;
  for (const t of titled.map(clean).filter((x): x is Track => !!x))
    if (!out.some((o) => key(o) === key(t))) out.push(t);
  for (const a of artistsOnly)
    if (!out.some((o) => o.artist.toLowerCase() === a.toLowerCase()))
      out.push({ artist: a });
  return out.slice(0, MAX_TRACKS);
}
