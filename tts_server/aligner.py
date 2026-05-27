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

        candidate = self._words_to_chars(text, word_segments, total_dur)
        rejection_reason = self._alignment_rejection_reason(candidate, total_dur)
        if rejection_reason:
            log.warning(
                "Alignment unusable (%s), falling back to even distribution",
                rejection_reason,
            )
            fallback = self._fallback_even(text, total_dur)
            fallback["meta"] = {
                "alignment_fallback_reason": rejection_reason,
                "alignment_fallback_strategy": "even_duration",
            }
            return fallback

        return candidate

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

    @staticmethod
    def _alignment_rejection_reason(alignment: Dict, total_dur: float):
        chars = alignment.get("characters") or []
        starts = alignment.get("character_start_times_seconds") or []
        ends = alignment.get("character_end_times_seconds") or []
        if not chars:
            return None
        if len(starts) < len(chars) or len(ends) < len(chars):
            return "alignment_length_mismatch"
        if not np.isfinite(total_dur) or total_dur <= 0:
            return "invalid_duration"

        words = []
        i = 0
        while i < len(chars):
            if not str(chars[i]).isalnum():
                i += 1
                continue
            j = i
            while j < len(chars) and str(chars[j]).isalnum():
                j += 1
            word_start = starts[i]
            word_end = ends[j - 1]
            if not np.isfinite(word_start) or not np.isfinite(word_end):
                return "invalid_word_timing"
            words.append((float(word_start), float(word_end)))
            i = j

        if len(words) < 3:
            return None

        first_start = words[0][0]
        previous_start = -float("inf")
        previous_end = 0.0
        max_gap = 0.0
        zero_duration = 0
        non_monotonic = 0
        max_end = 0.0

        for start, end in words:
            if start < previous_start - 0.025 or end < start - 0.025:
                non_monotonic += 1
            if start > previous_end:
                max_gap = max(max_gap, start - previous_end)
            if end - start <= 0.03:
                zero_duration += 1
            previous_start = max(previous_start, start)
            previous_end = max(previous_end, end)
            max_end = max(max_end, end)

        zero_ratio = zero_duration / len(words)
        coverage_ratio = max_end / total_dur if total_dur > 0 else 0.0
        trailing_gap = max(0.0, total_dur - max_end)

        if first_start > 2.5:
            return "first_caption_too_late"
        if max_gap > 3.0:
            return "max_gap_too_large"
        if non_monotonic > 0:
            return "non_monotonic_timing"
        if zero_ratio > 0.18:
            return "zero_duration_words"
        if coverage_ratio < 0.75:
            return "timeline_ends_too_early"
        if trailing_gap > 2.0:
            return "trailing_caption_gap_too_large"
        if max_end > total_dur + 0.75:
            return "timeline_runs_past_audio"

        return None
