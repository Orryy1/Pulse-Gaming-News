# Voice Shootout Overnight Report

Generated: 2026-05-07T03:26:28.590Z
Verdict: AMBER_READY_FOR_LOCAL_BENCHMARKS

## Model Setup Status
- elevenlabs_production_baseline: configured_external_paid_locked; allowed tonight=false; approval required=true
- local_liam_current: ready_for_local_proof; allowed tonight=true; approval required=false
- chatterbox_local: not_detected_optional_setup; allowed tonight=false; approval required=false
- indextts2_local: not_detected_setup_required; allowed tonight=false; approval required=false
- fish_local_or_api: not_detected_external_locked; allowed tonight=false; approval required=true
- kokoro_fast_baseline: not_detected_optional_setup; allowed tonight=false; approval required=false

## Benchmark Scripts
- prices: Price shock (urgent_news) watch=GTA 6, Take-Two
- game_titles: Game title stress test (flash_news) watch=Pokémon, BioShock, Red Dead Redemption, S.T.A.L.K.E.R. 2, Final Fantasy 14, The Elder Scrolls
- acronyms: Gaming acronyms (technical_news) watch=AAA, MMORPG, DLC, FPS, RPG, GPU, PSVR2
- urgent_news: Urgent short hook (high_energy_short) watch=Nintendo, Switch 2
- calm_analysis: Briefing analysis (mini_documentary) watch=publishers
- outro: Pulse outro (cta) watch=Pulse Gaming

## Audio QA
- duration_seconds: true
- words_per_minute: true
- silence_ratio: true
- clipping_ratio: true
- loudness_lufs: true
- true_peak_db: true
- median_pitch_hz: true
- timestamp_viability: true
- pronunciation_watchlist: true

## Blind Review
- public rows: 36
- private model map is kept in JSON only and should not be shared before scoring.

## Safety
- callsExternalApis: false
- spendsPaidCredits: false
- switchesProductionVoice: false
- writesProductionDb: false
- postsToPlatforms: false

## Next Actions
- Run local Liam against the benchmark scripts when a proof batch is needed.
- Use the same transcript set for ElevenLabs, Chatterbox, IndexTTS2, Fish and Kokoro comparisons.
- Do not call paid or external providers until a small capped shootout is approved.
- Use the blind review sheet before changing any production voice default.
