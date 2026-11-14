"""The music beds' bar grid: tempo and the first beat of every bed in public/music, by librosa's beat tracker.

The documentary changes bed at a chapter; the change now lands on a bar line of the outgoing bed (src/render/
soundfx.ts phraseSnap) instead of wherever the chapter happens to open. The beds are beat-cut loops (they
start on a beat), so a bar is four beats from the first one. The numbers go into src/render/soundscape.ts
BED_GRID by hand; this prints them and flags a bed whose loop is not a whole number of bars (its grid drifts
on each loop, which the planner allows for, but worth knowing).

Usage (from the factory dir): python src/tools/sfxlab/bedgrid.py
"""
import glob
import os

import librosa
import numpy as np

for path in sorted(glob.glob("public/music/*.wav")):
    y, sr = librosa.load(path, sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    tempo = float(np.atleast_1d(tempo)[0])
    # A straight line through the beat times (each is quantised to a 23 ms hop; the line's slope is not):
    # its slope is the beat, its intercept the first beat.
    if len(beats) > 8:
        beat, first = (float(v) for v in np.polyfit(np.arange(len(beats)), beats, 1))
        first %= beat
    else:
        beat, first = 60 / tempo, 0.0
    length = len(y) / sr
    bars = length / (4 * beat)
    print(f'  "{os.path.basename(path)}": {{ bar: {4 * beat:.4f}, first: {first:.4f} }},  // {60 / beat:.1f} bpm, loop {length:.2f} s = {bars:.2f} bars{"" if abs(bars - round(bars)) < 0.05 else "  (not whole bars)"}')
