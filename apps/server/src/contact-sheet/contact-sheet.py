# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Timestamped contact sheets of a video, for picking b-roll by eye.

Usage:
  uv run contact-sheet.py <video> <out_dir> [--every 4] [--cols 8] [--rows 6] [--start 0] [--end END]

Writes <out_dir>/sheet_000.png, sheet_001.png, ... Each tile is labelled mm:ss.

Ported from the viral-shorts skill's contact_sheet.py; the sheets are unchanged. stdout carries one JSON
object per line: {"type": "progress", "done": 2, "total": 9}, an error line, or
{"type": "done", "frames": 456, "sheets": [{"file": "sheet_000.png", "start": 0.0, "end": 315.0}, ...]}.
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

TILE_W = 240


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out_dir")
    ap.add_argument("--every", type=float, default=4.0)
    ap.add_argument("--cols", type=int, default=8)
    ap.add_argument("--rows", type=int, default=6)
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=None)
    args = ap.parse_args()

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        cmd = ["ffmpeg", "-loglevel", "error", "-ss", str(args.start)]
        if args.end:
            cmd += ["-to", str(args.end)]
        cmd += ["-i", args.video, "-vf", f"fps=1/{args.every},scale={TILE_W}:-2", f"{td}/f_%05d.jpg"]
        # -to before -i is relative to the input, so recompute when start is set
        if args.end:
            cmd[cmd.index("-to") + 1] = str(args.end)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            fail("ffmpeg", f"can't extract frames: {r.stderr.strip()[-2000:]}")
        frames = sorted(Path(td).glob("f_*.jpg"))
        if not frames:
            fail("no-frames", "no frames extracted")
        th = Image.open(frames[0]).height
        font = ImageFont.load_default(18)
        per = args.cols * args.rows
        total = (len(frames) + per - 1) // per
        sheets = []
        for si in range(0, len(frames), per):
            sheet = Image.new("RGB", (args.cols * TILE_W, args.rows * th), "black")
            d = ImageDraw.Draw(sheet)
            for i, fp in enumerate(frames[si:si + per]):
                t = args.start + (si + i) * args.every
                x, y = (i % args.cols) * TILE_W, (i // args.cols) * th
                sheet.paste(Image.open(fp), (x, y))
                label = f"{int(t // 60):02d}:{int(t % 60):02d}"
                d.rectangle((x, y, x + 60, y + 22), fill="black")
                d.text((x + 4, y + 2), label, font=font, fill="yellow")
            name = f"sheet_{si // per:03d}.png"
            sheet.save(out / name)
            count = len(frames[si:si + per])
            sheets.append({"file": name, "start": args.start + si * args.every,
                           "end": args.start + (si + count - 1) * args.every})
            emit({"type": "progress", "done": len(sheets), "total": total})
        emit({"type": "done", "frames": len(frames), "sheets": sheets})


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
