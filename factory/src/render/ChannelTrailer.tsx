// The channel trailer for visitors who have not subscribed (channel page plan, 14 Nov 2026): a 54-second 16:9 cut
// made from the channel's own published Shorts, documentaries and the official GTA VI footage they used, over one
// narration take. The clips sit in public/trailer/ (copied from the episodes, never committed). The beats follow the
// narration's word timings: hook, what the channel is, GTA 6 Day N, The Why, rankings and documentaries, subscribe.
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "./brand.ts";
import { BODY, DISPLAY } from "./components/fonts.ts";

export const TRAILER_FPS = 30;
export const TRAILER_W = 1920;
export const TRAILER_H = 1080;
/** The narration starts this far in, so the first word never lands on frame 0. */
const VO = 0.4;
export const TRAILER_SECONDS = 54.4;

const AMBER = COLOUR.amber;
const INK = COLOUR.ink;
const PAPER = COLOUR.paper;

/** A narration time in seconds as a frame of the trailer. */
const f = (s: number) => Math.round((s + VO) * TRAILER_FPS);
const clip = (name: string) => staticFile(`trailer/${name}.mp4`);

/** Full-frame footage, pushed in a little (hides the trailers' letterbox) with a slow drift. */
const Footage: React.FC<{ name: string; dim?: number; from?: number; zoom?: number }> = ({
  name,
  dim = 0,
  zoom = 1.16,
  from = 0,
}) => {
  const frame = useCurrentFrame();
  const scale = zoom + frame * 0.0009;
  return (
    <AbsoluteFill style={{ background: INK, overflow: "hidden" }}>
      <OffthreadVideo
        src={clip(name)}
        muted
        startFrom={from}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
        }}
      />
      {dim > 0 ? (
        <AbsoluteFill style={{ background: `rgba(11,11,14,${dim})` }} />
      ) : null}
    </AbsoluteFill>
  );
};

/** The ink field the card scenes sit on: a warm glow, a faint grid and grain. */
const Field: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(70% 70% at 50% 40%, #22201f 0%, ${INK} 75%)`,
    }}
  >
    <AbsoluteFill
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
        backgroundSize: "80px 80px",
      }}
    />
    <AbsoluteFill
      style={{
        backgroundImage: `url(${staticFile("grain.png")})`,
        opacity: 0.12,
      }}
    />
  </AbsoluteFill>
);

/** One Short in a phone-shaped card, sliding up into place. */
const Phone: React.FC<{
  name: string;
  x: number;
  delay?: number;
  h?: number;
  tilt?: number;
  y?: number;
}> = ({ name, x, delay = 0, h = 820, tilt = 0, y = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame: frame - delay,
    fps,
    config: { damping: 16, stiffness: 140 },
  });
  const w = (h * 9) / 16;
  return (
    <div
      style={{
        position: "absolute",
        left: x - w / 2,
        top: (TRAILER_H - h) / 2 + y + (1 - p) * 500,
        width: w,
        height: h,
        opacity: p,
        transform: `rotate(${tilt}deg)`,
        borderRadius: 34,
        overflow: "hidden",
        border: `6px solid ${PAPER}`,
        boxShadow: "0 40px 90px rgba(0,0,0,0.65)",
        background: INK,
      }}
    >
      <Sequence from={delay} layout="none">
        <OffthreadVideo
          src={clip(name)}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </Sequence>
    </div>
  );
};

