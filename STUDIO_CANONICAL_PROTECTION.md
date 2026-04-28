# Studio Canonical Protection

## Principle

Studio V2 canonical remains the default render unless a candidate beats it on evidence. A larger diff, more effects or a more complex scene graph is not enough.

## Current Evidence

Latest QA dossier:

- Gauntlet verdict: `fail`
- Current channel verdict: `warn`
- Release-ready current channels: `0/3`
- Best gauntlet candidate: `1sn9xhe:canonical`
- Historical failure count retained: `5`

The canonical Pulse render still warns on amber metrics but remains the best available baseline. Stacked and The Signal variants show weaker source diversity, lower clip dominance and hot true peak warnings.

## Required Candidate Gates

Any new render candidate must pass:

- Studio gauntlet
- Forensic QA
- Subtitle timeline QA
- Audio recurrence QA
- Source diversity gate
- Beat-awareness gate
- Repeated-still gate
- Black-screen/dead-zone gate
- Thumbnail safety QA
- Human visual review when subjective quality is uncertain

## Hard Reject Conditions

Reject a render candidate if any of these are true:

- Slideshow-like verdict
- Subtitle fallback used for premium output
- Corrupted alignment or caption blackout
- Black-screen/dead-zone segment
- Audio recurrence warning
- Major gauntlet drop against canonical
- Source diversity materially below canonical
- Repeated still abuse
- Adjacent duplicate cards
- Premium assets missing
- Unsafe thumbnail candidate

## Promotion Rule

Promotion requires a side-by-side proof, contact sheet, machine-readable report and markdown judgement. If canonical wins or the result is only debatably better, keep canonical.

## Operator Commands

- `npm run studio:v2:dossier`
- `npm run studio:v2:gauntlet`
- `npm run studio:v21:gate`
- `npm run media:inventory`

## Current Decision

Do not replace canonical. The true creative bottleneck is still media inventory and repeatable clip acquisition, not more authored overlay complexity.

