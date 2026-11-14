// Readers for the two feeds the community Discord follows: the channel's YouTube uploads and the
// pulsegmg.com news RSS (every story there has been checked and has its sources).

export interface FeedVideo {
  id: string;
  title: string;
  published: string;
}

export interface FeedStory {
  guid: string;
  title: string;
  link: string;
  published: string;
  summary: string;
  image?: string;
  videoId?: string;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const tag = (xml: string, name: string) =>
  xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1];

/** Newest first, as YouTube serves them. */
export function parseYouTubeFeed(xml: string): FeedVideo[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(([, e]) => {
    const id = tag(e!, "yt:videoId");
    const title = tag(e!, "title");
    return id && title
      ? [{ id, title: decode(title), published: tag(e!, "published") ?? "" }]
      : [];
  });
}

/** Strips tags and keeps the opening paragraph (or two, if the first is only a picture). */
function summaryOf(html: string): string {
  const paras = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map(([, p]) => decode(p!.replace(/<[^>]+>/g, "")).trim())
    .filter(Boolean);
  const text = paras.slice(0, 2).join("\n\n");
  return text.length > 600
    ? `${text.slice(0, 597).replace(/\s+\S*$/, "")}…`
    : text;
}

export function parseNewsRss(xml: string): FeedStory[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, it]) => {
    const title = tag(it!, "title");
    const link = tag(it!, "link");
    if (!title || !link) return [];
    const body = decode(tag(it!, "description") ?? "");
    const image = body.match(/<img[^>]+src="([^"]+)"/)?.[1];
    const videoId = body.match(/youtube\.com\/watch\?v=([\w-]{11})/)?.[1];
    return [
      {
        guid: tag(it!, "guid") ?? link,
        title: decode(title),
        link: decode(link),
        published: tag(it!, "pubDate") ?? "",
        summary: summaryOf(body),
        ...(image ? { image } : {}),
        ...(videoId ? { videoId } : {}),
      },
    ];
  });
}

/** Items not seen before, oldest first so they post in order. The first run only remembers. */
export function fresh<T>(
  items: T[],
  key: (t: T) => string,
  seen: string[] | undefined,
): { post: T[]; seen: string[] } {
  const keys = items.map(key);
  if (!seen) return { post: [], seen: keys.slice(0, 100) };
  const known = new Set(seen);
  const post = items.filter((t) => !known.has(key(t))).reverse();
  return { post, seen: [...new Set([...keys, ...seen])].slice(0, 200) };
}
