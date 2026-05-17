"use strict";

const { SCENE_TYPES } = require("../scene-composer");
const { buildSourceCardFilter } = require("../scenes/source-card");
const { buildReleaseDateCardFilter } = require("../scenes/release-date-card");
const { buildQuoteCardFilter } = require("../scenes/quote-card");

const FPS = 30;
const ACCENT = "0xFF6B1A";

function ffEscape(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/=/g, "\\=")
    .replace(/%/g, "\\%");
}

function wrapHookLines(text) {
  const words = String(text || "")
    .replace(/[.!?]$/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 25 && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function openerVisualHookText(story = {}) {
  const corpus = [story.hook, story.title, story.body, story.full_script]
    .filter(Boolean)
    .join(" ");
  const numeric = corpus.match(/\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s*(?:million|thousand)\b/i);
  if (/\bsteam\b/i.test(corpus) && numeric) return `${numeric[0]} ON STEAM`;

  const thumbnailText = String(story.suggested_thumbnail_text || "").trim();
  if (thumbnailText && thumbnailText.length <= 42) return thumbnailText;

  return String(story?.hook || story?.title || "")
    .split(/[.!?]/)[0]
    .trim();
}

function wrapDisplayLines(text, { maxChars = 24, maxLines = 3 } = {}) {
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines) {
    const consumed = lines.join(" ").split(/\s+/).length;
    if (consumed < words.length) {
      lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\.+$/g, "")}...`;
    }
  }
  return lines.length ? lines : [String(text || "").trim()].filter(Boolean);
}

function buildFreezeCaptionDraws({ caption, fontOpt, fade, enable }) {
  if (!caption) return [];
  const lines = wrapDisplayLines(String(caption).toUpperCase(), {
    maxChars: 24,
    maxLines: 3,
  });
  const fontSize = lines.length >= 3 ? 48 : lines.length === 2 ? 54 : 62;
  const boxH = lines.length >= 3 ? 300 : lines.length === 2 ? 260 : 224;
  const lineHeight = Math.round(fontSize * 1.12);
  const textBlockH = fontSize + (lines.length - 1) * lineHeight;
  const firstY = `h/2-${Math.round(textBlockH / 2)}`;
  const draws = [
    `drawbox=x=76:y=h/2-${Math.round(boxH / 2)}:w=928:h=${boxH}:color=black@0.68:t=fill:${enable}`,
    `drawbox=x=76:y=h/2-${Math.round(boxH / 2)}:w=928:h=6:color=${ACCENT}@0.98:t=fill:${enable}`,
  ];
  lines.forEach((line, index) => {
    const escaped = ffEscape(line);
    const y = `${firstY}${index ? `+${index * lineHeight}` : ""}`;
    draws.push(
      `drawtext=text='${escaped}':${fontOpt}:fontcolor=black@0.72:fontsize=${fontSize}:x=(w-tw)/2+4:y=${y}+4:${fade}:${enable}`,
      `drawtext=text='${escaped}':${fontOpt}:fontcolor=white:fontsize=${fontSize}:x=(w-tw)/2:y=${y}:${fade}:${enable}`,
    );
  });
  return draws;
}

function inferEntityFromSource(source) {
  const text = String(source || "").replace(/[_-]+/g, " ").toLowerCase();
  if (/\bbioshock\b/.test(text)) return "BioShock";
  if (/\bred\s+dead\b/.test(text)) return "Red Dead";
  if (/\bgta\b|\bgrand\s+theft\s+auto\b/.test(text)) return "GTA";
  return null;
}

function badgeKicker(scene) {
  const type = String(scene?.sourceType || scene?.source || "").toLowerCase();
  if (/trailer.*frame|official_trailer_frame/.test(type)) return "OFFICIAL FRAME";
  if (/movie|trailer|clip/.test(type) || scene?.type === SCENE_TYPES.CLIP) return "OFFICIAL CLIP";
  if (/steam|igdb|store/.test(type)) return "GAME ART";
  return "SUBJECT";
}

function buildEntityBadgeFilters(scene, fontOpt, layout = {}) {
  const entity = scene?.entity || inferEntityFromSource(scene?.source || scene?.backgroundSource);
  if (!entity) return [];
  const label = ffEscape(String(entity).toUpperCase());
  const kicker = ffEscape(badgeKicker(scene));
  const labelFontSize = label.length > 16 ? 28 : 34;
  const x = Number.isFinite(Number(layout.x)) ? Number(layout.x) : 74;
  const kickerY = Number.isFinite(Number(layout.kickerY)) ? Number(layout.kickerY) : 250;
  const labelY = Number.isFinite(Number(layout.labelY)) ? Number(layout.labelY) : 306;
  const enable = "enable='between(t\\,0.12\\,2.56)'";
  return [
    `drawtext=text='${kicker}':${fontOpt}:fontcolor=${ACCENT}:fontsize=22:x=${x}:y=${kickerY}:box=1:boxcolor=black@0.46:boxborderw=10:${enable}`,
    `drawtext=text='${label}':${fontOpt}:fontcolor=white:fontsize=${labelFontSize}:x=${x}:y=${labelY}:box=1:boxcolor=black@0.38:boxborderw=13:${enable}`,
  ];
}

function buildMotionFilter({ slot, duration, motion, scene, fontOpt }) {
  const frames = Math.max(1, Math.round(duration * FPS));
  const inc = Math.round(10000 * (0.18 / frames)) / 10000;
  let zoompan;
  switch (motion) {
    case "pullBackCentre":
      zoompan = `zoompan=z=if(eq(on\\,1)\\,1.18\\,max(zoom-${inc}\\,1.0)):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=${frames}:s=1080x1920:fps=${FPS}`;
      break;
    case "pushPanRight":
      zoompan = `zoompan=z=min(zoom+${inc}\\,1.18):x=(iw-iw/zoom)*on/${frames}:y=ih/2-(ih/zoom/2):d=${frames}:s=1080x1920:fps=${FPS}`;
      break;
    case "pushPanLeft":
      zoompan = `zoompan=z=min(zoom+${inc}\\,1.18):x=(iw-iw/zoom)*(1-on/${frames}):y=ih/2-(ih/zoom/2):d=${frames}:s=1080x1920:fps=${FPS}`;
      break;
    case "driftDown":
      zoompan = `zoompan=z=min(zoom+${inc}\\,1.18):x=iw/2-(iw/zoom/2):y=(ih-ih/zoom)*on/${frames}:d=${frames}:s=1080x1920:fps=${FPS}`;
      break;
    default:
      zoompan = `zoompan=z=min(zoom+${inc}\\,1.18):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=${frames}:s=1080x1920:fps=${FPS}`;
  }
  return [
    `[${slot}:v]setrange=tv`,
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
    zoompan,
    ...buildEntityBadgeFilters(scene, fontOpt),
    `trim=duration=${duration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function isClipLikeScene(scene) {
  return (
    scene?.prerenderedMp4 ||
    scene?.type === SCENE_TYPES.CLIP ||
    scene?.type === SCENE_TYPES.PUNCH ||
    scene?.type === SCENE_TYPES.SPEED_RAMP ||
    scene?.type === SCENE_TYPES.FREEZE_FRAME ||
    (scene?.type === SCENE_TYPES.OPENER && scene?.isClipBacked === true)
  );
}

function isFreezeRiskClipScene(scene) {
  return (
    scene?.prerenderedMp4 ||
    scene?.type === SCENE_TYPES.CLIP ||
    scene?.type === SCENE_TYPES.PUNCH ||
    scene?.type === SCENE_TYPES.SPEED_RAMP ||
    (scene?.type === SCENE_TYPES.OPENER && scene?.isClipBacked === true)
  );
}

function safeClipRenderDuration(scene, duration) {
  const safeClipDuration = Number(scene?.clipDurationS ?? scene?.clip_duration_s);
  const sceneDuration = Number(duration);
  if (
    !isFreezeRiskClipScene(scene) ||
    !Number.isFinite(safeClipDuration) ||
    !Number.isFinite(sceneDuration) ||
    safeClipDuration <= 0 ||
    safeClipDuration >= sceneDuration
  ) {
    return sceneDuration;
  }
  return Number(Math.max(0.1, safeClipDuration).toFixed(3));
}

function buildClipFilter({ slot, duration, scene, fontOpt }) {
  const renderDuration = safeClipRenderDuration(scene, duration);
  return [
    `[${slot}:v]setrange=tv`,
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
    `fps=${FPS}`,
    ...buildEntityBadgeFilters(scene, fontOpt),
    `trim=duration=${renderDuration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function buildPunchFilter({ slot, duration, scene, fontOpt }) {
  const renderDuration = safeClipRenderDuration(scene, duration);
  return [
    `[${slot}:v]setrange=tv`,
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
    `fps=${FPS}`,
    "eq=brightness=0.02:saturation=1.12:contrast=1.12",
    "unsharp=5:5:0.55:3:3:0.2",
    ...buildEntityBadgeFilters(scene, fontOpt),
    `trim=duration=${renderDuration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function buildSpeedRampFilter({ slot, duration, scene, fontOpt }) {
  const renderDuration = safeClipRenderDuration(scene, duration);
  const envelope = scene.envelope || "slow-in";
  const dFrames = Math.max(1, Math.round(renderDuration * FPS));
  const scaleStart = envelope === "fast-out" ? 1.0 : 2.0;
  const scaleEnd = envelope === "fast-out" ? 2.0 : 1.0;
  const setpts = `setpts='(N/${FPS}/TB) * (${scaleStart} + (${scaleEnd - scaleStart}) * min(N/${dFrames}\\,1))'`;
  return [
    `[${slot}:v]setrange=tv`,
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
    `fps=${FPS}`,
    setpts,
    "eq=brightness=0.01:saturation=1.08:contrast=1.08",
    ...buildEntityBadgeFilters(scene, fontOpt),
    `trim=duration=${renderDuration}`,
    "setpts=PTS-STARTPTS",
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function buildFreezeFrameFilter({ slot, duration, scene, fontOpt }) {
  const playInS = Math.min(0.8, Math.max(0.45, duration * 0.22));
  const holdS = Math.max(0.1, duration - playInS);
  const caption = scene.caption ? String(scene.caption).toUpperCase() : null;
  const enable = `enable='gte(t\\,${playInS.toFixed(2)})'`;
  const fade = `alpha='if(lt(t-${playInS.toFixed(2)}\\,0.16)\\,(t-${playInS.toFixed(2)})/0.16\\,1)'`;
  const filters = [
    `[${slot}:v]setrange=tv`,
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
    `fps=${FPS}`,
    `tpad=stop_mode=clone:stop_duration=${holdS.toFixed(2)}`,
    `drawbox=x=0:y=0:w=iw:h=ih:color=white@0.72:t=fill:enable='between(t\\,${playInS.toFixed(2)}\\,${(playInS + 0.055).toFixed(2)})'`,
    ...buildEntityBadgeFilters(scene, fontOpt),
  ];
  if (caption) {
    filters.push(...buildFreezeCaptionDraws({ caption, fontOpt, fade, enable }));
  }
  filters.push(`trim=duration=${duration}`);
  filters.push("setpts=PTS-STARTPTS");
  filters.push(`format=yuv420p,setsar=1[v${slot}]`);
  return filters.join(",");
}

function buildOpenerFilter({ slot, scene, story, fontOpt }) {
  const renderDuration = safeClipRenderDuration(scene, scene.duration);
  const frames = Math.max(1, Math.round(renderDuration * FPS));
  const base = scene.isClipBacked
    ? [
        `[${slot}:v]setrange=tv`,
        "scale=1080:1920:force_original_aspect_ratio=increase",
        "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
        `fps=${FPS}`,
      ]
    : [
        `[${slot}:v]setrange=tv`,
        "scale=1080:1920:force_original_aspect_ratio=increase",
        "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
        `zoompan=z=min(zoom+${Math.round(10000 * (0.2 / frames)) / 10000}\\,1.20):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=${frames}:s=1080x1920:fps=${FPS}`,
      ];

  const hookLines = wrapHookLines(openerVisualHookText(story).toUpperCase());
  const hookEnable = "enable='between(t\\,0.12\\,2.45)'";
  const hookDraws = hookLines.map((line, index) => {
    const y = 134 + index * 44;
    return `drawtext=text='${ffEscape(line)}':${fontOpt}:fontcolor=white:fontsize=38:x=100:y=${y}:${hookEnable}:alpha='if(lt(t\\,0.22)\\,t/0.22\\,if(gt(t\\,2.18)\\,1-(t-2.18)/0.27\\,1))'`;
  });

  return [
    ...base,
    `drawbox=x=72:y=102:w=760:h=118:color=black@0.58:t=fill:${hookEnable}`,
    `drawbox=x=72:y=102:w=7:h=118:color=${ACCENT}@0.95:t=fill:${hookEnable}`,
    ...hookDraws,
    ...buildEntityBadgeFilters(scene, fontOpt, { x: 74, kickerY: 250, labelY: 306 }),
    `trim=duration=${renderDuration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function buildTakeawayCardFilter({ slot, scene, fontOpt }) {
  const text = ffEscape(scene.text || "WATCH THE FULL TRAILER");
  const cta = ffEscape(scene.cta || "FOLLOW FOR MORE");
  const textSize = String(scene.text || "").length > 18 ? 60 : 74;
  const fadeIn = (start, dur = 0.4) =>
    `alpha='if(lt(t\\,${start})\\,0\\,if(lt(t-${start}\\,${dur})\\,(t-${start})/${dur}\\,1))'`;
  return [
    `[${slot}:v]setrange=tv`,
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
    `fps=${FPS}`,
    "boxblur=10:3",
    "eq=brightness=-0.08:saturation=1.08:contrast=1.14",
    `drawbox=x=0:y=0:w=iw:h=ih:color=${ACCENT}@0.08:t=fill`,
    `drawtext=text='PULSE LOCK':${fontOpt}:fontcolor=${ACCENT}:fontsize=30:x=158:y=h/2-116:${fadeIn(0.08, 0.28)}`,
    `drawtext=text='${text}':${fontOpt}:fontcolor=black@0.70:fontsize=${textSize}:x=(w-tw)/2+4:y=h/2-26+4:${fadeIn(0.32, 0.46)}`,
    `drawtext=text='${text}':${fontOpt}:fontcolor=white:fontsize=${textSize}:x=(w-tw)/2:y=h/2-26:${fadeIn(0.32, 0.46)}`,
    `drawbox=x=310:y=h/2+70:w='if(lt(t\\,0.72)\\,1\\,1+(460-1)*(t-0.72)/0.34)':h=5:color=${ACCENT}@0.98:t=fill:enable='gte(t\\,0.72)'`,
    `drawtext=text='   ${cta}   ':${fontOpt}:fontcolor=black:fontsize=30:x=(w-tw)/2:y=h/2+102:box=1:boxcolor=${ACCENT}@0.98:boxborderw=16:${fadeIn(0.82, 0.42)}`,
    `trim=duration=${scene.duration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function buildFlashStatCardFilter({ slot, scene, fontOpt }) {
  const heading = ffEscape(String(scene.statLabel || "MUST KNOW").toUpperCase());
  const sub = ffEscape(String(scene.sublabel || "THE DETAIL THAT MATTERS").toUpperCase());
  const badge = ffEscape(String(scene.badge || "SOURCE-BACKED").toUpperCase());
  const trim = `trim=duration=${scene.duration},setpts=PTS-STARTPTS`;
  const fadeIn = (start, dur = 0.35) =>
    `alpha='if(lt(t\\,${start})\\,0\\,if(lt(t-${start}\\,${dur})\\,(t-${start})/${dur}\\,1))'`;
  const enableAfter = (start) => `enable='gte(t\\,${start})'`;
  const headingSize = heading.length > 18 ? 62 : heading.length > 12 ? 76 : 92;
  return [
    `[${slot}:v]setrange=tv`,
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
    `fps=${FPS}`,
    "boxblur=18:6",
    "eq=brightness=-0.28:saturation=0.82:contrast=1.16",
    "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.18:t=fill",
    `drawbox=x=68:y=410:w=944:h=520:color=black@0.60:t=fill:${enableAfter(0.04)}`,
    `drawbox=x=68:y=410:w=944:h='if(lt(t\\,0.5)\\,4+(520-4)*t/0.5\\,520)':color=${ACCENT}@0.95:t=4`,
    `drawtext=text='MUST KNOW':${fontOpt}:fontcolor=${ACCENT}:fontsize=34:x=118:y=474:${fadeIn(0.18, 0.28)}`,
    `drawtext=text='${heading}':${fontOpt}:fontcolor=black@0.72:fontsize=${headingSize}:x=123:y=567:${fadeIn(0.36, 0.42)}`,
    `drawtext=text='${heading}':${fontOpt}:fontcolor=white:fontsize=${headingSize}:x=118:y=562:${fadeIn(0.36, 0.42)}`,
    `drawbox=x=118:y=700:w='if(lt(t\\,0.9)\\,1\\,1+(620-1)*(t-0.52)/0.38)':h=5:color=${ACCENT}@0.95:t=fill`,
    `drawtext=text='${sub}':${fontOpt}:fontcolor=white@0.80:fontsize=34:x=118:y=748:${fadeIn(0.74, 0.36)}`,
    `drawtext=text='  ${badge}  ':${fontOpt}:fontcolor=black:fontsize=28:x=118:y=832:box=1:boxcolor=white@0.88:boxborderw=12:${fadeIn(0.96, 0.36)}`,
    trim,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function buildContextFallbackFilter({ slot, scene, fontOpt }) {
  if (scene.cardTreatment === "flash_lane") {
    return buildFlashStatCardFilter({ slot, scene, fontOpt });
  }
  return buildReleaseDateCardFilter({
    slot,
    duration: scene.duration,
    dateLabel: scene.statLabel || "CONTEXT",
    kicker: "CONTEXT",
    sublabel: scene.sublabel || "",
    fontOpt,
  });
}

/**
 * ffmpeg fallback for card.timeline when no HF render is available.
 * Renders the heading + 3 numbered bullets with a fade-in stagger.
 * Far less polished than the HF version but keeps the slate
 * structurally complete if HF rendering is offline.
 */
function buildTimelineFallbackFilter({ slot, scene, fontOpt }) {
  const heading = ffEscape(
    String(scene.heading || "WHAT WE KNOW").toUpperCase(),
  );
  const kicker = ffEscape(String(scene.kicker || "WHAT WE KNOW").toUpperCase());
  const bullets = (scene.bullets || []).slice(0, 3);
  const fadeIn = (start, dur = 0.4) =>
    `alpha='if(lt(t\\,${start})\\,0\\,if(lt(t-${start}\\,${dur})\\,(t-${start})/${dur}\\,1))'`;
  const lines = [
    `[${slot}:v]setrange=tv`,
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
    `fps=${FPS}`,
    "boxblur=24:6",
    "eq=brightness=-0.42:saturation=0.5:contrast=1.08",
    `drawbox=x=(w-1)/2:y=h/2-380:w='if(lt(t\\,0.5)\\,1+(760-1)*t/0.5\\,760)':h=4:color=${ACCENT}@0.95:t=fill`,
    `drawtext=text='${kicker}':${fontOpt}:fontcolor=${ACCENT}:fontsize=32:x=(w-tw)/2:y=h/2-300:${fadeIn(0.15, 0.34)}`,
    `drawtext=text='${heading}':${fontOpt}:fontcolor=white:fontsize=60:x=(w-tw)/2:y=h/2-240:${fadeIn(0.4, 0.5)}`,
  ];
  bullets.forEach((b, i) => {
    const numText = String(i + 1).padStart(2, "0");
    const start = 0.7 + i * 0.22;
    const yBase = `h/2-100+${i * 80}`;
    lines.push(
      `drawtext=text='${numText}':${fontOpt}:fontcolor=${ACCENT}:fontsize=36:x=160:y=${yBase}:${fadeIn(start, 0.42)}`,
    );
    const copy = ffEscape(String(b || "").slice(0, 60));
    lines.push(
      `drawtext=text='${copy}':${fontOpt}:fontcolor=white:fontsize=36:x=240:y=${yBase}:${fadeIn(start, 0.42)}`,
    );
  });
  lines.push(
    `drawbox=x=(w-1)/2:y=h/2+340:w='if(lt(t\\,2.0)\\,1\\,1+(760-1)*(t-2.0)/0.5)':h=4:color=${ACCENT}@0.95:t=fill`,
  );
  lines.push(`trim=duration=${scene.duration},setpts=PTS-STARTPTS`);
  lines.push(`format=yuv420p,setsar=1[v${slot}]`);
  return lines.join(",");
}

function dispatchSceneFilter({ slot, scene, story, fontOpt }) {
  if (scene.prerenderedMp4) {
    return buildClipFilter({ slot, duration: scene.duration, scene, fontOpt });
  }

  switch (scene.type) {
    case SCENE_TYPES.CLIP:
      return buildClipFilter({ slot, duration: scene.duration, scene, fontOpt });
    case SCENE_TYPES.PUNCH:
      return buildPunchFilter({ slot, duration: scene.duration, scene, fontOpt });
    case SCENE_TYPES.SPEED_RAMP:
      return buildSpeedRampFilter({ slot, duration: scene.duration, scene, fontOpt });
    case SCENE_TYPES.FREEZE_FRAME:
      return buildFreezeFrameFilter({ slot, duration: scene.duration, scene, fontOpt });
    case SCENE_TYPES.STILL:
    case SCENE_TYPES.CLIP_FRAME:
      return buildMotionFilter({
        slot,
        duration: scene.duration,
        motion: scene.motion || "pushInCentre",
        scene,
        fontOpt,
      });
    case SCENE_TYPES.OPENER:
      return buildOpenerFilter({ slot, scene, story, fontOpt });
    case SCENE_TYPES.CARD_SOURCE:
      return buildSourceCardFilter({
        slot,
        duration: scene.duration,
        sourceLabel: scene.sourceLabel,
        sublabel: scene.sublabel,
        treatment: scene.cardTreatment,
        fontOpt,
      });
    case SCENE_TYPES.CARD_RELEASE:
      return buildReleaseDateCardFilter({
        slot,
        duration: scene.duration,
        dateLabel: scene.dateLabel,
        kicker: scene.kicker,
        sublabel: scene.sublabel,
        fontOpt,
      });
    case SCENE_TYPES.CARD_QUOTE:
      return buildQuoteCardFilter({
        slot,
        duration: scene.duration,
        body: scene.body,
        author: scene.author,
        score: scene.score,
        fontOpt,
        treatment: scene.cardTreatment,
      });
    case SCENE_TYPES.CARD_STAT:
      return buildContextFallbackFilter({ slot, scene, fontOpt });
    case SCENE_TYPES.CARD_TAKEAWAY:
      return buildTakeawayCardFilter({ slot, scene, fontOpt });
    case SCENE_TYPES.CARD_TIMELINE:
      return buildTimelineFallbackFilter({ slot, scene, fontOpt });
    default:
      throw new Error(`unknown scene type: ${scene.type}`);
  }
}

function sceneInputReadDuration(scene, multiplier = 1, extraS = 0) {
  const sceneDuration = Number(scene?.duration || 4);
  const requested = sceneDuration * multiplier + Number(extraS || 0);
  const safeClipDuration = Number(scene?.clipDurationS ?? scene?.clip_duration_s);
  if (isClipLikeScene(scene) && Number.isFinite(safeClipDuration) && safeClipDuration > 0) {
    const source = String(scene?.prerenderedMp4 || scene?.source || scene?.backgroundSource || "");
    const remoteReadAheadS = /^https?:\/\//i.test(source) ? 0.25 : 0;
    return Math.max(0.1, Math.min(requested, safeClipDuration + remoteReadAheadS));
  }
  return requested;
}

function buildSceneInput(scene) {
  const dur = sceneInputReadDuration(scene, 1, 1).toFixed(2);
  const file = scene.prerenderedMp4 || scene.source || scene.backgroundSource;
  const esc = (p) => String(p).replace(/\\/g, "/");
  const mediaStartS = Number(scene.mediaStartS ?? scene.media_start_s ?? scene.startS ?? 0);
  const seek = Number.isFinite(mediaStartS) && mediaStartS > 0 ? `-ss ${mediaStartS.toFixed(2)} ` : "";

  if (scene.type === SCENE_TYPES.SPEED_RAMP) {
    const sourceReadDur = sceneInputReadDuration(scene, 2.2).toFixed(2);
    return `${seek}-t ${sourceReadDur} -i "${esc(file)}"`;
  }
  if (scene.type === SCENE_TYPES.FREEZE_FRAME) {
    const playInS = Math.min(0.8, Math.max(0.45, Number(scene.duration || 4) * 0.22));
    const sourceReadDur = Math.min(playInS + 0.2, sceneInputReadDuration(scene));
    return `${seek}-t ${sourceReadDur.toFixed(2)} -i "${esc(file)}"`;
  }
  if (scene.type === SCENE_TYPES.PUNCH) {
    return `${seek}-t ${dur} -i "${esc(file)}"`;
  }
  if (scene.prerenderedMp4 || scene.type === SCENE_TYPES.CLIP) {
    return `${seek}-t ${dur} -i "${esc(file)}"`;
  }
  if (
    scene.type === SCENE_TYPES.STILL ||
    scene.type === SCENE_TYPES.CLIP_FRAME ||
    (scene.type === SCENE_TYPES.OPENER && !scene.isClipBacked)
  ) {
    return `-loop 1 -t ${dur} -i "${esc(file)}"`;
  }
  if (scene.type === SCENE_TYPES.OPENER && scene.isClipBacked) {
    return `${seek}-t ${dur} -i "${esc(file)}"`;
  }
  if (file) {
    return `-loop 1 -t ${dur} -i "${esc(file)}"`;
  }
  return `-f lavfi -t ${dur} -i color=c=0x0D0D0F:s=1080x1920:r=${FPS}`;
}

function buildTransitionPlan(scenes) {
  const transitions = [];
  let runningDuration = Number(scenes[0]?.duration || 0);
  for (let i = 0; i < scenes.length - 1; i++) {
    let type = "cut";
    let duration = 0;
    if (i === scenes.length - 2) {
      type = "dissolve";
      duration = 0.3;
    } else if (i > 0 && i % 5 === 4) {
      type = "slideleft";
      duration = 0.25;
    } else if (i > 0 && i % 2 === 1) {
      type = "dissolve";
      duration = 0.22;
    }

    let offset;
    if (type === "cut") {
      offset = runningDuration;
      runningDuration += Number(scenes[i + 1].duration || 0);
    } else {
      offset = runningDuration - duration;
      runningDuration = offset + Number(scenes[i + 1].duration || 0);
    }
    transitions.push({ type, duration, offset });
  }
  return transitions;
}

function buildTransitionFilters(transitions) {
  const filters = [];
  let prev = "v0";
  for (let i = 0; i < transitions.length; i++) {
    const transition = transitions[i];
    const out = i === transitions.length - 1 ? "base" : `xf${i + 1}`;
    if (transition.type === "cut") {
      filters.push(
        `[${prev}][v${i + 1}]concat=n=2:v=1:a=0,fps=${FPS},setpts=PTS-STARTPTS[${out}]`,
      );
    } else {
      filters.push(
        `[${prev}][v${i + 1}]xfade=transition=${transition.type}:duration=${transition.duration}:offset=${transition.offset.toFixed(2)}[${out}]`,
      );
    }
    prev = out;
  }
  return filters;
}

module.exports = {
  FPS,
  buildSceneInput,
  dispatchSceneFilter,
  safeClipRenderDuration,
  buildTransitionPlan,
  buildTransitionFilters,
  buildClipFilter,
  buildPunchFilter,
  buildSpeedRampFilter,
  buildFreezeFrameFilter,
  buildMotionFilter,
  buildFlashStatCardFilter,
  wrapDisplayLines,
  ffEscape,
};
