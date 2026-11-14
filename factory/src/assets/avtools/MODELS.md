# Audio and video tools: models and licences

Checked on each model's official card or repository on 14 Nov 2026. `setup.mjs` fetches each file from the address below and refuses any file whose SHA-256 differs from the pinned value.

| Use                                      | Model                                                                                        | Licence                                                                                 | Source                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Radio strip: dialogue, effects and music | CDX23 cinematic demixer, three HTDemucs checkpoints (ZFTurbo, Sound Demixing Challenge 2023) | MIT (repository LICENSE; the weights are released in the same repository)               | github.com/ZFTurbo/MVSEP-CDX23-Cinematic-Sound-Demixing, release v.1.0.0 |
| Radio strip: lyric pass                  | Mel-Band RoFormer vocals (Kimberley Jensen)                                                  | MIT (model card)                                                                        | huggingface.co/KimberleyJSN/melbandroformer                              |
| Lyric pass network code                  | BS-RoFormer 0.3.10 (lucidrains), the version these weights fit exactly                       | MIT                                                                                     | PyPI BS-RoFormer                                                         |
| Residue check and VOD scan               | Audio Spectrogram Transformer, AudioSet                                                      | BSD-3-Clause (model card)                                                               | huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593                   |
| Instant replay                           | RIFE 4.26 (hzwer)                                                                            | MIT ("the content of these links is under the same MIT license", Practical-RIFE README) | huggingface.co/hzwer/RIFE, RIFEv4.26_0921.zip (only flownet.pkl is used) |
| Crop upscale                             | Real-ESRGAN general x4v3 (xinntao)                                                           | BSD-3-Clause                                                                            | github.com/xinntao/Real-ESRGAN, release v0.2.5.0                         |
| Demixer runtime                          | demucs 4.0.1                                                                                 | MIT                                                                                     | PyPI demucs                                                              |

Rejected:

- BandIt and BandIt Plus DnR checkpoints, including ZFTurbo's `model_bandit_plus_dnr_sdr_11.47.chpt`. The original Zenodo record (10160698) is CC BY-NC 4.0, and the repackaged file matches its configuration.
- Sucial and similar RoFormer dereverb and denoise checkpoints: CC BY-NC-SA 4.0.
- No RoFormer checkpoint trained for dialogue, music and effects carries a commercial licence. That is why the split itself uses CDX23 (HTDemucs) and the RoFormer only does the lyric pass.
- SAM 3 tracking: its weights are gated behind Meta's licence form, which the owner would have to accept. Not built.

Caveats:

- CDX23 was trained on the DnR dataset. DnR is built from LibriSpeech (CC BY 4.0), FSD50K and the Free Music Archive, and some of their clips carry non-commercial terms. The weights' own licence is MIT.
- Removing music is not a licence. The clip's rights are unchanged, and the private-upload copyright check stays mandatory (`src/youtube/copyrightgate.ts`).
- Network code for RIFE and SRVGGNetCompact is re-typed in `vidtools.py` from the MIT and BSD-3 sources. Nothing from the downloaded archives is imported, and all weights load with `torch.load(weights_only=True)`. The CDX23 checkpoints need demucs' pickled class, so `radiostrip.py` first checks that their pickle names only the expected globals.
