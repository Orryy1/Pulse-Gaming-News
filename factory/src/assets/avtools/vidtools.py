"""Instant replay and sharpening for gameplay Shorts (INSTANT_REPLAY, CROP_UPSCALE; src/assets/avtools.ts drives it).

  slowmo IN OUT --factor 4      AI slow motion: RIFE 4.26 (hzwer, MIT) makes factor-1 new frames between each
                                pair, written at the input's frame rate, so the clip plays factor times slower.
  upscale IN OUT --width W --height H
                                Real-ESRGAN general x4v3 (xinntao, BSD-3-Clause) on each frame, then an area
                                downscale to W x H: the 9:16 crop of a 16:9 source (about 607x1080 shown at
                                1080x1920, a 1.78x blow-up) gets real detail instead of a stretched one.
  sharpness IN [IN...]          a no-reference measure per file (variance of the Laplacian, mean gradient), for
                                the proof and the tests.

Frames move through ffmpeg pipes (rgb24); no file path is ever given to a shell. Run with python -I from this
folder. The network definitions below are re-typed from the MIT and BSD-3 sources named above (see MODELS.md);
nothing is imported from the downloaded archives, and the weights load with torch's weights_only loader.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time

import numpy as np


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def pick_device(want=None):
    import torch

    if want:
        return torch.device(want)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


# ------------------------------------------------------------------ video in and out


def probe(ffprobe: str, path: str) -> dict:
    out = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_frames", "-of", "json", path],
        check=True,
        capture_output=True,
    ).stdout
    s = json.loads(out)["streams"][0]
    num, den = (int(x) for x in s["r_frame_rate"].split("/"))
    return {"w": int(s["width"]), "h": int(s["height"]), "fps": num / max(1, den), "rate": s["r_frame_rate"]}


def reader(ffmpeg: str, path: str, w: int, h: int, vf: str | None = None):
    cmd = [ffmpeg, "-v", "error", "-nostdin", "-i", path]
    if vf:
        cmd += ["-vf", vf]
    cmd += ["-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = w * h * 3
    try:
        while True:
            b = p.stdout.read(n)
            if len(b) < n:
                break
            yield np.frombuffer(b, dtype=np.uint8).reshape(h, w, 3)
    finally:
        p.stdout.close()
        p.wait()


def writer(ffmpeg: str, path: str, w: int, h: int, rate: str, crf: int = 16):
    cmd = [
        ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", rate, "-i", "pipe:0",
        "-c:v", "libx264", "-preset", "medium", "-crf", str(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", path,
    ]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


# ------------------------------------------------------------------ RIFE 4.26 (IFNet_HDv3), MIT, hzwer

_GRID = {}


def warp(x, flow):
    import torch
    import torch.nn.functional as F

    k = (str(flow.device), tuple(flow.shape))
    if k not in _GRID:
        h = torch.linspace(-1.0, 1.0, flow.shape[3], device=flow.device).view(1, 1, 1, -1).expand(flow.shape[0], -1, flow.shape[2], -1)
        v = torch.linspace(-1.0, 1.0, flow.shape[2], device=flow.device).view(1, 1, -1, 1).expand(flow.shape[0], -1, -1, flow.shape[3])
        _GRID[k] = torch.cat([h, v], 1)
    f = torch.cat([flow[:, 0:1] / ((x.shape[3] - 1.0) / 2.0), flow[:, 1:2] / ((x.shape[2] - 1.0) / 2.0)], 1)
    g = (_GRID[k] + f).permute(0, 2, 3, 1)
    return F.grid_sample(x, g, mode="bilinear", padding_mode="border", align_corners=True)


def build_ifnet():
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    def conv(i, o, k=3, s=1, p=1):
        return nn.Sequential(nn.Conv2d(i, o, k, s, p, bias=True), nn.LeakyReLU(0.2, True))

    class Head(nn.Module):
        def __init__(self):
            super().__init__()
            self.cnn0 = nn.Conv2d(3, 16, 3, 2, 1)
            self.cnn1 = nn.Conv2d(16, 16, 3, 1, 1)
            self.cnn2 = nn.Conv2d(16, 16, 3, 1, 1)
            self.cnn3 = nn.ConvTranspose2d(16, 4, 4, 2, 1)
            self.relu = nn.LeakyReLU(0.2, True)

        def forward(self, x):
            x = self.relu(self.cnn0(x))
            x = self.relu(self.cnn1(x))
            x = self.relu(self.cnn2(x))
            return self.cnn3(x)

    class ResConv(nn.Module):
        def __init__(self, c):
            super().__init__()
            self.conv = nn.Conv2d(c, c, 3, 1, 1)
            self.beta = nn.Parameter(torch.ones((1, c, 1, 1)))
            self.relu = nn.LeakyReLU(0.2, True)

        def forward(self, x):
            return self.relu(self.conv(x) * self.beta + x)

    class IFBlock(nn.Module):
        def __init__(self, cin, c):
            super().__init__()
            self.conv0 = nn.Sequential(conv(cin, c // 2, 3, 2, 1), conv(c // 2, c, 3, 2, 1))
            self.convblock = nn.Sequential(*[ResConv(c) for _ in range(8)])
            self.lastconv = nn.Sequential(nn.ConvTranspose2d(c, 4 * 13, 4, 2, 1), nn.PixelShuffle(2))

        def forward(self, x, flow=None, scale=1.0):
            x = F.interpolate(x, scale_factor=1.0 / scale, mode="bilinear", align_corners=False)
            if flow is not None:
                flow = F.interpolate(flow, scale_factor=1.0 / scale, mode="bilinear", align_corners=False) / scale
                x = torch.cat((x, flow), 1)
            feat = self.convblock(self.conv0(x))
            tmp = F.interpolate(self.lastconv(feat), scale_factor=scale, mode="bilinear", align_corners=False)
            return tmp[:, :4] * scale, tmp[:, 4:5], tmp[:, 5:]

    class IFNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.block0 = IFBlock(7 + 8, 192)
            self.block1 = IFBlock(8 + 4 + 8 + 8, 128)
            self.block2 = IFBlock(8 + 4 + 8 + 8, 96)
            self.block3 = IFBlock(8 + 4 + 8 + 8, 64)
            self.block4 = IFBlock(8 + 4 + 8 + 8, 32)
            self.encode = Head()

        def forward(self, img0, img1, timestep: float, scale_list):
            t = img0[:, :1] * 0 + timestep
            f0, f1 = self.encode(img0), self.encode(img1)
            blocks = [self.block0, self.block1, self.block2, self.block3, self.block4]
            flow = mask = feat = None
            w0, w1 = img0, img1
            for i, b in enumerate(blocks):
                if flow is None:
                    flow, mask, feat = b(torch.cat((img0, img1, f0, f1, t), 1), None, scale=scale_list[i])
                else:
                    wf0, wf1 = warp(f0, flow[:, :2]), warp(f1, flow[:, 2:4])
                    fd, mask, feat = b(torch.cat((w0, w1, wf0, wf1, t, mask, feat), 1), flow, scale=scale_list[i])
                    flow = flow + fd
                w0, w1 = warp(img0, flow[:, :2]), warp(img1, flow[:, 2:4])
            m = torch.sigmoid(mask)
            return w0 * m + w1 * (1 - m)

    return IFNet()


def load_rife(folder: str, device):
    import torch

    net = build_ifnet()
    sd = torch.load(f"{folder}/flownet.pkl", map_location="cpu", weights_only=True)
    sd = {k.replace("module.", ""): v for k, v in sd.items() if "teacher" not in k and "caltime" not in k}
    missing, unexpected = net.load_state_dict(sd, strict=False)
    if missing:
        raise RuntimeError(f"RIFE weights do not fit: missing {missing[:4]}")
    return net.eval().to(device)


def cmd_slowmo(a):
    import torch
    import torch.nn.functional as F

    dev = pick_device(a.device)
    info = probe(a.ffprobe, a.inp)
    w, h = info["w"], info["h"]
    net = load_rife(a.models + "/rife/RIFEv4.26_0921", dev)
    scale = 1.0 if max(w, h) <= 2000 else 0.5
    scales = [16 / scale, 8 / scale, 4 / scale, 2 / scale, 1 / scale]
    tmp = max(128, int(128 / scale))
    ph, pw = ((h - 1) // tmp + 1) * tmp, ((w - 1) // tmp + 1) * tmp
    half = dev.type == "cuda"
    out = writer(a.ffmpeg, a.out, w, h, info["rate"])

    def tens(fr):
        x = torch.from_numpy(fr.copy()).to(dev).permute(2, 0, 1)[None].float() / 255.0
        x = F.pad(x, (0, pw - w, 0, ph - h))
        return x.half() if half else x

    if half:
        net = net.half()
    t0 = time.time()
    n_in = 0
    prev = None
    with torch.inference_mode():
        for fr in reader(a.ffmpeg, a.inp, w, h):
            cur = tens(fr)
            if prev is not None:
                out.stdin.write(prev_frame.tobytes())
                for k in range(1, a.factor):
                    mid = net(prev, cur, k / a.factor, scales)
                    img = (mid[0, :, :h, :w].float().clamp(0, 1) * 255).round().byte().permute(1, 2, 0).cpu().numpy()
                    out.stdin.write(img.tobytes())
            prev, prev_frame = cur, fr
            n_in += 1
        if prev is not None:
            # The last frame is held for the length of its interval, so the slowed clip keeps factor x the time.
            for _ in range(a.factor):
                out.stdin.write(prev_frame.tobytes())
    out.stdin.close()
    out.wait()
    el = time.time() - t0
    print(json.dumps({"ok": True, "framesIn": n_in, "framesOut": n_in * a.factor, "seconds": round(el, 2), "fpsIn": round(n_in / max(el, 1e-3), 2), "device": str(dev)}))


# ------------------------------------------------------------------ Real-ESRGAN SRVGGNetCompact, BSD-3, xinntao


def build_srvgg(num_conv=32, upscale=4):
    import torch.nn as nn
    import torch.nn.functional as F

    class SRVGGNetCompact(nn.Module):
        def __init__(self):
            super().__init__()
            self.upscale = upscale
            body = [nn.Conv2d(3, 64, 3, 1, 1), nn.PReLU(num_parameters=64)]
            for _ in range(num_conv):
                body += [nn.Conv2d(64, 64, 3, 1, 1), nn.PReLU(num_parameters=64)]
            body += [nn.Conv2d(64, 3 * upscale * upscale, 3, 1, 1)]
            self.body = nn.ModuleList(body)
            self.upsampler = nn.PixelShuffle(upscale)

        def forward(self, x):
            out = x
            for m in self.body:
                out = m(out)
            return self.upsampler(out) + F.interpolate(x, scale_factor=self.upscale, mode="nearest")

    return SRVGGNetCompact()


def cmd_upscale(a):
    import torch
    import torch.nn.functional as F

    dev = pick_device(a.device)
    info = probe(a.ffprobe, a.inp)
    w, h = info["w"], info["h"]
    net = build_srvgg()
    sd = torch.load(f"{a.models}/realesrgan/realesr-general-x4v3.pth", map_location="cpu", weights_only=True)
    net.load_state_dict(sd.get("params", sd), strict=True)
    net = net.eval().to(dev)
    half = dev.type == "cuda"
    if half:
        net = net.half()
    out = writer(a.ffmpeg, a.out, a.width, a.height, info["rate"])
    t0 = time.time()
    n = 0
    with torch.inference_mode():
        for fr in reader(a.ffmpeg, a.inp, w, h):
            x = torch.from_numpy(fr.copy()).to(dev).permute(2, 0, 1)[None].float() / 255.0
            y = net(x.half() if half else x).float()
            # A blend with the plain resize keeps the model from repainting fine game texture as smooth plastic.
            if a.strength < 1:
                base = F.interpolate(x, size=y.shape[2:], mode="bicubic", align_corners=False)
                y = base + (y - base) * a.strength
            y = F.interpolate(y, size=(a.height, a.width), mode="area")
            out.stdin.write((y[0].clamp(0, 1) * 255).round().byte().permute(1, 2, 0).cpu().numpy().tobytes())
            n += 1
    out.stdin.close()
    out.wait()
    el = time.time() - t0
    print(json.dumps({"ok": True, "frames": n, "seconds": round(el, 2), "fps": round(n / max(el, 1e-3), 2), "device": str(dev), "in": [w, h], "out": [a.width, a.height]}))


# ------------------------------------------------------------------ measures


def sharpness(frame: np.ndarray) -> tuple[float, float]:
    g = frame.astype(np.float32) @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    lap = g[1:-1, 1:-1] * -4 + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    gx = np.abs(np.diff(g, axis=1)).mean()
    gy = np.abs(np.diff(g, axis=0)).mean()
    return float(lap.var()), float((gx + gy) / 2)


def cmd_sharpness(a):
    res = {}
    for f in a.files:
        info = probe(a.ffprobe, f)
        lv, gr = [], []
        for i, fr in enumerate(reader(a.ffmpeg, f, info["w"], info["h"])):
            if i % a.every == 0:
                l, g = sharpness(fr)
                lv.append(l)
                gr.append(g)
        res[f] = {"laplacianVar": round(float(np.mean(lv)), 1) if lv else 0, "gradient": round(float(np.mean(gr)), 3) if gr else 0, "frames": len(lv)}
    print(json.dumps(res, indent=1))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ffmpeg", default="ffmpeg")
    p.add_argument("--ffprobe", default="ffprobe")
    p.add_argument("--models", default="")
    p.add_argument("--device")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("slowmo")
    s.add_argument("inp")
    s.add_argument("out")
    s.add_argument("--factor", type=int, default=4)
    s = sub.add_parser("upscale")
    s.add_argument("inp")
    s.add_argument("out")
    s.add_argument("--width", type=int, required=True)
    s.add_argument("--height", type=int, required=True)
    s.add_argument("--strength", type=float, default=1.0)
    s = sub.add_parser("sharpness")
    s.add_argument("files", nargs="+")
    s.add_argument("--every", type=int, default=5)
    a = p.parse_args()
    {"slowmo": cmd_slowmo, "upscale": cmd_upscale, "sharpness": cmd_sharpness}[a.cmd](a)


if __name__ == "__main__":
    main()
