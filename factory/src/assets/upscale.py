"""AI upscaling of old games' footage and stills (src/assets/upscale.ts): a PS1 or PS2 capture is 480 lines or
less, and the plain resize to 1080 the gather does makes it soft and blocky on a big screen. Real-ESRGAN (open
weights from the authors' GitHub releases, run locally on CUDA, MPS or the CPU) redraws the edges at four times
the size; the result is resized to the height asked for. One run per video: the model loads once.

The networks are written out here (the two published shapes, SRVGGNetCompact and RRDBNet) so the environment
needs only torch, numpy and Pillow, not basicsr.

Usage: python upscale.py <jobs.json> <out.json>
  jobs.json: {"model": "general" | "anime" | "x4plus", "modelDir": "...", "ffmpeg": "...", "half": true,
              "items": [{"kind": "video" | "image", "src": "...", "dest": "...", "height": 1080}]}
  out.json:  {"model": "...", "device": "...", "loadSeconds": n,
              "items": [{"src", "dest", "ok", "seconds", "frames", "width", "height", "why"}]}
"""
import json
import os
import subprocess
import sys
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

MODELS = {
    # Real-ESRGAN's general compact model (v0.2.5.0): fast enough for footage, kind to real-world texture.
    "general": ("realesr-general-x4v3.pth", "compact", 32),
    # The compact anime-video model (v0.2.5.0): flat colours and hard edges, much like low-poly game art.
    "anime": ("realesr-animevideov3.pth", "compact", 16),
    # The big general model (v0.1.0): best on stills, about ten times slower.
    "x4plus": ("RealESRGAN_x4plus.pth", "rrdb", 23),
}


class Compact(nn.Module):
    """SRVGGNetCompact: a plain stack of 3x3 convolutions and PReLUs, a pixel shuffle, plus the nearest-upscaled input."""

    def __init__(self, num_conv, feat=64, scale=4):
        super().__init__()
        body = [nn.Conv2d(3, feat, 3, 1, 1), nn.PReLU(num_parameters=feat)]
        for _ in range(num_conv):
            body += [nn.Conv2d(feat, feat, 3, 1, 1), nn.PReLU(num_parameters=feat)]
        body += [nn.Conv2d(feat, 3 * scale * scale, 3, 1, 1)]
        self.body = nn.ModuleList(body)
        self.up = nn.PixelShuffle(scale)
        self.scale = scale

    def forward(self, x):
        out = x
        for m in self.body:
            out = m(out)
        return self.up(out) + F.interpolate(x, scale_factor=self.scale, mode="nearest")


class RDB(nn.Module):
    def __init__(self, f=64, g=32):
        super().__init__()
        self.conv1 = nn.Conv2d(f, g, 3, 1, 1)
        self.conv2 = nn.Conv2d(f + g, g, 3, 1, 1)
        self.conv3 = nn.Conv2d(f + 2 * g, g, 3, 1, 1)
        self.conv4 = nn.Conv2d(f + 3 * g, g, 3, 1, 1)
        self.conv5 = nn.Conv2d(f + 4 * g, f, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(0.2, True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    def __init__(self, f=64):
        super().__init__()
        self.rdb1, self.rdb2, self.rdb3 = RDB(f), RDB(f), RDB(f)

    def forward(self, x):
        return self.rdb3(self.rdb2(self.rdb1(x))) * 0.2 + x


class RRDBNet(nn.Module):
    def __init__(self, blocks, f=64):
        super().__init__()
        self.conv_first = nn.Conv2d(3, f, 3, 1, 1)
        self.body = nn.Sequential(*[RRDB(f) for _ in range(blocks)])
        self.conv_body = nn.Conv2d(f, f, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(f, f, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(f, f, 3, 1, 1)
        self.conv_hr = nn.Conv2d(f, f, 3, 1, 1)
        self.conv_last = nn.Conv2d(f, 3, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(0.2, True)

    def forward(self, x):
        feat = self.conv_first(x)
        feat = feat + self.conv_body(self.body(feat))
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode="nearest")))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode="nearest")))
        return self.conv_last(self.lrelu(self.conv_hr(feat)))


def device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def load(name, model_dir, dev, half):
    file, shape, n = MODELS[name]
    net = Compact(n) if shape == "compact" else RRDBNet(n)
    sd = torch.load(os.path.join(model_dir, file), map_location="cpu", weights_only=True)
    sd = sd.get("params_ema") or sd.get("params") or sd
    net.load_state_dict(sd, strict=True)
    net.eval().to(dev)
    if half:
        net = net.half()
    return net


def run_net(net, x, tile):
    """x: N,3,H,W in [0,1]. The big model works in overlapping tiles so a frame never runs the card out of memory."""
    if not tile or max(x.shape[2], x.shape[3]) <= tile:
        return net(x)
    n, c, h, w = x.shape
    pad = 16
    out = torch.zeros((n, c, h * 4, w * 4), dtype=x.dtype, device=x.device)
    for y0 in range(0, h, tile):
        for x0 in range(0, w, tile):
            y1, x1 = min(h, y0 + tile), min(w, x0 + tile)
            py0, px0 = max(0, y0 - pad), max(0, x0 - pad)
            py1, px1 = min(h, y1 + pad), min(w, x1 + pad)
            o = net(x[:, :, py0:py1, px0:px1])
            oy, ox = (y0 - py0) * 4, (x0 - px0) * 4
            out[:, :, y0 * 4:y1 * 4, x0 * 4:x1 * 4] = o[:, :, oy:oy + (y1 - y0) * 4, ox:ox + (x1 - x0) * 4]
    return out


