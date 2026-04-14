"""
WhisperX-based forced alignment.

Given (audio, text), returns character-level timestamps in the exact
shape ElevenLabs produces:
  {
    "characters":                  [c1, c2, c3, ...],
    "character_start_times_seconds": [s1, s2, s3, ...],
    "character_end_times_seconds":   [e1, e2, e3, ...],
  }

Strategy:
  1. Use WhisperX wav2vec2-CTC alignment to get word-level timings
  2. For each word, distribute its duration across its characters
     proportional to character count
  3. For non-word characters (spaces, punctuation), assign zero-duration
     timestamps anchored to the nearest word boundary

This gives us subtitle-grade alignment without needing per-character
acoustic features.
"""
import logging
from typing import Dict, List

import numpy as np

log = logging.getLogger("aligner")


class Aligner:
    def __init__(self, language: str = "en", device: str = "cuda"):
        import torch

        self.language = language
        self.device = device if torch.cuda.is_available() else "cpu"
        self._model = None
        self._metadata = None

    def load(self):
        if self._model is not None:
            return
        log.info(f"Loading WhisperX alignment model for {self.language}...")
        import whisperx

        self._model, self._metadata = whisperx.load_align_model(
            language_code=self.language, device=self.device
        )
        log.info("Aligner loaded.")

    def align(self, audio: np.ndarray, sample_rate: int, text: str) -> Dict:
        """
        Align text to audio. Returns ElevenLabs-shaped alignment dict.
        """
        self.load()
        import whisperx

        # WhisperX expects 16 kHz mono float32
        if sample_rate != 16_000:
            audio_16k = self._resample_to_16k(audio, sample_rate)
        else:
            audio_16k = audio.astype(np.float32)

        # Build a single-segment "transcript" - we already know what was said
        total_dur = len(audio_16k) / 16_000
        segments = [{"text": text, "start": 0.0, "end": total_dur}]

        try:
            aligned = whisperx.align(
                segments,
                self._model,
                self._metadata,
                audio_16k,
                self.device,
                return_char_alignments=False,
            )
        except Exception as e:
            log.warning(f"Alignment failed, falling back to even distribution: {e}")
            return self._fallback_even(text, total_dur)

        # Build char-level alignment from word-level
        word_segments = []
        for seg in aligned.get("segments", []):
            for w in seg.get("words", []):
                if "start" in w and "end" in w and w.get("word"):
                    word_segments.append(
                        {
                            "word": w["word"],
                            "start": float(w["start"]),
                            "end": float(w["end"]),
                        }
                    )

        if not word_segments:
            return self._fallback_even(text, total_dur)

        return self._words_to_chars(text, word_segments, total_dur)

    @staticmethod
    def _resample_to_16k(audio: np.ndarray, src_sr: int) -> np.ndarray:
        """Linear resample to 16 kHz - good enough for forced alignment."""
        if src_sr == 16_000:
            return audio.astype(np.float32)
        ratio = 16_000 / src_sr
        new_len = int(len(audio) * ratio)
        idx = np.linspace(0, len(audio) - 1, new_len).astype(np.int64)
        return audio[idx].astype(np.float32)

    @staticmethod
    def _fallback_even(text: str, total_dur: float) -> Dict:
        """Distribute char times evenly across total duration."""
        chars = list(text)
        if not chars:
            return {
                "characters": [],
                "character_start_times_seconds": [],
                "character_end_times_seconds": [],
            }
        per_char = total_dur / len(chars)
        starts = [i * per_char for i in range(len(chars))]
        ends = [(i + 1) * per_char for i in range(len(chars))]
        return {
            "characters": chars,
            "character_start_times_seconds": starts,
            "character_end_times_seconds": ends,
        }

    @staticmethod
    def _words_to_chars(
        text: str, word_segments: List[Dict], total_dur: float
    ) -> Dict:
        """
        Walk through `text` character-by-character and assign each char
        a timestamp by matching it against the next word in word_segments.
        Non-word chars (spaces, punctuation) get the boundary time.
        """
        chars = list(text)
        starts = [0.0] * len(chars)
        ends = [0.0] * len(chars)

        # Normalise word matching (whisperx returns lowercase, no punct)
        def norm(s: str) -> str:
            return "".join(c.lower() for c in s if c.isalnum())

        word_idx = 0
        i = 0
        last_t = 0.0

        while i < len(chars):
            ch = chars[i]

            if not ch.isalnum():
                # Punctuation/space: zero-width timestamp at last boundary
                starts[i] = last_t
                ends[i] = last_t
                i += 1
                continue

            # Find next contiguous run of alphanumeric chars (= one word)
            j = i
            while j < len(chars) and chars[j].isalnum():
                j += 1
            word_in_text = "".join(chars[i:j])

            # Match against next word_segment by normalised text
            matched = None
            search_idx = word_idx
            while search_idx < len(word_segments):
                if norm(word_segments[search_idx]["word"]) == norm(word_in_text):
                    matched = word_segments[search_idx]
                    word_idx = search_idx + 1
                    break
                search_idx += 1

            if matched is None:
                # No match - interpolate from last_t to last_t + 0.05*len
                est_dur = 0.05 * (j - i)
                w_start = last_t
                w_end = min(total_dur, last_t + est_dur)
            else:
                w_start = matched["start"]
                w_end = matched["end"]

            # Distribute word duration across its chars proportionally
            n = j - i
            char_dur = (w_end - w_start) / n if n > 0 else 0
            for k in range(n):
                starts[i + k] = w_start + k * char_dur
                ends[i + k] = w_start + (k + 1) * char_dur

            last_t = w_end
            i = j

        return {
            "characters": chars,
            "character_start_times_seconds": starts,
            "character_end_times_seconds": ends,
        }
