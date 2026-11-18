// Instagram Trial Reels (IG_TRIAL_SHARE, research of 14 Nov 2026, section 4). A trial reel is shown to non-followers
// first; with graduation SS_PERFORMANCE Instagram shares it with followers only if it does well, so a weak Reel never
// reaches them. The Content Publishing API takes it as `trial_params` on the REELS container
// (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media). Which Reels
// are trials is fixed per episode (a hash of its id), so a retry never changes the arm and the two arms can be compared.
// An account Instagram has not enabled for trials gets the error back; the poster then posts the same Reel as an
// ordinary one and says so, rather than losing the post.

import { createHash } from "node:crypto";
import type { TrialGraduation } from "./settings.ts";

/** A number in [0, 1) from a key (pure, stable). */
export function unitOf(key: string): number {
  return createHash("sha1").update(key).digest().readUInt32BE(0) / 2 ** 32;
}

/** The trial arm for an episode (pure): its graduation strategy, or undefined for an ordinary Reel. */
export function trialFor(
  episodeId: string,
  share: number,
  graduation: TrialGraduation,
): TrialGraduation | undefined {
  return share > 0 && unitOf(`igtrial:${episodeId}`) < share
    ? graduation
    : undefined;
}

/** The container field (pure). */
export function trialParams(g: TrialGraduation | undefined): {
  trial_params?: { graduation_strategy: TrialGraduation };
} {
  return g ? { trial_params: { graduation_strategy: g } } : {};
}

const TRIAL_REFUSED =
  /trial|not eligible|unsupported|invalid parameter|\(#100\)/i;

/** Whether a container error is Instagram refusing the trial itself (pure), so the Reel can go out as an ordinary one. */
export function trialRefused(message: string): boolean {
  return TRIAL_REFUSED.test(message);
}
