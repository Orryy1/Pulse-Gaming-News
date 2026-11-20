// Which wiki files the art library keeps (pure, so every rule has a test). Only official art, in-game logos and
// signs, in-game screenshots, maps, box art and promotional renders: the file's name, its description page text
// (licence templates included), its categories and its extmetadata description are all read, and one sign of fan
// work anywhere rejects it. A file also needs a positive sign that it is the game's own material (a screenshot or
// fair-use licence template, a category of the game's images, or a name that says logo, artwork, cover, map and so
// on); a file with no sign either way is left out rather than guessed at.

export type ArtKind =
  | "logo"
  | "sign"
  | "boxart"
  | "artwork"
  | "render"
  | "map"
  | "screenshot"
  | "icon";

export interface FileFacts {
  /** "File:Artwork-JasonDuval-GTAVI.jpg" */
  title: string;
  mime: string;
  width: number;
  height: number;
  categories: string[];
  /** The file description page's wikitext (licence templates and {{Information}}). */
  wikitext: string;
  /** extmetadata ImageDescription, Credit, Artist and LicenseShortName, tags stripped. */
  description: string;
  licence: string;
}

export interface Verdict {
  keep: boolean;
  why: string;
  kind?: ArtKind;
  /** How sure we are it is the publisher's own: "official" art or "in-game" capture. */
  origin?: "official" | "in-game";
  /** A short credit/licence line for the index, as the wiki states it. */
  licence?: string;
}

const strip = (t: string) =>
  t
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Signs of fan work, edits, memes, cosplay, leaks, AI pictures or real-world photos. Any one rejects the file. */
export const FAN_SIGNS: Array<[RegExp, string]> = [
  [
    /\bfan[\s_-]?(art|made|render|edit|work|creation|concept|poster|cover|map|fic(tion)?|design|image|picture|logo|recreation|remake)s?\b/i,
    "fan work",
  ],
  [/\bfanart\b|\bfanmade\b|\bfanon\b|\bfan[\s_-]?game\b/i, "fan work"],
  [
    /\{\{\s*(fan|fanart|fanon|fan[\s_]?made|fan[\s_]?image|self|own[\s_]?work|user[\s_]?image|personal|userimage|ownwork)\s*[|}]/i,
    "fan or self-made licence template",
  ],
  [
    /\b(self|own)[\s_-]made\b|\bmade by me\b|\bmy own (work|edit|render|drawing)\b|\bi (made|drew|created|edited|rendered)\b/i,
    "uploader made it",
  ],
  [/\bcosplay(er|ing)?\b/i, "cosplay"],
  [/\bmemes?\b|\bshitpost\b|\bjoke image\b/i, "meme"],
  [
    /\b(photo)?shopped\b|\bphotoshop(ped)?\b|\bmock-?up\b|\bedited by\b|\bmanip(ulation)?\b|\bfan[\s_-]?edit\b/i,
    "edit",
  ],
  [
    /\bmodded\b|\bmod(ification)? by\b|\bnexus ?mods\b|\bgame mods?\b|\bmod screenshot\b|\btexture mod\b|\breshade\b|\bENB\b/i,
    "modded game",
  ],
  [/\bleak(ed|s)?\b|\bdevelopment build leak\b/i, "leaked material"],
  [
    /\b(ai[\s_-]generated|ai[\s_-]art|midjourney|stable[\s_-]?diffusion|dall-?e)\b/i,
    "AI-made picture",
  ],
  [
    /\b(real[\s_-]?(life|world)|\birl\b|photograph(ed)? (of|at|by)|real person|actor photo|voice actor)\b/i,
    "real-world photo",
  ],
  [
    /\bcustom[\s_-]?(render|image|art|edit)\b|\brecreation\b|\bremaster(ed)? by\b|\bupscaled? by\b/i,
    "fan remake",
  ],
  [
    /category:\s*(fan|user|personal|community|meme|cosplay|real[\s-]world|real[\s-]life|photographs|people|images? by)/i,
    "fan or real-world category",
  ],
  [/\{\{\s*watermark|category:\s*watermarked|\bwatermarked\b/i, "watermarked"],
  [
    /\bprintables?\b|\bpapercraft\b|\bcolou?ring (page|sheet)\b/i,
    "a printable craft sheet, not a picture for video",
  ],
  [
    /\b(placeholder|no[\s_-]?image|image[\s_-]?needed|missing[\s_-]?image|invisible ?hero ?image|site[\s_-]?logo|wiki[\s_-]?(logo|wordmark|icon)|favicon|discord|twitter[\s_-]?icon|socialmedia)\b/i,
    "wiki furniture",
  ],
];

/** A source link to a publisher's or platform's own site: the strongest sign a picture is official. */
const OFFICIAL_SITE =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:nintendo|rockstargames|playstation|xbox|bethesda|capcom|capcom-games|square-enix|square-enix-games|bandainamco|bandainamcoent|fromsoftware|cdprojekt|cdprojektred|ubisoft|ea|activision|blizzard|sega|konami|bungie|minecraft|mojang|pokemon|larian|teamcherry|insomniacgames|santamonicastudio|naughtydog|bioware|sonicthehedgehog|store\.steampowered|steamcommunity)\.(?:com|net|co\.jp|jp|co\.uk|eu)\b/i;

/** The "type" a structured file template gives ({{FileInfo|type= Artwork}} on Zelda Wiki), as a kind (pure). */
export function templateKind(wikitext: string): ArtKind | undefined {
  const t =
    /\|\s*type\s*=\s*([^|\n}]+)/i.exec(wikitext)?.[1]?.trim().toLowerCase() ??
    "";
  if (!t) return undefined;
  if (/box ?art|cover|packaging/.test(t)) return "boxart";
  if (/logo/.test(t)) return "logo";
  if (/\bmap\b/.test(t)) return "map";
  if (/screenshot|screen ?cap/.test(t)) return "screenshot";
  if (/render|model/.test(t)) return "render";
  if (/sprite|icon/.test(t)) return "icon";
  if (/art/.test(t)) return "artwork";
  return undefined;
}

/** The game a structured file template ties the file to ({{FileInfo|game= OoT}}), if any (pure). */
export function templateGame(wikitext: string): string | undefined {
  return /\|\s*game\s*=\s*([^|\n}]+)/i.exec(wikitext)?.[1]?.trim() || undefined;
}

