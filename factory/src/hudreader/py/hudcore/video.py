"""Frames from a recording through ffmpeg (never OpenCV's reader: a "%" in a file name is read by OpenCV as an image
sequence pattern, and the owner's VOD names carry one, "GTA V 100% [v...]"). The path goes to ffmpeg as one argument,
never through a shell."""

import subprocess
import sys

import numpy as np


def probe(ffprobe, path):
    out = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height:format=duration", "-of", "default=nw=1", path],
        capture_output=True, text=True, check=True,
    ).stdout
    vals = {}
    for line in out.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip()
    return int(vals["width"]), int(vals["height"]), float(vals.get("duration", "0") or 0)


def frames(ffmpeg, path, fps, start=0.0, duration=None, width=None, height=None, threads=2, quiet=False,
           keyframes=False):
    """Yields (seconds, BGR frame) at `fps`, from `start`, scaled to width x height when both are given.
    `keyframes`: decode only the key frames (a Twitch recording has one every 2 s), about 40 times less work than
    decoding every frame; for a whole recording read at 0.5 fps, where a second either way does not matter."""
    w, h = width, height
    vf = f"fps={fps}"
    if w and h:
        vf += f",scale={w}:{h}"
    args = [ffmpeg, "-v", "error", "-nostdin", "-threads", str(threads)]
    # The Mac mini decodes on its media engine (falls back to software by itself), which leaves the CPU for the reading.
    if sys.platform == "darwin":
        args += ["-hwaccel", "videotoolbox"]
    if keyframes:
        args += ["-skip_frame", "nokey"]
    if start > 0:
        args += ["-ss", f"{start:.3f}"]
    args += ["-i", path]
    if duration:
        args += ["-t", f"{duration:.3f}"]
    args += ["-an", "-vf", vf, "-pix_fmt", "bgr24", "-f", "rawvideo", "-"]
    if not (w and h):
        raise ValueError("frames() needs the output size; probe the file first")
    size = w * h * 3
    # ffmpeg is stopped as soon as enough frames are read; its complaint about the closed pipe is not an error.
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL if quiet else None, bufsize=size * 2)
    i = 0
    try:
        while True:
            buf = p.stdout.read(size)
            if len(buf) < size:
                break
            yield start + i / fps, np.frombuffer(buf, np.uint8).reshape(h, w, 3)
            i += 1
    finally:
        p.stdout.close()
        p.kill()
        p.wait()


def frame_at(ffmpeg, path, t, width, height):
    """One frame at `t` seconds."""
    for _, f in frames(ffmpeg, path, 30, start=t, duration=0.2, width=width, height=height, quiet=True):
        return f
    return None
