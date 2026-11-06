# /// script
# requires-python = ">=3.10"
# dependencies = ["pyobjc-framework-Vision", "pyobjc-framework-Quartz", "pillow"]
# ///
"""Lift subjects out of images with macOS's own subject cut-out (Vision's foreground instance mask, the same
model as "Lift subject from background" in Photos; macOS 14+). No model download. render-thumbnail.py tries this
first for bold thumbnails, and falls back to rembg (cutout.py) where it fails or isn't available.

Usage:
  uv run cutout-apple.py <in.png> <out.png> [<in.png> <out.png> ...]

Each `out.png` is the input with an alpha channel. Vision can find several subjects; the one under the image's
centre is kept (all of them when none is there). stdout carries one JSON object per line:
{"type": "cutout", "out": "...", "instances": 2, "kept": [1], "coverage": 0.41}, or an error line.
"""
import json
import struct
import sys

import Quartz
import Vision
from Foundation import NSURL, NSMutableIndexSet
from PIL import Image


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


def pixels(buffer) -> tuple[int, int, int, bytes]:
    """A CVPixelBuffer's width, height, bytes per row and bytes."""
    Quartz.CVPixelBufferLockBaseAddress(buffer, 1)
    try:
        width = Quartz.CVPixelBufferGetWidth(buffer)
        height = Quartz.CVPixelBufferGetHeight(buffer)
        stride = Quartz.CVPixelBufferGetBytesPerRow(buffer)
        base = Quartz.CVPixelBufferGetBaseAddress(buffer)
        data = bytes(base.as_buffer(stride * height))
        return width, height, stride, data
    finally:
        Quartz.CVPixelBufferUnlockBaseAddress(buffer, 1)


def cut(src: str, out: str) -> None:
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(NSURL.fileURLWithPath_(src), None)
    request = Vision.VNGenerateForegroundInstanceMaskRequest.alloc().init()
    ok, error = handler.performRequests_error_([request], None)
    if not ok:
        raise RuntimeError(f"vision failed: {error}")
    results = request.results()
    if not results:
        raise RuntimeError("no subject found")
    result = results[0]
    instances = result.allInstances()
    # the label map: 0 = background, 1..n = instances; keep the instance under the centre
    w, h, stride, labels = pixels(result.instanceMask())
    centre = labels[(h // 2) * stride + w // 2]
    kept = NSMutableIndexSet.alloc().init()
    chosen = [centre] if centre != 0 else list(instances)
    for i in chosen:
        kept.addIndex_(i)
    mask, error = result.generateScaledMaskForImageForInstances_fromRequestHandler_error_(kept, handler, None)
    if mask is None:
        raise RuntimeError(f"mask failed: {error}")
    mw, mh, mstride, mdata = pixels(mask)
    # the mask is one float32 per pixel, 0..1
    alpha = Image.new("L", (mw, mh))
    values = []
    for y in range(mh):
        row = struct.unpack_from(f"{mw}f", mdata, y * mstride)
        values.extend(max(0, min(255, int(v * 255 + 0.5))) for v in row)
    alpha.putdata(values)
    img = Image.open(src).convert("RGBA")
    if alpha.size != img.size:
        alpha = alpha.resize(img.size, Image.LANCZOS)
    img.putalpha(alpha)
    img.save(out)
    coverage = sum(1 for v in values if v > 127) / len(values)
    emit({"type": "cutout", "out": out, "instances": len(instances), "kept": chosen, "coverage": round(coverage, 3)})


def main() -> None:
    args = sys.argv[1:]
    if len(args) < 2 or len(args) % 2:
        emit({"type": "error", "code": "usage", "message": "cutout-apple.py <in.png> <out.png> [...]"})
        sys.exit(1)
    for i in range(0, len(args), 2):
        try:
            cut(args[i], args[i + 1])
        except Exception as error:  # one failed image shouldn't stop the others
            emit({"type": "error", "code": "cutout", "message": f"{args[i]}: {type(error).__name__}: {error}"})


if __name__ == "__main__":
    main()