/** A positive sign that the file is the game's own material, with the origin it implies. */
const OFFICIAL_SIGNS: Array<[RegExp, "official" | "in-game"]> = [
  [
    /\{\{\s*[^}|]*\b(screenshot|screencap|ingame|in-game|game ?image|gameimage)\b/i,
    "in-game",
  ],
  [
    /\{\{\s*(fair ?use|fairuse|non-?free|copyright(ed)?|copyrighted ?(by|game)|official|promo(tional)?|artwork|cover ?art|boxart|logo|trademark|game ?cover|press)\b/i,
    "official",
  ],
  [
    /\b(official (art(work)?|render|screenshot|image|logo|map|poster|cover)|press (kit|release|image)|newswire|promotional (art|image|render|material)|key ?art|box ?art|cover art|packshot)\b/i,
    "official",
  ],
  [
    /\b(copyright|©|\(c\))\s*(\d{4}\s*)?(rockstar|take-?two|nintendo|game freak|the pokémon company|sony|microsoft|xbox|bethesda|zenimax|capcom|cd projekt|fromsoftware|bandai namco|square enix|ubisoft|activision|blizzard|electronic arts|\bea\b|sega|konami|bungie|343|valve|mojang|epic games|larian|team cherry|insomniac|santa monica|naughty dog|bioware|warner)/i,
    "official",
  ],
  [
    /category:\s*(images?|screenshots?|artwork|concept art|promotional|logos?|maps?|renders?|covers?|box ?art|posters?) (of|from|in|for)\b/i,
    "in-game",
  ],
  [
    /category:\s*[^|\]]*\b(screenshots?|artwork|promotional|logos?|box art|covers?|official)\b/i,
    "official",
  ],
  [/\|\s*licens(e|ing)\s*=\s*(copyright|fair ?use|non-?free)/i, "official"],
  [OFFICIAL_SITE, "official"],
];

/** The kind a file shows, from its name and categories (pure). */
export function kindOf(
  title: string,
  categories: string[],
): ArtKind | undefined {
  const name = title.replace(/^File:/i, "");
  const cats = categories.join(" ");
  const both = `${name} ${cats}`;
  if (
    /\b(map|minimap|atlas)\b|[-_]map[-_.]/i.test(name) ||
    /category:[^|]*\bmaps\b/i.test(cats)
  )
    return "map";
  if (
    /\b(logo|wordmark|emblem|insignia)s?\b|[-_]logo[-_.]|logo[-_]/i.test(
      name,
    ) ||
    /category:[^|]*\blogos?\b/i.test(cats)
  )
    return "logo";
  if (
    /\b(sign|signage|billboard|livery|decal|poster)s?\b|[-_](sign|billboard)[-_.]/i.test(
      name,
    )
  )
    return "sign";
  if (
    /\b(cover|box ?art|boxart|packshot|key ?art|keyart)\b|[-_](cover|boxart)[-_.]/i.test(
      both,
    )
  )
    return "boxart";
  if (
    /\b(artwork|concept ?art|official ?art|promo(tional)?|portrait|character ?art|wallpaper|key ?visual|illustration)\b|artwork[-_]|[-_]artwork/i.test(
      both,
    )
  )
    return "artwork";
  if (/\brenders?\b|[-_]render[-_.]/i.test(name)) return "render";
  if (/\b(icon|blip|emblem)s?\b|[-_]icon[-_.]/i.test(name)) return "icon";
  if (
    /\b(screenshot|screencap|in-?game|ingame|gameplay|trailer|cutscene|snapmatic|still)s?\b|[-_](front|rear|side|interior|exterior|view|overview)[-_.]/i.test(
      both,
    )
  )
    return "screenshot";
  return undefined;
}

const PICTURE_MIME = /^image\/(jpeg|png|webp|gif|svg\+xml)$/i;

/** Keep or reject a wiki file (pure). */
export function classifyFile(f: FileFacts): Verdict {
  if (!PICTURE_MIME.test(f.mime))
    return { keep: false, why: `not a picture (${f.mime || "no type"})` };
  const text = [
    f.title,
    f.categories.map((c) => `[[${c}]]`).join(" "),
    f.wikitext,
    strip(f.description),
    f.licence,
  ].join("\n");
  for (const [re, why] of FAN_SIGNS)
    if (re.test(text)) return { keep: false, why };
  const kind = templateKind(f.wikitext) ?? kindOf(f.title, f.categories);
  const small =
    kind === "logo" || kind === "icon" || kind === "sign" ? 96 : 240;
  if (Math.max(f.width, f.height) < small)
    return { keep: false, why: `too small (${f.width}x${f.height})` };
  let origin: "official" | "in-game" | undefined;
  for (const [re, o] of OFFICIAL_SIGNS)
    if (re.test(text)) {
      origin = origin === "official" ? origin : o;
      if (origin === "official") break;
    }
  if (!origin && kind && kind !== "render")
    origin =
      kind === "screenshot" ||
      kind === "map" ||
      kind === "icon" ||
      kind === "sign"
        ? "in-game"
        : "official";
  if (!origin)
    return {
      keep: false,
      why: "no sign it is official art or an in-game picture",
    };
  // A "render" or model is kept only when the file says it is the publisher's own (a link to the publisher's site,
  // "official render", a press kit): renders posed from ripped models by fans are common on wikis.
  if (
    kind === "render" &&
    !OFFICIAL_SITE.test(f.wikitext) &&
    !OFFICIAL_SIGNS.slice(2, 4).some(([re]) => re.test(text))
  )
    return {
      keep: false,
      why: "a render or model with no sign it is the publisher's own",
    };
  return {
    keep: true,
    why: "ok",
    kind: kind ?? (origin === "in-game" ? "screenshot" : "artwork"),
    origin,
    licence: licenceLine(f),
  };
}

/** The licence or copyright line as the wiki gives it, kept short for the credits (pure). */
export function licenceLine(
  f: Pick<FileFacts, "wikitext" | "licence" | "description">,
): string {
  if (f.licence) return strip(f.licence).slice(0, 120);
  const field = /\|\s*licens(?:e|ing)\s*=\s*([^|\n}]+)/i
    .exec(f.wikitext)?.[1]
    ?.trim();
  if (field)
    return `filed on the wiki as: ${field} (the publisher's copyright)`.slice(
      0,
      120,
    );
  const tpl =
    /==\s*licen[cs]ing\s*==\s*\{\{\s*([^}|]+)/i.exec(f.wikitext) ??
    /\{\{\s*((?:fair ?use|fairuse|copyright|screenshot|[^}|]*screenshot)[^}|]*)/i.exec(
      f.wikitext,
    );
  if (tpl) return `licence template: ${tpl[1]!.trim()}`.slice(0, 120);
  return "copyright of the game's publisher; shown as fair-use reference art";
}
