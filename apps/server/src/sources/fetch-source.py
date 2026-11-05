# /// script
# requires-python = ">=3.10"
# dependencies = ["yt-dlp"]
# ///
"""Bring a long video into a source folder as <out-dir>/source.mp4 and report its metadata.

Usage:
  uv run fetch-source.py (--url URL | --file PATH) --out-dir DIR

A URL is downloaded with yt-dlp (up to 1080p, merged to mp4; yt-dlp is an inline dependency, so nothing
needs installing). A local file is hard-linked when it is on the same disk, copied otherwise, and remuxed
when it isn't already an mp4.

stdout, one JSON object per line:
  {"type": "progress", "pct": 42.0}
  {"type": "error", "code": "download", "message": "..."}    (then exit 1)
  {"type": "done", "path": "source.mp4", "title": ..., "channel": ..., "url": ..., "duration_s": 2280.4}
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


class FetchFailure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise FetchFailure("probe", f"not a readable video: {r.stderr.strip()}")
    return float(r.stdout.strip())


def from_url(url: str, out: Path) -> dict:
    import yt_dlp

    def hook(d: dict) -> None:
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                emit({"type": "progress", "pct": round(100 * d.get("downloaded_bytes", 0) / total, 1)})

    opts = {
        "format": "bv*[height<=1080]+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": str(out / "source.%(ext)s"),
        "progress_hooks": [hook],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Exception as error:  # yt-dlp raises DownloadError with a readable message
        raise FetchFailure("download", str(error)) from error
    if not (out / "source.mp4").exists():
        raise FetchFailure("download", "yt-dlp finished without producing source.mp4")
    return {
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "url": info.get("webpage_url") or url,
    }


def from_file(path: Path, out: Path) -> dict:
    if not path.is_file():
        raise FetchFailure("missing-file", f"{path} is not a file")
    target = out / "source.mp4"
    if path.suffix.lower() == ".mp4":
        try:
            os.link(path, target)
        except OSError:  # another disk, or links not supported
            shutil.copy2(path, target)
    else:
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-c", "copy", str(target)],
                           capture_output=True, text=True)
        if r.returncode != 0:  # codecs that mp4 can't hold: re-encode
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-c:v", "libx264", "-crf", "18",
                                "-c:a", "aac", str(target)], capture_output=True, text=True)
            if r.returncode != 0:
                raise FetchFailure("convert", r.stderr.strip()[-2000:])
    emit({"type": "progress", "pct": 100.0})
    return {"title": path.stem, "channel": None, "url": None}


def main() -> None:
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--url")
    src.add_argument("--file")
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    meta = from_url(args.url, out) if args.url else from_file(Path(args.file).expanduser().resolve(), out)
    emit({"type": "done", "path": "source.mp4", **meta, "duration_s": round(duration(out / "source.mp4"), 3)})


if __name__ == "__main__":
    try:
        main()
    except FetchFailure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
