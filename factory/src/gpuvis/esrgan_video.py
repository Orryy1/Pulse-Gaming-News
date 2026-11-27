"""Real-ESRGAN on footage: every frame of a clip enlarged on the PC's 4090 and encoded again (UPSCALE_STILLS benchmark
and tool). Reads frames from ffmpeg, runs the network in half precision with spandrel (the loader ComfyUI itself
uses, already in the ComfyUI desktop app's Python), resizes to the target height with Lanczos and pipes the frames to
an ffmpeg encoder. Prints one JSON line with the seconds of footage, frames, wall time and frames per second.

    <ComfyUI python> -I esrgan_video.py <in.mp4> <out.mp4> --height 1080 [--model RealESRGAN_x4plus.pth]
        [--start 0] [--seconds 5] [--ffmpeg path] [--tile 0]

Run it wrapped by the orchestrator (class gpu). Real-ESRGAN is BSD 3-Clause.
"""

import argparse
import json
import subprocess
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F
from spandrel import ModelLoader

MODELS = "D:/pulse-tools/models/realesrgan"


def probe(ffprobe: str, path: str):
    out = subprocess.check_output(
        [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate",
         "-of", "csv=p=0", path]).decode().strip().split(",")
    w, h = int(out[0]), int(out[1])
    num, den = out[2].split("/")
    return w, h, float(num) / float(den or 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dest")
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--model", default="RealESRGAN_x4plus.pth")
    ap.add_argument("--start", type=float, default=0)
    ap.add_argument("--seconds", type=float, default=5)
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--ffprobe", default="ffprobe")
    ap.add_argument("--batch", type=int, default=4)
    a = ap.parse_args()

    w, h, fps = probe(a.ffprobe, a.src)
    out_h = a.height
    out_w = int(round(w * out_h / h / 2) * 2)
    model = ModelLoader().load_from_file(f"{MODELS}/{a.model}").eval().cuda().half()
    scale = model.scale

    reader = subprocess.Popen(
        [a.ffmpeg, "-v", "error", "-ss", str(a.start), "-t", str(a.seconds), "-i", a.src, "-f", "rawvideo",
         "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    writer = subprocess.Popen(
        [a.ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{out_w}x{out_h}", "-r", str(fps),
         "-i", "-", "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p", a.dest],
        stdin=subprocess.PIPE)
    frame_bytes = w * h * 3
    frames = 0
    t0 = time.time()
    torch.backends.cudnn.benchmark = True
    with torch.inference_mode():
        done = False
        while not done:
            batch = []
            for _ in range(a.batch):
                buf = reader.stdout.read(frame_bytes)
                if len(buf) < frame_bytes:
                    done = True
                    break
                batch.append(np.frombuffer(buf, np.uint8).reshape(h, w, 3))
            if not batch:
                break
            x = torch.from_numpy(np.stack(batch)).cuda().permute(0, 3, 1, 2).half() / 255.0
            y = model(x)
            y = F.interpolate(y.float(), size=(out_h, out_w), mode="bicubic", antialias=True, align_corners=False)
            y = (y.clamp(0, 1) * 255).round().byte().permute(0, 2, 3, 1).contiguous().cpu().numpy()
            for f in y:
                writer.stdin.write(f.tobytes())
            frames += len(batch)
    writer.stdin.close()
    writer.wait()
    reader.wait()
    wall = time.time() - t0
    print(json.dumps({
        "src": a.src, "in": f"{w}x{h}", "out": f"{out_w}x{out_h}", "model": a.model, "scale": scale,
        "frames": frames, "footage_seconds": round(frames / fps, 2), "wall_seconds": round(wall, 2),
        "fps": round(frames / wall, 2), "seconds_per_footage_second": round(wall / max(0.001, frames / fps), 2),
        "vram_peak_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2),
    }))


if __name__ == "__main__":
    sys.exit(main())
