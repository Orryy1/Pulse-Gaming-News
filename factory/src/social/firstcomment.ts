// The channel's first comment under a Short (FIRST_COMMENT_QUESTION). The stock opener "What do you make of it?" asks
// nothing a viewer can argue about, while the video itself usually ends on a real two-sided question (53 of the 65
// videos published 21 Oct to 4 Nov 2026). So the comment asks the same question the video just asked, and the two
// faults seen in the 4 Nov comments are cleaned up: a verdict stamp read out as a word ("Our verdict: STEADY: a name")
// and a ranking criterion used as a game's name ("Which 3D Super Mario games game would you move"). No model call.

import type { Script } from "../editorial/schema.ts";
import { pinnedComment } from "../editorial/seo.ts";

const QUESTION_MAX = 140;

/** The video's own closing question, when it is about this video (never a tease for the next one). */
export function arguableQuestion(script: Script): string {
  const q = (script.loop_line ?? "").replace(/—/g, ",").trim();
  if (!q.endsWith("?") || q.length > QUESTION_MAX || q.split(/\s+/).length < 4)
    return "";
  if (/\b(next why|tomorrow|next episode|next week)\b/i.test(q)) return "";
  return q;
}

/** True for the plain story Shorts, whose comment opens on one general question. */
function isStoryShort(s: Script): boolean {
  return (
    !s.gameplay &&
    !s.cutdown &&
    !s.recap &&
    !s.evergreen_format &&
    !s.entries?.length &&
    s.runtime !== "long"
  );
}

export function firstComment(script: Script): string {
  let text = pinnedComment(script);
  // "Our verdict: STEADY: a name, no date yet" reads as a machine's label, whichever words lead it.
  text = text.replace(
    /\b(verdict|take|line|version|read)\s*:\s*[A-Z]{3,}(?:\s+[A-Z]{3,})*\s*:\s*/,
    "$1: ",
  );
  // A criterion or plural in the game slot ("Which 3D Super Mario games game"): ask without the name.
  text = text.replace(
    /Which ([^?]{28,}|[^?]*\bgames) game would you move up or down the list\?/,
    "Which one would you move up or down the list?",
  );
  if (isStoryShort(script)) {
    const q = arguableQuestion(script);
    if (q) text = text.replace(/^[^?]*\?/, q);
  }
  return text;
}
