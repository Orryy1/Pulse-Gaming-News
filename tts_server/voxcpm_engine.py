"""
VoxCPM 2 wrapper.

Loads the model once at startup, exposes synth() that returns a mono float32
PCM array at the model's native sample rate.

Voice modes:
  - default (no reference): VoxCPM 2 picks a generic voice on each session.
    Surprisingly listenable, useful for getting started without any setup.
  - reference cloning (REF_VOICE_PATH set): the model conditions on the clip
    so the output matches that timbre and prosody. 6-30 s of clean speech is
    plenty. Do NOT use audio of an ElevenLabs stock voice as the reference -
    that is a ToS violation.

Pacing: VoxCPM 2's default voice synthesizes slowly for Pulse-style shorts.
The pipeline-supplied speaking_rate is multiplied by BASE_SPEED (env, default
1.0). When tempo correction is needed, prefer FFmpeg's Rubber Band filter over
librosa's phase vocoder because it keeps consonants cleaner for social video.
"""

import logging
import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

import librosa
import numpy as np
import torch

log = logging.getLogger("voxcpm")
_generation_lock = threading.Lock()


class VoxCPMEngine:
    SAMPLE_RATE = 16_000  # Fallback only; overwritten from VoxCPM once loaded.

    def __init__(
        self,
        model_path: Optional[str] = None,
        ref_voice_path: Optional[str] = None,
        device: str = "cuda",
        voice_prompt: Optional[str] = None,
        prompt_text: Optional[str] = None,
        cfg_value: float = 2.0,
        inference_timesteps: int = 20,
        load_denoiser: bool = False,
        voice_qa: Optional[Dict[str, Any]] = None,
    ):
        self.device = device if torch.cuda.is_available() else "cpu"
        self.ref_voice_path = ref_voice_path or None
        self.prompt_text = prompt_text or voice_prompt or None
        self.cfg_value = float(cfg_value)
        self.inference_timesteps = int(inference_timesteps)
        self.load_denoiser = bool(load_denoiser)
        self.voice_qa = voice_qa or {}
        self._model = None
        self._model_path = model_path or "openbmb/VoxCPM2"
        self.sample_rate = self.SAMPLE_RATE
        self.last_voice_diagnostics: Dict[str, Any] = {}
        # Multiplied with the per-call speaking_rate so the operator can set a
        # global pace floor. VoxCPM 2 default voice ≈ 50 WPM, so 2.6x lands
        # near 130 WPM (Pulse Gaming target). Sleep niches should set ~1.0-1.4.
        self.base_speed = float(os.getenv("BASE_SPEED", "2.6"))

    def load(self):
        """Lazy-load model on first synth call."""
        if self._model is not None:
            return

        log.info(
            f"Loading VoxCPM 2 from {self._model_path} on {self.device} "
            f"(load_denoiser={self.load_denoiser})..."
        )
        try:
            from voxcpm import VoxCPM

            # The VoxCPM library handles device placement internally via its
            # device kwarg - .to() is not exposed and not needed.
            self._model = VoxCPM.from_pretrained(
                self._model_path,
                device=self.device,
                load_denoiser=self.load_denoiser,
            )
            model_sr = getattr(getattr(self._model, "tts_model", None), "sample_rate", None)
            if model_sr:
                self.sample_rate = int(model_sr)
            log.info("VoxCPM 2 loaded (sample_rate=%s).", self.sample_rate)
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
          numpy float32 array, mono, shape (n_samples,), at self.sample_rate
        """
        self.load()

        kwargs = self._build_generation_kwargs(
            text,
            include_reference=True,
            include_prompt=bool(self.prompt_text),
        )
        audio = self._generate_with_voice_qa(text, kwargs)

        effective_rate = speaking_rate * self.base_speed
        if abs(effective_rate - 1.0) > 1e-3:
            stretch_t0 = time.monotonic()
            log.info(
                "stretch_begin rate=%.3f samples=%d",
                effective_rate,
                len(audio),
            )
            audio = self._time_stretch(audio, effective_rate)
            stretch_ms = int((time.monotonic() - stretch_t0) * 1000)
            log.info("stretch_end elapsed_ms=%s samples=%d", stretch_ms, len(audio))
            try:
                post_metrics = self._voice_quality_metrics(audio, text)
                self.last_voice_diagnostics = {
                    **(self.last_voice_diagnostics or {}),
                    "post_stretch_metrics": post_metrics,
                    "effective_rate": effective_rate,
                }
            except Exception:
                self.last_voice_diagnostics = {
                    **(self.last_voice_diagnostics or {}),
                    "effective_rate": effective_rate,
                }
        return audio

    def _build_generation_kwargs(
        self,
        text: str,
        include_reference: bool = True,
        include_prompt: bool = True,
    ) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {
            "text": text,
            "cfg_value": self.cfg_value,
            "inference_timesteps": self.inference_timesteps,
        }
        if include_reference and self.ref_voice_path and Path(self.ref_voice_path).exists():
            kwargs["reference_wav_path"] = str(self.ref_voice_path)
            if include_prompt and self.prompt_text:
                kwargs["prompt_wav_path"] = str(self.ref_voice_path)
                kwargs["prompt_text"] = self.prompt_text
            log.debug(f"Cloning from reference: {self.ref_voice_path}")
        return kwargs

    def _generate_with_voice_qa(self, text: str, kwargs: Dict[str, Any]) -> np.ndarray:
        if not self.voice_qa.get("enabled", False):
            audio = self._generate_candidate("configured", kwargs)
            metrics = self._voice_quality_metrics(audio, text)
            self.last_voice_diagnostics = {
                "qa_enabled": False,
                "selected_candidate": "configured",
                "metrics": metrics,
                "rejection": None,
                "candidates": [
                    {
                        "label": "configured",
                        "metrics": metrics,
                        "rejection": None,
                    }
                ],
            }
            return audio

        candidates = [("configured", kwargs)]
        if kwargs.get("prompt_text"):
            candidates.append(
                (
                    "without_prompt",
                    self._build_generation_kwargs(
                        text,
                        include_reference=True,
                        include_prompt=False,
                    ),
                )
            )
        elif self.voice_qa.get("retry_same_reference", False) and kwargs.get("reference_wav_path"):
            candidates.append(("reference_retry", dict(kwargs)))

        if self.voice_qa.get("fallback_without_reference", False):
            candidates.append(
                (
                    "fallback_without_reference",
                    self._build_generation_kwargs(
                        text,
                        include_reference=False,
                        include_prompt=False,
                    ),
                )
            )

        best_audio: Optional[np.ndarray] = None
        best_metrics: Dict[str, Any] = {}
        best_reason: Optional[str] = None
        best_label: Optional[str] = None
        candidate_diagnostics = []
        for label, candidate_kwargs in candidates:
            audio = self._generate_candidate(label, candidate_kwargs)
            metrics = self._voice_quality_metrics(audio, text)
            reason = self._voice_quality_rejection(metrics)
            log.info("voice_qa candidate=%s metrics=%s rejection=%s", label, metrics, reason)
            candidate_diagnostics.append(
                {
                    "label": label,
                    "metrics": metrics,
                    "rejection": reason,
                }
            )
            if reason is None:
                self.last_voice_diagnostics = {
                    "qa_enabled": True,
                    "selected_candidate": label,
                    "metrics": metrics,
                    "rejection": None,
                    "candidates": candidate_diagnostics,
                }
                return audio

            if best_audio is None or self._voice_quality_score(metrics) > self._voice_quality_score(best_metrics):
                best_audio = audio
                best_metrics = metrics
                best_reason = reason
                best_label = label

        if not self.voice_qa.get("fallback_without_reference", False):
            self.last_voice_diagnostics = {
                "qa_enabled": True,
                "selected_candidate": None,
                "metrics": best_metrics,
                "rejection": best_reason,
                "best_rejected_candidate": best_label,
                "candidates": candidate_diagnostics,
            }
            raise RuntimeError(
                "voice_qa_all_candidates_rejected: "
                f"metrics={best_metrics} rejection={best_reason}"
            )

        log.warning(
            "voice_qa all candidates rejected; using best candidate metrics=%s rejection=%s",
            best_metrics,
            best_reason,
        )
        self.last_voice_diagnostics = {
            "qa_enabled": True,
            "selected_candidate": best_label or "configured",
            "metrics": best_metrics,
            "rejection": best_reason,
            "used_rejected_fallback": True,
            "candidates": candidate_diagnostics,
        }
        return best_audio if best_audio is not None else self._generate_candidate("configured", kwargs)

    def _generate_candidate(self, label: str, kwargs: Dict[str, Any]) -> np.ndarray:
        gen_t0 = time.monotonic()
        log.info(
            "generate_begin candidate=%s chars=%d cfg=%.2f timesteps=%d ref=%s prompt=%s denoiser=%s",
            label,
            len(str(kwargs.get("text", ""))),
            self.cfg_value,
            self.inference_timesteps,
            bool(kwargs.get("reference_wav_path")),
            bool(kwargs.get("prompt_text")),
            self.load_denoiser,
        )
        with _generation_lock:
            audio = self._model.generate(**kwargs)
        gen_ms = int((time.monotonic() - gen_t0) * 1000)
        try:
            generated_samples = len(audio)
        except TypeError:
            generated_samples = "unknown"
        log.info("generate_end candidate=%s elapsed_ms=%s samples=%s", label, gen_ms, generated_samples)
        return self._coerce_audio(audio)

    @staticmethod
    def _coerce_audio(audio: Any) -> np.ndarray:
        if isinstance(audio, torch.Tensor):
            audio = audio.detach().cpu().float().numpy()
        if audio.ndim > 1:
            audio = audio.mean(
                axis=0 if audio.shape[0] < audio.shape[1] else 1
            )
        return audio.astype(np.float32)

    def _voice_quality_metrics(self, audio: np.ndarray, text: str) -> Dict[str, Any]:
        try:
            duration_s = len(audio) / float(self.sample_rate)
            max_analysis_s = float(os.getenv("VOICE_QA_MAX_ANALYSIS_S", "45") or 45)
            max_analysis_samples = max(1, int(max_analysis_s * self.sample_rate))
            if len(audio) > max_analysis_samples:
                # Analyse a stable mid-front window. Running f0/STFT over a full
                # 90-150s raw render can spike memory and has crashed the local
                # server after generation, before the HTTP response is returned.
                start = min(
                    max(0, len(audio) - max_analysis_samples),
                    max(0, int(len(audio) * 0.15)),
                )
                analysis_audio = audio[start:start + max_analysis_samples]
            else:
                analysis_audio = audio
            trimmed, _ = librosa.effects.trim(analysis_audio, top_db=35)
            if len(trimmed) < int(self.sample_rate * 0.25):
                trimmed = analysis_audio
            f0 = librosa.yin(trimmed, fmin=50, fmax=350, sr=self.sample_rate)
            voiced = f0[np.isfinite(f0)]
            voiced = voiced[(voiced >= 50) & (voiced <= 350)]
            centroid = librosa.feature.spectral_centroid(y=trimmed, sr=self.sample_rate)[0]
            rolloff = librosa.feature.spectral_rolloff(
                y=trimmed,
                sr=self.sample_rate,
                roll_percent=0.85,
            )[0]
            n_fft = 1024
            spectrum = np.abs(librosa.stft(trimmed, n_fft=n_fft, hop_length=512)) ** 2
            freqs = librosa.fft_frequencies(sr=self.sample_rate, n_fft=n_fft)
            voice_band = (freqs >= 80) & (freqs <= min(7500, self.sample_rate / 2))
            high_band = freqs >= 5000
            total = spectrum[voice_band].sum(axis=0)
            high = spectrum[high_band].sum(axis=0)
            high_ratio = high / np.maximum(total, 1e-12)
            return {
                "duration_s": round(float(duration_s), 3),
                "analysis_duration_s": round(float(len(analysis_audio) / self.sample_rate), 3),
                "duration_per_char_s": round(float(duration_s / max(1, len(text))), 4),
                "median_f0_hz": round(float(np.median(voiced)), 2) if len(voiced) else None,
                "p10_f0_hz": round(float(np.percentile(voiced, 10)), 2) if len(voiced) else None,
                "p90_f0_hz": round(float(np.percentile(voiced, 90)), 2) if len(voiced) else None,
                "centroid_hz": round(float(np.median(centroid)), 2),
                "rolloff_85_hz": round(float(np.median(rolloff)), 2),
                "high_frequency_ratio_gt_5khz": round(float(np.median(high_ratio)), 6),
            }
        except Exception as exc:
            return {"error": f"{type(exc).__name__}: {exc}"}

    def _voice_quality_rejection(self, metrics: Dict[str, Any]) -> Optional[str]:
        if metrics.get("error"):
            return str(metrics["error"])
        min_median_f0_hz = float(self.voice_qa.get("min_median_f0_hz", 0) or 0)
        median_f0 = metrics.get("median_f0_hz")
        if min_median_f0_hz and (median_f0 is None or float(median_f0) < min_median_f0_hz):
            return f"median_f0_hz={median_f0} below min_median_f0_hz={min_median_f0_hz}"
        max_duration_per_char_s = float(self.voice_qa.get("max_duration_per_char_s", 0) or 0)
        duration_per_char = metrics.get("duration_per_char_s")
        if max_duration_per_char_s and duration_per_char and float(duration_per_char) > max_duration_per_char_s:
            return (
                f"duration_per_char_s={duration_per_char} above "
                f"max_duration_per_char_s={max_duration_per_char_s}"
            )
        return None

    @staticmethod
    def _voice_quality_score(metrics: Dict[str, Any]) -> float:
        median_f0 = metrics.get("median_f0_hz")
        if median_f0 is None:
            return 0.0
        return float(median_f0)

    def _time_stretch(self, audio: np.ndarray, rate: float) -> np.ndarray:
        """Pitch-preserving time-stretch with a Rubber Band first path.

        Librosa's phase vocoder is kept only as librosa_fallback because the
        old path made Pulse narration sound filtered when pushed to Shorts pace.
        """
        if abs(rate - 1.0) < 1e-3 or len(audio) < 2:
            return audio
        backend = os.getenv("VOXCPM_TIME_STRETCH_BACKEND", "rubberband").strip().lower()
        if backend in ("rubberband", "ffmpeg", "ffmpeg_rubberband"):
            try:
                return self._time_stretch_rubberband(audio, rate)
            except Exception as exc:
                log.warning("rubberband stretch failed; using librosa_fallback: %s", exc)
        log.info("librosa_fallback rate=%.3f", rate)
        return librosa.effects.time_stretch(audio, rate=rate).astype(np.float32)

    def _time_stretch_rubberband(self, audio: np.ndarray, rate: float) -> np.ndarray:
        import soundfile as sf

        timeout_s = int(os.getenv("VOXCPM_RUBBERBAND_TIMEOUT_S", "180") or 180)
        sample_rate = int(self.sample_rate)
        with tempfile.TemporaryDirectory(prefix="voxcpm-rubberband-") as tmp:
            in_path = Path(tmp) / "in.wav"
            out_path = Path(tmp) / "out.wav"
            sf.write(in_path, audio.astype(np.float32), sample_rate)
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    str(in_path),
                    "-af",
                    f"rubberband=tempo={float(rate):.6f}:pitch=1",
                    "-ar",
                    str(sample_rate),
                    "-ac",
                    "1",
                    str(out_path),
                ],
                check=True,
                capture_output=True,
                timeout=timeout_s,
            )
            stretched, _ = sf.read(out_path, dtype="float32", always_2d=False)
            if getattr(stretched, "ndim", 1) > 1:
                stretched = stretched.mean(axis=1)
            return np.asarray(stretched, dtype=np.float32)
