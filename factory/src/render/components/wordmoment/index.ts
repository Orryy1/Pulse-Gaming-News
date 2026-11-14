// Every word-moment look by name, for the Short's one stamp moment (./types.ts for the contract). The
// rubber stamp (../Stamp.tsx) is one look among the rest. `tone`, `era`, `fits` and `motifs` say what each
// suits; src/render/wordlook.ts picks one per Short from these with a memory of the last twelve.
import React from "react";
import { Stamp } from "../Stamp.tsx";
import type { WLook, WordMomentProps } from "./types.ts";
import { DEFAULT_SIZE, DEFAULT_TOP } from "./kit.tsx";
import { Sticker, fitsSticker } from "./looks/Sticker.tsx";
import { Marker, fitsMarker } from "./looks/Marker.tsx";
import { Neon, fitsNeon } from "./looks/Neon.tsx";
import { SplitFlap, fitsSplitFlap } from "./looks/SplitFlap.tsx";
import { Ticket, fitsTicket } from "./looks/Ticket.tsx";
import { Dymo, fitsDymo } from "./looks/Dymo.tsx";
import { PriceGun, fitsPriceGun } from "./looks/PriceGun.tsx";
import { WaxSeal, fitsWaxSeal } from "./looks/WaxSeal.tsx";
import { Passport, fitsPassport } from "./looks/Passport.tsx";
import { Stencil, fitsStencil } from "./looks/Stencil.tsx";
import { LedTicker, fitsLedTicker } from "./looks/LedTicker.tsx";
import { Vhs, fitsVhs } from "./looks/Vhs.tsx";
import { Typewriter, fitsTypewriter } from "./looks/Typewriter.tsx";
import { Chalk, fitsChalk } from "./looks/Chalk.tsx";
import { FileStamp, fitsFileStamp } from "./looks/FileStamp.tsx";
import { Highlighter, fitsHighlighter } from "./looks/Highlighter.tsx";
import { Metal, fitsMetal } from "./looks/Metal.tsx";
import { TornBanner, fitsTornBanner } from "./looks/TornBanner.tsx";

/** The rubber stamp as a look: the original, with the Short's band and size as its defaults. */
const StampLook: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
}) => React.createElement(Stamp, { stamp, hold, top, size });

export const W_STYLES: Record<string, WLook> = {
  Stamp: { name: "Rubber stamp", component: StampLook, sound: "land" },
  Sticker: {
    name: "Slapped sticker",
    component: Sticker,
    fits: fitsSticker,
    sound: "land",
    motifs: [
      "blocky",
      "wii-channels",
      "switch-home",
      "dual-screen",
      "gta",
      "pixel",
    ],
  },
  Marker: {
    name: "Marker ring",
    component: Marker,
    fits: fitsMarker,
    tone: ["neutral", "confirm", "alert"],
    sound: "air",
  },
  Neon: {
    name: "Neon sign",
    component: Neon,
    fits: fitsNeon,
    tone: ["neutral", "price", "confirm"],
    sound: "glint",
    motifs: [
      "scifi",
      "arena",
      "fighting",
      "ps3-xmb",
      "xbox-orb",
      "xbox-modern",
      "racing",
    ],
  },
  SplitFlap: {
    name: "Split-flap board",
    component: SplitFlap,
    fits: fitsSplitFlap,
    tone: ["neutral", "confirm", "alert"],
    sound: "glint",
    motifs: ["sports", "racing"],
  },
  Ticket: {
    name: "Punched ticket",
    component: Ticket,
    fits: fitsTicket,
    tone: ["neutral", "confirm"],
    sound: "land",
    motifs: ["sports", "racing", "wii-channels"],
  },
  Dymo: {
    name: "Dymo label",
    component: Dymo,
    fits: fitsDymo,
    tone: ["neutral", "alert"],
    sound: "glint",
    motifs: ["codec", "military"],
  },
  PriceGun: {
    name: "Price gun label",
    component: PriceGun,
    fits: fitsPriceGun,
    tone: ["price"],
    sound: "land",
  },
  WaxSeal: {
    name: "Wax seal",
    component: WaxSeal,
    fits: fitsWaxSeal,
    tone: ["confirm"],
    sound: "land",
    motifs: ["fantasy", "rpg", "souls", "reddead"],
  },
  Passport: {
    name: "Passport date stamp",
    component: Passport,
    fits: fitsPassport,
    tone: ["confirm", "neutral"],
    sound: "land",
  },
  Stencil: {
    name: "Spray stencil",
    component: Stencil,
    fits: fitsStencil,
    tone: ["alert", "neutral"],
    sound: "air",
    motifs: ["gta", "military", "codec", "fighting", "horror"],
  },
  LedTicker: {
    name: "LED ticker",
    component: LedTicker,
    fits: fitsLedTicker,
    sound: "glint",
    motifs: ["arena", "sports", "scifi", "x360-blades", "x360-nxe"],
  },
  Vhs: {
    name: "VHS insert",
    component: Vhs,
    fits: fitsVhs,
    era: { to: 1999 },
    sound: "vhs",
    motifs: ["ps1-memory", "pixel", "horror"],
  },
  Typewriter: {
    name: "Typewriter strike",
    component: Typewriter,
    fits: fitsTypewriter,
    tone: ["neutral", "alert"],
    sound: "glint",
    motifs: ["reddead", "fallout", "horror", "codec"],
  },
  Chalk: {
    name: "Chalkboard",
    component: Chalk,
    fits: fitsChalk,
    tone: ["neutral", "price"],
    sound: "air",
    motifs: ["sports", "rpg"],
  },
  FileStamp: {
    name: "File stamp",
    component: FileStamp,
    fits: fitsFileStamp,
    sound: "land",
  },
  Highlighter: {
    name: "Highlighter swipe",
    component: Highlighter,
    fits: fitsHighlighter,
    tone: ["neutral", "confirm"],
    sound: "air",
  },
  Metal: {
    name: "Metal plate",
    component: Metal,
    fits: fitsMetal,
    era: { from: 2000 },
    sound: "land",
    motifs: [
      "souls",
      "military",
      "xbox-modern",
      "xbox-orb",
      "racing",
      "fallout",
      "x360-nxe",
    ],
  },
  TornBanner: {
    name: "Torn banner",
    component: TornBanner,
    fits: fitsTornBanner,
    sound: "air",
    motifs: ["gta", "reddead", "ps2-towers"],
  },
};

/** The look to draw when the plan names none (an old plan, or a preview): the rubber stamp. */
export const DEFAULT_LOOK = "Stamp";
