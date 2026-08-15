# Current-release illustrative footage policy

## Purpose

Pulse Gaming technical explainers may use current-release footage as an illustrative moving canvas only when the game, shot type and visible action are genuinely relevant to the subject being explained. Popularity is a secondary ranking signal, not a substitute for topic fit.

## Semantic fit gate

Every candidate must pass all of the following before views, freshness or controlled randomness are considered:

- The candidate is explicitly approved for the individual story ID.
- Its topic tags meet the story's minimum match requirement.
- Its content type is allowed for that story.
- It contains every required visual trait.
- It contains none of the story's forbidden visual traits.

For example, the render-queue and input-latency explainer requires actual first-person competitive gameplay where frame rate and response time visibly matter. A sports reveal containing live-action actors cannot qualify. The texture-streaming explainer requires a large open world, world traversal and varied environments rather than merely any graphically detailed game.

## Source and ranking controls

- System Trace uses `current-release-illustrative` mode and never falls through to the legacy generic B-roll search.
- Sources must come from the official-channel allowlist in `config/current-release-footage-pool.json`.
- A source must remain inside its configured market window and meet either the minimum-view threshold or the fresh-release threshold.
- Popularity ranks only the candidates that have already passed the semantic fit gate.
- Randomness is limited to near-equivalent candidates within the configured maximum score gap.
- A cooldown prevents the same release appearing in adjacent production slots.
- Source audio is always muted.
- Every frame carries a discreet `ILLUSTRATIVE GAMEPLAY` source label.
- Acquired clips retain the source URL, official channel, video ID, content hash and selection evidence.
- Public release requires a separate rights review. A private technical preview is not publication authority.
- If no semantically suitable official source exists, production holds.

## Refresh and expiry

Run the pool refresh before each production batch. The render path also performs a low-cost live YouTube statistics read when an API key is available. If live validation is unavailable, the local snapshot may be used only for 24 hours. An older snapshot causes a HOLD.
