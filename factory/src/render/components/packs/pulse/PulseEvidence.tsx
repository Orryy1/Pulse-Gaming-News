// Real evidence, full frame (src/editorial/evidence.ts, DOC_EVIDENCE): a key beat of a documentary shown as the
// record itself, the way the breakout faceless documentaries cut to the studio's letter or the review aggregate.
// Two pages, each in a Pulse browser window with the source in its address bar and a credit strip:
//   - statement: the statement's exact words (a grounded quote, or the source's own passage) set large, the
//     issuer above it, the key phrase marked as the narrator reaches it;
//   - aggregate: the aggregator's figure as the source gives it ("86/100"), or its verdict words, in big type.
// Honesty: every word on the page comes from the graphic, which the writer's grounding and markEvidence took
// from the source; labels are fixed ("FROM THE RECORD", "STATEMENT", "REVIEW AGGREGATE"); no company letterhead,
// no logo, no site design is copied; the address bar shows the page Pulse read the words on.
import React from "react";
import { interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps } from "../types.ts";
import { clamp, sizeByLength, txt, wordCount } from "../screen/common.ts";
import { PulseMark } from "../screen/pulse.tsx";

const KIND_LABEL: Record<string, string> = {
  announcement: "THE ANNOUNCEMENT",
  delay: "THE DELAY",
  apology: "THE APOLOGY",
  verdict: "THE VERDICT",
  sales: "THE MILESTONE",
  statement: "THE STATEMENT",
};

/** The address bar: the article the words were read on (a Wikipedia credit), else the credit itself. */
export function evidenceAddress(credit: string): string {
  const m = credit.match(/Wikipedia[:,]\s*(.+)$/);
  return m
    ? `en.wikipedia.org/wiki/${m[1]!.trim().replace(/\s+/g, "_")}`
    : credit;
}

const VERDICT_WORDS =
  /^(universal acclaim|generally favou?rable|mixed or average|generally unfavou?rable|overwhelming dislike|mighty|strong|fair|weak)$/i;

/** What an aggregator's figure measures, as the aggregator itself defines it (a fixed label, never a claim). */
export function aggregateLabel(outlet: string, score: string): string {
  if (!/\d/.test(score)) return `${outlet}'s verdict`;
  if (/%/.test(score)) return "of critics recommend it";
  return outlet === "Metacritic" ? "Metascore" : "Top Critic Average";
}

/**
 * "Metacritic: 86/100" or "Metacritic: generally favorable" rows; undefined unless every row names an aggregator
 * and a figure or the aggregator's own verdict words.
 */
export function aggregateRows(
  items: string[],
): Array<{ outlet: string; score: string; label: string }> | undefined {
  const rows = items.map((x) => {
    const i = x.indexOf(":");
    if (i <= 0) return undefined;
    const outlet = txt(x.slice(0, i));
    const score = txt(x.slice(i + 1));
    return { outlet, score, label: aggregateLabel(outlet, score) };
  });
  return rows.length &&
    rows.every(
      (r) =>
        r &&
        /^(Metacritic|OpenCritic)$/i.test(r.outlet) &&
        (/\d/.test(r.score) || VERDICT_WORDS.test(r.score)),
    )
    ? (rows as Array<{ outlet: string; score: string; label: string }>)
    : undefined;
}

/** The statement page can draw this graphic: a quote or a passage of 4-80 words, tagged as evidence. */
export const fitsEvidenceStatement = (g: MomentGraphic) =>
  g.evidence?.page === "statement" &&
  (g.kind === "quote" || g.kind === "source") &&
  wordCount(txt(g.primary)) >= 4 &&
  wordCount(txt(g.primary)) <= 80;

/** The aggregate page can draw this graphic: aggregator rows, or the source's sentence with its verdict words. */
export const fitsEvidenceAggregate = (g: MomentGraphic) =>
  g.evidence?.page === "aggregate" &&
  ((g.kind === "reviews" && !!aggregateRows(g.items)) ||
    (g.kind === "source" && wordCount(txt(g.primary)) <= 80));

const Window: React.FC<{
  address: string;
  rise: number;
  children: React.ReactNode;
}> = ({ address, rise, children }) => (
  <div
    style={{
      width: 1500,
      background: "#F7F6F2",
      borderRadius: 18,
      overflow: "hidden",
      boxShadow: "0 40px 120px rgba(0,0,0,0.55)",
      transform: `translateY(${(1 - rise) * 80}px) scale(${0.96 + 0.04 * rise})`,
      opacity: rise,
    }}
  >
    <div
      style={{
        height: 64,
        background: "#E4E2DC",
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "0 24px",
      }}
    >
      {["#E2574C", "#F2B13B", "#5DB65A"].map((c) => (
        <div
          key={c}
          style={{ width: 16, height: 16, borderRadius: 8, background: c }}
        />
      ))}
      <PulseMark size={30} colour={COLOUR.amber} />
      <div
        style={{
          flex: 1,
          height: 38,
          borderRadius: 19,
          background: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          padding: "0 22px",
          fontFamily: BODY,
          fontSize: 22,
          color: "#55524B",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {address}
      </div>
    </div>
    {children}
  </div>
);

const Credit: React.FC<{ credit: string; at: number }> = ({ credit, at }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 20,
      padding: "22px 56px",
      borderTop: "2px solid #DDDAD2",
      fontFamily: BODY,
      fontSize: 24,
      color: "#3B3833",
      opacity: at,
    }}
  >
    <span
      style={{
        fontFamily: DISPLAY,
        fontSize: 24,
        letterSpacing: 3,
        color: "#FFFFFF",
        background: COLOUR.amber,
        padding: "4px 12px",
        borderRadius: 4,
      }}
    >
      SOURCE
    </span>
    <span>{credit}</span>
  </div>
);

