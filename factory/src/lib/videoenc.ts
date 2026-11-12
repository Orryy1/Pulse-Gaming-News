// The picture encoder for in-between files (12 Nov 2026, APPLE_HW_ENCODE): trailer and gameplay clip cuts
// that the renderer re-encodes anyway. On the Mac mini with the setting on they go to Apple's VideoToolbox
// hardware encoder, which leaves the CPU to the renders; everywhere else, and for final masters always,
// libx264 as before. Measured 12 Nov 2026 on 56 s of real trailer clips (previews/2026-11-12-appletools/
// encode_benchmark.txt): VideoToolbox at q 75 scored VMAF 99.0 and SSIM 0.9955 against the source, level with
// libx264 CRF 17 fast (99.2, 0.9955), in 9 s instead of 90 s, at about twice the file size (fine for files
// that live a day). q 65 fell to VMAF 98.1, so 75 it is.

/** VideoToolbox's constant-quality level for in-between clips (higher is better, 1-100). */
export const HW_QUALITY = 75;

/** True when in-between encodes go to the hardware encoder: the Mac, with APPLE_HW_ENCODE on. */
export function hwEncodeOn(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    platform === "darwin" &&
    /^(1|true|yes|on)$/i.test(env.APPLE_HW_ENCODE ?? "") &&
    !env.NODE_TEST_CONTEXT
  );
}

/**
 * ffmpeg's picture-encoder arguments for an in-between file: libx264 at the caller's CRF and preset, or
 * VideoToolbox H.264 at HW_QUALITY when `hw` (hwEncodeOn() by default). Pixel format is the caller's.
 */
export function intermediateVideoArgs(
  o: { crf: number; preset: string },
  hw: boolean = hwEncodeOn(),
): string[] {
  return hw
    ? [
        "-c:v",
        "h264_videotoolbox",
        "-q:v",
        String(HW_QUALITY),
        "-allow_sw",
        "1",
      ]
    : ["-c:v", "libx264", "-crf", String(o.crf), "-preset", o.preset];
}
