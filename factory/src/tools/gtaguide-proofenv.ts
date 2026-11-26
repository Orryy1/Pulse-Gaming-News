// The GTA guide proof's sandbox settings (src/tools/gtaguide-proof.ts), kept apart so a test can hold them.
//
// CAPTURE_CHECKLIST is off in the sandbox: with it on, a long video about one of the owner's games sends him the
// "record these moments" list and then holds its footage until 10 hours before the slot (src/capture.ts captureHold),
// so the 26 Nov proof sat at "voiced" through all twelve passes and never rendered. A proof never waits for footage.

export function gtaGuideProofEnv(o: {
  data: string;
  backup: string;
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
    BACKUP_DIR: o.backup,
  };
}
