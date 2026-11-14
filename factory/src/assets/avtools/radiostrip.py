"""Radio stripping for gameplay sound (RADIO_STRIP, src/assets/radiostrip.ts drives it).

A clip with licensed car-radio music is split into dialogue, effects and music; the music is dropped and
the rest (engine, police, ambient, people talking) kept. A RoFormer lyric pass then removes sung vocals
that leaked into the kept sound, and a residue check listens to what is left: an AudioSet classifier
per second plus an audio fingerprint compared with the removed music. A clip with music left is rejected.

Models (each licence checked on its official card, 14 Nov 2026; see avtools/MODELS.md):
  - CDX23 cinematic demixer, three HTDemucs checkpoints (ZFTurbo, MIT): dialogue, effects, music.
  - Mel-Band RoFormer vocals (KimberleyJSN/melbandroformer, MIT) on lucidrains' BS-RoFormer 0.3.10 (MIT).
  - Audio Spectrogram Transformer, AudioSet (MIT/ast-finetuned-audioset-10-10-0.4593, BSD-3-Clause).

Run with python -I from this folder. Subcommands:
  separate JOBS RESULT   jobs: {"models": dir, "jobs": [{"src", "outDir", "start"?, "seconds"?}], ...}
  scan FILE RESULT       per-second music, speech and vehicle scores of a long file (finding radio)
  residue FILE RESULT    the residue check on one file (--ref music.wav adds the fingerprint test)
  stream                 live filter: s16le 48 kHz stereo on stdin, the music removed on stdout
"""

from __future__ import annotations

import argparse
import json
import math
import os
import pickletools
import subprocess
import sys
import time
import zipfile

import numpy as np

SR = 44100
AST_SR = 16000

# AudioSet labels (AST config id2label indices) that mean music, speech and a vehicle.
MUSIC_IDS = [27, 28, 29, 137, 138] + list(range(139, 283))
SPEECH_IDS = [0, 1, 2, 3, 4, 5, 6]
VEHICLE_IDS = [300, 306, 307, 312, 313, 315, 316, 322, 323, 324, 325, 326, 327, 335, 336, 337, 338, 339, 340, 343]
SING_IDS = [27, 28, 29, 254, 255, 266]

# The only globals a CDX23 checkpoint may name; anything else is refused before unpickling.
CDX_GLOBALS = {
    "fractions Fraction",
    "torch HalfStorage",
    "torch FloatStorage",
    "collections OrderedDict",
    "demucs.htdemucs HTDemucs",
    "torch._utils _rebuild_tensor_v2",
}
CDX_FILES = ["97d170e1-dbb4db15.th", "97d170e1-a778de4a.th", "97d170e1-e41a5468.th"]

MBR_CONFIG = dict(
    dim=384, depth=6, stereo=True, num_stems=1, time_transformer_depth=1, freq_transformer_depth=1,
    num_bands=60, dim_head=64, heads=8, attn_dropout=0.0, ff_dropout=0.0, flash_attn=True,
    dim_freqs_in=1025, sample_rate=SR, stft_n_fft=2048, stft_hop_length=441, stft_win_length=2048,
    stft_normalized=False, mask_estimator_depth=2,
)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def pick_device(want: str | None = None):
    import torch

    if want:
        return torch.device(want)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


# ------------------------------------------------------------------ audio in and out


