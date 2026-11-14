// The copyright gate for videos whose game sound had its radio music removed (COPYRIGHT_CHECK_GATE, on whenever
// RADIO_STRIP is; src/assets/radiostrip.ts). Separation is never perfect and a faint leftover of a song can still
// match Content ID, so such a video never goes public on a timer:
//   1. it uploads PRIVATE with no publish time (stepUpload, holdForCopyright), and the hold is logged;
//   2. every tick this looks at it through the Data API. What the API can show is checked: a rejected upload
//      (rejectionReason claim, copyright or trademark) or countries blocked (a claim's block policy) means a
//      claim, and the video stays private for good;
//   3. what the API cannot show is the claims themselves: Studio's Checks (copyright and ad suitability) are not in
//      the Data API for a channel outside Content ID. So once YouTube has processed the video, the release gate
//      asks the owner, once, to look at Checks in Studio, with a signed "Checks are clean" link. Only that tap
//      schedules it public (src/server.ts /episodes/:id/copyright-clear).
import { signToken } from "../lib/crypto.ts";
import type { Db } from "../db.ts";
import type { DiscordMessage } from "../approval/discord.ts";
import { getEpisode, logEvent, type Episode } from "../episodes.ts";
import { isRadioFree } from "../assets/radiostrip.ts";
import { errorMessage, log } from "../lib/util.ts";

/** Whether a video used radio-stripped sound anywhere (pure): its clips, or the gameplay lane's own clip. */
export function copyrightCheckNeeded(
  ep: Pick<Episode, "assets_json" | "script_json">,
): boolean {
  if (ep.script_json?.gameplay?.radio_stripped) return true;
  return (ep.assets_json?.clips ?? []).some(
    (c) =>
      c.radioStripped === true ||
      isRadioFree(c.sourceUrl) ||
      isRadioFree(c.provenance),
  );
}

export interface CopyrightProbe {
  uploadStatus: string;
  privacyStatus: string;
  rejectionReason?: string;
  processingStatus?: string;
  regionBlocked: string[];
  licensedContent?: boolean;
}

export type CopyrightDecision =
  | { kind: "claimed"; why: string }
  | { kind: "pending"; why: string }
  | { kind: "owner_check"; why: string };

/** What the probe means (pure). The API never shows a claim that only tracks or monetises, so clean is never decided here. */
export function copyrightDecision(
  p: CopyrightProbe | undefined,
): CopyrightDecision {
  if (!p) return { kind: "pending", why: "video not found yet" };
  if (p.uploadStatus === "rejected" || p.uploadStatus === "failed")
    return CLAIM_REASON.test(p.rejectionReason ?? "")
      ? { kind: "claimed", why: `YouTube rejected it: ${p.rejectionReason}` }
      : {
          kind: "claimed",
          why: `YouTube ${p.uploadStatus} it: ${p.rejectionReason ?? "no reason given"}`,
        };
  if (p.regionBlocked.length)
    return {
      kind: "claimed",
      why: `blocked in ${p.regionBlocked.length} countries (a claim's block policy)`,
    };
  if (
    p.uploadStatus !== "processed" ||
    (p.processingStatus && p.processingStatus !== "succeeded")
  )
    return {
      kind: "pending",
      why: `still processing (${p.uploadStatus}${p.processingStatus ? `, ${p.processingStatus}` : ""})`,
    };
  return {
    kind: "owner_check",
    why: "processed; claims are only visible in Studio's Checks",
  };
}
const CLAIM_REASON = /claim|copyright|trademark|duplicate/i;

/** When a released video goes public (pure): its planned slot, or 20 minutes from now if that has passed. */
export function releaseTime(
  planned: string | null | undefined,
  now: Date,
  leadMinutes = 20,
): Date {
  const soonest = new Date(now.getTime() + leadMinutes * 60_000);
  const p = planned ? new Date(planned) : undefined;
  return p && p > soonest ? p : soonest;
}

/** The owner's "Checks are clean" link (signed, a week). */
export function copyrightClearLink(
  cfg: { publicUrl: string; appSecret: string },
  id: string,
): string {
  return `${cfg.publicUrl}/episodes/${id}/copyright-clear?t=${signToken(`copyright:${id}:clear`, cfg.appSecret, 7 * 24 * 3600)}`;
}

export interface CopyrightYouTube {
  copyrightProbe(videoId: string): Promise<CopyrightProbe | undefined>;
  schedulePublish(videoId: string, publishAt: Date): Promise<void>;
}

export interface CopyrightDeps {
  db: Db;
  cfg: { publicUrl: string; appSecret: string };
  youtube(account: string): CopyrightYouTube;
  notify(msg: DiscordMessage): Promise<unknown>;
  now(): Date;
}

