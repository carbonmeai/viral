# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""A storyboard of a shot plan: one frame per tile at its source second, labelled, for checking by eye.

Usage:
  uv run storyboard.py <video> <spec.json> <out.png>

spec.json: {"cols": 6, "tiles": [{"t": 25.0, "label": "1  w0 This", "kind": "shot", "file": "frames/shot-01.jpg"}, ...]}.
Each tile's frame is saved on its own at `file` (relative to out.png's folder), then the frames are stitched
into out.png; kind "real" tiles (inserts and outro clips) get a red frame. stdout carries one JSON object per
line: {"type": "progress", "done": 3, "total": 30}, an error line, or {"type": "done", "tiles": 30}.
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

TILE_W = 320
LABEL_H = 26


def main() -> None:
    if len(sys.argv) != 4:
        fail("usage", "storyboard.py <video> <spec.json> <out.png>")
    video, spec_path, out = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    out.parent.mkdir(parents=True, exist_ok=True)
    spec = json.loads(spec_path.read_text())
    tiles = spec["tiles"]
    if not tiles:
        fail("no-tiles", "the storyboard has no tiles")
    cols = int(spec.get("cols", 6))
    font = ImageFont.load_default(16)
    frames = []
    for i, tile in enumerate(tiles):
        fp = out.parent / tile["file"]
        fp.parent.mkdir(parents=True, exist_ok=True)
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{float(tile['t']):.3f}", "-i", video,
                            "-frames:v", "1", "-vf", f"scale={TILE_W}:-2", str(fp)], capture_output=True, text=True)
        if r.returncode != 0 or not fp.exists():
            fail("ffmpeg", f"no frame at {tile['t']}s: {r.stderr.strip()[-500:]}")
        frames.append(Image.open(fp).copy())
        emit({"type": "progress", "done": i + 1, "total": len(tiles)})
    th = frames[0].height
    rows = (len(tiles) + cols - 1) // cols
    board = Image.new("RGB", (cols * TILE_W, rows * (th + LABEL_H)), "black")
    d = ImageDraw.Draw(board)
    for i, (tile, frame) in enumerate(zip(tiles, frames)):
        x, y = (i % cols) * TILE_W, (i // cols) * (th + LABEL_H)
        board.paste(frame, (x, y + LABEL_H))
        real = tile.get("kind") == "real"
        d.text((x + 6, y + 4), str(tile["label"])[:40], font=font, fill="#FF5A4F" if real else "yellow")
        if real:
            d.rectangle((x, y + LABEL_H, x + TILE_W - 1, y + LABEL_H + th - 1), outline="#FF3B30", width=4)
    board.save(out)
    emit({"type": "done", "tiles": len(tiles)})


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


class Failure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def fail(code: str, message: str) -> None:
    raise Failure(code, message)


if __name__ == "__main__":
    try:
        main()
    except Failure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
