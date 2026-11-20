"""Chooses Pulse's own ACE-Step music (ACE_BEDS, src/render/acebeds.ts) from acegen.py's takes, by measurement.

The takes come from src/tools/musiclab/acebeds.json (acegen.py --briefs acebeds.json). The finishing and scoring are
picksig.py's, so the beds and the ident drop into the existing mix with no new levels:
  - Ident (ace_theme__ident): cut to its opening phrase, varispeed into BOTH keys (ident_N-D.mp3 and ident_N-E.mp3,
    so it is tuned to whichever bed plays, like the house sting), filtered, faded and loudness-matched like every v3
    sound; scored by picksig's sting rules. Up to IDENTS kept.
  - Theme (ace_theme__theme): mastered to the house beds' loudness in E, scored for a harsh top, phone carry and key.
  - Beds (ace_<mood>__bed): seamless beat-cut loop (sfxlab/loop.py), Rubber Band into the brief's key, -12.7 LUFS,
    scored by pickbeds.py's rules for life under a narrator. Up to BEDS_PER_MOOD per mood kept.
On top, every kept file must pass the artefact checks (no clipped samples, true peak under 0 dBTP, no dropouts inside
the music, no DC offset) and a melody check: its most salient pitch line, as note-to-note intervals (so any key
matches), is compared with the openings of well-known game themes (FAMOUS); a close match drops the take.
A take that fails anything is never kept; a mood with nothing that passed stays on the house beds.
Writes public/music/ace/<mood>_<n>.flac, public/music/ace/theme.flac, public/sfx/ace/ident_<n>-{D,E}.mp3, their
rights.json, src/render/acebedlib.ts and a report.

Usage (from the factory dir, the audio Python): python src/tools/musiclab/pickace.py <raw dir> --report out.json
"""
import glob
import hashlib
import json
import os
import subprocess
import sys

import librosa
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import picksig as S  # noqa: E402  (the signature picker: finishing, scoring and the pickbeds rules)

SR = S.SR
BRIEFS = json.load(open(os.path.join(HERE, "acebeds.json"), encoding="utf-8"))
IDENTS = 3
BEDS_PER_MOOD = 2
THEME_MAX_PENALTY = 6.0
CLIP_LIMIT = 0.999  # a sample at or over this is clipped
DROPOUT_DB = -50.0  # a 50 ms window this far under full scale inside the music is a dropout
DC_LIMIT = 0.005
# Openings of well-known game themes as semitone steps between successive notes, so any key matches. A sanity screen
# against the famous melodies a style prompt could drift towards; the beds are also fingerprinted (fingerprint.py).
FAMOUS = {
    "Super Mario Bros. overworld": [0, 0, -4, 4, 3, -12],
    "Tetris (Korobeiniki)": [-5, 1, 2, -2, -1, -2, 0, 3, 4, -2, -2, -1],
    "The Legend of Zelda overworld": [-5, 5, 0, 2, 2, 1, 2],
    "Zelda's Lullaby": [3, -5, 2, 3, -5],
    "Song of Storms": [3, 9, -12, 3, 9],
    "Final Fantasy Prelude": [2, 2, 3, 5, 2, 2, 3],
    "Final Fantasy Victory Fanfare": [0, 0, 0, -4, 2, 2, -2, 2],
    "Pac-Man intro": [12, -5, -3, 8, -5, -3],
    "Megalovania": [0, 12, -5, -1, -1, -2, -3, 3, 2],
    "Doom E1M1 riff": [0, 12, -12, 0, 10, -10, 0, 8, -8, 0, 6, -6],
}