/** The held videos still waiting for a decision. */
async function held(
  db: Db,
): Promise<
  Array<{
    id: string;
    video: string;
    title: string | null;
    account: string;
    asked: boolean;
  }>
> {
  return db.query(
    `SELECT e.id, e.youtube_video_id AS video, e.script_json->'youtube'->>'title' AS title,
            COALESCE(e.story_json->'twin'->>'account', '') AS account,
            EXISTS (SELECT 1 FROM events a WHERE a.episode_id = e.id AND a.kind = 'copyright_asked') AS asked
       FROM episodes e
      WHERE e.youtube_video_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM events h WHERE h.episode_id = e.id AND h.kind = 'copyright_hold')
        AND NOT EXISTS (SELECT 1 FROM events d WHERE d.episode_id = e.id AND d.kind IN ('copyright_cleared','copyright_claimed'))`,
  );
}

/** One pass over the held videos: claims found, owners asked. Never throws. */
export async function copyrightChecks(d: CopyrightDeps): Promise<void> {
  let rows: Awaited<ReturnType<typeof held>>;
  try {
    rows = await held(d.db);
  } catch (err) {
    log("warn", "copyright gate: could not list held videos", {
      error: errorMessage(err),
    });
    return;
  }
  for (const r of rows) {
    try {
      const p = await d.youtube(r.account).copyrightProbe(r.video);
      const dec = copyrightDecision(p);
      if (dec.kind === "pending") continue;
      if (dec.kind === "claimed") {
        await logEvent(d.db, r.id, "copyright_claimed", {
          why: dec.why,
          probe: p,
        });
        await d.notify({
          ping: true,
          content: `🛑 "${r.title ?? r.id}" had its radio music removed, and YouTube still found a claim: ${dec.why}. It stays private. Nothing for you to do; delete it in Studio if you like: https://studio.youtube.com/video/${r.video}/edit`,
        });
        continue;
      }
      if (r.asked) continue;
      await logEvent(d.db, r.id, "copyright_asked", { probe: p });
      await d.notify({
        ping: true,
        content: [
          `🎵 "${r.title ?? r.id}" had its radio music removed, so it is uploaded PRIVATE until its copyright check is clean.`,
          `1. Open Checks in YouTube Studio: https://studio.youtube.com/video/${r.video}/edit`,
          `2. Copyright says "No issues found": tap ✅ [Checks are clean](${copyrightClearLink(d.cfg, r.id)}) and it goes out in its slot.`,
          `A copyright claim: do nothing. It stays private.`,
        ].join("\n"),
      });
    } catch (err) {
      log("warn", "copyright gate check failed", {
        episode: r.id,
        error: errorMessage(err),
      });
    }
  }
}

/**
 * The owner's tap: the held video is scheduled public at its slot (or 20 minutes on). Returns what happened, for
 * the page the tap opens. A claim already found is never released.
 */
export async function releaseHeldVideo(
  d: CopyrightDeps,
  id: string,
): Promise<{ ok: boolean; message: string; publishAt?: string }> {
  const ep = await getEpisode(d.db, id);
  if (!ep?.youtube_video_id)
    return { ok: false, message: "This episode has no uploaded video." };
  const events = await d.db.query<{ kind: string }>(
    `SELECT kind FROM events WHERE episode_id = $1 AND kind IN ('copyright_hold','copyright_cleared','copyright_claimed')`,
    [id],
  );
  const kinds = new Set(events.map((e) => e.kind));
  if (!kinds.has("copyright_hold"))
    return {
      ok: false,
      message: "This video is not waiting for a copyright check.",
    };
  if (kinds.has("copyright_claimed"))
    return {
      ok: false,
      message: "YouTube found a claim on this video, so it stays private.",
    };
  if (kinds.has("copyright_cleared"))
    return { ok: true, message: "Already released." };
  const yt = d.youtube(ep.story_json.twin?.account ?? "");
  // A last look first: a claim that blocked or rejected it since the owner opened Checks wins over the tap.
  const dec = copyrightDecision(await yt.copyrightProbe(ep.youtube_video_id));
  if (dec.kind === "claimed") {
    await logEvent(d.db, id, "copyright_claimed", { why: dec.why });
    return {
      ok: false,
      message: `YouTube found a claim (${dec.why}), so it stays private.`,
    };
  }
  const at = releaseTime(ep.publish_at, d.now());
  await yt.schedulePublish(ep.youtube_video_id, at);
  await d.db.query(`UPDATE episodes SET publish_at = $2 WHERE id = $1`, [
    id,
    at,
  ]);
  await logEvent(d.db, id, "copyright_cleared", {
    publish_at: at.toISOString(),
  });
  return {
    ok: true,
    message: `Released: it goes public at ${at.toISOString().slice(11, 16)} UTC.`,
    publishAt: at.toISOString(),
  };
}
