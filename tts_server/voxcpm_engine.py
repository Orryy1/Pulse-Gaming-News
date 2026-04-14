"""
VoxCPM 2 wrapper.

Loads the model once at startup, exposes a synth() function that returns
raw float32 PCM at the model's native sample rate (48 kHz for VoxCPM 2).

Two modes:
  - reference cloning: if REF_VOICE_PATH is set, uses that audio as the
    voice prompt
  - voice design:      otherwise generates from a text prompt describing
    the voice characteristics (VOICE_PROMPT)

The pulse-gaming pipeline owns its reference voice (record yourself once,
save to ./voices/main.wav). Do NOT use audio of an ElevenLabs stock voice
as the reference - that is a ToS violation.
"""
import os
import logging
from pathlib import Path
from typing import Optional

import numpy as np
import torch

log = logging.getLogger("voxcpm")


class VoxCPMEngine:
    SAMPLE_RATE = 48_000  # VoxCPM 2 native

    def __init__(
        self,
        model_path: Optional[str] = None,
        ref_voice_path: Optional[str] = None,
        voice_prompt: Optional[str] = None,
        device: str = "cuda",
    ):
        self.device = device if torch.cuda.is_available() else "cpu"
        self.ref_voice_path = ref_voice_path
        self.voice_prompt = voice_prompt or (
            "Confident British male news narrator, mid-30s, deep warm timbre, "
            "energetic delivery, clear diction, slight gravel in lower register. "
            "Pace is brisk but never rushed. Tone is authoritative and engaged."
        )
        self._model = None
        self._model_path = model_path or "openbmb/VoxCPM-2"

    def load(self):
        """Lazy-load model on first synth call."""
        if self._model is not None:
            return

        log.info(f"Loading VoxCPM 2 from {self._model_path} on {self.device}...")

        # VoxCPM API per https://github.com/OpenBMB/VoxCPM
        # The exact import surface may shift between releases - we wrap
        # the load in a try block and surface a clear error.
        try:
            from voxcpm import VoxCPM

            self._model = VoxCPM.from_pretrained(self._model_path)
            if hasattr(self._model, "to"):
                self._model = self._model.to(self.device)
            log.info("VoxCPM 2 loaded.")
        except ImportError as e:
            raise RuntimeError(
                "voxcpm package not installed. Run setup.bat first.\n"
                f"Original error: {e}"
            )
        except Exception as e:
            raise RuntimeError(f"Failed to load VoxCPM 2: {e}")

    @torch.inference_mode()
    def synth(
        self,
        text: str,
        speaking_rate: float = 1.0,
        seed: Optional[int] = None,
    ) -> np.ndarray:
        """
        Generate speech for the given text.

        Returns:
          numpy float32 array, mono, shape (n_samples,), at SAMPLE_RATE
        """
        self.load()

        if seed is not None:
            torch.manual_seed(seed)

        # VoxCPM 2 inference call. The library exposes a `generate` method
        # that takes text plus either a reference audio path or a voice
        # description prompt.
        kwargs = {"text": text}
        if self.ref_voice_path and Path(self.ref_voice_path).exists():
            kwargs["prompt_audio"] = self.ref_voice_path
            log.debug(f"Cloning from reference: {self.ref_voice_path}")
        else:
            kwargs["voice_description"] = self.voice_prompt
            log.debug(f"Voice design: {self.voice_prompt[:60]}...")

        # Speaking rate - VoxCPM exposes via temperature / cfg in some
        # versions. We pass it through if the API supports it; otherwise
        # we time-stretch in post.
        if speaking_rate != 1.0:
            kwargs["speaking_rate"] = speaking_rate

        try:
            output = self._model.generate(**kwargs)
        except TypeError:
            # API mismatch on speaking_rate - retry without it then
            # apply post-hoc time-stretch
            kwargs.pop("speaking_rate", None)
            output = self._model.generate(**kwargs)
            if speaking_rate != 1.0:
                output = self._time_stretch(output, speaking_rate)

        # Coerce to mono float32 numpy
        if isinstance(output, torch.Tensor):
            output = output.detach().cpu().float().numpy()
        if output.ndim > 1:
            output = output.mean(axis=0) if output.shape[0] < output.shape[1] else output.mean(axis=1)
        return output.astype(np.float32)

    @staticmethod
    def _time_stretch(audio: np.ndarray, rate: float) -> np.ndarray:
        """Naive time-stretch via resampling. Not pitch-preserving but
        adequate for small rate adjustments (0.9 - 1.1)."""
        if rate == 1.0:
            return audio
        new_len = int(len(audio) / rate)
        idx = np.linspace(0, len(audio) - 1, new_len).astype(np.int64)
        return audio[idx]
