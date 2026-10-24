// Amazon affiliate links for what a video talks about: every game it names
// (each ranking entry, each Release Radar game, the news story's game) and any
// hardware it mentions (consoles, handhelds, controllers). Search links, so
// they always resolve to current listings and every edition, tagged with the
// channel's Associates IDs. The disclosure line Amazon requires goes with them.

import type { Script } from "./schema.ts";

export type Store = "us" | "uk" | "ca" | "de" | "fr" | "it" | "es" | "au";

/** Amazon's national stores the channel has Associates IDs for, US first. */
export const STORES: Record<Store, { host: string; name: string }> = {
  us: { host: "www.amazon.com", name: "US" },
  uk: { host: "www.amazon.co.uk", name: "UK" },
  ca: { host: "www.amazon.ca", name: "Canada" },
  au: { host: "www.amazon.com.au", name: "Australia" },
  de: { host: "www.amazon.de", name: "Germany" },
  fr: { host: "www.amazon.fr", name: "France" },
  it: { host: "www.amazon.it", name: "Italy" },
  es: { host: "www.amazon.es", name: "Spain" },
};

export interface AffiliateTags {
  uk: string; // amazon.co.uk tracking ID, e.g. orryy0d-21
  us?: string; // amazon.com tracking ID, when the owner has one
  ca?: string;
  de?: string;
  fr?: string;
  it?: string;
  es?: string;
  au?: string;
  /** The video's own shop page (every store, picked by the viewer's country). */
  shopUrl?: string;
}

/** Which store serves a viewer, from their two-letter country code. Amazon.de, .fr, .it and .es ship across their neighbours. */
export function storeFor(country: string | undefined): Store {
  const c = (country ?? "").toUpperCase();
  if (["GB", "IE", "IM", "JE", "GG"].includes(c)) return "uk";
  if (c === "CA") return "ca";
  if (["AU", "NZ"].includes(c)) return "au";
  if (["DE", "AT", "CH", "LU", "LI", "NL", "PL", "CZ", "DK", "SE", "NO", "FI"].includes(c)) return "de";
  if (["FR", "BE", "MC"].includes(c)) return "fr";
  if (["IT", "SM", "VA", "MT"].includes(c)) return "it";
  if (["ES", "PT", "AD"].includes(c)) return "es";
  return "us";
}

/** The stores with a tag, US first. */
export function taggedStores(tags: AffiliateTags | undefined): Store[] {
  if (!tags) return [];
  return (Object.keys(STORES) as Store[]).filter((k) => Boolean(tags[k]));
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

export function amazonUrl(query: string, tag: string, store: Store): string {
  const host = STORES[store].host;
  return `https://${host}/s?k=${encodeURIComponent(query).replace(/%20/g, "+")}&tag=${encodeURIComponent(tag)}`;
}

/** The description block: one line per product (US first when there is a US tag), then Amazon's disclosure. */
export function affiliateBlock(
  script: Script,
  tags: AffiliateTags | undefined,
  opts: { free?: boolean } = {},
): string {
  if (!tags?.uk && !tags?.us) return "";
  // Links in a Short's description are not clickable (YouTube, since August 2023): only clutter there.
  if (script.runtime !== "long") return "";
  const products = productsFor(script, opts.free);
  if (!products.length) return "";
  // Up to three direct links (US first: with Amazon OneLink switched on they route UK and EU shoppers to
  // their own store), then one link to the video's shop page, which lists every product with a button for
  // each country's store. No per-country pairs, so the block stays short.
  const home: Store = tags.us ? "us" : "uk";
  const lines = products.slice(0, 3).map((p) => `🛒 ${p.label} on Amazon: ${amazonUrl(p.query, tags[home]!, home)}`);
  const shop = tags.shopUrl
    ? `🌍 ${products.length > 3 ? `All ${products.length} games and gear` : "Every link"}, with your own country's Amazon store: ${tags.shopUrl}`
    : "";
  return [
    "\nAffiliate links (we may earn from purchases):",
    ...lines,
    shop,
    "As an Amazon Associate I earn from qualifying purchases.",
  ]
    .filter(Boolean)
    .join("\n");
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

const escHtml = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The shop page behind a video's "other countries" link: each product with a
 * big button for the viewer's own Amazon store and small links to the rest.
 */
export function shopPageHtml(opts: {
  title: string;
  products: AffiliateLink[];
  tags: AffiliateTags;
  country?: string;
}): string {
  const stores = taggedStores(opts.tags);
  const want = storeFor(opts.country);
  const home = stores.includes(want) ? want : stores[0];
  if (!home) return "<p>No shop links for this video.</p>";
  const rows = opts.products
    .map((p) => {
      const main = `<a class="buy" rel="sponsored nofollow" href="${escHtml(amazonUrl(p.query, opts.tags[home]!, home))}">Find it on Amazon ${escHtml(STORES[home].name)}</a>`;
      const rest = stores
        .filter((k) => k !== home)
        .map((k) => `<a rel="sponsored nofollow" href="${escHtml(amazonUrl(p.query, opts.tags[k]!, k))}">${escHtml(STORES[k].name)}</a>`)
        .join(" · ");
      return `<section><h2>${escHtml(p.label)}</h2>${main}<p class="more">Other stores: ${rest}</p></section>`;
    })
    .join("");
  return `<style>section{padding:18px 0;border-bottom:1px solid #222}h2{font-size:19px;margin:0 0 10px}.buy{display:inline-block;background:#ff6b1a;color:#0b0b0e;font-weight:800;padding:13px 20px;border-radius:10px;text-decoration:none}.more{font-size:14px;color:#a3a3a3;margin:10px 0 0}.more a{color:#d4d4d4}</style>
<h1>${escHtml(opts.title)}</h1><p>The games and gear from this Pulse Gaming News video.</p>${rows}
<p style="font-size:13px;color:#8a8a8a;margin-top:22px">As an Amazon Associate I earn from qualifying purchases.</p>`;
}
