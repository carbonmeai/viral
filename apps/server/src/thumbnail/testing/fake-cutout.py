# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""A fake cut-out script for the thumbnail tests, standing in for both cutout-apple.py (`in out` pairs) and cutout.py
(`models_dir` first, then `in out model` triples), so every cut-out path runs without Vision or rembg. It is a file
in the repo, not one a test writes: uv keeps a script's environment by its path, so a fresh copy each run would build
a new environment (several seconds) every time.

FAKE_CUT=ok keeps an ellipse (about half the image), "empty" keeps almost nothing, "fail" writes nothing;
FAKE_CUT_APPLE overrides it for the Apple stand-in only.
"""
import json
import os
import sys

from PIL import Image, ImageDraw

args = sys.argv[1:]
rembg = len(args) > 0 and os.path.isdir(args[0])
mode = os.environ.get("FAKE_CUT", "ok") if rembg else os.environ.get("FAKE_CUT_APPLE") or os.environ.get("FAKE_CUT", "ok")
step = 3 if rembg else 2
images = args[1:] if rembg else args
for i in range(0, len(images), step):
    src, out = images[i], images[i + 1]
    if mode == "fail":
        print(json.dumps({"type": "error", "code": "cutout", "message": "fake failure"}))
        continue
    img = Image.open(src).convert("RGBA")
    mask = Image.new("L", img.size, 0)
    w, h = img.size
    if mode == "ok":
        ImageDraw.Draw(mask).ellipse((w * 0.1, h * 0.1, w * 0.9, h * 0.9), fill=255)
    img.putalpha(mask)
    img.save(out)
    kept = mask.histogram()[128:]
    print(json.dumps({"type": "cutout", "out": out, "coverage": round(sum(kept) / (w * h), 3)}))