/** The words of the passage with the key phrase marked once the narrator has reached it. */
const Marked: React.FC<{
  text: string;
  mark: string;
  sweep: number;
  size: number;
}> = ({ text, mark, sweep, size }) => {
  const i = mark ? text.toLowerCase().indexOf(mark.toLowerCase()) : -1;
  const parts =
    i >= 0
      ? [
          text.slice(0, i),
          text.slice(i, i + mark.length),
          text.slice(i + mark.length),
        ]
      : [text, "", ""];
  return (
    <span style={{ fontSize: size }}>
      {parts[0]}
      {parts[1] && (
        <span
          style={{
            backgroundImage: `linear-gradient(${COLOUR.amber}66, ${COLOUR.amber}66)`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${sweep * 100}% 100%`,
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {parts[1]}
        </span>
      )}
      {parts[2]}
    </span>
  );
};

export const PulseEvidence: React.FC<GfxProps> = ({ g, len, bg, variant }) => {
  const { frame, fps, dim, visible } = useStage(len, 260);
  if (!visible || !g.evidence) return null;
  const ev = g.evidence;
  const rise = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 22,
  });
  const textIn = interpolate(frame, [10, 34], [0, 1], clamp);
  const sweep = interpolate(frame, [40, 70], [0, 1], clamp);
  const creditIn = interpolate(frame, [24, 40], [0, 1], clamp);
  const label = KIND_LABEL[ev.kind] ?? "FROM THE RECORD";
  const rows = g.kind === "reviews" ? aggregateRows(g.items) : undefined;
  const body = txt(g.primary).replace(/^["“]|["”]$/g, "");
  const quoted = g.kind === "quote";
  const size = sizeByLength(body.length, [
    [90, 64],
    [160, 52],
    [260, 42],
    [380, 36],
    [10_000, 31],
  ]);
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <Window address={evidenceAddress(ev.credit)} rise={rise}>
        <div style={{ padding: "48px 56px 40px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              fontFamily: DISPLAY,
              fontSize: 30,
              letterSpacing: 4,
              color: COLOUR.amber,
            }}
          >
            <span>FROM THE RECORD</span>
            <span style={{ color: "#9A968C" }}>·</span>
            <span style={{ color: "#2A2824" }}>
              {rows ? "REVIEW AGGREGATE" : label}
            </span>
          </div>
          {ev.issuer && !rows && (
            <div
              style={{
                marginTop: 18,
                fontFamily: BODY,
                fontWeight: 700,
                fontSize: 34,
                color: "#2A2824",
              }}
            >
              {quoted ? "Statement by " : ""}
              {txt(ev.issuer)}
            </div>
          )}
          {rows ? (
            <div
              style={{
                display: "flex",
                gap: 40,
                marginTop: 36,
                opacity: textIn,
              }}
            >
              {rows.map((r) => (
                <div
                  key={r.outlet}
                  style={{
                    flex: 1,
                    background: "#FFFFFF",
                    border: "2px solid #DDDAD2",
                    borderRadius: 14,
                    padding: "34px 40px",
                  }}
                >
                  <div
                    style={{
                      fontFamily: BODY,
                      fontWeight: 700,
                      fontSize: 34,
                      color: "#55524B",
                    }}
                  >
                    {r.outlet}
                  </div>
                  <div
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: /[0-9]/.test(r.score) ? 168 : 76,
                      lineHeight: /[0-9]/.test(r.score) ? 1.05 : 1.2,
                      margin: /[0-9]/.test(r.score) ? 0 : "28px 0",
                      color: "#141310",
                    }}
                  >
                    {/[0-9]/.test(r.score) ? r.score : `"${r.score}"`}
                  </div>
                  <div
                    style={{ fontFamily: BODY, fontSize: 26, color: "#6B675E" }}
                  >
                    {r.label}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                marginTop: 30,
                fontFamily: "Georgia, 'Times New Roman', serif",
                lineHeight: 1.32,
                color: "#141310",
                opacity: textIn,
                transform: `translateY(${(1 - textIn) * 14}px)`,
              }}
            >
              {quoted ? "“" : ""}
              <Marked
                text={body}
                mark={txt(g.items[0] ?? "")}
                sweep={sweep}
                size={size}
              />
              {quoted ? "”" : ""}
            </div>
          )}
        </div>
        <Credit credit={txt(ev.credit)} at={creditIn} />
      </Window>
    </Stage>
  );
};
