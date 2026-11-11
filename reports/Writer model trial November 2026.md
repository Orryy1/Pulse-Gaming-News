# Writer model trial, November 2026

Standing item from the weekly improvement task: test Claude Fable against the current writer and final checks on 5 real Shorts, and switch only if clearly better. Run 11 Nov 2026, 21:05 to 21:45, by the weekly improvement task.

**Verdict: keep Claude Opus 5.5 as the writer and the fact checker. Fable 5.1 and Fable 5.2 are not better, and they are slower.** Nothing was changed in the factory.

## Method

- Five Shorts published 9 to 11 Nov, taken from a copy of the Mac's database: Bandai Namco closes the Unknown 9 studio (news), Ocarina of Time tops 5.2 million (breaking), Big Walk's AI code (breaking), why GTA 6 runs at 30 fps (Why), Silksong's free DLC (news).
- The same inputs for all three models: the story as the editor picked it, its sources fetched again on 11 Nov, the personal voice note (VOICE_TEST_SHARE=1), no lessons text. The factory's own code ran for each: the writer, the house rules, the fact check with one rewrite, then the friend pass and its fact check. Each model did every step itself (writer, check and friend pass). The models tried were `claude-opus-5-5` (current), `claude-fable-5-1` (the one the task named) and `claude-fable-5-2` (newer, so tried as well).
- Two blind judges, Sonnet 5.5 and Opus 5.5, scored each set of three scripts 1 to 10. They saw the sources and the scripts in random order, with no model names.
- Fact-check test: one figure in the Opus script was changed to a wrong number (for example "21 million euro loss" became "70 million"), and each model's fact check had to stop it.
- Read-only. Nothing was published and the live database was not touched. Cost: $6.76 in API calls (logged under `data/smoke/fable_ab`). The harness is `fable_ab.mts` and `fable_judge.mts`; the raw scripts and scores are kept in `reports/writer-trial-2026-11-11/`.

## Results

|                                  | Opus 5.5 (current) | Fable 5.1 | Fable 5.2 |
| -------------------------------- | ------------------ | --------- | --------- |
| Blind judge average (out of 10)  | **7.13**           | 6.51      | 6.05      |
| Stories won (of 5)               | **4**              | 1         | 0         |
| Passed the fact check at the end | 5                  | 5         | 5         |
| Planted wrong figure stopped     | 5 of 5             | 5 of 5    | 5 of 5    |
| House-rule problems left         | 6                  | 8         | **4**     |
| Friend pass kept                 | 3                  | 3         | **5**     |
| Total time for 5 Shorts          | **9 min**          | 16 min    | 12 min    |
| "You" per 100 words              | 3.5                | 3.8       | 3.7       |
| "I" per 100 words                | 1.0                | 1.6       | 1.2       |
| Words per sentence               | 10.5               | 10.0      | 10.3      |

Scores per story (Sonnet / Opus judge):

| Story                   | Opus 5.5  | Fable 5.1 | Fable 5.2 |
| ----------------------- | --------- | --------- | --------- |
| Unknown 9 studio closed | 7 / 7     | 6 / 5     | 8 / 6     |
| Ocarina 5.2 million     | 7.6 / 7.5 | 5.8 / 6.8 | 5.6 / 6.4 |
| Big Walk AI code        | 7.5 / 8   | 6 / 6     | 5 / 6     |
| GTA 6 at 30 fps         | 7.7 / 8   | 6.5 / 6   | 5.5 / 5   |
| Silksong free DLC       | 5 / 6     | 8 / 9     | 6 / 7     |

## What it means

- Both judges, one of them a different model from the writer, put Opus first on four stories. Fable 5.1 won one (Silksong). The judges' reasons favour Opus for staying close to the sources and owning exactly one first-person line.
- All three fact checks are equally strong on this test: each stopped every planted wrong figure.
- Fable 5.2 had the fewest house-rule problems and its friend pass was always kept, so it writes cleanly; the judges still found its takes weaker ("Dumping the team was wrong" read as too strong).
- My own read of the Unknown 9 story preferred Fable 5.2 (Opus brought in an odd Arkane Lyon aside), which matches the Sonnet judge on that one story. One story is not a pattern.
- Limit: on the Ocarina story only 2 of the 4 sources could be fetched again, so all three models wrote prices the trial's sources do not hold (the live Short credited GameSpot for them). That story is the weakest comparison, the same for all three.

## Next

- No switch. Look again when a new Claude model comes out, using the same harness and the same 5 stories so the numbers compare.
