# /// script
# requires-python = ">=3.10"
# dependencies = ["yt-dlp"]
# ///
"""Bring a long video into a source folder as <out-dir>/source.mp4 and report its metadata.

Usage:
  uv run fetch-source.py (--url URL | --file PATH) --out-dir DIR

A URL is downloaded with yt-dlp at 1080p, else 720p, else the best there is below that (never above 1080p:
shorts are 1080x1920, so more only costs disk), merged to mp4; yt-dlp is an inline dependency, so nothing
needs installing. A local file is hard-linked when it is on the same disk, copied otherwise, and remuxed
when it isn't already an mp4.

stdout, one JSON object per line:
  {"type": "progress", "pct": 42.0}
  {"type": "error", "code": "download", "message": "..."}    (then exit 1)
  {"type": "done", "path": "source.mp4", "title": ..., "channel": ..., "url": ..., "duration_s": 2280.4,
   "width": 1920, "height": 1080}

`--print-format` prints the yt-dlp format selector and exits (for tests).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


class FetchFailure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# 1080p first, then 720p, then the best under 1080p, then anything; within a height, H.264 + AAC so the merge
# into mp4 needs no re-encode.
FORMAT = "/".join([
    "bv*[height=1080][vcodec^=avc1]+ba[ext=m4a]",
    "bv*[height=1080]+ba",
    "bv*[height=720][vcodec^=avc1]+ba[ext=m4a]",
    "bv*[height=720]+ba",
    "bv*[height<=1080]+ba",
    "b[height<=1080]",
    "b",
])


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


def is_refusal(message: str) -> bool:
    """YouTube saying no (a 403), as opposed to a missing or broken video."""
    return "HTTP Error 403" in message or "403: Forbidden" in message


RETRY_PAUSE_S = 8


def download_with_retry(download, sleep) -> dict:
    """Downloads once, and once more after a short pause when YouTube answers 403. A second refusal is reported as
    `blocked`, in plain words; Viral never works around it (no cookies, proxies or other tricks)."""
    for attempt in (1, 2):
        try:
            return download()
        except Exception as error:  # yt-dlp raises DownloadError with a readable message
            message = str(error)
            if is_refusal(message) and attempt == 1:
                emit({"type": "log", "message": f"YouTube refused the download (403); trying once more in {RETRY_PAUSE_S}s"})
                sleep(RETRY_PAUSE_S)
                continue
            if is_refusal(message):
                raise FetchFailure("blocked", "YouTube refused the download twice (403). Viral doesn't work around a "
                                              "block: try again later, or replace this video.") from error
            raise FetchFailure("download", message) from error
    raise FetchFailure("download", "unreachable")


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
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--url")
    src.add_argument("--file")
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    meta = from_url(args.url, out) if args.url else from_file(Path(args.file).expanduser().resolve(), out)
    video = probe(out / "source.mp4")
    if video["height"]:
        emit({"type": "log", "message": f"source video is {video['width']}x{video['height']}"})
    emit({"type": "done", "path": "source.mp4", **meta, **video})


if __name__ == "__main__":
    try:
        main()
    except FetchFailure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
