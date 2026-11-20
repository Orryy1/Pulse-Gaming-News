"""Measures a gameplay Short against the audit's list, with ffmpeg only.
python gameplay_measure.py <video> [result.json]  ->  one JSON line, and <video>.sheet.jpg (one frame a second)

first_frame_luma   brightness of frame 1 (0-255); under 16 is a black opening
opening_motion     mean frame difference over the first 1.5 s; under about 1 is a frozen or empty opening
black_spans        black over 0.2 s at full frame rate
picture_fill       share of the frame's height with picture in it on the middle frame (1.0 is full screen)
longest_still_s    the longest stretch with almost no change in the picture (filler)
With result.json: voice_start_s, payoff_at_s, after_payoff_s, wpm, loop text.
"""
import json, os, re, subprocess, sys

FF = os.environ.get("FFMPEG", "ffmpeg")
FP = os.environ.get("FFPROBE", "ffprobe")


def err(args):
    return subprocess.run([FF, "-hide_banner", "-nostats", *args], capture_output=True, text=True, errors="replace").stderr


video = sys.argv[1]
dur = float(subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], capture_output=True, text=True).stdout)
out = {"seconds": round(dur, 2)}
s = err(["-i", video, "-frames:v", "1", "-vf", "signalstats,metadata=print:file=-", "-f", "null", "-"])
p = subprocess.run([FF, "-hide_banner", "-nostats", "-i", video, "-frames:v", "1", "-vf", "signalstats,metadata=print:file=-", "-f", "null", "-"], capture_output=True, text=True, errors="replace").stdout
m = re.search(r"YAVG=([\d.]+)", p)
out["first_frame_luma"] = round(float(m.group(1)), 1) if m else None
p = subprocess.run([FF, "-hide_banner", "-nostats", "-t", "1.5", "-i", video, "-vf", "tblend=all_mode=difference,signalstats,metadata=print:file=-", "-f", "null", "-"], capture_output=True, text=True, errors="replace").stdout
v = [float(x) for x in re.findall(r"YAVG=([\d.]+)", p)]
out["opening_motion"] = round(sum(v) / max(1, len(v)), 2)
out["black_spans"] = [[float(a), float(b)] for a, b in re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", err(["-i", video, "-vf", "blackdetect=d=0.2:pix_th=0.08", "-an", "-f", "null", "-"]))]
c = err(["-ss", str(dur / 2), "-i", video, "-frames:v", "5", "-vf", "cropdetect=24:2:0", "-f", "null", "-"])
m = re.findall(r"crop=(\d+):(\d+):", c)
h = subprocess.run([FP, "-v", "error", "-select_streams", "v", "-show_entries", "stream=height", "-of", "csv=p=0", video], capture_output=True, text=True).stdout.strip().split(',')[0]
out["picture_fill"] = round(int(m[-1][1]) / int(h), 2) if m else None
p = subprocess.run([FF, "-hide_banner", "-nostats", "-i", video, "-vf", "fps=10,tblend=all_mode=difference,signalstats,metadata=print:file=-", "-f", "null", "-"], capture_output=True, text=True, errors="replace").stdout
v = [float(x) for x in re.findall(r"YAVG=([\d.]+)", p)]
run = best = 0
for x in v:
    run = run + 1 if x < 0.6 else 0
    best = max(best, run)
out["longest_still_s"] = round(best / 10, 1)
if len(sys.argv) > 2:
    r = json.load(open(sys.argv[2], encoding="utf8"))
    words = r.get("words") or []
    if words:
        out["voice_start_s"] = round(words[0]["start"], 2)
        out["wpm"] = round(len(words) / max(0.1, (words[-1]["end"] - words[0]["start"])) * 60)
        out["spoken_words"] = len(words)
    t = r.get("timing") or {}
    out["payoff_at_s"] = t.get("payoffAt")
    out["answer_at_s"] = t.get("answerAt")
    if t.get("payoffAt") is not None:
        out["after_payoff_s"] = round(dur - t["payoffAt"], 2)
    d = (r.get("gameplay") or {}).get("direct") or {}
    out["loop_reads"] = f'{d.get("loop_line","")} / {d.get("hook","")}'
n = max(1, int(dur))
subprocess.run([FF, "-v", "error", "-y", "-i", video, "-vf", f"fps=1,scale=180:-2,tile={min(n,12)}x{(n+11)//12}", "-frames:v", "1", video + ".sheet.jpg"])
print(json.dumps(out, ensure_ascii=False))
