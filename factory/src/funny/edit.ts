// The comedy edit (FUNNY_SHORTS), pure: where to cut in, the freeze and zoom punch on the payoff, the slowed replay,
// the caption and the punchline, and the ffmpeg filter that makes the picture. The owner's own reaction carries it:
// no narration by default, the game's and the owner's sound all the way through.
//
//   cut in      LEAD seconds before the payoff (a viewer needs a beat to see what is about to go wrong, not more)
//   payoff      the picture holds on the payoff frame for FREEZE seconds with a zoom punch while the sound runs on
//               (the picture then catches up, so sound and picture stay in step)
//   reaction    up to TAIL seconds after it: the owner's laugh, the aftermath
//   replay      the payoff again at REPLAY_SPEED, ending on the payoff itself, a hard cut back to the start: the loop

export const LEAD = 4.5;
export const LEAD_BUILDUP = 6.5;
export const FREEZE = 0.6;
export const TAIL = 2.6;
export const TAIL_MAX = 5;
export const REPLAY_BEFORE = 1.4;
export const REPLAY_AFTER = 0.8;
export const REPLAY_SPEED = 0.5;
/** The first seconds a viewer and an advertiser see: no gore, no swearing, nothing jarring. */
export const AD_SAFE_SECONDS = 7;

export interface FunnyPlan {
  /** In the clip's own seconds. */
  cutIn: number;
  payoff: number;
  cutOut: number;
  freeze: number;
  replay: { from: number; to: number; speed: number };
  /** On the finished Short's clock. */
  payoffAt: number;
  replayAt: number;
  seconds: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The plan for a clip (pure). `reactionEnd` is when the owner's reaction dies down (clip seconds), when known;
 * `buildup` gives a longer run-in (a wanted level climbing, a chase starting).
 */
export function funnyPlan(o: {
  payoff: number;
  clipSeconds: number;
  reactionEnd?: number;
  buildup?: boolean;
}): FunnyPlan {
  const lead = o.buildup ? LEAD_BUILDUP : LEAD;
  const payoff = Math.max(1.5, Math.min(o.payoff, o.clipSeconds - 1.5));
  const cutIn = round(Math.max(0, payoff - lead));
  const tail =
    o.reactionEnd !== undefined
      ? Math.min(TAIL_MAX, Math.max(1.2, o.reactionEnd - payoff + 0.4))
      : TAIL;
  const cutOut = round(Math.min(o.clipSeconds, payoff + tail));
  const from = round(Math.max(cutIn, payoff - REPLAY_BEFORE));
  const to = round(Math.min(cutOut, payoff + REPLAY_AFTER));
  const payoffAt = round(payoff - cutIn);
  const replayAt = round(cutOut - cutIn);
  const seconds = round(replayAt + (to - from) / REPLAY_SPEED);
  return {
    cutIn,
    payoff,
    cutOut,
    freeze: FREEZE,
    replay: { from, to, speed: REPLAY_SPEED },
    payoffAt,
    replayAt,
    seconds,
  };
}

/**
 * The ffmpeg filter for the plan (pure): one input (the clip), [vout] 1080x1920 at 30 fps and [aout]. The freeze holds
 * the payoff frame with a zoom punch while the sound runs on; the picture resumes FREEZE seconds later, in step.
 */
export function funnyFilter(
  p: FunnyPlan,
  o: { tone?: string; focus?: number } = {},
): string {
  const tone = o.tone ?? "";
  const hold = round(p.payoff + p.freeze);
  const f = Math.max(0, Math.min(1, o.focus ?? 0.5)).toFixed(3);
  const frames = Math.round(p.freeze * 30);
  const parts = [
    `[0:v]${tone}fps=30,scale=1920:1080,setsar=1,split=4[s1][s2][s3][s4]`,
    `[s1]trim=start=${p.cutIn}:end=${p.payoff},setpts=PTS-STARTPTS[v1]`,
    // The payoff frame held, pushed in from 1.0 to 1.18 over the first five frames.
    `[s2]trim=start=${p.payoff}:duration=0.034,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${p.freeze},trim=end_frame=${frames},zoompan=z='min(1.18,1+0.036*on)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30,setsar=1[v2]`,
    `[s3]trim=start=${hold}:end=${p.cutOut},setpts=PTS-STARTPTS[v3]`,
    `[s4]trim=start=${p.replay.from}:end=${p.replay.to},setpts=(PTS-STARTPTS)/${p.replay.speed}[v4]`,
    `[v1][v2][v3][v4]concat=n=4:v=1:a=0[jv]`,
    `[0:a]aresample=48000,asplit=2[a1][a2]`,
    `[a1]atrim=start=${p.cutIn}:end=${p.cutOut},asetpts=PTS-STARTPTS,afade=t=in:d=0.03[am]`,
    `[a2]atrim=start=${p.replay.from}:end=${p.replay.to},asetpts=PTS-STARTPTS,atempo=${p.replay.speed},volume=0.8[ar]`,
    `[am][ar]concat=n=2:v=0:a=1,afade=t=out:st=${Math.max(0, round(p.seconds - 0.12))}:d=0.12[aout]`,
    `[jv]scale=-2:1920,crop=1080:1920:x='(iw-ow)*${f}':y=0,fps=30,format=yuv420p[vout]`,
  ];
  return parts.join(";");
}

// ------------------------------------------------------------------ words on screen

/** Words that never go on a funny Short's screen or title (advertiser safety, the channel's own rules). */
const UNSAFE =
  /\b(death|dead|die[ds]?|dying|kill(s|ed|ing)?|murder\w*|war|horror|scary|crisis|attack\w*|blood\w*|gore|suicide|shoot(ing|s)?|gun(s|fire)?|drunk|sex\w*|nsfw)\b/i;
const SWEAR =
  /\b(f+u+c*k+\w*|sh[i1]t+\w*|bitch\w*|bastard\w*|cunt\w*|dick\w*|piss\w*|wank\w*|twat\w*|bollocks|arse\w*|ass(hole)?s?|damn\w*|crap)\b/i;
const CRUEL =
  /\b(stupid|idiot\w*|moron\w*|retard\w*|dumb|loser\w*|ugly|fat)\b/i;

/** What is wrong with a caption or punchline, empty when it is fine (pure). */
export function captionProblems(
  text: string,
  o: { words?: number; chars?: number } = {},
): string[] {
  const maxWords = o.words ?? 7;
  const maxChars = o.chars ?? 40;
  const t = text.trim();
  const out: string[] = [];
  if (!t) out.push("empty");
  if (t.split(/\s+/).length > maxWords) out.push(`over ${maxWords} words`);
  if (t.length > maxChars) out.push(`over ${maxChars} characters`);
  if (/[—–]/.test(t)) out.push("a long dash");
  if (UNSAFE.test(t)) out.push("advertiser-unfriendly word");
  if (SWEAR.test(t)) out.push("swearing");
  if (CRUEL.test(t)) out.push("mean about someone");
  return out;
}

/** Whether spoken words carry swearing (pure): the lane's Whisper words over the cut. */
export function strongLanguage(words: string): boolean {
  return SWEAR.test(words);
}

/** Captions by kind of moment, the friend voice: short, warm, aimed at the game or the situation, never at a person. */
export const CAPTIONS: Record<
  string,
  Array<{ hook: string; punch: string }>
> = {
  physics: [
    { hook: "Physics had other plans", punch: "Newton says hi" },
    { hook: "That went well", punch: "Gravity: 1" },
    { hook: "Totally intended", punch: "Nope" },
  ],
  npc: [
    { hook: "The locals, everybody", punch: "Why though" },
    { hook: "Nobody told him the plan", punch: "Bold choice" },
  ],
  glitch: [
    { hook: "The game blinked first", punch: "Working as intended" },
    { hook: "That is not how this works", punch: "Bug or feature?" },
  ],
  fail: [
    { hook: "The plan was flawless", punch: "Until it wasn't" },
    { hook: "Confidence: high. Skill: pending", punch: "Nope" },
    { hook: "Watch this", punch: "Oh no" },
  ],
  near_miss: [
    { hook: "Inches. Literal inches", punch: "Too close" },
    { hook: "Hold my controller", punch: "How?!" },
    { hook: "Pilot licence: pending", punch: "Still pending" },
  ],
  none: [{ hook: "Wait for it", punch: "Called it" }],
};

/** A caption and punchline for a moment (pure): the model's caption when it passes, else the bank, varied by id. */
export function pickCaption(
  kind: string,
  id: string,
  modelCaption?: string,
): { hook: string; punch: string } {
  const bank = CAPTIONS[kind] ?? CAPTIONS.none!;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pick = bank[h % bank.length]!;
  const hook =
    modelCaption && !captionProblems(modelCaption).length
      ? modelCaption
      : pick.hook;
  return { hook: hook.replace(/[.!]+$/, ""), punch: pick.punch };
}
