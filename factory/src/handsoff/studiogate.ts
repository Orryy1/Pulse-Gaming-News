// The work check for the Studio browser routines (25 Nov 2026). Related videos and hearts, A/B tests, premieres and
// community posts need Brave and judgement, so they stay Claude scheduled tasks; but most runs found nothing to do
// and still paid for a whole session with the browser tools loaded. Each routine's first step now runs
// src/tools/studio-gate.ts, which reads the same factory routine pages the routine would read and prints NONE (end
// the run in one line) or WORK. Pure decisions here; the page reads are in the tool.
//
// A list that never changes (an A/B test YouTube keeps refusing, say) would otherwise wake the routine twice a day
// for ever: after the same work has been seen three runs in a row, the gate lets it through once a day only.

export type RoutineKind = "related" | "abtest" | "premieres" | "community";

export interface GateMemo {
  lastKeys: string[];
  sameRuns: number;
  lastAllowedAt?: string;
  lastRunAt?: string;
}

export interface Verdict {
  work: boolean;
  keys: string[];
  why: string;
}

type J = Record<string, unknown>;
const arr = (x: unknown): J[] => (Array.isArray(x) ? (x as J[]) : []);

/** related: a related-video plan item, a heart or pin, or a video gone live since the last run (its own question
 *  may need pinning, part 3b) (pure). */
export function relatedWork(
  related: J | undefined,
  viewers: J | undefined,
  published: J[],
  lastRunAt: string | undefined,
  now: Date,
): Verdict {
  const items = related && related.ok !== false ? arr(related.items) : [];
  const hearts =
    viewers && viewers.enabled !== false ? arr(viewers.hearts) : [];
  const pins = viewers && viewers.enabled !== false ? arr(viewers.pins) : [];
  const since = lastRunAt
    ? Date.parse(lastRunAt)
    : now.getTime() - 12 * 3600_000;
  const fresh = published.filter((p) => {
    const t = Date.parse(String(p.live_at ?? ""));
    return (
      t > since && t <= now.getTime() && now.getTime() - t <= 3 * 86400_000
    );
  });
  const keys = [
    ...items.map((i) => `related:${String(i.short)}`),
    ...hearts.map((h) => `heart:${String(h.key)}`),
    ...pins.map((p) => `pin:${String(p.key ?? p.video)}`),
    ...fresh.map((p) => `live:${String(p.youtube_video_id ?? p.id)}`),
  ];
  return {
    work: keys.length > 0,
    keys,
    why: keys.length
      ? `${items.length} related, ${hearts.length} hearts, ${pins.length} pins, ${fresh.length} newly live`
      : `nothing to do${related?.ok === false ? ` (related plan: ${String(related.error ?? "unavailable")})` : ""}`,
  };
}

export function abtestWork(page: J | undefined): Verdict {
  const ready = arr(page?.tests).filter((t) => t.ready === true);
  return {
    work: ready.length > 0,
    keys: ready.map((t) => `abtest:${String(t.videoId)}`),
    why: ready.length
      ? `${ready.length} test(s) ready`
      : `no test ready (${arr(page?.tests).length} listed, none marked ready)`,
  };
}

export function premiereWork(page: J | undefined): Verdict {
  const toSet = arr(page?.toSet);
  return {
    work: toSet.length > 0,
    keys: toSet.map(
      (p) => `premiere:${String(p.videoId ?? p.episode ?? p.id)}`,
    ),
    why: toSet.length
      ? `${toSet.length} premiere(s) to set`
      : "no premieres waiting",
  };
}

/** community: today's post exists, is fresh (2 days at most), not done and its picture has reached this PC (pure). */
export function communityWork(page: J | undefined, now: Date): Verdict {
  const post = page?.post as J | null | undefined;
  const detail = (post?.detail ?? {}) as J;
  const day = String(detail.day ?? "");
  if (!post) return { work: false, keys: [], why: "no fresh post" };
  if (page?.done === true)
    return { work: false, keys: [], why: "already posted" };
  if (!day || now.getTime() - Date.parse(`${day}T12:00:00Z`) > 2.5 * 86400_000)
    return { work: false, keys: [], why: "no fresh post" };
  if (detail.image && page?.image_on_pc === false)
    return { work: false, keys: [], why: "picture not on this PC yet" };
  return {
    work: true,
    keys: [`community:${day}`],
    why: `post for ${day} waiting`,
  };
}

/** Holds back work that has not changed for three runs to one run a day (pure). */
export function throttle(
  v: Verdict,
  memo: GateMemo | undefined,
  now: Date,
): { verdict: Verdict; memo: GateMemo } {
  const iso = now.toISOString();
  if (!v.work)
    return {
      verdict: v,
      memo: {
        lastKeys: [],
        sameRuns: 0,
        lastAllowedAt: memo?.lastAllowedAt,
        lastRunAt: iso,
      },
    };
  const same =
    !!memo &&
    memo.lastKeys.length === v.keys.length &&
    v.keys.every((k) => memo.lastKeys.includes(k));
  const sameRuns = same ? memo!.sameRuns + 1 : 1;
  const lastAllowed = memo?.lastAllowedAt ? Date.parse(memo.lastAllowedAt) : 0;
  if (sameRuns > 3 && now.getTime() - lastAllowed < 20 * 3600_000)
    return {
      verdict: {
        work: false,
        keys: v.keys,
        why: `same work as the last ${sameRuns - 1} runs (${v.why}); tried today already`,
      },
      memo: {
        lastKeys: v.keys,
        sameRuns,
        lastAllowedAt: memo?.lastAllowedAt,
        lastRunAt: iso,
      },
    };
  return {
    verdict: v,
    memo: { lastKeys: v.keys, sameRuns, lastAllowedAt: iso, lastRunAt: iso },
  };
}
