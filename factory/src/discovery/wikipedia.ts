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
  /legacy|impact|influence|remaster|re-?release|port/i,
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

/** The lead plus the most useful sections, within a character budget. */
export function pickSections(extract: string, maxChars = 9000): string {
  const sections = splitSections(extract).filter((s) => !SKIP.test(s.title));
  const lead = sections.find((s) => s.title === "Lead");
  const scored = sections
    .filter((s) => s.title !== "Lead")
    .map((s, i) => {
      const at = WANT.findIndex((re) => re.test(s.title));
      return { s, score: at < 0 ? WANT.length : at, i };
    })
    .filter((x) => x.score < WANT.length)
    .sort((a, b) => a.score - b.score || a.i - b.i);
  const parts: string[] = [];
  let used = 0;
  const add = (title: string, text: string) => {
    const room = maxChars - used;
    if (room < 200) return;
    const t =
      text.length > room
        ? `${text.slice(0, room).replace(/\s+\S*$/, "")} …`
        : text;
    parts.push(`## ${title}\n${t}`);
    used += t.length + title.length + 4;
  };
  if (lead) add("Overview", lead.text.slice(0, 2500));
  for (const { s } of scored) add(s.title, s.text);
  return parts.join("\n\n");
}

export interface WikiArticle {
  title: string;
  url: string;
  text: string; // the picked sections
}

type FetchLike = typeof fetch;

/** The article's picked sections, following redirects; undefined when there is no such article. */
export async function fetchWikiArticle(
  title: string,
  maxChars = 9000,
  fetchFn: FetchLike = fetch,
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
  const text = pickSections(String(page.extract), maxChars);
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
): Promise<WikiArticle | undefined> {
  const direct = await fetchWikiArticle(title, maxChars, fetchFn).catch(
    () => undefined,
  );
  if (direct) return direct;
  const found = await searchWikiTitle(fallbackQuery, fetchFn).catch(
    () => undefined,
  );
  return found
    ? fetchWikiArticle(found, maxChars, fetchFn).catch(() => undefined)
    : undefined;
}
