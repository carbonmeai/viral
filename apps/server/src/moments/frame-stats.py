# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Compares each shot's first and last frame, so a ranking's moments step can catch a shot that drifts into another
scene (another animal, a recap, the "before" replayed in the "after") or starts or ends on black.

Usage:
  uv run frame-stats.py <spec.json>

spec.json: {"pairs": [["frames/rank-01-shot-1-first.jpg", "frames/rank-01-shot-1-last.jpg"], ...]} (paths relative
to the spec's folder, or absolute). For each pair: the mean brightness of both frames (0–1) and how alike their
colours are (0–1, histogram intersection over a coarse RGB grid). stdout carries one JSON object per line:
{"type": "pair", "index": 0, "first_luma": 0.41, "last_luma": 0.38, "similarity": 0.72}, then {"type": "done",
"pairs": 3}, or {"type": "error", "code", "message"}.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageStat

BINS = 4  # per channel: a 4×4×4 colour grid


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


class Failure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def histogram(img: Image.Image) -> list[float]:
    small = img.convert("RGB").resize((64, 36))
    counts = [0] * (BINS ** 3)
    step = 256 // BINS
    pixels = list(small.getdata())
    for r, g, b in pixels:
        counts[(r // step) * BINS * BINS + (g // step) * BINS + b // step] += 1
    return [c / len(pixels) for c in counts]


def luma(img: Image.Image) -> float:
    return ImageStat.Stat(img.convert("L")).mean[0] / 255


def main() -> None:
    if len(sys.argv) != 2:
        raise Failure("usage", "frame-stats.py <spec.json>")
    spec_path = Path(sys.argv[1])
    spec = json.loads(spec_path.read_text())
    pairs = spec.get("pairs", [])
    for i, (first, last) in enumerate(pairs):
        a = Image.open(first if Path(first).is_absolute() else spec_path.parent / first)
        b = Image.open(last if Path(last).is_absolute() else spec_path.parent / last)
        ha, hb = histogram(a), histogram(b)
        emit({"type": "pair", "index": i, "first_luma": round(luma(a), 4), "last_luma": round(luma(b), 4),
              "similarity": round(sum(min(x, y) for x, y in zip(ha, hb)), 4)})
    emit({"type": "done", "pairs": len(pairs)})


if __name__ == "__main__":
    try:
        main()
    except Failure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