def read_audio(ffmpeg: str, path: str, sr: int = SR, channels: int = 2, start=None, seconds=None) -> np.ndarray:
    """(channels, n) float32 decoded by ffmpeg; the path goes as an argument, never through a shell."""
    cmd = [ffmpeg, "-v", "error", "-nostdin"]
    if start:
        cmd += ["-ss", f"{float(start):.3f}"]
    cmd += ["-i", path]
    if seconds:
        cmd += ["-t", f"{float(seconds):.3f}"]
    cmd += ["-vn", "-ac", str(channels), "-ar", str(sr), "-f", "f32le", "pipe:1"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    a = np.frombuffer(raw, dtype=np.float32)
    a = a[: len(a) - len(a) % channels]
    return a.reshape(-1, channels).T.copy()


def write_wav(path: str, audio: np.ndarray, sr: int = SR):
    """16-bit PCM WAV with the standard library (no soundfile on the Mac's environment)."""
    import wave

    pcm = (np.clip(audio.T, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(audio.shape[0])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def resample(audio: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst:
        return audio
    import julius
    import torch

    g = math.gcd(src, dst)
    return julius.resample_frac(torch.from_numpy(np.ascontiguousarray(audio)), src // g, dst // g).numpy()


# ------------------------------------------------------------------ the demixer


def check_pickle(path: str) -> set[str]:
    """The globals a torch zip checkpoint's pickle names; raises when any is outside CDX_GLOBALS."""
    with zipfile.ZipFile(path) as z:
        pk = [n for n in z.namelist() if n.endswith("data.pkl")][0]
        found = set()
        for op, arg, _ in pickletools.genops(z.read(pk)):
            if op.name == "GLOBAL":
                found.add(str(arg))
    # STACK_GLOBAL names are pushed as strings just before the opcode; GLOBAL covers protocol 2 files.
    bad = found - CDX_GLOBALS
    if bad:
        raise RuntimeError(f"{os.path.basename(path)} names unexpected globals: {sorted(bad)}")
    return found


def _openunmix_shim():
    """demucs.hdemucs imports openunmix's Wiener filter, and openunmix imports torchaudio, which has no build
    for the Mac's torch 2.15. HTDemucs never calls the filter, so where openunmix will not import a stand-in
    that refuses to run takes its place."""
    try:
        import openunmix.filtering  # noqa: F401
    except Exception:
        import types

        def wiener(*_a, **_k):
            raise NotImplementedError("Wiener filtering is not available in this environment")

        pkg = types.ModuleType("openunmix")
        filt = types.ModuleType("openunmix.filtering")
        filt.wiener = wiener
        pkg.filtering = filt
        sys.modules["openunmix"] = pkg
        sys.modules["openunmix.filtering"] = filt


MPS_MAX_OUT = 60000  # Apple's GPU refuses a 1-D transposed convolution with an output longer than 65,536


def conv_transpose1d_chunked(x, weight, bias, stride: int, padding: int, output_padding: int, groups: int, dilation: int, max_out: int = MPS_MAX_OUT):
    """A 1-D transposed convolution done in pieces short enough for Apple's GPU, exactly: each input piece is
    transposed on its own and the overlapping outputs are added (overlap-add), then the padding is cropped."""
    import torch.nn.functional as F

    L = x.shape[-1]
    K = weight.shape[-1]
    span = dilation * (K - 1) + 1
    full_len = (L - 1) * stride + span + output_padding
    out = x.new_zeros(x.shape[0], weight.shape[1] * groups, full_len)
    step = max(1, (max_out - span) // stride)
    for a in range(0, L, step):
        piece = F.conv_transpose1d(x[..., a : a + step], weight, None, stride=stride, padding=0, groups=groups, dilation=dilation)
        out[..., a * stride : a * stride + piece.shape[-1]] += piece
    out = out[..., padding : full_len - padding]
    if bias is not None:
        out = out + bias[None, :, None]
    return out


def _mps_conv_transpose1d_shim():
    """HTDemucs' waveform decoder makes outputs longer than Apple's GPU allows; on MPS every ConvTranspose1d whose
    output would be too long is computed in pieces (conv_transpose1d_chunked, same result)."""
    import torch

    if getattr(torch.nn.ConvTranspose1d, "_pulse_shim", False):
        return
    original = torch.nn.ConvTranspose1d.forward

    def forward(self, x, output_size=None):
        k = self.kernel_size[0]
        out_len = (x.shape[-1] - 1) * self.stride[0] + self.dilation[0] * (k - 1) + 1
        if x.device.type != "mps" or output_size is not None or self.padding_mode != "zeros" or out_len <= MPS_MAX_OUT:
            return original(self, x, output_size)
        return conv_transpose1d_chunked(
            x, self.weight, self.bias, self.stride[0], self.padding[0], self.output_padding[0], self.groups, self.dilation[0]
        )

    torch.nn.ConvTranspose1d.forward = forward
    torch.nn.ConvTranspose1d._pulse_shim = True


class Demixer:
    """CDX23: dialogue, effects and music from one, or the average of three, HTDemucs checkpoints."""

    def __init__(self, folder: str, device, n_models: int = 1, overlap: float = 0.25):
        import torch

        _openunmix_shim()
        if getattr(device, "type", str(device)) == "mps":
            _mps_conv_transpose1d_shim()
        from demucs.states import load_model

        self.device = device
        self.overlap = overlap
        self.models = []
        for name in CDX_FILES[: max(1, min(3, n_models))]:
            path = os.path.join(folder, name)
            check_pickle(path)
            # weights_only, with demucs' model class and Fraction (its sample-rate type) as the only extra globals.
            from fractions import Fraction
            from demucs.htdemucs import HTDemucs

            with torch.serialization.safe_globals([HTDemucs, Fraction]):
                package = torch.load(path, map_location="cpu", weights_only=True)
            m = load_model(package)
            m.eval().to(device)
            self.models.append(m)
        # The checkpoints call their stems music, sfx and speech; the rest of this file says music, effect, dialog.
        alias = {"sfx": "effect", "effects": "effect", "speech": "dialog", "dialogue": "dialog"}
        self.sources = [alias.get(n, n) for n in getattr(self.models[0], "sources", ["music", "sfx", "speech"])]
        if sorted(self.sources) != ["dialog", "effect", "music"]:
            raise RuntimeError(f"unexpected CDX23 stems: {self.sources}")
        self.torch = torch

    def __call__(self, mix: np.ndarray) -> dict[str, np.ndarray]:
        from demucs.apply import apply_model  # after the shim in __init__

        torch = self.torch
        x = torch.from_numpy(mix[None]).float().to(self.device)
        outs = []
        with torch.inference_mode():
            for m in self.models:
                outs.append(apply_model(m, x, shifts=0, overlap=self.overlap, split=True, device=self.device)[0].float().cpu().numpy())
        o = np.mean(outs, axis=0)
        return {name: o[i] for i, name in enumerate(self.sources)}


def slaney_mel(sr: float, n_fft: int, n_mels: int = 128, fmin: float = 0.0, fmax: float | None = None, htk: bool = False, norm="slaney", dtype=np.float32) -> np.ndarray:
    """librosa.filters.mel, re-written (librosa's defaults: Slaney's mel scale and area normalisation). Only the
    lyric pass needs it, to lay out the RoFormer's bands; the weights only load if the layout is identical."""
    if fmax is None:
        fmax = sr / 2.0

    def hz_to_mel(f):
        f = np.asanyarray(f, dtype=np.float64)
        if htk:
            return 2595.0 * np.log10(1.0 + f / 700.0)
        f_sp = 200.0 / 3
        mels = f / f_sp
        min_log_hz = 1000.0
        min_log_mel = min_log_hz / f_sp
        logstep = np.log(6.4) / 27.0
        return np.where(f >= min_log_hz, min_log_mel + np.log(np.maximum(f, 1e-10) / min_log_hz) / logstep, mels)

    def mel_to_hz(m):
        m = np.asanyarray(m, dtype=np.float64)
        if htk:
            return 700.0 * (10.0 ** (m / 2595.0) - 1.0)
        f_sp = 200.0 / 3
        freqs = f_sp * m
        min_log_hz = 1000.0
        min_log_mel = min_log_hz / f_sp
        logstep = np.log(6.4) / 27.0
        return np.where(m >= min_log_mel, min_log_hz * np.exp(logstep * (m - min_log_mel)), freqs)

    fftfreqs = np.fft.rfftfreq(n=n_fft, d=1.0 / sr)
    mel_f = mel_to_hz(np.linspace(hz_to_mel(fmin), hz_to_mel(fmax), n_mels + 2))
    fdiff = np.diff(mel_f)
    ramps = np.subtract.outer(mel_f, fftfreqs)
    weights = np.zeros((n_mels, len(fftfreqs)), dtype=np.float64)
    for i in range(n_mels):
        lower = -ramps[i] / fdiff[i]
        upper = ramps[i + 2] / fdiff[i + 1]
        weights[i] = np.maximum(0, np.minimum(lower, upper))
    if norm == "slaney":
        weights *= (2.0 / (mel_f[2 : n_mels + 2] - mel_f[:n_mels]))[:, None]
    return weights.astype(dtype)


def _librosa_shim():
    """BS-RoFormer imports librosa only for its mel filter bank; the Mac's environment has no librosa (it would
    pull in numba and scipy), so where it will not import, slaney_mel stands in as librosa.filters.mel."""
    try:
        import librosa.filters  # noqa: F401
    except Exception:
        import types

        pkg = types.ModuleType("librosa")
        filt = types.ModuleType("librosa.filters")
        filt.mel = lambda sr, n_fft, n_mels=128, fmin=0.0, fmax=None, htk=False, norm="slaney", dtype=np.float32: slaney_mel(sr, n_fft, n_mels, fmin, fmax, htk, norm, dtype)
        pkg.filters = filt
        sys.modules["librosa"] = pkg
        sys.modules["librosa.filters"] = filt


class LyricPass:
    """Mel-Band RoFormer vocals: what of the kept sound is a voice (sung or spoken)."""

    def __init__(self, ckpt: str, device, chunk_seconds: float = 8.0):
        import torch

        _librosa_shim()
        from bs_roformer import MelBandRoformer

        self.torch = torch
        self.device = device
        self.model = MelBandRoformer(**MBR_CONFIG)
        sd = torch.load(ckpt, map_location="cpu", weights_only=True)
        self.model.load_state_dict(sd, strict=True)
        self.model.eval().to(device)
        self.chunk = int(chunk_seconds * SR)

    def __call__(self, audio: np.ndarray) -> np.ndarray:
        torch = self.torch
        n = audio.shape[1]
        hop = self.chunk // 2
        win = np.hanning(self.chunk).astype(np.float32) + 1e-4
        out = np.zeros_like(audio)
        wsum = np.zeros(n, dtype=np.float32)
        pos = 0
        with torch.inference_mode():
            while pos < n:
                seg = audio[:, pos : pos + self.chunk]
                pad = self.chunk - seg.shape[1]
                if pad:
                    seg = np.pad(seg, ((0, 0), (0, pad)))
                y = self.model(torch.from_numpy(seg[None]).float().to(self.device))
                y = y.reshape(1, 2, -1)[0].float().cpu().numpy()[:, : self.chunk]
                take = self.chunk - pad
                out[:, pos : pos + take] += (y * win)[:, :take]
                wsum[pos : pos + take] += win[:take]
                if pos + self.chunk >= n:
                    break
                pos += hop
        return out / np.maximum(wsum, 1e-4)


# ------------------------------------------------------------------ the listener


class Tagger:
    """AudioSet scores per second (AST): music, singing, speech and vehicle, from 3 s windows a second apart."""

    def __init__(self, folder: str, device, window: float = 3.0):
        import torch
        from transformers import ASTFeatureExtractor, ASTForAudioClassification

        self.torch = torch
        self.device = device
        self.fe = ASTFeatureExtractor.from_pretrained(folder)
        self.model = ASTForAudioClassification.from_pretrained(folder).eval().to(device)
        self.window = window

    def per_second(self, audio: np.ndarray, sr: int = SR, batch: int = 16) -> dict[str, list[float]]:
        torch = self.torch
        mono = resample(audio.mean(axis=0, keepdims=True), sr, AST_SR)[0]
        secs = max(1, int(math.ceil(len(mono) / AST_SR)))
        w = int(self.window * AST_SR)
        wins = []
        for s in range(secs):
            c = s * AST_SR + AST_SR // 2
            a = max(0, c - w // 2)
            seg = mono[a : a + w]
            if len(seg) < w:
                seg = np.pad(seg, (0, w - len(seg)))
            wins.append(seg)
        probs = []
        with torch.inference_mode():
            for i in range(0, len(wins), batch):
                feats = self.fe(wins[i : i + batch], sampling_rate=AST_SR, return_tensors="pt")["input_values"].to(self.device)
                probs.append(torch.sigmoid(self.model(feats).logits).float().cpu().numpy())
        p = np.concatenate(probs, axis=0)
        loud = rms_db(mono, AST_SR, secs)
        return {
            "music": p[:, MUSIC_IDS].max(axis=1).round(3).tolist(),
            "musicLabel": p[:, 137].round(3).tolist(),
            "singing": p[:, SING_IDS].max(axis=1).round(3).tolist(),
            "speech": p[:, SPEECH_IDS].max(axis=1).round(3).tolist(),
            "vehicle": p[:, VEHICLE_IDS].max(axis=1).round(3).tolist(),
            "db": loud,
        }


def rms_db(mono: np.ndarray, sr: int, secs: int) -> list[float]:
    out = []
    for s in range(secs):
        seg = mono[s * sr : (s + 1) * sr]
        r = float(np.sqrt(np.mean(seg**2))) if len(seg) else 0.0
        out.append(round(20 * math.log10(max(r, 1e-6)), 1))
    return out


# ------------------------------------------------------------------ the fingerprint


def fingerprint(audio: np.ndarray, sr: int = SR) -> np.ndarray:
    """Haitsma-Kalker sub-fingerprints: 32 bits a frame from 33 log bands, 300-2000 Hz (frames, 32) bool."""
    fs = 11025
    mono = resample(audio.mean(axis=0, keepdims=True), sr, fs)[0]
    n_fft, hop = 4096, 128
    if len(mono) < n_fft + hop:
        return np.zeros((0, 32), dtype=bool)
    win = np.hanning(n_fft)
    frames = np.lib.stride_tricks.sliding_window_view(mono, n_fft)[::hop] * win
    spec = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    freqs = np.fft.rfftfreq(n_fft, 1 / fs)
    edges = np.geomspace(300, 2000, 34)
    bands = np.stack([spec[:, (freqs >= edges[i]) & (freqs < edges[i + 1])].sum(axis=1) for i in range(33)], axis=1)
    e = np.log(bands + 1e-12)
    d = (e[1:, :-1] - e[1:, 1:]) - (e[:-1, :-1] - e[:-1, 1:])
    return d > 0


def fp_rate() -> float:
    return 11025 / 128  # sub-fingerprints a second


def ber_per_block(a: np.ndarray, b: np.ndarray, block: int = 256, step: int = 86) -> list[float]:
    """Bit error rate of two aligned fingerprints over ~3 s blocks a second apart (0 identical, 0.5 unrelated)."""
    n = min(len(a), len(b))
    out = []
    for s in range(0, max(1, n - block + 1), step):
        x, y = a[s : s + block], b[s : s + block]
        if len(x) < block // 2:
            break
        out.append(round(float(np.mean(x != y)), 4))
    return out


# ------------------------------------------------------------------ verdicts

# A second counts as music at this AudioSet score. Car radio under engine noise scores 0.3-0.5 in the owner's GTA
# footage and its separated remainder about 0.05 (the 14 Nov proof), so 0.25 sits between them; 0.5 missed radio.
MUSIC_ON = 0.25
SPEECH_ON = 0.5
FP_MATCH = 0.35  # a block whose BER is under this matches (the usual threshold for this fingerprint)


def summarise(tags: dict[str, list[float]], quiet_db: float = -50.0) -> dict:
    m = np.array(tags["music"])
    loud = np.array(tags["db"]) > quiet_db
    on = (m >= MUSIC_ON) & loud
    return {
        "seconds": len(m),
        "musicShare": round(float(on.mean()) if len(m) else 0.0, 3),
        "musicMean": round(float(m.mean()) if len(m) else 0.0, 3),
        "musicP95": round(float(np.percentile(m, 95)) if len(m) else 0.0, 3),
        "speechShare": round(float(((np.array(tags["speech"]) >= SPEECH_ON) & loud).mean()) if len(m) else 0.0, 3),
        "vehicleShare": round(float(((np.array(tags["vehicle"]) >= 0.3) & loud).mean()) if len(m) else 0.0, 3),
    }


def fp_compare(kept: np.ndarray, music: np.ndarray, music_db: list[float], floor_db: float = -45.0) -> dict:
    """How much of the kept sound still carries the removed music's fingerprint, where the music was audible."""
    a, b = fingerprint(kept), fingerprint(music)
    bers = ber_per_block(a, b)
    if not bers:
        return {"blocks": 0, "matchShare": 0.0, "minBer": 0.5, "meanBer": 0.5}
    # Only blocks where the radio actually played count: a silent music stem fingerprints as noise.
    audible = [i for i in range(len(bers)) if i + 1 < len(music_db) and max(music_db[i : i + 3]) > floor_db]
    use = [bers[i] for i in audible] or bers
    return {
        "blocks": len(use),
        "matchShare": round(sum(1 for x in use if x < FP_MATCH) / len(use), 3),
        "minBer": round(min(use), 4),
        "meanBer": round(float(np.mean(use)), 4),
    }


# ------------------------------------------------------------------ subcommands


def lyric_gate(kept: np.ndarray, vocals: np.ndarray, tagger: Tagger, sing_min: float = 0.35) -> tuple[np.ndarray, list[int]]:
    """Removes the RoFormer voice where it is singing rather than speech, a second at a time, faded."""
    tags = tagger.per_second(vocals)
    sing = np.array(tags["singing"])
    speech = np.array(tags["speech"])
    music = np.array(tags["music"])
    drop = ((sing >= sing_min) | (music >= 0.6)) & (sing > speech * 0.8)
    secs = np.flatnonzero(drop).tolist()
    if not secs:
        return kept, []
    g = np.repeat(drop.astype(np.float32), SR)[: kept.shape[1]]
    if len(g) < kept.shape[1]:
        g = np.pad(g, (0, kept.shape[1] - len(g)), mode="edge")
    k = int(0.15 * SR)
    g = np.convolve(g, np.ones(k) / k, mode="same").astype(np.float32)
    return kept - vocals * g[None], secs


def cmd_separate(args):
    import torch

    spec = json.load(open(args.jobs, encoding="utf-8"))
    models = spec["models"]
    device = pick_device(spec.get("device"))
    ffmpeg = spec.get("ffmpeg", "ffmpeg")
    t0 = time.time()
    demix = Demixer(os.path.join(models, "cdx23"), device, spec.get("nModels", 1), spec.get("overlap", 0.25))
    tagger = Tagger(os.path.join(models, "ast"), device)
    lyric = LyricPass(os.path.join(models, "mbr-kim", "MelBandRoformer.ckpt"), device) if spec.get("lyricPass", True) else None
    load_s = time.time() - t0
    max_share = float(spec.get("maxResidueShare", 0.1))
    max_fp = float(spec.get("maxFingerprintShare", 0.1))
    results = []
    for job in spec["jobs"]:
        r = {"src": job["src"]}
        try:
            t1 = time.time()
            mix = read_audio(ffmpeg, job["src"], start=job.get("start"), seconds=job.get("seconds"))
            secs = mix.shape[1] / SR
            out_dir = job["outDir"]
            os.makedirs(out_dir, exist_ok=True)
            before = tagger.per_second(mix)
            stems = demix(mix)
            kept = stems["dialog"] + stems["effect"]
            sung = []
            if lyric is not None:
                vocals = lyric(kept)
                kept, sung = lyric_gate(kept, vocals, tagger)
            after = tagger.per_second(kept)
            music_tags_db = rms_db(stems["music"].mean(axis=0), SR, int(math.ceil(secs)))
            fp = fp_compare(kept, stems["music"], music_tags_db)
            fp_orig = fp_compare(mix, stems["music"], music_tags_db)
            s_before, s_after = summarise(before), summarise(after)
            residue = s_after["musicShare"]
            clean = residue <= max_share and fp["matchShare"] <= max_fp
            write_wav(os.path.join(out_dir, "kept.wav"), kept)
            write_wav(os.path.join(out_dir, "music.wav"), stems["music"])
            if job.get("keepStems"):
                write_wav(os.path.join(out_dir, "dialog.wav"), stems["dialog"])
                write_wav(os.path.join(out_dir, "effect.wav"), stems["effect"])
            el = time.time() - t1
            r.update(
                ok=True,
                kept="kept.wav",
                music="music.wav",
                seconds=round(secs, 2),
                before=s_before,
                after=s_after,
                fingerprint={"kept": fp, "original": fp_orig},
                sungSeconds=sung,
                verdict="clean" if clean else "music_remains",
                rtf=round(el / max(secs, 1e-3), 3),
                perSecond={"before": before["music"], "after": after["music"]},
            )
        except Exception as e:  # one bad clip never stops the rest
            r.update(ok=False, error=f"{type(e).__name__}: {e}"[:400])
        results.append(r)
        log(json.dumps({k: r.get(k) for k in ("src", "ok", "verdict", "rtf", "error")}))
    out = {
        "device": str(device),
        "models": {"demixer": f"CDX23 x{len(demix.models)}", "lyricPass": lyric is not None, "tagger": "AST AudioSet"},
        "loadSeconds": round(load_s, 1),
        "results": results,
    }
    if device.type == "cuda":
        out["gpuPeakGb"] = round(torch.cuda.max_memory_allocated() / 2**30, 2)
    json.dump(out, open(args.result, "w", encoding="utf-8"), indent=1)


def cmd_scan(args):
    device = pick_device(args.device)
    tagger = Tagger(os.path.join(args.models, "ast"), device)
    # Decoded at 16 kHz mono in 10-minute pieces: an hours-long VOD never sits in memory at 44.1 kHz stereo.
    out = {"music": [], "musicLabel": [], "singing": [], "speech": [], "vehicle": [], "db": []}
    start = 0.0
    piece = 600.0
    while True:
        a = read_audio(args.ffmpeg, args.file, sr=AST_SR, channels=1, start=start, seconds=piece)
        if a.shape[1] < AST_SR:
            break
        t = tagger.per_second(a, sr=AST_SR, batch=32)
        for k in out:
            out[k] += t[k]
        log(f"scanned {start + a.shape[1] / AST_SR:.0f}s")
        if a.shape[1] < piece * AST_SR - AST_SR:
            break
        start += piece
    json.dump(out, open(args.result, "w", encoding="utf-8"))


def cmd_residue(args):
    device = pick_device(args.device)
    tagger = Tagger(os.path.join(args.models, "ast"), device)
    a = read_audio(args.ffmpeg, args.file)
    tags = tagger.per_second(a)
    out = {"summary": summarise(tags), "perSecond": tags}
    if args.ref:
        ref = read_audio(args.ffmpeg, args.ref)
        out["fingerprint"] = fp_compare(a, ref, rms_db(ref.mean(axis=0), SR, int(math.ceil(ref.shape[1] / SR))))
    json.dump(out, open(args.result, "w", encoding="utf-8"), indent=1)


# ------------------------------------------------------------------ live


class LiveStripper:
    """Block-wise demixing with context either side, all in the input's own sample rate.

    Each step takes [left context | block | fade | look-ahead] of the input, resamples the whole window to the
    model's 44.1 kHz (so resampling edges fall in the context, never in what is played), demixes it, resamples back
    and emits the block, cross-faded with the previous step's tail so the seams never click. The output runs
    exactly `ahead + fade` seconds of samples behind the input; in wall-clock time a block also has to arrive and
    be processed, so the relay sees about block + ahead + one step's compute. The lyric pass is left out live."""

    def __init__(self, models: str, device, rate: int, block: float, left: float, ahead: float, fade: float = 0.05, passthrough=False):
        self.demix = None if passthrough else Demixer(os.path.join(models, "cdx23"), device, 1, overlap=0.0)
        self.rate = rate
        self.block = int(block * rate)
        self.left = int(left * rate)
        self.ahead = int(ahead * rate)
        self.fade = max(1, int(fade * rate))
        self.hist = np.zeros((2, self.left + self.fade + self.ahead), dtype=np.float32)
        self.prev_tail = None
        self.ramp = np.linspace(0, 1, self.fade, dtype=np.float32)[None]

    @property
    def sample_delay(self) -> float:
        return (self.ahead + self.fade) / self.rate

    def kept(self, window: np.ndarray) -> np.ndarray:
        if self.demix is None:
            return window
        x = resample(window, self.rate, SR)
        st = self.demix(x)
        y = resample(st["dialog"] + st["effect"], SR, self.rate)
        if y.shape[1] < window.shape[1]:
            y = np.pad(y, ((0, 0), (0, window.shape[1] - y.shape[1])))
        return y[:, : window.shape[1]]

    def step(self, block: np.ndarray) -> np.ndarray:
        """One block in (2, block samples), one block out, `sample_delay` behind."""
        buf = np.concatenate([self.hist, block], axis=1)
        self.hist = buf[:, -self.hist.shape[1] :]
        y = self.kept(buf)
        L, B, F = self.left, self.block, self.fade
        body = y[:, L : L + B].copy()
        if self.prev_tail is not None:
            body[:, :F] = body[:, :F] * self.ramp + self.prev_tail * (1 - self.ramp)
        self.prev_tail = y[:, L + B : L + B + F]
        return body


def cmd_stream(args):
    """stdin: s16le stereo at --rate; stdout: the same format with the music removed, `sampleDelaySeconds` behind."""
    device = pick_device(args.device)
    live = LiveStripper(args.models, device, args.rate, args.block, args.left, args.ahead, passthrough=args.passthrough)
    rin, rout = sys.stdin.buffer, sys.stdout.buffer
    nbytes = live.block * 4  # two s16 channels
    stats = {"blocks": 0, "compute": 0.0, "worst": 0.0}
    log(json.dumps({
        "musicStrip": "ready", "device": str(device), "rate": args.rate,
        "sampleDelaySeconds": round(live.sample_delay, 3),
        "wallLatencySeconds": round(args.block + live.sample_delay, 2),
    }))
    while True:
        raw = read_exact(rin, nbytes)
        if not raw:
            break
        x = np.frombuffer(raw, dtype="<i2").astype(np.float32).reshape(-1, 2).T / 32768.0
        n_in = x.shape[1]
        if n_in < live.block:
            x = np.pad(x, ((0, 0), (0, live.block - n_in)))
        t = time.time()
        y = live.step(x)
        dt = time.time() - t
        rout.write((np.clip(y[:, :n_in].T, -1, 1) * 32767).astype("<i2").tobytes())
        rout.flush()
        stats["blocks"] += 1
        stats["compute"] += dt
        stats["worst"] = max(stats["worst"], dt)
        if stats["blocks"] % args.report_every == 0:
            log(json.dumps({"blocks": stats["blocks"], "rtf": round(stats["compute"] / (stats["blocks"] * args.block), 3), "worstSeconds": round(stats["worst"], 3)}))
    # The look-ahead still held is flushed as silence-padded blocks, so nothing at the end is lost.
    tail = live.ahead + live.fade
    while tail > 0:
        y = live.step(np.zeros((2, live.block), dtype=np.float32))
        n = min(live.block, tail)
        rout.write((np.clip(y[:, :n].T, -1, 1) * 32767).astype("<i2").tobytes())
        tail -= n
    rout.flush()
    log(json.dumps({"done": True, **{k: round(v, 3) if isinstance(v, float) else v for k, v in stats.items()}, "rtf": round(stats["compute"] / max(1, stats["blocks"]) / args.block, 3)}))


def read_exact(f, n: int) -> bytes:
    chunks, got = [], 0
    while got < n:
        b = f.read(n - got)
        if not b:
            break
        chunks.append(b)
        got += len(b)
    return b"".join(chunks)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("separate")
    s.add_argument("jobs")
    s.add_argument("result")
    s = sub.add_parser("scan")
    s.add_argument("file")
    s.add_argument("result")
    s.add_argument("--models", required=True)
    s.add_argument("--ffmpeg", default="ffmpeg")
    s.add_argument("--device")
    s = sub.add_parser("residue")
    s.add_argument("file")
    s.add_argument("result")
    s.add_argument("--ref")
    s.add_argument("--models", required=True)
    s.add_argument("--ffmpeg", default="ffmpeg")
    s.add_argument("--device")
    s = sub.add_parser("stream")
    s.add_argument("--models", required=True)
    s.add_argument("--device")
    s.add_argument("--rate", type=int, default=48000)
    s.add_argument("--block", type=float, default=4.0)
    s.add_argument("--left", type=float, default=2.0)
    s.add_argument("--ahead", type=float, default=1.5)
    s.add_argument("--passthrough", action="store_true")
    s.add_argument("--report-every", type=int, default=15)
    args = p.parse_args()
    {"separate": cmd_separate, "scan": cmd_scan, "residue": cmd_residue, "stream": cmd_stream}[args.cmd](args)


if __name__ == "__main__":
    main()
