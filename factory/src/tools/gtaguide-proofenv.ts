// The GTA guide proof's sandbox settings (src/tools/gtaguide-proof.ts), kept apart so a test can hold them.
//
// CAPTURE_CHECKLIST is off in the sandbox: with it on, a long video about one of the owner's games sends him the
// "record these moments" list and then holds its footage until 10 hours before the slot (src/capture.ts captureHold),
// so the 26 Nov proof sat at "voiced" through all twelve passes and never rendered. A proof never waits for footage.

/** Mac turn-taking caps "proof" jobs at 90 minutes; a proof stops its passes well before that. */
export const PROOF_MAX_MINUTES = 75;

/**
 * Whether the proof's passes are done (pure): the render's cut is on disk (render_raw.mp4 or short.mp4; the 60 s cut
 * then fails the full-length duration QA, and before 27 Nov every pass rendered it again until macrun killed the
 * proof at 242 min), the episode reached an end state, or the time is up.
 */
export function proofDone(o: { rendered: boolean; status: string; minutes: number; maxMinutes?: number }): boolean {
  return (
    o.rendered ||
    ["failed", "rejected", "awaiting_approval", "approved", "published"].includes(o.status) ||
    o.minutes >= (o.maxMinutes ?? PROOF_MAX_MINUTES)
  );
}

/**
 * A reused sandbox's render outputs, cleared so the render runs again on the same script, voice and gathered media
 * (--reuse: a new render of an earlier proof inside the cap, never paying for the writer or the voice twice).
 */
export const REUSE_CLEAR = ["short.mp4", "render_raw.mp4", "thumb.jpg", "thumb_b.jpg", "thumb_c.jpg", "poster.jpg"];

export function gtaGuideProofEnv(o: {
  data: string;
  backup: string;
  /** --versus: the slot goes to a versus (VERSUS_LONG, src/versus.ts) instead of a guide. */
  versus?: boolean;
}): Record<string, string> {
  return {
    DATA_DIR: o.data,
    DATABASE_URL: "",
    DRY_RUN: "true",
    PORT: "0",
    LONGFORM_ENABLED: "true",
    LONGFORM_DAYS: "mon,tue,wed,thu,fri,sat,sun",
    LONGFORM_SKIP: "",
    LONG_LEAD_MINUTES: String(48 * 60),
    GTA_GUIDES: "true",
    GTA_GUIDE_SHARE: "1",
    AUTO_PUBLISH: "false",
    CAPTURE_CHECKLIST: "false",
    // The sandbox's render never waits for the live Shorts' slots (run10 waited out all twelve passes at 15:29).
    LONG_RENDER_IGNORE_SHORT_WINDOWS: "true",
    BACKUP_DIR: o.backup,
    ...(o.versus ? { VERSUS_LONG: "true", VERSUS_SHARE: "1" } : {}),
  };
}
