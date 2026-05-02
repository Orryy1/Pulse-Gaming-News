# Topicality Gate Report

Date: 2026-04-29
Mode: sandbox, local implementation

## Incident

A House of the Dragon Season 3 item appeared in Pulse Gaming output. That is off-brand for Pulse Gaming unless the story is directly about a game, gaming platform, game company, game release or clearly game-related adaptation.

## Root cause from local code

The existing scoring system weighted source confidence, importance, freshness, demand, visual viability and safety, but did not have a hard Pulse Gaming topicality gate. Trusted feeds and high-demand entertainment stories could therefore score high enough to proceed even when the topic was general TV/film/celebrity news.

## Implemented local gate

New module: `lib/topicality-gate.js`

The gate evaluates Pulse Gaming stories as:

- `accept`: game, gaming platform, gaming service, game industry, developer/publisher or known game story.
- `review`: game adaptation stories where the game connection is real but the item is partly film/TV/casting.
- `reject`: general TV, film, streaming, celebrity, anime or entertainment-only items.

`lib/scoring.js` now applies this gate to Pulse Gaming scoring:

- `reject` adds hard stop `pulse_gaming_off_topic_entertainment`.
- `review` prevents auto-approval and keeps the story for manual review.
- `accept` lets the normal rubric continue.

## Test coverage

Added `tests/services/pulse-topicality-gate.test.js`:

- House of the Dragon Season 3: reject.
- Nintendo Switch 2 games: accept.
- MindsEye update or price cut: accept.
- Xbox Game Pass price: accept.
- Elden Ring movie casting: review.
- General Marvel, Netflix and TV news: reject.

## Routing policy

Pulse Gaming should not publish entertainment-only stories. If entertainment expansion is desired later, those stories should be routed to a separate channel/status and held out of the Pulse Gaming render/publish lane.

## Promotion note

This is a safe candidate for review because it blocks off-brand content before render/upload. It should still be checked against a recent real-story sample before production deployment to make sure the phrase list is not over-blocking valid game-platform stories.
