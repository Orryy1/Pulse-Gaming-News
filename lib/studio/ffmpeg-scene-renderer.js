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

function buildMotionFilter({ slot, duration, motion }) {
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
    `trim=duration=${duration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function buildClipFilter({ slot, duration }) {
  return [
    `[${slot}:v]setrange=tv`,
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920:(iw-1080)/2:(ih-1920)/2",
    `fps=${FPS}`,
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
  const hookDraws = hookLines.map((line, index) => {
    const y = 218 + index * 58;
    return `drawtext=text='${ffEscape(line)}':${fontOpt}:fontcolor=white:fontsize=46:x=(w-tw)/2:y=${y}:enable='lt(t\\,1.65)':alpha='if(lt(t\\,0.15)\\,t/0.15\\,if(gt(t\\,1.42)\\,1-(t-1.42)/0.23\\,1))'`;
  });

  return [
    ...base,
    "drawbox=x=0:y=190:w=iw:h=172:color=black@0.86:t=fill:enable='lt(t\\,1.65)'",
    `drawbox=x=0:y=358:w=iw:h=4:color=${ACCENT}@0.95:t=fill:enable='lt(t\\,1.65)'`,
    ...hookDraws,
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

function buildContextFallbackFilter({ slot, scene, fontOpt }) {
  return buildReleaseDateCardFilter({
    slot,
    duration: scene.duration,
    dateLabel: scene.statLabel || "CONTEXT",
    kicker: "CONTEXT",
    sublabel: scene.sublabel || "",
    fontOpt,
  });
}

function dispatchSceneFilter({ slot, scene, story, fontOpt }) {
  if (scene.prerenderedMp4) {
    return buildClipFilter({ slot, duration: scene.duration });
  }

  switch (scene.type) {
    case SCENE_TYPES.CLIP:
      return buildClipFilter({ slot, duration: scene.duration });
    case SCENE_TYPES.STILL:
    case SCENE_TYPES.CLIP_FRAME:
      return buildMotionFilter({
        slot,
        duration: scene.duration,
        motion: scene.motion || "pushInCentre",
      });
    case SCENE_TYPES.OPENER:
      return buildOpenerFilter({ slot, scene, story, fontOpt });
    case SCENE_TYPES.CARD_SOURCE:
      return buildSourceCardFilter({
        slot,
        duration: scene.duration,
        sourceLabel: scene.sourceLabel,
        sublabel: scene.sublabel,
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
    default:
      throw new Error(`unknown scene type: ${scene.type}`);
  }
}

function buildSceneInput(scene) {
  const dur = (Number(scene.duration || 4) + 1).toFixed(2);
  const file = scene.prerenderedMp4 || scene.source || scene.backgroundSource;
  const esc = (p) => String(p).replace(/\\/g, "/");

  if (scene.prerenderedMp4 || scene.type === SCENE_TYPES.CLIP) {
    return `-t ${dur} -i "${esc(file)}"`;
  }
  if (
    scene.type === SCENE_TYPES.STILL ||
    scene.type === SCENE_TYPES.CLIP_FRAME ||
    (scene.type === SCENE_TYPES.OPENER && !scene.isClipBacked)
  ) {
    return `-loop 1 -t ${dur} -i "${esc(file)}"`;
  }
  if (scene.type === SCENE_TYPES.OPENER && scene.isClipBacked) {
    return `-t ${dur} -i "${esc(file)}"`;
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
  ffEscape,
};
