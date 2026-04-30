# Studio V2 → Production Promotion: Design Memo

**Author:** Claude Code (autonomous overnight engineer)
**Date:** 2026-04-30 evening
**Status:** Design only. No code change. No production switch. **Awaiting Martin approval.**

---

## Why this memo exists

The 2026-04-29 forensic audit's #2 P0 finding said: "Production rendering still appears to use the legacy `assemble.js` path, while the premium Studio V2 work remains mostly experimental and local."

Tonight's mission brief is explicit: **do not switch Studio V2 into production.** The render contract system shipped today (`aadbd2d`) gives the operator visibility into when output falls below premium grade, but the production renderer is still legacy `assemble.js`. Studio V2 lives under `lib/studio/v2/` and is exercised by tools like `studio:v2:dossier`, `studio:v2:gauntlet`, `studio:v2:multichannel` — never by the live produce path.

This memo proposes a **safe, reversible, evidence-driven** promotion plan. **Nothing here ships without explicit operator approval.**

---

## Non-negotiable guardrails

1. The legacy `assemble.js` path stays the production default until promotion is approved.
2. Studio V2 must beat legacy on every quality dimension across at least 5 representative real stories before promotion is even considered.
3. Studio V2 canonical (the proven gold sample, per the audit) must NOT be replaced by V2.1 unless V2.1 also beats canonical on the same gauntlet.
4. A one-command revert path back to `assemble.js` must exist after promotion. Promotion is not "delete the old code"; it's "switch a flag and keep the old path warm."
5. Promotion does not turn on hard publish-blocking gates (`BLOCK_THIN_VISUALS`, `BLOCK_BELOW_CONTRACT`) automatically. Those flips remain operator decisions.

---

## Phased plan

### Phase 0 — Today (already done)

✅ Render contract system in production (`aadbd2d`)
✅ Render-fallback forensic stamp (`c0f1707`)
✅ Asset provenance ledger + visual content prescan (`07cd50e`)
✅ Render-health daily digest (`e71e918`)
✅ Live performance analyst (`5facfd3`, dedupe `24bacba`)
✅ Operator publish-readiness 20-pillar verdict (`f28c090`)
✅ Token-log sweep (`5d8ca28`)

These shipped earlier this week and tonight. They're already the foundation a promotion would rest on — the operator now has the data signals to know whether Studio V2 actually outperforms legacy.

### Phase 1 — Promotion-readiness gauntlet (no production change)

**Goal:** prove Studio V2 beats legacy on 5+ real stories.

Build:

- `tools/studio-v2-promotion-gauntlet.js` — runs both renderers against the same 5 real story rows from production DB (with `--story-ids` flag). Produces:
  - Side-by-side MP4s in `test/output/studio_v2_promotion_gauntlet/`
  - Forensic JSON: durations, audio loudness, true peak, subtitle integrity, render time, file size
  - Render contract verdict for each output (using `lib/render-contract.js`)
  - Visual contact sheet per output
  - A composite "Studio V2 wins / legacy wins / tie" tally per dimension
- The gauntlet is read-only against production: it copies story metadata, fetches the same media assets, and produces output to a local `test/output/` tree. It does NOT publish, does NOT mutate the DB row, and does NOT touch Railway.

Acceptance criteria for this phase:

- Studio V2 beats legacy on render contract grade for ≥4 of 5 stories
- No new failure modes introduced (durations match, audio levels within ±1 LUFS of legacy, subtitle integrity intact)
- Operator-visible delta packet (markdown + side-by-side MP4s + JSON)

**No production switch in this phase.** Output is "is Studio V2 ready?" evidence only.

### Phase 2 — Shadow render in production (NO publish change)

**Goal:** prove Studio V2 holds up against the entire daily produce queue, not just hand-picked test stories.

Build:

- New env flag: `STUDIO_V2_SHADOW_RENDER=true` (default OFF)
- When set, `publisher.produce()` runs Studio V2 ALONGSIDE legacy `assemble.js` for every story. Both outputs are persisted to disk; the legacy output remains the canonical published MP4.
- Studio V2 output goes to `output/shadow/{id}.mp4` and is forensically QA'd.
- Daily Discord digest reports Studio V2 vs legacy delta for the day (similar shape to current render-health digest).
- After 7 days of green deltas, the shadow render data is enough to consider promotion.

Acceptance criteria for this phase:

- 7 consecutive days of "Studio V2 ≥ legacy on every contract grade"
- Zero new render failures attributable to Studio V2 path
- Shadow render adds <90s per story to the produce window (operationally safe)

**Still no production switch.** Both renderers active; only legacy publishes.

### Phase 3 — Operator-approved promotion

**Goal:** flip Studio V2 to production with a one-command revert.

Build:

- `RENDER_PRIMARY=studio_v2` env flag (default `legacy`). When set to `studio_v2`, the publisher uses the Studio V2 output as the canonical MP4 for upload. Legacy output is still produced as the shadow.
- Two days of post-flip monitoring. Live performance analyst + render contract auto-flag any regression.
- Revert path: set `RENDER_PRIMARY=legacy` and redeploy. ~60s round trip.
- After 14 days of green, the shadow flag (`STUDIO_V2_SHADOW_RENDER`) can be flipped off to halve produce time.

**Approval gate:** the Phase 2 7-day green data must be presented to the operator (Martin) as a one-page summary. Promotion happens only after a written approval. This memo does not pre-authorise that switch.

### Phase 4 — Cleanup (post-stable)

Only after 30 days of `RENDER_PRIMARY=studio_v2` with no operator-driven revert:

- Mark `assemble.js` as deprecated (keep the file, add a banner comment).
- Promote Studio V2 canonical to the canonical default; remove the env flag dependency.
- Document the promotion + retirement in `docs/render-history.md`.

---

## What I am NOT proposing

- **Not** flipping any env var tonight.
- **Not** making Studio V2 the default for any new produce cycle.
- **Not** deleting `assemble.js`.
- **Not** auto-promoting V2.1 over Studio V2 canonical.
- **Not** touching Railway env vars.
- **Not** running any Studio V2 render against production data.

---

## What I am proposing for the next session (with approval)

Build Phase 1 (`tools/studio-v2-promotion-gauntlet.js`) — read-only, runs locally, never touches production. Produces the evidence packet. **The operator (Martin) reviews the packet and decides whether to greenlight Phase 2.**

If Phase 1 fails to prove Studio V2 beats legacy, the project stays on `assemble.js` indefinitely, and the next P1 priority becomes something else (e.g. consolidating the two media-inventory scorers, or wiring real YouTube Analytics).

---

## Risk register

| Risk                                                   | Likelihood | Impact | Mitigation                                                 |
| ------------------------------------------------------ | ---------- | ------ | ---------------------------------------------------------- |
| Studio V2 regresses on stories not in test set         | Medium     | High   | Phase 2 shadow render exposes this before flip             |
| Studio V2 slower than legacy → produce window blows    | Low        | High   | Phase 2 measures this; gate at <90s extra per story        |
| Studio V2 introduces audio/subtitle drift              | Low        | High   | Phase 1 forensic JSON catches this; render contract reject |
| Operator flips RENDER_PRIMARY without Phase 2 evidence | Low        | High   | This memo + the audit's discipline; revert is one env flip |
| Studio V2 canonical replaced by V2.1 by accident       | Low        | Medium | Audit explicit guidance: V2.1 must beat canonical first    |

---

## Decision needed

Martin to confirm one of:

- ✅ **Approve Phase 1**: build the read-only gauntlet tool over the next session
- ⏸ **Park**: Studio V2 promotion is not a current priority; focus on other audit items
- ❌ **Reject promotion track entirely**: stay on legacy indefinitely; close this design

Until a written approval lands, the production renderer remains `assemble.js`, no Studio V2 work touches production.
