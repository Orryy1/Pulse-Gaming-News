/**
 * Which episodes /admin/retry?rewrite=1 writes again from their stored topic (src/server.ts). Pure, so it is tested
 * without a server or a database.
 *
 * A failed episode that never reached the voice was always allowed (20 Nov 2026: the weekly explainer after a
 * spoiler fix). From 25 Nov 2026 a rejected long video is too, voiced or not, so one rejected by hand for a fault
 * since fixed is written again under the new rules: "The Fall and Return of Cyberpunk 2077" was rejected for 18 lines
 * its fact check disputed, before DOC_FACT_DISCIPLINE. Its script, voice and every upload and approval field go; the
 * stored topic (factcheck_json) stays. Never a rejected Short (rumours, thin sources, twins and rehearsals are
 * rejected on purpose), and never one that reached YouTube: that one is the owner's to handle.
 */
export interface RetryCandidate {
  status: string;
  lane: string;
  assets_json: { audio?: unknown } | null;
  youtube_video_id: string | null;
}

export function rewriteRetry(
  ep: RetryCandidate,
): { ok: true; clearAssets: boolean } | { ok: false; why: string } {
  if (ep.status === "failed" && !ep.assets_json?.audio)
    return { ok: true, clearAssets: false };
  if (ep.status === "rejected") {
    if (ep.lane !== "longform")
      return {
        ok: false,
        why: "only a rejected long video is written again; a rejected Short was rejected on purpose",
      };
    if (ep.youtube_video_id)
      return {
        ok: false,
        why: "a rejected episode that reached YouTube is not rewritten",
      };
    return { ok: true, clearAssets: true };
  }
  return {
    ok: false,
    why: "only a failed episode that never reached the voice, or a rejected long video, is written again",
  };
}

/** The columns a rewritten rejected episode starts afresh: its script, voice, approval and any upload state. */
export const REWRITE_CLEARED_COLUMNS = [
  "script_json",
  "assets_json",
  "qa_json",
  "approved_by",
  "approval_mode",
  "approval_requested_at",
  "upload_session_uri",
  "publish_at",
  "youtube_status",
] as const;
