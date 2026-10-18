// Amazon affiliate links for what a video talks about: every game it names
// (each ranking entry, each Release Radar game, the news story's game) and any
// hardware it mentions (consoles, handhelds, controllers). Search links, so
// they always resolve to current listings and every edition, tagged with the
// channel's Associates IDs. The disclosure line Amazon requires goes with them.

import type { Script } from "./schema.ts";

export interface AffiliateTags {
  uk: string; // amazon.co.uk tracking ID, e.g. orryy0d-21
  us?: string; // amazon.com tracking ID, when the owner has one
}

export interface AffiliateLink {
  label: string;
  query: string;
}

/** Hardware worth linking when a video names it, most specific first. */
const HARDWARE: Array<[RegExp, string, string]> = [
  [/\bps5 pro\b|playstation 5 pro/i, "PS5 Pro", "PlayStation 5 Pro console"],
  [
    /\bps portal\b|playstation portal/i,
    "PlayStation Portal",
    "PlayStation Portal remote player",
  ],
  [/\bdualsense edge\b/i, "DualSense Edge", "DualSense Edge controller"],
  [/\bdualsense\b/i, "DualSense controller", "DualSense wireless controller"],
  [/\bps5\b|playstation 5\b/i, "PS5", "PlayStation 5 console"],
  [/\bswitch 2\b/i, "Nintendo Switch 2", "Nintendo Switch 2 console"],
  [/\bxbox series x\b/i, "Xbox Series X", "Xbox Series X console"],
  [/\bxbox series s\b/i, "Xbox Series S", "Xbox Series S console"],
  [/\bsteam deck\b/i, "Steam Deck accessories", "Steam Deck accessories"],
  [/\brog ally\b/i, "ROG Ally", "ASUS ROG Ally"],
  [/\bmeta quest\b|\bquest 3\b/i, "Meta Quest 3", "Meta Quest 3"],
];

const CLEAN = (t: string) =>
  t
    .replace(/[®™©]/g, "")
    .replace(/\s*\((19|20)\d\d\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

/** The products a script talks about: its games first, then the hardware it names. */
export function productsFor(script: Script, free = false): AffiliateLink[] {
  const out: AffiliateLink[] = [];
  const seen = new Set<string>();
  const add = (label: string, query: string) => {
    const key = query.toLowerCase();
    if (!label || seen.has(key)) return;
    seen.add(key);
    out.push({ label, query });
  };
  // A free game is not sold; its links would be noise.
  if (!free) {
    if (script.entries?.length) {
      // Best first: number one leads the list.
      const achievements = /achievements$/.test(script.evergreen_format ?? "");
      for (const e of [...script.entries].sort((a, b) => a.rank - b.rank)) {
        // An achievement list sells the games the achievements belong to.
        const name = CLEAN(achievements ? e.steam_search_term || e.platforms : e.game_title);
        if (name) add(name, `${name} game`);
      }
    } else if (
      script.game_title &&
      !/^(new games|gaming news|this week)/i.test(script.game_title)
    ) {
      add(CLEAN(script.game_title), `${CLEAN(script.game_title)} game`);
    }
  }
  const text = [
    script.headline,
    script.hook,
    ...script.beats.map(
      (b) =>
        `${b.narration} ${b.visual.primary} ${(b.visual.items ?? []).join(" ")}`,
    ),
    script.pulse_take.narration,
  ].join(" ");
  // Most specific first, and a match is removed from the text so "PS5 Pro" does not also list "PS5".
  let rest = text;
  for (const [re, label, query] of HARDWARE) {
    if (!re.test(rest)) continue;
    add(label, query);
    rest = rest.replace(new RegExp(re.source, "gi"), " ");
  }
  return out.slice(0, 10);
}

export function amazonUrl(
  query: string,
  tag: string,
  store: "uk" | "us",
): string {
  const host = store === "uk" ? "www.amazon.co.uk" : "www.amazon.com";
  return `https://${host}/s?k=${encodeURIComponent(query).replace(/%20/g, "+")}&tag=${encodeURIComponent(tag)}`;
}

/** The description block: one line per product (US first when there is a US tag), then Amazon's disclosure. */
export function affiliateBlock(
  script: Script,
  tags: AffiliateTags | undefined,
  opts: { free?: boolean } = {},
): string {
  if (!tags?.uk && !tags?.us) return "";
  const products = productsFor(script, opts.free);
  if (!products.length) return "";
  const lines = products.map((p) => {
    const links = [
      tags.us ? `US ${amazonUrl(p.query, tags.us, "us")}` : "",
      tags.uk
        ? `${tags.us ? "UK " : ""}${amazonUrl(p.query, tags.uk, "uk")}`
        : "",
    ].filter(Boolean);
    return `🛒 ${p.label}: ${links.join(" | ")}`;
  });
  return [
    "\nGet the games and gear in this video:",
    ...lines,
    "As an Amazon Associate I earn from qualifying purchases.",
  ].join("\n");
}

/** The pinned comment line for a long video, where comment links are clickable. */
export function affiliateCommentLine(
  script: Script,
  tags: AffiliateTags | undefined,
): string {
  if (!tags?.uk && !tags?.us) return "";
  const top = productsFor(script)[0];
  if (!top) return "";
  const url = tags.us
    ? amazonUrl(top.query, tags.us, "us")
    : amazonUrl(top.query, tags.uk, "uk");
  return ` Grab ${top.label} here: ${url} (affiliate link)`;
}
