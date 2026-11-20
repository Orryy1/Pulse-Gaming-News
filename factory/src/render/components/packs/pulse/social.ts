// Pulse universe, area "social": quotes drawn where they were said. Every style takes GfxProps (../types.ts);
// STYLES lists them by name. A post, an email and a chat each tell the viewer where the words were said, so each
// fits only a quote whose credit names that medium (./socialCredit.ts), never an interview quote. Inside its era
// each style picks the look of the story's year (and of the medium, where that names its own look).
import type { GfxStyle } from "../types.ts";
import { PulseSocial } from "./PulseSocial.tsx";
import { PulseMail } from "./PulseMail.tsx";
import { PulseChat } from "./PulseChat.tsx";
import {
  fitsPulseChat,
  fitsPulseMail,
  fitsPulseSocial,
} from "./socialCredit.ts";

export const STYLES: Record<string, GfxStyle> = {
  /**
   * primary: the quote word for word (3-60 words); secondary: who said it and where, e.g. "Leslie Benzies, on
   * Twitter, 2013" or "Sam Houser, on the Rockstar forums, 2004": social media, a forum, a blog, a message board
   * or a newsgroup. A Pulse Groups newsgroup reader to 1999, a Pulse Boards forum thread 2000-2009, a Pulse
   * Social feed post from 2010.
   */
  PulseSocial: {
    kind: "quote",
    component: PulseSocial,
    fits: fitsPulseSocial,
    sound: "glint",
    era: { from: 1985 },
  },
  /**
   * primary: the quote (3-70 words); secondary: who wrote it and how, e.g. "Dan Houser, in an internal email,
   * 2003": an email, memo, letter or note. A grey desktop Pulse Mail client to 2004, a clean webmail from 2005.
   */
  PulseMail: {
    kind: "quote",
    component: PulseMail,
    fits: fitsPulseMail,
    sound: "pop",
    era: { from: 1985 },
  },
  /**
   * primary: the quote (2-40 words); secondary: who sent it and how, e.g. "a Rockstar developer, in a Slack
   * message, 2022": a chat, message, text, SMS, DM or IRC. A Pulse Messenger buddy chat to 2008 (a Pulse Relay
   * channel for IRC), a Pulse Chat team window or a Pulse OS phone thread from 2009.
   */
  PulseChat: {
    kind: "quote",
    component: PulseChat,
    fits: fitsPulseChat,
    sound: "glint",
    era: { from: 1988 },
  },
};
