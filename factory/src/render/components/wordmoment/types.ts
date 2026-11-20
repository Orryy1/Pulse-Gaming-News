// The word-moment suite (owner, 30 Oct 2026: "those red stamps are being too overused in shorts, we need
// WAY more variety and the same visual fidelity across all types"). Every Short has one word moment: the
// spoken word that carries the news lands on screen with its text, an optional sub line and a colour by
// tone (src/editorial/schema.ts `stamp`). The rubber stamp used to draw every one; now it is one look among
// many, and src/render/wordlook.ts picks a look per Short with a memory of the last twelve.
//
// A look's contract is the stamp's: it is placed in a Sequence that starts on the spoken word's frame, it
// holds for STAMP_FRAMES (under two seconds) and lifts in the last eight, it reads fully inside twelve
// frames, it shows only the stamp's text and sub, it uses the stamp's tone colour, and it is a pure
// function of the frame (no Math.random, no state). The Short dims the shelf while a moment holds.
import type React from "react";

export type Tone = "confirm" | "alert" | "price" | "neutral";

export interface WordStamp {
  /** Seconds the moment lands: the spoken word's start. */
  at: number;
  /** 1-3 words in capitals, 14 characters at most. */
  text: string;
  /** 0-2 words under it, or none. */
  sub?: string;
  /** The tone colour (src/render/brand.ts stampColour). */
  colour: string;
  tone?: Tone;
}

export interface WordMomentProps {
  stamp: WordStamp;
  /** Frames the moment stays on screen (STAMP_FRAMES). */
  hold?: number;
  /** Where the moment's band starts, in px from the top of the 1080x1920 frame. */
  top?: number;
  /** The headline's type size in px; everything else scales from it. */
  size?: number;
  variant?: number;
}

/** The sound that lands with a look (src/render/soundscape.ts SFX and RETRO_SFX). */
export type WordSound = "land" | "glint" | "air" | "vhs" | "static" | "tvon";

export interface WLook {
  /** Plain-English name for logs, events and previews. */
  name: string;
  component: React.FC<WordMomentProps>;
  /** Can this look draw the stamp? Length limits and text shapes (a date, a price). */
  fits?: (stamp: WordStamp) => boolean;
  /** The tones it suits; any when omitted. */
  tone?: Tone[];
  /** The game years it suits (inclusive); any when omitted. */
  era?: { from?: number; to?: number };
  /** Motif ids (src/render/components/motifs) whose look it matches, preferred when the Short wears one. */
  motifs?: string[];
  sound: WordSound;
}
