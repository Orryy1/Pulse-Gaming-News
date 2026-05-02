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
    .replace(/,/g, "")
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

function buildEntityBadgeFilters(scene, fontOpt) {
  const entity = scene?.entity || inferEntityFromSource(scene?.source || scene?.backgroundSource);
  if (!entity) return [];
  const label = ffEscape(String(entity).toUpperCase());
  const kicker = ffEscape(badgeKicker(scene));
  const enabled = "enable='between(t\\,0.15\\,2.35)'";
  return [
    `drawbox=x=52:y=108:w=420:h=74:color=black@0.62:t=fill:${enabled}`,
    `drawbox=x=52:y=108:w=5:h=74:color=${ACCENT}@0.95:t=fill:${enabled}`,
    `drawtext=text='${kicker}':${fontOpt}:fontcolor=${ACCENT}:fontsize=21:x=78:y=118:${enabled}`,
    `drawtext=text='${label}':${fontOpt}:fontcolor=white:fontsize=34:x=78:y=146:${enabled}`,
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

function buildClipFilter({ slot, duration, scene, fontOpt }) {
  return [
    `[${slot}:v]setrange=tv`,
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
    `fps=${FPS}`,
    ...buildEntityBadgeFilters(scene, fontOpt),
    `trim=duration=${duration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function buildOpenerFilter({ slot, scene, story, fontOpt }) {
  const frames = Math.max(1, Math.round(scene.duration * FPS));
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

  const hookLines = wrapHookLines(
    String(story?.hook || story?.title || "")
      .split(/[.!?]/)[0]
      .trim()
      .toUpperCase(),
  );
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
    ...buildEntityBadgeFilters(scene, fontOpt),
    `trim=duration=${scene.duration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function buildTakeawayCardFilter({ slot, scene, fontOpt }) {
  const text = ffEscape(scene.text || "WATCH THE FULL TRAILER");
  const cta = ffEscape(scene.cta || "FOLLOW FOR MORE");
  const fadeIn = (start, dur = 0.4) =>
    `alpha='if(lt(t\\,${start})\\,0\\,if(lt(t-${start}\\,${dur})\\,(t-${start})/${dur}\\,1))'`;
  return [
    `[${slot}:v]setrange=tv`,
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
    `fps=${FPS}`,
    "boxblur=20:6",
    "eq=brightness=-0.35:saturation=0.55:contrast=1.05",
    "drawbox=x=0:y=0:w=iw:h=400:color=black@0.55:t=fill",
    "drawbox=x=0:y=h-500:w=iw:h=500:color=black@0.55:t=fill",
    `drawbox=x=(w-1)/2:y=h/2-220:w='if(lt(t\\,0.6)\\,1+(700-1)*t/0.6\\,700)':h=3:color=${ACCENT}@0.95:t=fill`,
    `drawbox=x=(w-1)/2:y=h/2+200:w='if(lt(t\\,0.6)\\,1+(700-1)*t/0.6\\,700)':h=3:color=${ACCENT}@0.95:t=fill`,
    `drawtext=text='TAKEAWAY':${fontOpt}:fontcolor=${ACCENT}:fontsize=32:x=(w-tw)/2:y=h/2-170:${fadeIn(0, 0.4)}`,
    `drawtext=text='${text}':${fontOpt}:fontcolor=black@0.7:fontsize=78:x=(w-tw)/2+4:y=h/2-40+4:${fadeIn(0.4, 0.6)}`,
    `drawtext=text='${text}':${fontOpt}:fontcolor=white:fontsize=78:x=(w-tw)/2:y=h/2-40:${fadeIn(0.4, 0.6)}`,
    `drawtext=text='   ${cta}   ':${fontOpt}:fontcolor=black:fontsize=32:x=(w-tw)/2:y=h/2+108:box=1:boxcolor=${ACCENT}@0.95:boxborderw=18:${fadeIn(1.0, 0.6)}`,
    `trim=duration=${scene.duration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function buildFlashStatCardFilter({ slot, scene, fontOpt }) {
  const heading = ffEscape(String(scene.statLabel || "MUST KNOW").toUpperCase());
  const sub = ffEscape(String(scene.sublabel || "THE DETAIL THAT MATTERS").toUpperCase());
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
    `drawtext=text='  KEEP WATCHING  ':${fontOpt}:fontcolor=black:fontsize=28:x=118:y=832:box=1:boxcolor=white@0.88:boxborderw=12:${fadeIn(0.96, 0.36)}`,
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

function buildSceneInput(scene) {
  const dur = (Number(scene.duration || 4) + 1).toFixed(2);
  const file = scene.prerenderedMp4 || scene.source || scene.backgroundSource;
  const esc = (p) => String(p).replace(/\\/g, "/");
  const mediaStartS = Number(scene.mediaStartS ?? scene.media_start_s ?? scene.startS ?? 0);
  const seek = Number.isFinite(mediaStartS) && mediaStartS > 0 ? `-ss ${mediaStartS.toFixed(2)} ` : "";

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
  buildTransitionPlan,
  buildTransitionFilters,
  buildClipFilter,
  buildMotionFilter,
  buildFlashStatCardFilter,
  ffEscape,
};