def artefacts(path):
    """Clipped samples, true peak (ffmpeg's ebur128), dropouts inside the music and DC offset."""
    y, sr = sf.read(path, always_2d=True)
    clipped = int((np.abs(y) >= CLIP_LIMIT).sum())
    mono = y.mean(axis=1)
    n = int(0.05 * sr)
    m = len(mono) // n
    db = 20 * np.log10(np.sqrt((mono[: m * n].reshape(m, n) ** 2).mean(axis=1)) + 1e-9)
    inner = db[int(0.5 / 0.05): m - int(0.5 / 0.05)] if m > 40 else db
    dropouts = int((inner < DROPOUT_DB).sum())
    dc = float(abs(y.mean()))
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    tp = float("nan")
    for line in r.stderr.splitlines()[::-1]:
        if "Peak:" in line:
            tp = float(line.split("Peak:")[1].split("dBFS")[0])
            break
    flags = {}
    if clipped:
        flags["clipped samples"] = clipped
    if tp > 0:
        flags["true peak over 0 dBTP"] = round(tp, 2)
    if dropouts:
        flags["dropouts"] = dropouts
    if dc > DC_LIMIT:
        flags["dc offset"] = round(dc, 4)
    return dict(clipped=clipped, true_peak=round(tp, 2), dropouts=dropouts, dc=round(dc, 5)), flags


def melody_steps(path, seconds=60):
    """The most salient pitch line (pyin on the harmonic part) as notes held 120 ms or more, then their steps."""
    y, sr = librosa.load(path, sr=22050, mono=True, duration=seconds)
    h = librosa.effects.harmonic(y)
    f0, voiced, _ = librosa.pyin(h, fmin=110, fmax=1400, sr=sr, frame_length=2048, hop_length=256)
    midi = np.where(voiced, np.round(librosa.hz_to_midi(np.nan_to_num(f0, nan=1.0))), np.nan)
    hop_s = 256 / sr
    notes, run, cur = [], 0, None
    for v in midi:
        if not np.isnan(v) and v == cur:
            run += 1
            continue
        if cur is not None and run * hop_s >= 0.12:
            notes.append(int(cur))
        cur, run = (None if np.isnan(v) else v), (0 if np.isnan(v) else 1)
    if cur is not None and run * hop_s >= 0.12:
        notes.append(int(cur))
    return [b - a for a, b in zip(notes, notes[1:])], len(notes)


def famous_match(steps):
    """The closest well-known theme: its name and mismatches in the best window; flagged when close enough."""
    best = (None, 99, 0)
    for name, motif in FAMOUS.items():
        k = len(motif)
        for i in range(0, max(0, len(steps) - k + 1)):
            w = steps[i: i + k]
            if len(set(w)) < 3:  # a repeated note or a two-note trill matches too much to mean anything
                continue
            miss = sum(1 for a, b in zip(w, motif) if a != b)
            if miss < best[1]:
                best = (name, miss, k)
    name, miss, k = best
    flagged = name is not None and (miss == 0 or (k >= 8 and miss <= 1))
    return dict(closest=name, mismatches=miss if name else None, length=k), flagged


def meta_of(p):
    j = p[:-4] + ".json"
    return json.load(open(j, encoding="utf-8")) if os.path.exists(j) else {}


def to_flac(src, dest):
    S.ff("-i", src, "-c:a", "flac", "-compression_level", "8", dest)


def right(file, path, meta, take, finishing):
    return dict(
        file=file,
        sha256=hashlib.sha256(open(path, "rb").read()).hexdigest(),
        origin=f"ACE-Step 1.5 ({meta.get('model', 'acestep-v15-turbo')}), generated locally on the PC, seed {meta.get('seed')} ({take})",
        prompt=meta.get("caption", ""),
        licence="MIT model licence; ACE-Step's official model card says generated music may be used commercially (public/music/ace/LICENCE.md). Retire the file on any Content ID claim.",
        finishing=finishing,
    )


