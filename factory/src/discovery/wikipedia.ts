// Research for the documentary lane: a game's English Wikipedia article as
// plain text, cut to the sections a history needs (development, release,
// reception, legacy). The writer may use only these facts, and the video's
// description credits the articles it drew on.

const API = "https://en.wikipedia.org/w/api.php";
const UA =
  "PulseGamingFactory/1.0 (https://pulse.orryy.com; documentary research)";

/** Sections worth reading for a history, most useful first. */
const WANT = [
  /development|production|history|conception|design|background/i,
  /release|marketing|launch|promotion/i,
  /reception|sales|critical|response/i,
  /legacy|impact|influence|remaster|re-?release|port|post-?release|aftermath|shutdown|closure|cancel|revival|reboot/i,
  /controvers|legal|lawsuit|censorship|rating/i,
  /plot|setting|synopsis|premise|gameplay/i,
];
const SKIP =
  /^(see also|notes|references|external links|further reading|bibliography|citations|sources|footnotes)$/i;

export interface WikiSection {
  title: string;
  text: string;
}

/** Splits a plain-text extract ("== Development ==" headings) into its lead and sections. */
export function splitSections(extract: string): WikiSection[] {
  const out: WikiSection[] = [];
  let title = "Lead";
  let buf: string[] = [];
  const flush = () => {
    const text = buf
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text) out.push({ title, text });
    buf = [];
  };
  for (const line of extract.split("\n")) {
    const h = line.match(/^\s*(={2,})\s*(.+?)\s*\1\s*$/);
    if (h) {
      flush();
      title = h[2]!;
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

/** The words of a chapter's focus worth searching a section for. */
export function focusTerms(focus: string): string[] {
  const common =
    /^(with|from|that|this|their|them|they|then|than|when|what|which|while|about|after|before|into|over|under|have|been|were|will|would|chapter|game|games)$/;
  return [
    ...new Set(
      focus
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .map((w) => w.replace(/(?:'s|s)$/, ""))
        .filter((w) => w.length >= 4 && !common.test(w)),
    ),
  ];
}

/**
 * Shares a budget between sections: each takes up to an even share, and what a short one leaves goes to the next
 * in order. Until 4 Nov 2026 the first section took all it wanted; on a story's main article that was Development,
 * so nothing a chapter about the release or the ending needed was ever in its brief (Final Fantasy XIV, 7,000 of
 * the 9,000 characters, with the billing and the finale further down the article) and the writer wrote that instead.
 */
export function shareBudget(lengths: number[], budget: number): number[] {
  const out = lengths.map(() => 0);
  let left = Math.max(0, budget);
  let open = lengths.map((_, i) => i);
  while (left > 0 && open.length) {
    const even = Math.floor(left / open.length);
    if (even <= 0) break;
    const next: number[] = [];
    for (const i of open) {
      const take = Math.min(lengths[i]! - out[i]!, even);
      out[i]! += take;
      left -= take;
      if (out[i]! < lengths[i]!) next.push(i);
    }
    if (next.length === open.length) break;
    open = next;
  }
  return out;
}

/**
 * The lead plus the most useful sections, within a character budget. With a focus (what a chapter is about), the
 * sections that mention it come first and are kept whole where they fit, whatever they are called.
 */
export function pickSections(
  extract: string,
  maxChars = 9000,
  focus?: string,
): string {
  const sections = splitSections(extract).filter((s) => !SKIP.test(s.title));
  const lead = sections.find((s) => s.title === "Lead");
  const terms = focus ? focusTerms(focus) : [];
  const scored = sections
    .filter((s) => s.title !== "Lead")
    .map((s, i) => {
      const at = WANT.findIndex((re) => re.test(s.title));
      const lower = `${s.title} ${s.text}`.toLowerCase();
      const hits = terms.filter((t) => lower.includes(t)).length;
      return { s, score: at < 0 ? WANT.length : at, i, hits };
    })
    .filter((x) => x.score < WANT.length || x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.score - b.score || a.i - b.i);
  const parts: string[] = [];
  let used = 0;
  const add = (title: string, text: string) => {
    const room = maxChars - used;
    if (room < Math.min(200, text.length)) return;
    const t =
      text.length > room
        ? `${text.slice(0, room).replace(/\s+\S*$/, "")} …`
        : text;
    parts.push(`## ${title}\n${t}`);
    used += t.length + title.length + 4;
  };
  // The overview gets at most 30% of a short brief, so development, sales and reception still fit.
  if (lead) add("Overview", lead.text.slice(0, Math.min(2500, Math.round(maxChars * 0.3))));
  // What it's about first and whole; the rest share what is left, so a long section can't push out all the others.
  const about = scored.filter((x) => x.hits > 0).slice(0, 3);
  for (const { s } of about) add(s.title, s.text);
  const rest = scored.filter((x) => !about.includes(x));
  const room = Math.max(0, maxChars - used);
  // Headings and the join count against the budget too.
  const shares = shareBudget(
    rest.map(({ s }) => s.text.length),
    Math.max(0, room - rest.reduce((n, { s }) => n + s.title.length + 6, 0)),
  );
  rest.forEach(({ s }, i) => {
    const share = shares[i]!;
    if (share < Math.min(200, s.text.length)) return;
    add(
      s.title,
      share >= s.text.length
        ? s.text
        : `${s.text.slice(0, share).replace(/\s+\S*$/, "")} …`,
    );
  });
  return parts.join("\n\n");
}

export interface WikiArticle {
  title: string;
  url: string;
  text: string; // the picked sections
  /** Other articles merged into the text (a chapter short of evidence), for the video's credits. */
  also?: string[];
}

/** One brief out of several articles, the first keeping its name; each comes under its own heading. */
export function mergeArticles(articles: WikiArticle[]): WikiArticle | undefined {
  const seen = new Set<string>();
  const unique = articles.filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
  const first = unique[0];
  if (!first) return undefined;
  if (unique.length === 1) return first;
  return {
    title: first.title,
    url: first.url,
    text: unique.map((a) => `# From "${a.title}"\n${a.text}`).join("\n\n"),
    also: unique.slice(1).map((a) => a.url),
  };
}

type FetchLike = typeof fetch;

/** The article's picked sections, following redirects; undefined when there is no such article. */
export async function fetchWikiArticle(
  title: string,
  maxChars = 9000,
  fetchFn: FetchLike = fetch,
  focus?: string,
): Promise<WikiArticle | undefined> {
  const q = new URLSearchParams({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    exsectionformat: "wiki",
    redirects: "1",
    format: "json",
    formatversion: "2",
    titles: title,
  });
  const res = await fetchFn(`${API}?${q}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return undefined;
  const page = ((await res.json()) as any)?.query?.pages?.[0];
  if (!page || page.missing || !page.extract) return undefined;
  const text = pickSections(String(page.extract), maxChars, focus);
  if (text.length < 400) return undefined;
  return {
    title: page.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(page.title).replace(/ /g, "_"))}`,
    text,
  };
}

/** The best-matching article title for a search, for when the writer's guess at a title misses. */
export async function searchWikiTitle(
  query: string,
  fetchFn: FetchLike = fetch,
): Promise<string | undefined> {
  const q = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "1",
    format: "json",
    formatversion: "2",
  });
  const res = await fetchFn(`${API}?${q}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return undefined;
  return ((await res.json()) as any)?.query?.search?.[0]?.title;
}

/** Fetch by the given title, else by search. */
export async function researchGame(
  title: string,
  fallbackQuery: string,
  maxChars = 9000,
  fetchFn: FetchLike = fetch,
  focus?: string,
): Promise<WikiArticle | undefined> {
  const direct = await fetchWikiArticle(title, maxChars, fetchFn, focus).catch(
    () => undefined,
  );
  if (direct) return direct;
  const found = await searchWikiTitle(fallbackQuery, fetchFn).catch(
    () => undefined,
  );
  return found
    ? fetchWikiArticle(found, maxChars, fetchFn, focus).catch(() => undefined)
    : undefined;
}
