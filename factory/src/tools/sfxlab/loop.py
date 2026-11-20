"""Makes a music bed loop seamlessly.

The raw beds fade in from near silence and end loud, so every time a long video restarts one the
music dips 10-21 dB and swells back. This cuts the bed on the beat (past its fade-in, before its
fade-out, a whole number of 4-bar phrases long) and crossfades the music that follows the cut into
the start, so the end flows into the beginning with no dip. Written as WAV: MP3 and AAC pad the
start with silence, which would put a gap in every loop.

Usage (from the factory dir): python src/tools/sfxlab/loop.py in.mp3 out.wav
"""
import sys

import librosa
import numpy as np
import soundfile as sf

src, dst = sys.argv[1], sys.argv[2]
y, sr = librosa.load(src, sr=48000, mono=False)
y = np.atleast_2d(y)
mono = y.mean(axis=0)
_, beats = librosa.beat.beat_track(y=mono, sr=sr, units="samples")
rms = librosa.feature.rms(y=mono, frame_length=4096, hop_length=1024)[0]
med = np.median(rms)
t = lambda i: i * 1024
full = np.where(rms >= med * 10 ** (-3 / 20))[0]
start_ok, end_ok = t(full[0]), t(full[-1])
b0 = next(i for i, b in enumerate(beats) if b >= start_ok)
xfade_beats = 4
# The longest stretch of whole 4-bar phrases (16 beats) that leaves room for the crossfade before the fade-out.
n = ((len([b for b in beats if b <= end_ok]) - 1 - b0 - xfade_beats) // 16) * 16
if n < 16:
    raise SystemExit(f"{src}: too short to loop on the beat")
s0, s1 = int(beats[b0]), int(beats[b0 + n])
x = int(beats[b0 + n + xfade_beats]) - s1
out = y[:, s0:s1].copy()
# Equal-power crossfade: the start of the loop fades in while the music after the cut fades out.
ph = np.linspace(0, np.pi / 2, x)
out[:, :x] = out[:, :x] * np.sin(ph) + y[:, s1: s1 + x] * np.cos(ph)
sf.write(dst, out.T.astype(np.float32), sr, subtype="PCM_16")
seam = lambda a: 20 * np.log10(np.sqrt(np.mean(a**2)) + 1e-9)
print(f"{src} -> {dst}: {s0 / sr:.2f}-{s1 / sr:.2f} s ({n // 4} bars, {out.shape[1] / sr:.1f} s), seam {seam(out[:, :4800]) - seam(out[:, -4800:]):+.1f} dB")