def main():
    raw = sys.argv[1]
    report_path = sys.argv[sys.argv.index("--report") + 1] if "--report" in sys.argv else "ace_report.json"
    out_music = os.path.join("public", "music", "ace")
    out_sfx = os.path.join("public", "sfx", "ace")
    work = os.path.join("data", "musiclab", "ace_work")
    for d in (out_music, out_sfx, work):
        os.makedirs(d, exist_ok=True)
    report = {"model": "ACE-Step 1.5 (acestep-v15-turbo)", "idents": [], "themes": [], "beds": {}}
    rights, lib = [], {"beds": [], "idents": []}

    # Idents.
    rows = []
    for p in sorted(glob.glob(os.path.join(raw, "ace_theme__ident__s*.wav"))):
        st = S.cut_sting(S.read(p))
        c = S.chroma(st.mean(axis=0))
        fins = {k: S.finish_sting(st.copy(), S.best_shift(c, k)) for k in ("D", "E")}
        fits = {k: S.key_fit(S.chroma(v.mean(axis=0)), k) for k, v in fins.items()}
        f = S.features(fins["E"])
        pen, flags = S.sting_score(f, min(fits.values()))
        row = dict(take=os.path.basename(p), key_fit=round(min(fits.values()), 3), penalty=pen, flags=flags, **f)
        rows.append((row, fins, meta_of(p)))
        report["idents"].append(row)
    rows.sort(key=lambda r: r[0]["penalty"])
    n = 0
    for row, fins, meta in rows:
        if row["penalty"] > S.MAX_STING_PENALTY or n >= IDENTS:
            continue
        name = f"ident_{n + 1}"
        files = {}
        for k, y in fins.items():
            tmp = os.path.join(work, f"{name}-{k}.wav")
            sf.write(tmp, y.T.astype(np.float32), SR, subtype="PCM_16")
            art, aflags = artefacts(tmp)
            row.setdefault("artefacts", {})[k] = art
            if aflags:
                row.setdefault("dropped", []).append(f"{k}: {aflags}")
            files[k] = tmp
        if row.get("dropped"):
            continue
        for k, tmp in files.items():
            dest = os.path.join(out_sfx, f"{name}-{k}.mp3")
            S.ff("-i", tmp, "-ar", str(SR), "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", dest)
            rights.append(right(f"sfx/ace/{name}-{k}.mp3", dest, meta, row["take"], f"opening phrase cut ({row['seconds']} s), varispeed into {k} major, 38 Hz high-pass, 10 kHz low-pass, fades, {S.FILE_LOUD} dB K-weighted 200 ms max (src/tools/musiclab/pickace.py)"))
        peak = S.features(S.read(os.path.join(out_sfx, f"{name}-E.mp3")))["peak_s"]
        lib["idents"].append({"sting": f"ace/{name}", "peak": round(peak, 3)})
        row["kept"] = name
        n += 1

    # Theme.
    best = None
    for p in sorted(glob.glob(os.path.join(raw, "ace_theme__theme__s*.wav"))):
        name = os.path.basename(p)[:-4]
        fin = os.path.join(work, f"{name}_final.wav")
        shift, fit = S.master_music(p, fin, "E")
        y = S.read(fin)
        fo = int(2.0 * SR)
        y[:, -fo:] *= np.linspace(1, 0, fo) ** 1.5
        sf.write(fin, y.T.astype(np.float32), SR, subtype="PCM_16")
        f = S.features(y)
        art, aflags = artefacts(fin)
        flags = {
            "harsh top": max(0, f["presence"] - 0.12) * 40 + max(0, f["air"] - 0.02) * 150,
            "lost on phones": max(0, 0.55 - f["phone"]) * 20,
            "out of key": max(0, S.KEY_FIT_MIN - fit) * 40,
            "forgettable": max(0, 0.08 - f["motif"]) * 25,
        }
        pen = round(sum(flags.values()), 2)
        steps, notes = melody_steps(fin)
        fam, famous = famous_match(steps)
        row = dict(take=name, shift=shift, key_fit=round(fit, 3), penalty=pen, flags={k: round(v, 1) for k, v in flags.items() if v > 0.05},
                   artefacts=art, melody_notes=notes, famous=fam, **f)
        if aflags:
            row["dropped"] = aflags
        if famous:
            row["dropped"] = f"melody close to {fam['closest']}"
        report["themes"].append(row)
        if not row.get("dropped") and pen <= THEME_MAX_PENALTY and (best is None or pen < best[0]["penalty"]):
            best = (row, fin, meta_of(p))
    if best:
        row, fin, meta = best
        dest = os.path.join(out_music, "theme.flac")
        to_flac(fin, dest)
        lib["theme"] = {"file": "music/ace/theme.flac", "key": "E", "seconds": round(row["seconds"], 2)}
        row["kept"] = "theme"
        rights.append(right("music/ace/theme.flac", dest, meta, row["take"], f"Rubber Band {row['shift']:+d} semitones into E major (tempo kept), {S.BED_LUFS} LUFS, 2 s fade out (src/tools/musiclab/pickace.py)"))

    # Beds, per mood.
    for series, spec in BRIEFS["series"].items():
        mood = spec.get("mood")
        if not mood:
            continue
        key = spec["key"]
        rep = report["beds"].setdefault(mood, [])
        cands = []
        for p in sorted(glob.glob(os.path.join(raw, f"{series}__bed__s*.wav"))):
            name = os.path.basename(p)[:-4]
            loop = os.path.join(work, f"{name}_loop.wav")
            r = subprocess.run([sys.executable, os.path.join(S.SFXLAB, "loop.py"), p, loop], capture_output=True, text=True)
            if r.returncode:
                rep.append(dict(take=name, error=(r.stdout + r.stderr).strip()[-200:]))
                continue
            fin = os.path.join(work, f"{name}_final.wav")
            shift, fit = S.master_music(loop, fin, key)
            m = S.P["bed"](fin)
            m["seam"], m["dip"] = S.P["flow"](fin)
            pen, flags = S.P["score"](m)
            if fit < S.KEY_FIT_MIN:
                flags["out of key"] = round((S.KEY_FIT_MIN - fit) * 40, 1)
                pen = round(pen + flags["out of key"], 2)
            art, aflags = artefacts(fin)
            steps, notes = melody_steps(fin)
            fam, famous = famous_match(steps)
            row = dict(take=name, shift=shift, key_fit=round(fit, 3), penalty=pen, flags=flags, metrics=m, artefacts=art,
                       melody_notes=notes, famous=fam)
            if aflags:
                row["dropped"] = aflags
            if famous:
                row["dropped"] = f"melody close to {fam['closest']}"
            rep.append(row)
            if not row.get("dropped") and pen <= S.MAX_BED_PENALTY:
                cands.append((row, fin, meta_of(p)))
        cands.sort(key=lambda c: c[0]["penalty"])
        for i, (row, fin, meta) in enumerate(cands[:BEDS_PER_MOOD]):
            rel = f"music/ace/{mood}_{i + 1}.flac"
            dest = os.path.join("public", rel)
            to_flac(fin, dest)
            lib["beds"].append({"file": rel, "key": key, "mood": mood, "grid": S.grid(dest)})
            row["kept"] = rel
            rights.append(right(rel, dest, meta, row["take"], f"beat-aligned seamless loop, Rubber Band {row['shift']:+d} semitones into {key} major (tempo kept), {S.BED_LUFS} LUFS (src/tools/musiclab/pickace.py)"))
        print(f"{mood:10} {len(cands)} passed of {len(rep)}, kept {min(len(cands), BEDS_PER_MOOD)}", flush=True)

    json.dump(dict(schema="pulse-audio-rights-v1", licence_record="public/music/ace/LICENCE.md", music=rights),
              open(os.path.join(out_music, "rights.json"), "w", encoding="utf-8", newline="\n"), indent=2)
    lines = [
        "// GENERATED by src/tools/musiclab/pickace.py: Pulse's own ACE-Step music that passed the measurement. Do not edit by",
        "// hand; re-run the picker (src/render/acebeds.ts).",
        'import type { AceLibrary } from "./acebeds.ts";',
        "",
        f"export const ACE_LIBRARY: AceLibrary = {json.dumps(lib, indent=2)};",
        "",
    ]
    with open(os.path.join("src", "render", "acebedlib.ts"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))
    report["library"] = lib
    json.dump(report, open(report_path, "w", encoding="utf-8"), indent=1, default=str)
    print(f"idents {len(lib['idents'])}, theme {'theme' in lib}, beds {len(lib['beds'])}; report: {report_path}")


if __name__ == "__main__":
    main()
