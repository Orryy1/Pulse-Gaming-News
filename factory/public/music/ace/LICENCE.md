# Pulse's own ACE-Step music (ACE_BEDS): licence record

Checked on 20 November 2026 against the local copies of the official sources (the same model and checkout as the
series-signature music, public/music/signature/LICENCE.md).

## The model

- **Model:** ACE-Step 1.5, the turbo DiT `acestep-v15-turbo`. The language model was not used (instrumental briefs,
  `thinking` off).
- **Code:** MIT licence (`LICENSE`: "MIT License, Copyright (c) 2026 ACEStep"), checkout
  `ca1e85fe9430179831e6bc6be790c332190a3866` (29 Aug 2026) in `D:\pulse-tools\acestep`, identical to `D:\AI\ACE-Step-1.5`.
  The README's "License & Disclaimer" section: "This project is licensed under MIT".
- **Weights:** the model cards shipped with the weights (`checkpoints/README.md` and
  `checkpoints/acestep-v15-sft/README.md`) carry the metadata `license: mit`, and the Model Details section gives
  "License: MIT".

## Commercial use of what it makes

The model card's Key Features: "You can strictly use the generated music for commercial purposes."

## Training data (as the developers describe it)

Professionally licensed music, public-domain and royalty-free music, and synthetic MIDI-to-audio. This is the
developers' own account; there is no independent audit of it. The README's disclaimer asks users to verify the
originality of generated works and names "unintentional copyright infringement due to stylistic similarity" as a risk,
which is what the checks below are for.

## How we use it, and the safeguards

- Generated locally on the PC's GPU through the orchestrator (`src/tools/musiclab/acegen.py --briefs acebeds.json`).
  The prompts (`src/tools/musiclab/acebeds.json`) describe styles and instruments only: no artist, song, game,
  composer, soundtrack or console is named.
- `src/tools/musiclab/pickace.py` keeps a file only if it passes artefact checks (no clipped samples, true peak at
  or under 0 dBTP, no dropouts, no DC offset), a melody screen against the openings of well-known game themes
  (intervals, so any key matches) and the landmark fingerprint check (`src/tools/musiclab/fingerprint.py`) against the
  channel's other music and the trailers it plays beside; it refuses to write the library without that check.
  The melody screen covers ten themes encoded by hand, so it is a screen, not proof: the private test upload below
  is still the real check.
- Each file's seed, prompt and SHA-256 are in `rights.json` beside this note.
- Retire any file on a Content ID claim. Before ACE_BEDS goes on, one private test upload of a Short using an ACE bed
  is the strongest check Content ID offers.