/** An amber plate with ink text: the channel's label style. */
const Plate: React.FC<{
  children: React.ReactNode;
  size?: number;
  delay?: number;
  style?: React.CSSProperties;
  ink?: boolean;
}> = ({ children, size = 64, delay = 0, style, ink }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, stiffness: 180 },
  });
  return (
    <div
      style={{
        display: "inline-block",
        background: ink ? INK : AMBER,
        color: ink ? PAPER : INK,
        fontFamily: DISPLAY,
        fontSize: size,
        lineHeight: 1.08,
        padding: `${size * 0.1}px ${size * 0.32}px ${size * 0.04}px`,
        transform: `scaleX(${p})`,
        transformOrigin: "left center",
        opacity: frame < delay ? 0 : 1,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Big glanced text that pops in. */
const Pop: React.FC<{
  children: React.ReactNode;
  size: number;
  color?: string;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, size, color = PAPER, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, stiffness: 200 },
  });
  return (
    <div
      style={{
        fontFamily: DISPLAY,
        fontSize: size,
        lineHeight: 0.95,
        color,
        opacity: frame < delay ? 0 : 1,
        transform: `scale(${1.25 - 0.25 * p})`,
        textShadow: "0 8px 40px rgba(0,0,0,0.7)",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** The PULSE GAMING lockup (as on the banner). */
const Lockup: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ display: "flex" }}>
    <div
      style={{
        background: PAPER,
        color: INK,
        fontFamily: DISPLAY,
        fontSize: size,
        lineHeight: 1,
        padding: `${size * 0.06}px ${size * 0.22}px 0`,
      }}
    >
      PULSE
    </div>
    <div
      style={{
        background: AMBER,
        color: INK,
        fontFamily: DISPLAY,
        fontSize: size,
        lineHeight: 1,
        padding: `${size * 0.06}px ${size * 0.22}px 0`,
      }}
    >
      GAMING
    </div>
  </div>
);

/** A shade along the bottom so lower text reads on any footage. */
const Shade: React.FC<{ top?: boolean }> = ({ top }) => (
  <AbsoluteFill
    style={{
      background: top
        ? "linear-gradient(180deg, rgba(11,11,14,0.85) 0%, rgba(11,11,14,0) 45%)"
        : "linear-gradient(0deg, rgba(11,11,14,0.9) 0%, rgba(11,11,14,0) 50%)",
    }}
  />
);

const Cut: React.FC<{
  from: number;
  to: number;
  children: React.ReactNode;
}> = ({ from, to, children }) => (
  <Sequence from={f(from)} durationInFrames={f(to) - f(from)}>
    {children}
  </Sequence>
);

/** The GTA 6 Day N counter: the number changes on the word. */
const DayCounter: React.FC = () => {
  const frame = useCurrentFrame();
  const local = (s: number) => f(s) - f(12.0);
  const day = frame >= local(17.4) ? 3 : frame >= local(16.0) ? 2 : 1;
  const since =
    frame - (day === 3 ? local(17.4) : day === 2 ? local(16.0) : local(14.6));
  const kick = interpolate(since, [0, 6], [1.18, 1], {
    extrapolateRight: "clamp",
  });
  if (frame < local(14.6)) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        top: 150,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 14,
      }}
    >
      <Plate size={58} ink>
        GTA 6
      </Plate>
      <div
        style={{
          background: AMBER,
          color: INK,
          fontFamily: DISPLAY,
          fontSize: 230,
          lineHeight: 1,
          padding: "18px 40px 2px",
          transform: `scale(${kick})`,
          transformOrigin: "left top",
        }}
      >
        DAY {day}
      </div>
    </div>
  );
};

