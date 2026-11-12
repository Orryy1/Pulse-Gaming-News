# Character quote playback plan

Character quote playback is deferred. `CUTSCENE_QUOTES` currently collects caption candidates after a script has already been written. It does not supply them to the production writers or play them. The optional writer inputs are available for a later integration. Cutscene footage remains silent, including when this setting is on.

The current download in `src/assets/cutscenes.ts` chooses a picture stream and `silentSectionArgs` strips audio. `src/editorial/schema.ts` builds one continuous narration string, and the pipeline voices and aligns that string before `gatherMedia` finds cutscenes. `src/render/Short.tsx` and `src/render/Long.tsx` each play the narration as a continuous audio track. Changing only a clip's `audio` flag would put dialogue over the narrator, and a cutscene found after writing cannot inform the writer.

To complete playback:

1. Find and persist the selected game's caption candidates before `writeScript` or `writeChapter`. Keep the video ID, title, uploader, exact cue times and a stable quote ID. Pass only candidates for that exact game to the corresponding writer. Retain the writer validation and repeat it after every rewrite and conversion to the shared script shape.
2. Treat captions as unverified candidates. Confirm that the words are a character's actual in-game speech, the source is the correct game and edition, the quoted words are exact and the material is suitable for advertisers. Automatic captions and a word filter cannot establish any of those facts. Apply the existing source, rights, publisher and footage limits before using the clip.
3. Obtain a section with both game picture and audio for the selected ID and cue, and cut the exact source interval. Preserve a silent path for every other cutscene. Screen the complete quote clip for overlays, text, blank frames and unsuitable imagery. Reject missing audio, truncated speech, inaccurate captions or an unclean frame rather than substituting another clip.
4. Synthesize narrator lines without the quote text, insert a silence of the verified clip's duration at that position and update word timings, chapter breaks, SRT captions and the persisted total duration together. Place the quote clip on that gap and bind it to the exact beat. Handle retries without inserting silence twice, and invalidate any older cached plan.
5. In both renderers, play that clip's game audio only in its reserved gap, with short fades and measured loudness matched to the narration. Keep unrelated footage muted and keep music and effects below the dialogue. Check that the quote is neither repeated by the narrator nor clipped at either end.
6. Add no-network tests for both writers, exact ID and text validation, rejected unsafe or unavailable cues, the audio exception, source offsets, non-overlapping narration and quote windows, timing shifts, captions, retries, both formats and disabled settings. Follow with a locally authorised proof render and listen to the complete mix before enabling this path.

Chapter and caption matches are textual hints, not visual proof of an action. A scene-upload title identifies a source, not the exact moment inside it. The current planner prefers a located clip for its target, but does not guarantee a match on every spoken word. Visual and timing review remains necessary.

## Status, 11 Nov 2026

Not built. It does not fit a contained change: step 4 needs the voice step (`src/voice/*` and the pipeline's voice and alignment step) to synthesise the narration around a reserved gap and shift every word timing, which another change is reworking now, and steps 1, 3 and 5 touch both writers, the cutscene download (a second, audio-keeping path) and both renderers. `CUTSCENE_QUOTES` still only saves caption candidates to `cutscene_quotes.json`. Zelda's characters mostly do not speak, so the first proof should be a voiced game (GTA, God of War, Final Fantasy, Metal Gear).

Scene footage itself (`CUTSCENE_SCENES`) now has the picture check it was missing: every lit keyframe of a located section goes to Claude with its line, one call per line, and a clip is cut from the frame Claude confirms, inside that shot. See `docs/cutscene-scenes-proof.json`.
