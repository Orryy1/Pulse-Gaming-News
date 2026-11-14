# Series-signature music: licence record

Checked on 14 November 2026 against the official sources.

## The model

- **Model:** ACE-Step 1.5 (StepFun and ACE Studio), the turbo DiT `acestep-v15-turbo` from the main repository
  `ACE-Step/Ace-Step1.5`. The language model was not used.
- **Code:** https://github.com/ace-step/ACE-Step-1.5, MIT licence (`LICENSE`, "Copyright (c) 2026 ACEStep"),
  checked out at commit `ca1e85fe9430179831e6bc6be790c332190a3866` (29 Aug 2026) in `D:\pulse-tools\acestep` on the PC.
- **Weights:** https://huggingface.co/ACE-Step/Ace-Step1.5 and https://huggingface.co/ACE-Step/acestep-v15-base:
  the model card's metadata reads `license: mit`, and its Model Details section also gives MIT.

## Commercial use of what it makes

The official model card states: "You can strictly use the generated music for commercial purposes."

## Training data (as the developers describe it)

The card lists three sources: professionally licensed music, public-domain and royalty-free music, and
synthetic audio made by MIDI-to-audio conversion. This is the developers' own account; there is no
independent audit of it.

## How we use it, and the safeguards

- Generated locally on the PC's GPU through the orchestrator (`src/tools/musiclab/acegen.py`). No prompt names
  an artist, song, game, composer or soundtrack (`src/tools/musiclab/briefs.json`), so nothing is asked to
  imitate anyone.
- Every kept file is fingerprinted against the channel's other music and the local libraries
  (`src/tools/musiclab/fingerprint.py`); the result is in the proof folder. An AcoustID lookup against the public
  database runs as well when an `ACOUSTID_API_KEY` is set (none is set today).
- Each file's seed, prompt and SHA-256 are in `rights.json` beside this note.
- Retire any file on a Content ID claim. Before the setting goes on, one private test upload of a Short using the
  signature music is the strongest check Content ID offers.