export const ChannelTrailer: React.FC = () => {
  const frame = useCurrentFrame();
  const total = Math.round(TRAILER_SECONDS * TRAILER_FPS);
  // Music: low under the voice, up for the end card, out over the last 1.5 s.
  const musicVol = (fr: number) =>
    interpolate(
      fr,
      [0, 12, f(48.6), f(49.4), total - 45, total],
      [0, 0.13, 0.13, 0.32, 0.32, 0],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      },
    );
  const sfx = (file: string, at: number, vol = 0.5) => (
    <Sequence from={f(at)} layout="none">
      <Audio src={staticFile(`sfx/${file}`)} volume={vol} />
    </Sequence>
  );
  return (
    <AbsoluteFill style={{ background: INK }}>
      {/* 1. Hook: GTA 6 lands on November 19th, and we play it every single day. */}
      <Cut from={-VO} to={1.4}>
        <Footage name="gta_plane" />
      </Cut>
      <Cut from={1.4} to={2.8}>
        <Footage name="gta_dance" />
      </Cut>
      <Cut from={2.8} to={4.0}>
        <Footage name="gta_bridge" />
      </Cut>
      <Cut from={4.0} to={5.0}>
        <Footage name="gta_street" />
      </Cut>
      <Cut from={5.0} to={6.4}>
        <Footage name="gta_jump" />
      </Cut>
      <Cut from={-VO} to={6.4}>
        <Shade />
        <div
          style={{
            position: "absolute",
            left: 120,
            bottom: 120,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <Pop size={220} delay={0}>
            GTA 6
          </Pop>
          <div>
            <Plate size={72} delay={f(1.4) - f(-VO)}>
              NOVEMBER 19
            </Plate>
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: 120,
            bottom: 130,
            display: "flex",
            gap: 28,
          }}
        >
          {[
            ["EVERY.", 4.9],
            ["SINGLE.", 5.4],
            ["DAY.", 5.8],
          ].map(([w, t]) => (
            <Pop
              key={w as string}
              size={120}
              color={w === "DAY." ? AMBER : PAPER}
              delay={f(t as number) - f(-VO)}
            >
              {w}
            </Pop>
          ))}
        </div>
      </Cut>

      {/* 2. This is Pulse Gaming: gaming news, checked against the sources, in under a minute. */}
      <Cut from={6.4} to={8.4}>
        <Field />
        <AbsoluteFill
          style={{ justifyContent: "center", alignItems: "center" }}
        >
          <div
            style={{
              transform: `scale(${interpolate(frame - f(6.4), [0, 8, 60], [1.3, 1, 1.05], { extrapolateRight: "clamp" })})`,
            }}
          >
            <Lockup size={190} />
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 44,
              color: PAPER,
              marginTop: 34,
              letterSpacing: 1,
            }}
          >
            The why behind the games you love
          </div>
        </AbsoluteFill>
      </Cut>
      <Cut from={8.4} to={12.0}>
        <Field />
        <Phone name="news_30fps" x={560} delay={0} tilt={-4} y={60} />
        <Phone name="news_xbox" x={960} delay={4} y={30} />
        <Phone name="news_steam" x={1360} delay={8} tilt={4} y={60} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 40,
            display: "flex",
            justifyContent: "center",
            gap: 18,
          }}
        >
          <Plate
            size={66}
            delay={0}
            ink
            style={{ border: `4px solid ${AMBER}` }}
          >
            GAMING NEWS
          </Plate>
          <Plate size={66} delay={f(9.5) - f(8.4)}>
            CHECKED
          </Plate>
          <Plate
            size={66}
            delay={f(10.8) - f(8.4)}
            ink
            style={{ border: `4px solid ${PAPER}` }}
          >
            UNDER A MINUTE
          </Plate>
        </div>
      </Cut>

      {/* 3. GTA 6 Day 1, Day 2, Day 3: a new episode every day from our own streams. */}
      <Cut from={12.0} to={14.5}>
        <Footage name="gta_lucia" />
      </Cut>
      <Cut from={14.5} to={17.3}>
        <Footage name="gta_crew" />
      </Cut>
      <Cut from={17.3} to={20.3}>
        <Footage name="gta_club" />
      </Cut>
      <Cut from={20.3} to={22.0}>
        <Footage name="gta_beach" />
      </Cut>
      <Cut from={22.0} to={25.0}>
        <Footage name="gta_bridge" />
      </Cut>
      <Cut from={12.0} to={25.0}>
        <Shade top />
        <Shade />
        {frame < f(14.6) ? (
          <div style={{ position: "absolute", left: 120, top: 150 }}>
            <Plate size={90} delay={f(12.2) - f(12.0)}>
              FROM LAUNCH DAY
            </Plate>
          </div>
        ) : null}
        <DayCounter />
        <div
          style={{
            position: "absolute",
            left: 120,
            bottom: 110,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            alignItems: "flex-start",
          }}
        >
          <Plate
            size={74}
            delay={f(18.5) - f(12.0)}
            ink
            style={{ borderLeft: `14px solid ${AMBER}` }}
          >
            A NEW EPISODE EVERY DAY
          </Plate>
          <Plate size={56} delay={f(20.2) - f(12.0)}>
            FROM OUR OWN GTA 6 STREAMS
          </Plate>
        </div>
        {frame >= f(22.8) ? (
          <div
            style={{
              position: "absolute",
              right: 120,
              top: 150,
              textAlign: "right",
            }}
          >
            <Pop size={84} delay={f(22.8) - f(12.0)}>
              WHAT'S WORTH YOUR TIME
            </Pop>
            <Pop size={84} color={AMBER} delay={f(24.0) - f(12.0)}>
              AND WHAT ISN'T
            </Pop>
          </div>
        ) : null}
      </Cut>

      {/* 4. The Why. */}
      <Cut from={25.0} to={27.0}>
        <Field />
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <Pop size={300} delay={f(25.9) - f(25.0)} color={AMBER}>
            THE WHY
          </Pop>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 40,
              color: PAPER,
              letterSpacing: 6,
              opacity: frame > f(26.1) ? 1 : 0,
            }}
          >
            A NEW STORY EVERY DAY
          </div>
        </AbsoluteFill>
      </Cut>
      <Cut from={27.0} to={29.3}>
        <Field />
        <Phone name="why_crash" x={1340} h={900} tilt={3} />
        <div style={{ position: "absolute", left: 120, top: 330, width: 820 }}>
          <Plate size={50} ink style={{ border: `4px solid ${AMBER}` }}>
            THE WHY
          </Plate>
          <Pop size={120} delay={4} style={{ marginTop: 20 }}>
            WHY SONY LOST CRASH BANDICOOT
          </Pop>
        </div>
      </Cut>
      <Cut from={29.3} to={33.2}>
        <Field />
        <Phone name="why_re4" x={580} h={900} tilt={-3} />
        <div style={{ position: "absolute", left: 980, top: 300, width: 820 }}>
          <Plate size={50} ink style={{ border: `4px solid ${AMBER}` }}>
            THE WHY
          </Plate>
          <Pop size={112} delay={4} style={{ marginTop: 20 }}>
            WHY CAPCOM SCRAPPED RESIDENT EVIL 4
          </Pop>
          <div style={{ marginTop: 22 }}>
            <Plate size={90} delay={f(31.8) - f(29.3)}>
              FOUR TIMES
            </Plate>
          </div>
        </div>
      </Cut>
      <Cut from={33.2} to={37.0}>
        <Field />
        <Phone name="why_crash" x={560} h={780} tilt={-4} y={70} />
        <Phone name="why_wow" x={960} h={780} delay={3} y={50} />
        <Phone name="why_re4" x={1360} h={780} delay={6} tilt={4} y={70} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 36,
            display: "flex",
            justifyContent: "center",
            gap: 18,
          }}
        >
          <Plate
            size={70}
            delay={0}
            ink
            style={{ border: `4px solid ${PAPER}` }}
          >
            ONE BIG QUESTION
          </Plate>
          <Plate size={70} delay={f(36.0) - f(33.2)}>
            ANSWERED PROPERLY
          </Plate>
        </div>
      </Cut>

      {/* 5. Rankings and documentaries. */}
      <Cut from={37.0} to={39.4}>
        <Field />
        <Phone name="rank_fallout" x={560} h={780} tilt={-4} y={70} />
        <Phone name="rank_halo" x={960} h={780} delay={3} y={50} />
        <Phone name="rank_mario" x={1360} h={780} delay={6} tilt={4} y={70} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 36,
            display: "flex",
            justifyContent: "center",
            gap: 18,
          }}
        >
          <Plate size={70} delay={0}>
            RANKINGS
          </Plate>
          <Plate
            size={70}
            delay={f(38.2) - f(37.0)}
            ink
            style={{ border: `4px solid ${PAPER}` }}
          >
            THAT PICK A SIDE
          </Plate>
        </div>
      </Cut>
      <Cut from={39.4} to={41.2}>
        <Footage name="doc_sa1" zoom={1} />
      </Cut>
      <Cut from={41.2} to={43.5}>
        <Footage name="doc_sa2" zoom={1} />
      </Cut>
      <Cut from={39.4} to={43.5}>
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(90deg, rgba(11,11,14,0.88) 0%, rgba(11,11,14,0) 60%)",
          }}
        />
        <div style={{ position: "absolute", left: 120, top: 330, width: 900 }}>
          <Plate size={70} delay={0}>
            FULL DOCUMENTARIES
          </Plate>
          <Pop size={104} delay={f(41.0) - f(39.4)} style={{ marginTop: 24 }}>
            WHY SAN ANDREAS NEVER GOT A SEQUEL
          </Pop>
        </div>
      </Cut>

      {/* 6. Subscribe. */}
      <Cut from={43.5} to={TRAILER_SECONDS}>
        <Footage name="gta_logo" dim={0.72} />
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(60% 70% at 50% 50%, rgba(11,11,14,0.55) 0%, rgba(11,11,14,0.92) 100%)",
          }}
        />
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            flexDirection: "column",
            gap: 30,
          }}
        >
          <Lockup size={110} />
          <Pop size={150} delay={4}>
            GTA 6 EVERY DAY
          </Pop>
          <Pop
            size={66}
            color={AMBER}
            delay={f(45.2) - f(43.5)}
            style={{ fontFamily: BODY, fontWeight: 900 }}
          >
            + THE STORIES BEHIND THE GAMES YOU LOVE
          </Pop>
          <div
            style={{
              marginTop: 20,
              background: "#FF0033",
              color: "#fff",
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 54,
              padding: "18px 56px",
              borderRadius: 999,
              letterSpacing: 2,
              opacity: frame >= f(46.4) ? 1 : 0,
              transform: `scale(${frame >= f(46.4) ? 1 + 0.05 * Math.sin((frame - f(46.4)) / 6) : 1})`,
              boxShadow: "0 20px 60px rgba(255,0,51,0.35)",
            }}
          >
            SUBSCRIBE
          </div>
          <div style={{ marginTop: 6, opacity: frame >= f(47.7) ? 1 : 0 }}>
            <Plate
              size={58}
              delay={f(47.7) - f(43.5)}
              ink
              style={{ border: `4px solid ${AMBER}` }}
            >
              SEE YOU ON DAY 1 · NOVEMBER 19
            </Plate>
          </div>
        </AbsoluteFill>
        <Img
          src={staticFile("logo.png")}
          style={{
            position: "absolute",
            right: 60,
            top: 50,
            height: 90,
            opacity: 0.9,
          }}
        />
      </Cut>

      {/* Sound. */}
      <Audio src={staticFile("music/mood_triumph_1.wav")} volume={musicVol} />
      <Sequence from={f(0)} layout="none">
        <Audio src={staticFile("trailer/voice.mp3")} volume={1} />
      </Sequence>
      {sfx("punch-deep.mp3", 0.0, 0.45)}
      {sfx("whoosh-short.mp3", 6.3, 0.4)}
      {sfx("whoosh-short.mp3", 11.9, 0.35)}
      {sfx("punch-deep.mp3", 14.6, 0.4)}
      {sfx("punch-deep.mp3", 16.0, 0.4)}
      {sfx("punch-deep.mp3", 17.4, 0.4)}
      {sfx("whoosh-short.mp3", 24.9, 0.4)}
      {sfx("whoosh-short.mp3", 36.9, 0.35)}
      {sfx("whoosh-short.mp3", 43.4, 0.35)}
      {sfx("sting.mp3", 46.4, 0.35)}
    </AbsoluteFill>
  );
};
