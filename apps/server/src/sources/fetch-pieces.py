# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""Fetch the stretches of a video a short uses, in full quality (1080p when the site has it, never above), into a
source's pieces folder: one yt-dlp request with every stretch (`--download-sections`), so a ranking of 16 shots
from one video is one request, not 16.

Usage:
  uv run fetch-pieces.py --url URL --out-dir DIR [--scan SCAN.mp4] --section START-END [--section START-END …]

Each piece is checked against the scan (the 480p copy the video was read from): its sound is matched to the scan's
around where it should start, and a piece that landed off by more than a frame or two is placed where it really
starts. A piece without sound keeps the requested start.

A 403 is retried once after a pause; a second is `blocked`, said plainly. Viral never works around a block.

stdout, one JSON object per line:
  {"type": "piece", "path": "/abs/12.5-20.mp4", "start": 12.5, "end": 20.0, "width": 1920, "height": 1080}
  {"type": "progress", "pct": 50.0}
  {"type": "log", "message": "..."}
  {"type": "error", "code": "blocked" | "download" | "missing", "message": "..."}   (then exit 1)
  {"type": "done", "pieces": 2}
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from youtube_download import FULL_FORMAT, FetchFailure, download_with_retry, emit, run_yt_dlp


def probe(path: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height:format=duration", "-of", "json", str(path)], capture_output=True, text=True)
    if r.returncode != 0:
        return {}
    data = json.loads(r.stdout)
    stream = (data.get("streams") or [{}])[0]
    return {"width": stream.get("width"), "height": stream.get("height"),
            "duration": float(data.get("format", {}).get("duration") or 0)}


RATE = 8000


def pcm(path: Path, start: float, seconds: float):
    import numpy as np
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(start, 0.0):.3f}", "-i", str(path), "-t", f"{seconds:.3f}",
                        "-vn", "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"], capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.int16).astype(np.float32)


def measured_start(piece: Path, scan: Path, start: float) -> float | None:
    """Where the piece really starts in the video, by matching its first 3 s of sound against the scan from 2 s before
    to 5 s after the requested start; None when there's no sound to match or the match is weak."""
    import numpy as np
    head = pcm(piece, 0.0, 3.0)
    lead = min(2.0, start)
    around = pcm(scan, start - lead, 7.0)
    if len(head) < RATE or len(around) < len(head) or float(np.abs(head).max(initial=0)) < 50:
        return None
    n = len(head) + len(around)
    corr = np.fft.irfft(np.fft.rfft(around, n) * np.conj(np.fft.rfft(head, n)), n)[: len(around) - len(head) + 1]
    k = int(np.argmax(corr))
    window = around[k:k + len(head)]
    confidence = float(corr[k] / (np.linalg.norm(head) * np.linalg.norm(window) + 1e-9))
    # a steady tone or a looped beat matches in many places: only a clear single best match counts
    guard = int(0.05 * RATE)
    rest = np.concatenate([corr[: max(0, k - guard)], corr[k + guard + 1:]])
    if confidence < 0.8 or (len(rest) > 0 and float(rest.max()) > 0.9 * float(corr[k])):
        return None
    return start - lead + k / RATE


def parse_section(text: str) -> tuple[float, float]:
    a, b = text.split("-", 1)
    start, end = float(a), float(b)
    if not 0 <= start < end:
        raise FetchFailure("section", f"{text} isn't a stretch of the video")
    return start, end


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--scan", default=None)
    ap.add_argument("--section", action="append", required=True)
    args = ap.parse_args()

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    sections = [parse_section(s) for s in args.section]
    got: dict[str, dict] = {}

    def line(text: str) -> None:
        text = text.strip()
        if not text.startswith("{"):
            return
        info = json.loads(text)
        path = info.get("filepath")
        if path and Path(path).exists() and path not in got:
            got[path] = info
            emit({"type": "progress", "pct": round(100 * len(got) / len(sections), 1)})

    yt_args = ["--quiet", "--no-progress", "-f", FULL_FORMAT, "--merge-output-format", "mp4",
               *[a for s, e in sections for a in ("--download-sections", f"*{s:g}-{e:g}")],
               "-o", str(out / "%(section_start)s-%(section_end)s.%(ext)s"),
               "--print", "after_move:%(.{filepath,section_start,section_end,width,height})j", args.url]
    failure: FetchFailure | None = None
    try:
        download_with_retry(lambda: run_yt_dlp(yt_args, line) or {}, time.sleep)
    except FetchFailure as error:  # the pieces that did arrive are still reported, then the failure
        failure = error

    scan = Path(args.scan) if args.scan and Path(args.scan).exists() else None
    pieces = []
    for path, info in got.items():
        start, end = float(info.get("section_start") or 0), float(info.get("section_end") or 0)
        probed = probe(Path(path))
        if probed.get("duration"):
            end = start + probed["duration"]
        if scan is not None:
            real = measured_start(Path(path), scan, start)
            if real is not None and abs(real - start) > 0.04:
                emit({"type": "log", "message": f"the piece asked for at {start:.2f}s starts at {real:.2f}s; placed there"})
                end += real - start
                start = real
        pieces.append({"type": "piece", "path": str(Path(path).resolve()), "start": round(start, 3), "end": round(end, 3),
                       "width": info.get("width") or probed.get("width"), "height": info.get("height") or probed.get("height")})
    for piece in sorted(pieces, key=lambda p: p["start"]):
        emit(piece)
    if failure is not None:
        raise failure
    if len(pieces) < len(sections):
        raise FetchFailure("missing", f"yt-dlp brought {len(pieces)} of the {len(sections)} pieces asked for")
    emit({"type": "done", "pieces": len(pieces)})


if __name__ == "__main__":
    try:
        main()
    except FetchFailure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
