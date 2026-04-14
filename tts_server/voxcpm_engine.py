"""
VoxCPM 2 wrapper.

Loads the model once at startup, exposes synth() that returns a mono float32
PCM array at the model's native 16 kHz sample rate.

Voice modes:
  - default (no reference): VoxCPM 2 picks a generic voice on each session.
    Surprisingly listenable, useful for getting started without any setup.
  - reference cloning (REF_VOICE_PATH set): the model conditions on the clip
    so the output matches that timbre and prosody. 6-30 s of clean speech is
    plenty. Do NOT use audio of an ElevenLabs stock voice as the reference -
    that is a ToS violation.

Pacing: VoxCPM 2's default voice synthesizes at ~50 WPM, which is well below
the 130-140 WPM Pulse Gaming targets. We post-process with librosa's phase
vocoder (pitch-preserving) so we can stretch up to ~2.5x without chipmunk
artifacts. The pipeline-supplied speaking_rate is multiplied by BASE_SPEED
(env, default 1.0) so the operator can set a global pace floor.
"""

import logging
import os
from pathlib import Path
from typing import Optional

import librosa
import numpy as np
import torch

log = logging.getLogger("voxcpm")


class VoxCPMEngine:
    SAMPLE_RATE = 16_000  # VoxCPM 2 AudioVAE native output

    def __init__(
        self,
        model_path: Optional[str] = None,
        ref_voice_path: Optional[str] = None,
        device: str = "cuda",
        # Accepted for API compatibility with the older voice-design wrapper;
        # VoxCPM 2 does not expose a text voice prompt parameter so this is
        # ignored (kept so server.py and .env stay unchanged).
        voice_prompt: Optional[str] = None,  # noqa: ARG002
    ):
        self.device = device if torch.cuda.is_available() else "cpu"
        self.ref_voice_path = ref_voice_path or None
        self._model = None
        self._model_path = model_path or "openbmb/VoxCPM2"
        # Multiplied with the per-call speaking_rate so the operator can set a
        # global pace floor. VoxCPM 2 default voice ≈ 50 WPM, so 2.6x lands
        # near 130 WPM (Pulse Gaming target). Sleep niches should set ~1.0-1.4.
        self.base_speed = float(os.getenv("BASE_SPEED", "2.6"))

    def load(self):
        """Lazy-load model on first synth call."""
        if self._model is not None:
            return

        log.info(f"Loading VoxCPM 2 from {self._model_path} on {self.device}...")
        try:
            from voxcpm import VoxCPM

            # The VoxCPM library handles device placement internally via its
            # device kwarg - .to() is not exposed and not needed.
            self._model = VoxCPM.from_pretrained(self._model_path, device=self.device)
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
        seed: Optional[int] = None,  # noqa: ARG002 - VoxCPM 2 has no seed param
    ) -> np.ndarray:
        """
        Generate speech for the given text.

        Returns:
          numpy float32 array, mono, shape (n_samples,), at SAMPLE_RATE
        """
        self.load()

        kwargs = {"text": text}
        if self.ref_voice_path and Path(self.ref_voice_path).exists():
            kwargs["reference_wav_path"] = str(self.ref_voice_path)
            log.debug(f"Cloning from reference: {self.ref_voice_path}")

        audio = self._model.generate(**kwargs)

        # Coerce to mono float32 numpy
        if isinstance(audio, torch.Tensor):
            audio = audio.detach().cpu().float().numpy()
        if audio.ndim > 1:
            audio = audio.mean(
                axis=0 if audio.shape[0] < audio.shape[1] else 1
            )
        audio = audio.astype(np.float32)

        effective_rate = speaking_rate * self.base_speed
        if abs(effective_rate - 1.0) > 1e-3:
            audio = self._time_stretch(audio, effective_rate)
        return audio

    @staticmethod
    def _time_stretch(audio: np.ndarray, rate: float) -> np.ndarray:
        """Pitch-preserving time-stretch via librosa's phase vocoder. Sounds
        natural up to ~2.5x; beyond that artifacts become audible."""
        if abs(rate - 1.0) < 1e-3 or len(audio) < 2:
            return audio
        return librosa.effects.time_stretch(audio, rate=rate).astype(np.float32)
