# /// script
# requires-python = ">=3.10"
# dependencies = ["yt-dlp"]
# ///
"""Bring a long video into a source folder as <out-dir>/source.mp4 and report its metadata.

Usage:
  uv run fetch-source.py (--url URL [--scan] | --file PATH) --out-dir DIR

A URL is downloaded with yt-dlp at 1080p, else 720p, else the best there is below that (never above 1080p:
shorts are 1080x1920, so more only costs disk), merged to mp4; yt-dlp is an inline dependency, so nothing
needs installing. A local file is hard-linked when it is on the same disk, copied otherwise, and remuxed
when it isn't already an mp4. `--scan` (videos found by research) downloads a 480p copy for reading instead, through
Viral's own yt-dlp command (VIRAL_YT_DLP overrides it); a short then fetches only the seconds it uses in 1080p with
fetch-pieces.py.

stdout, one JSON object per line:
  {"type": "progress", "pct": 42.0}
  {"type": "error", "code": "download", "message": "..."}    (then exit 1)
  {"type": "done", "path": "source.mp4", "title": ..., "channel": ..., "url": ..., "duration_s": 2280.4,
   "width": 1920, "height": 1080}                             (+ "scan": true for a scan)

`--print-format` / `--print-scan-format` print the yt-dlp format selectors and exit (for tests).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from youtube_download import (FULL_FORMAT, RETRY_PAUSE_S, SCAN_FORMAT, FetchFailure, download_with_retry, emit,  # noqa: F401
                              is_refusal, run_yt_dlp)


# 1080p first, then 720p, then the best under 1080p, then anything (FULL_FORMAT); a scan is 480p (SCAN_FORMAT).
FORMAT = FULL_FORMAT


def probe(path: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height:format=duration", "-of", "json", str(path)], capture_output=True, text=True)
    if r.returncode != 0:
        raise FetchFailure("probe", f"not a readable video: {r.stderr.strip()}")
    data = json.loads(r.stdout)
    stream = (data.get("streams") or [{}])[0]
    return {"duration_s": round(float(data["format"]["duration"]), 3), "width": stream.get("width"), "height": stream.get("height")}


def from_url(url: str, out: Path) -> dict:
    import yt_dlp

    def hook(d: dict) -> None:
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                emit({"type": "progress", "pct": round(100 * d.get("downloaded_bytes", 0) / total, 1)})

    opts = {
        "format": FORMAT,
        "merge_output_format": "mp4",
        "outtmpl": str(out / "source.%(ext)s"),
        "progress_hooks": [hook],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }
    info = download_with_retry(lambda: _download(yt_dlp, opts, url), time.sleep)
    if not (out / "source.mp4").exists():
        raise FetchFailure("download", "yt-dlp finished without producing source.mp4")
    return {
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "url": info.get("webpage_url") or url,
    }


def _download(yt_dlp, opts: dict, url: str) -> dict:
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=True)


def from_url_scan(url: str, out: Path) -> dict:
    """A scan: the 480p copy a video found by research is read from, through Viral's own yt-dlp (the one research
    searches with). A short later fetches the seconds it uses in 1080p (fetch-pieces.py)."""
    info: dict = {}

    def line(text: str) -> None:
        text = text.strip()
        if text.startswith("{"):
            info.update(json.loads(text))
        elif text.endswith("%"):
            try:
                emit({"type": "progress", "pct": round(float(text[:-1]), 1)})
            except ValueError:
                pass

    args = ["--quiet", "--progress", "--newline", "--progress-template", "download:%(progress._percent_str)s",
            "-f", SCAN_FORMAT, "--merge-output-format", "mp4", "-o", str(out / "source.%(ext)s"),
            "--print", "after_move:%(.{title,channel,uploader,webpage_url})j", url]
    download_with_retry(lambda: run_yt_dlp(args, line) or info, time.sleep)
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
    if sys.argv[1:] == ["--print-format"]:
        print(FORMAT)
        return
    if sys.argv[1:] == ["--print-scan-format"]:
        print(SCAN_FORMAT)
        return
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--url")
    src.add_argument("--file")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--scan", action="store_true", help="a link: download the 480p scan instead of the whole video")
    args = ap.parse_args()

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    scan = bool(args.url and args.scan)
    if args.url:
        meta = from_url_scan(args.url, out) if scan else from_url(args.url, out)
    else:
        meta = from_file(Path(args.file).expanduser().resolve(), out)
    video = probe(out / "source.mp4")
    if video["height"]:
        emit({"type": "log", "message": f"source video is {video['width']}x{video['height']}{' (a scan for reading)' if scan else ''}"})
    emit({"type": "done", "path": "source.mp4", **meta, **video, **({"scan": True} if scan else {})})


if __name__ == "__main__":
    try:
        main()
    except FetchFailure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
