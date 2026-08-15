# Current-release illustrative footage policy

## Purpose

Pulse Gaming technical explainers may use unrelated gameplay as an illustrative moving canvas only when the source is a demonstrably current, high-interest release and the editorial explanation remains the primary work.

## Mandatory controls

- System Trace uses `current-release-illustrative` mode and never falls through to the legacy generic B-roll search.
- Sources must come from the official-channel allowlist in `config/current-release-footage-pool.json`.
- A source must remain inside its configured market window and meet either the minimum-view threshold or the fresh-release threshold.
- Story subject tags influence selection. Randomness is limited to the highest-scoring eligible band and is deterministic for a given production seed.
- A cooldown prevents the same release appearing in adjacent production slots.
- Source audio is always muted.
- Every frame carries a discreet `ILLUSTRATIVE GAMEPLAY` source label.
- Acquired clips retain the exact source URL, official channel, video ID, content hash and selection evidence.
- Public release requires a separate rights review. A private technical preview is not publication authority.
- If no eligible official source exists, production holds. It must not use an older title, fan upload or unrelated generic fallback.

## Refresh and expiry

Run the pool refresh before each production batch. The render path also performs a low-cost live YouTube statistics read when an API key is available. If live validation is unavailable, the local snapshot may be used only for 24 hours; an older snapshot causes a HOLD. The refresh revalidates the remote video ID, channel ID, public state and current popularity snapshot. Expired market windows are ineligible even when an old trailer still has a high lifetime view count.

## Named-game stories

When the story is about a specific game, exact-subject publisher or storefront footage takes priority. The current-release illustrative pool is reserved for explainers whose technical subject does not provide its own suitable visual canvas.
