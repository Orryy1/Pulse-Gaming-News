# Studio Short Engine v1 Success Rubric

This rubric is for local prototype evaluation only. It separates checks the harness can score automatically from checks that still require human eyes or ears.

## Automatically measured

| Area | Passing signal | Failure signal |
| --- | --- | --- |
| Hook quality | Hook is 12 words or fewer, no banned opener, no filler phrase | Starts with So, Today, Hey, Welcome or uses generic suspense |
| Spoken pacing | 120 to 150 words preferred, 130 to 140 ideal for 50s, no long filler section | Over 160 words or repeated low-information sentence shapes |
| Source diversity | At least 3 topical source identities | Dominated by one still source or crop variants |
| Clip usage | At least 3 clip-backed scenes for `1sn9xhe` | Fewer than 2 clips |
| Scene variety | At least 4 scene types | Mostly still or clip.frame scenes |
| Anti-repetition | No still source used more than twice | Third use of the same still source |
| Subtitle integrity | Dialogue lines exist, last line ends within audio, no long caption blackout | Captions run past audio or have a detected blackout risk |
| Voice quality warning | Uses local Liam-style fixture or current best Liam path | Uses stale wrong-voice fixture without warning |
| Sound design richness | Music, narration and at least one subtle stinger are present | Voice only or music overpowers narration |
| Card lane polish | HyperFrames used for source card and one more premium card type | Card lane stays purely theoretical |
| Slideshow verdict | clip plus card ratio is 0.45 or higher, stock filler is zero | Clip count low, repeated stills high or stock filler present |

## Human judged

- Hook: does the first second feel specific, direct and creator-edited rather than generated?
- Spoken pacing: does the narration feel intentionally cut or just compressed?
- Source diversity: do the visuals feel like the actual story rather than generic gaming wallpaper?
- Clip usage: do the trailer slices carry the edit or feel dropped in randomly?
- Scene variety: does each scene type earn its place?
- Anti-repetition: are there visible moments where the same image returns too soon?
- Subtitle handling: are captions readable, timed and not fighting the frame?
- Voice quality: does Liam-style local audio help the piece or still sound synthetic?
- Sound layer: does the bed and stinger support momentum without drawing attention to itself?
- Card and overlay polish: do the HyperFrames cards look more premium than ffmpeg cards?
- Slideshow feel: does the final render finally feel less like repeated stills with overlays?

## V1 bar

A v1 prototype passes if it is stock-free, clip-first, uses narrow HyperFrames cards, has no obvious repeated still cycling, has no subtitle blackout and is materially better than legacy, PRL and the prior studio prototype on `1sn9xhe`.

It can still fail the "seasoned creator studio" bar if the voice remains too synthetic, the edit rhythm feels automated or the cards look premium in isolation but disconnected from the cut.
