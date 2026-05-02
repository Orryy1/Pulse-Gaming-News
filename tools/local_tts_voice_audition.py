#!/usr/bin/env python3
"""Generate a local VoxCPM voice audition pack.

This is an operator diagnostic tool, not production rendering. It loads VoxCPM
once, tries several reference/prompt combinations and writes WAV files plus a
small metrics report so we can evaluate voice quality without guessing.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import librosa
import numpy as np
import soundfile as sf


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "test" / "output" / "local-tts-voice-audition"
REF_DIR = OUT_DIR / "refs"
TEXT = "Pulse Gaming local voice check. Mega Mewtwo, GTA six and Xbox news should sound clean, bright and natural."
PROMPT_TEXT = (
    "A new Metro game just dropped its official reveal trailer, and nobody expected this franchise to return. "
    "Metro twenty 39 is officially happening, The reveal trailer just went live, showing what appears to be a "
    "deeply personal story centred on a protagonist grappling with a haunting past. Based on the trailer's tone "
    "and imagery, the narrative explores themes of indoctrination and trauma."
)


def write_ref(name: str, source: Path, start_s: float = 0.0, duration_s: float = 25.0) -> Path:
    """Create a clean 24 kHz mono WAV reference from a WAV/MP3 source."""
    REF_DIR.mkdir(parents=True, exist_ok=True)
    y, sr = librosa.load(str(source), sr=24_000, mono=True, offset=start_s, duration=duration_s)
    y = y.astype(np.float32)
    if np.max(np.abs(y)) > 0:
        y = y / max(1.0, float(np.max(np.abs(y))) / 0.95)
    out = REF_DIR / f"{name}.wav"
    sf.write(out, y, 24_000, subtype="PCM_16")
    return out


def f0_metrics(path: Path) -> dict:
    y, sr = librosa.load(str(path), sr=16_000, mono=True)
    f0 = librosa.yin(y, fmin=50, fmax=350, sr=sr)
    voiced = f0[np.isfinite(f0)]
    voiced = voiced[(voiced >= 50) & (voiced <= 350)]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    return {
        "duration_s": round(len(y) / sr, 3),
        "median_f0_hz": round(float(np.median(voiced)), 2) if len(voiced) else None,
        "p10_f0_hz": round(float(np.percentile(voiced, 10)), 2) if len(voiced) else None,
        "p90_f0_hz": round(float(np.percentile(voiced, 90)), 2) if len(voiced) else None,
        "centroid_hz": round(float(np.median(centroid)), 2),
    }


def generate_variant(model, sample_rate: int, name: str, ref: Optional[Path], prompt_text: Optional[str]) -> dict:
    kwargs = {
        "text": TEXT,
        "cfg_value": 2.0,
        "inference_timesteps": 20,
    }
    if ref:
        kwargs["reference_wav_path"] = str(ref)
        if prompt_text:
            kwargs["prompt_wav_path"] = str(ref)
            kwargs["prompt_text"] = prompt_text

    wav = model.generate(**kwargs)
    wav = np.asarray(wav, dtype=np.float32)
    if wav.ndim > 1:
        wav = wav.mean(axis=0 if wav.shape[0] < wav.shape[1] else 1)
    out = OUT_DIR / f"{name}.wav"
    sf.write(out, wav, sample_rate, subtype="PCM_16")
    metrics = f0_metrics(out)
    return {
        "name": name,
        "path": str(out),
        "reference": str(ref) if ref else None,
        "prompt_text": bool(prompt_text),
        **metrics,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    REF_DIR.mkdir(parents=True, exist_ok=True)

    refs = {
        "pulse_v2_16k_original": ROOT / "tts_server" / "voices" / "pulse_v2.wav",
        "pulse_v2_24k_resampled": write_ref(
            "pulse_v2_24k_resampled",
            ROOT / "tts_server" / "voices" / "pulse_v2.wav",
        ),
        "pulse_v1_24k_resampled": write_ref(
            "pulse_v1_24k_resampled",
            ROOT / "tts_server" / "voices" / "pulse.wav",
            duration_s=15.0,
        ),
        "source_1sn9xhe_24k": write_ref(
            "source_1sn9xhe_24k",
            ROOT / "output" / "audio" / "1sn9xhe.mp3",
        ),
        "studio_elevenlabs_24k": write_ref(
            "studio_elevenlabs_24k",
            ROOT / "output" / "audio" / "1sn9xhe_studio_v1_elevenlabs.mp3",
        ),
    }
    sleepy_ref = Path("C:/Users/MORR/gaming-studio/sleepy-empire/config/voices/reference_audio/the-sleep-lab_liam.wav")
    if sleepy_ref.exists():
        refs["sleepy_liam_24k"] = sleepy_ref

    from voxcpm import VoxCPM

    model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False)
    sample_rate = int(getattr(getattr(model, "tts_model", None), "sample_rate", 48_000))

    variants = [
        ("no_ref_default", None, None),
        ("pulse_v2_16k_prompt", refs["pulse_v2_16k_original"], PROMPT_TEXT),
        ("pulse_v2_16k_no_prompt", refs["pulse_v2_16k_original"], None),
        ("pulse_v2_24k_prompt", refs["pulse_v2_24k_resampled"], PROMPT_TEXT),
        ("pulse_v2_24k_no_prompt", refs["pulse_v2_24k_resampled"], None),
        ("source_1sn9xhe_24k_no_prompt", refs["source_1sn9xhe_24k"], None),
        ("studio_elevenlabs_24k_no_prompt", refs["studio_elevenlabs_24k"], None),
    ]
    if "sleepy_liam_24k" in refs:
        variants.append(("sleepy_liam_24k_no_prompt", refs["sleepy_liam_24k"], None))

    results = []
    for name, ref, prompt in variants:
        print(f"[audition] generating {name}")
        results.append(generate_variant(model, sample_rate, name, ref, prompt))

    report = {
        "text": TEXT,
        "model_sample_rate": sample_rate,
        "output_dir": str(OUT_DIR),
        "variants": results,
    }
    (OUT_DIR / "voice_audition_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    lines = ["# Local TTS Voice Audition", "", f"Text: {TEXT}", ""]
    for item in results:
        lines.append(
            f"- {item['name']}: duration={item['duration_s']}s, "
            f"median_f0={item['median_f0_hz']}Hz, centroid={item['centroid_hz']}Hz, "
            f"prompt={item['prompt_text']}, file={item['path']}"
        )
    (OUT_DIR / "voice_audition_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
