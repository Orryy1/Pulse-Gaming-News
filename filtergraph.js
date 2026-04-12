/**
 * FFmpeg filter_complex builder for multi-layer video composition.
 *
 * Layers (bottom to top):
 *   1. Background images with Ken Burns + crossfade transitions
 *   2. Vignette overlay
 *   3. Scanline overlay
 *   4. Animated word-by-word subtitles with active-word highlighting
 *   5. Headline text (first 4 seconds)
 *   6. Branded frame overlay
 */

function escapeFFmpegText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/**
 * Build the full filter_complex string and input list.
 *
 * @param {Object} opts
 * @param {string[]} opts.backgroundImages - paths to background JPGs
 * @param {string} opts.audioPath - path to audio MP3
 * @param {string} opts.scanlinesPath - overlay PNG
 * @param {string} opts.framePath - overlay PNG
 * @param {string} opts.vignettePath - overlay PNG
 * @param {Object} opts.timing - { words, groups } from subtitles.js
 * @param {number} opts.audioDuration - in seconds
 * @param {string} opts.headlineText - big text for first 4s
 * @param {string} opts.flairText - flair badge text
 * @param {string} opts.outputPath - output MP4 path
 * @returns {{ cmd: string }}
 */
function buildCommand(opts) {
  const {
    backgroundImages,
    audioPath,
    scanlinesPath,
    framePath,
    vignettePath,
    timing,
    audioDuration,
    headlineText,
    flairText,
    outputPath,
  } = opts;

  const bgCount = backgroundImages.length;
  const segmentDuration = audioDuration / bgCount;
  const transitionDuration = 0.5;

  const inputs = [];
  const filters = [];

  // --- Input declarations ---

  // Background images
  for (let i = 0; i < bgCount; i++) {
    const dur = segmentDuration + (i < bgCount - 1 ? transitionDuration : 0);
    inputs.push(`-loop 1 -t ${dur.toFixed(2)} -i "${backgroundImages[i]}"`);
  }

  // Audio
  const audioIdx = bgCount;
  inputs.push(`-i "${audioPath}"`);

  // Overlay PNGs
  const vignetteIdx = bgCount + 1;
  inputs.push(`-i "${vignettePath}"`);

  const scanlinesIdx = bgCount + 2;
  inputs.push(`-i "${scanlinesPath}"`);

  const frameIdx = bgCount + 3;
  inputs.push(`-i "${framePath}"`);

  // --- Background layer: scale + zoompan + crossfade ---

  // Ken Burns directions (cycle through these)
  const kenBurns = [
    {
      z: "min(zoom+0.00015,1.06)",
      x: "'iw/2-(iw/zoom/2)'",
      y: "'ih/2-(ih/zoom/2)'",
    }, // centre zoom
    { z: "min(zoom+0.00012,1.05)", x: "0", y: "'ih/2-(ih/zoom/2)'" }, // pan left
    { z: "min(zoom+0.00012,1.05)", x: "'iw-iw/zoom'", y: "'ih/2-(ih/zoom/2)'" }, // pan right
    { z: "min(zoom+0.0001,1.04)", x: "'iw/2-(iw/zoom/2)'", y: "0" }, // pan up
  ];

  for (let i = 0; i < bgCount; i++) {
    const kb = kenBurns[i % kenBurns.length];
    const frames = Math.ceil((segmentDuration + transitionDuration) * 30);
    filters.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
        `zoompan=z='${kb.z}':x=${kb.x}:y=${kb.y}:d=${frames}:s=1080x1920:fps=30[z${i}]`,
    );
  }

  // Crossfade chain
  if (bgCount === 1) {
    filters.push(`[z0]null[bg]`);
  } else {
    let prevLabel = "z0";
    for (let i = 1; i < bgCount; i++) {
      const offset = i * (segmentDuration - transitionDuration);
      const outLabel = i === bgCount - 1 ? "bg" : `x${i}`;
      filters.push(
        `[${prevLabel}][z${i}]xfade=transition=fadeblack:duration=${transitionDuration}:offset=${offset.toFixed(2)}[${outLabel}]`,
      );
      prevLabel = outLabel;
    }
  }

  // --- Overlay layers ---

  // Vignette
  filters.push(`[${vignetteIdx}:v]scale=1080:1920,format=rgba[vig]`);
  filters.push(`[bg][vig]overlay=0:0:format=auto[bgvig]`);

  // Scanlines
  filters.push(`[${scanlinesIdx}:v]scale=1080:1920,format=rgba[scan]`);
  filters.push(`[bgvig][scan]overlay=0:0:format=auto[bgscan]`);

  // --- Subtitle drawtext chain ---

  const subtitleFilters = [];

  if (timing?.groups?.length) {
    for (const group of timing.groups) {
      const escapedText = escapeFFmpegText(group.text);
      const start = group.start.toFixed(3);
      const end = group.end.toFixed(3);

      // White subtitle text (background group)
      subtitleFilters.push(
        `drawtext=text='${escapedText}':` +
          `fontsize=56:fontcolor=white:fontfile=/Windows/Fonts/arialbd.ttf:` +
          `x=(w-text_w)/2:y=1380:` +
          `borderw=3:bordercolor=black@0.8:` +
          `enable='between(t,${start},${end})'`,
      );

      // Highlight the active word in green (overlaid on top)
      for (const word of group.words) {
        const escapedWord = escapeFFmpegText(word.word);
        const ws = word.start.toFixed(3);
        const we = word.end.toFixed(3);

        // Calculate approximate x offset for the active word within the group
        // We use a separate drawtext that shows only during this word's time window
        subtitleFilters.push(
          `drawtext=text='${escapedWord}':` +
            `fontsize=60:fontcolor=#39FF14:fontfile=/Windows/Fonts/arialbd.ttf:` +
            `x=(w-text_w)/2:y=1310:` +
            `borderw=2:bordercolor=black@0.6:` +
            `enable='between(t,${ws},${we})'`,
        );
      }
    }
  }

  // Headline text (first 4 seconds, fades out)
  if (headlineText) {
    const escapedHeadline = escapeFFmpegText(headlineText);
    subtitleFilters.push(
      `drawtext=text='${escapedHeadline}':` +
        `fontsize=72:fontcolor=#39FF14:fontfile=/Windows/Fonts/arialbd.ttf:` +
        `x=(w-text_w)/2:y=400:` +
        `borderw=4:bordercolor=black:` +
        `alpha='if(lt(t,3.5),1,max(0,1-(t-3.5)*2))':` +
        `enable='lt(t,4.5)'`,
    );
  }

  // Flair badge (first 5 seconds)
  if (flairText) {
    const flairColour =
      flairText === "Verified"
        ? "#10B981"
        : flairText === "Highly Likely"
          ? "#F59E0B"
          : "#F97316";
    subtitleFilters.push(
      `drawtext=text='${escapeFFmpegText(flairText.toUpperCase())}':` +
        `fontsize=28:fontcolor=${flairColour}:fontfile=/Windows/Fonts/arialbd.ttf:` +
        `x=(w-text_w)/2:y=340:` +
        `borderw=2:bordercolor=black@0.5:` +
        `enable='lt(t,5)'`,
    );
  }

  // Apply all drawtext filters to the scanline-composited base
  if (subtitleFilters.length > 0) {
    filters.push(`[bgscan]${subtitleFilters.join(",")}[subtitled]`);
  } else {
    filters.push(`[bgscan]null[subtitled]`);
  }

  // Frame overlay (on top of everything)
  filters.push(`[${frameIdx}:v]scale=1080:1920,format=rgba[frm]`);
  filters.push(`[subtitled][frm]overlay=0:0:format=auto,format=yuv420p[outv]`);

  // --- Build command ---

  const filterComplex = filters.join(";\n");

  const cmd = [
    "ffmpeg -y",
    ...inputs,
    `-filter_complex_script pipe:0`,
    `-map "[outv]" -map ${audioIdx}:a`,
    "-c:v libx264 -crf 23 -preset medium",
    "-c:a aac -b:a 192k",
    "-r 30 -shortest",
    `-movflags +faststart "${outputPath}"`,
  ].join(" ");

  return { cmd, filterComplex };
}

module.exports = { buildCommand, escapeFFmpegText };