def to_size(y, height):
    """The model's 4x picture resized (area-averaged when shrinking) to the height asked for, width even."""
    h, w = y.shape[2], y.shape[3]
    if not height or height == h:
        return y
    nw = int(round(w * height / h / 2)) * 2
    return F.interpolate(y.float(), size=(height, nw), mode="bicubic", antialias=True, align_corners=False)


def probe(ffmpeg, src):
    """Width, height and frame rate from ffmpeg's banner (ffprobe is not always beside it)."""
    p = subprocess.run([ffmpeg, "-hide_banner", "-i", src], capture_output=True, text=True)
    import re

    m = re.search(r"Stream #\S+.*Video:.*?(\d{2,5})x(\d{2,5})", p.stderr)
    r = re.search(r"(\d+(?:\.\d+)?) fps", p.stderr)
    a = re.search(r"Stream #\S+.*Audio:", p.stderr)
    if not m:
        raise RuntimeError("no video stream")
    return int(m.group(1)), int(m.group(2)), float(r.group(1)) if r else 30.0, bool(a)


def video(net, dev, half, ffmpeg, src, dest, height, tile, batch=4):
    w, h, fps, audio = probe(ffmpeg, src)
    dec = subprocess.Popen(
        [ffmpeg, "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
    )
    enc = None
    frames = 0
    size = w * h * 3
    tmp = dest + ".part.mp4"
    try:
        while True:
            bufs = []
            for _ in range(batch):
                b = dec.stdout.read(size)
                if len(b) < size:
                    break
                bufs.append(b)
            if not bufs:
                break
            arr = np.stack([np.frombuffer(b, np.uint8).reshape(h, w, 3) for b in bufs])
            x = torch.from_numpy(arr).to(dev).permute(0, 3, 1, 2)
            x = (x.half() if half else x.float()) / 255.0
            with torch.inference_mode():
                y = to_size(run_net(net, x, tile), height)
            y = (y.clamp(0, 1) * 255).round().to(torch.uint8).permute(0, 2, 3, 1).contiguous().cpu().numpy()
            if enc is None:
                oh, ow = y.shape[1], y.shape[2]
                cmd = [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{ow}x{oh}",
                       "-r", f"{fps:g}", "-i", "-"]
                if audio:
                    cmd += ["-i", src, "-map", "0:v", "-map", "1:a", "-c:a", "copy", "-shortest"]
                cmd += ["-c:v", "libx264", "-crf", "17", "-preset", "fast", "-pix_fmt", "yuv420p", tmp]
                enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
            enc.stdin.write(y.tobytes())
            frames += len(bufs)
        if enc is None:
            raise RuntimeError("no frames")
        enc.stdin.close()
        if enc.wait() != 0:
            raise RuntimeError("encode failed")
        os.replace(tmp, dest)
        return frames, w, h
    finally:
        dec.kill()
        if enc and enc.poll() is None:
            enc.kill()
        if os.path.exists(tmp):
            os.remove(tmp)


MAX_STILL_H = 2160  # a still's four-times copy is capped at 4K's height


def image(net, dev, half, src, dest, height, tile, max_height=None):
    img = Image.open(src).convert("RGB")
    w, h = img.size
    if max_height and h > max_height:
        raise ValueError("tall enough")  # modern HD is never touched
    x = torch.from_numpy(np.array(img)).to(dev).permute(2, 0, 1)[None]
    x = (x.half() if half else x.float()) / 255.0
    with torch.inference_mode():
        y = run_net(net, x, tile)
        y = to_size(y, height or (MAX_STILL_H if y.shape[2] > MAX_STILL_H else 0))
    y = (y.clamp(0, 1) * 255).round().to(torch.uint8)[0].permute(1, 2, 0).cpu().numpy()
    tmp = dest + ".part" + os.path.splitext(dest)[1]
    Image.fromarray(y).save(tmp, quality=93)
    os.replace(tmp, dest)
    return 1, w, h


def main():
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    dev = device()
    half = bool(jobs.get("half", True)) and dev.type == "cuda"
    name = jobs.get("model", "general")
    t0 = time.time()
    net = load(name, jobs["modelDir"], dev, half)
    tile = 192 if MODELS[name][1] == "rrdb" else 0
    load_s = time.time() - t0
    out = []
    for it in jobs["items"]:
        t = time.time()
        r = {"src": it["src"], "dest": it["dest"], "ok": False}
        try:
            if it["kind"] == "video":
                n, w, h = video(net, dev, half, jobs["ffmpeg"], it["src"], it["dest"], it.get("height"), tile)
            else:
                n, w, h = image(net, dev, half, it["src"], it["dest"], it.get("height"), tile, it.get("maxHeight"))
            if dev.type == "cuda":
                torch.cuda.synchronize()
            r.update(ok=True, frames=n, width=w, height=h)
        except Exception as e:  # one bad file never stops the rest
            r["why"] = str(e)[:200]
        r["seconds"] = round(time.time() - t, 3)
        out.append(r)
    json.dump({"model": name, "device": dev.type, "loadSeconds": round(load_s, 3), "items": out},
              open(sys.argv[2], "w", encoding="utf-8"))
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
