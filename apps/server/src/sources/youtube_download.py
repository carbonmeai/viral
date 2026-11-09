"""What fetch-source.py and fetch-pieces.py share: the format selectors, Viral's own yt-dlp command, and the one retry
after a 403. Importable (no third-party imports at module level), so `fetch-source.py --print-format` still runs
without yt-dlp installed.
"""
import json
import os
import subprocess
import threading


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


class FetchFailure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# 1080p first, then 720p, then the best under 1080p, then anything; within a height, H.264 + AAC so the merge
# into mp4 needs no re-encode. Full downloads and the pieces a short uses.
FULL_FORMAT = "/".join([
    "bv*[height=1080][vcodec^=avc1]+ba[ext=m4a]",
    "bv*[height=1080]+ba",
    "bv*[height=720][vcodec^=avc1]+ba[ext=m4a]",
    "bv*[height=720]+ba",
    "bv*[height<=1080]+ba",
    "b[height<=1080]",
    "b",
])

# A scan, the copy a video found by research is read from: 480p (burned-in text stays readable, a matted coat still
# looks matted), else the best under it, else up to 720p, else anything rather than failing.
SCAN_FORMAT = "/".join([
    "bv*[height=480][vcodec^=avc1]+ba[ext=m4a]",
    "bv*[height=480]+ba",
    "bv*[height<=480]+ba",
    "b[height<=480]",
    "bv*[height<=720]+ba",
    "b",
])


def yt_dlp_command() -> str:
    """Viral's own yt-dlp (first on the server's PATH); VIRAL_YT_DLP runs another (tests point it at a fake)."""
    return os.environ.get("VIRAL_YT_DLP") or "yt-dlp"


STDERR_TAIL = 4000


def run_yt_dlp(args: list[str], on_line) -> None:
    """Runs yt-dlp once, handing each stdout line to `on_line`; a failure raises with the end of its stderr, which
    is where yt-dlp says why (a 403, a removed video)."""
    proc = subprocess.Popen([yt_dlp_command(), "--no-warnings", "--ignore-config", *args],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    err: list[str] = []
    drain = threading.Thread(target=lambda: err.extend(proc.stderr), daemon=True)
    drain.start()
    for line in proc.stdout:
        on_line(line.rstrip("\n"))
    code = proc.wait()
    drain.join()
    if code != 0:
        raise Exception("".join(err).strip()[-STDERR_TAIL:] or f"yt-dlp exited with {code}")


def is_refusal(message: str) -> bool:
    """YouTube saying no (a 403), as opposed to a missing or broken video."""
    return "HTTP Error 403" in message or "403: Forbidden" in message


# the pause before the one retry; VIRAL_YT_RETRY_PAUSE_S changes it (tests use 0)
RETRY_PAUSE_S = float(os.environ.get("VIRAL_YT_RETRY_PAUSE_S") or 8)


def download_with_retry(download, sleep) -> dict:
    """Downloads once, and once more after a short pause when YouTube answers 403. A second refusal is reported as
    `blocked`, in plain words; Viral never works around it (no cookies, proxies or other tricks)."""
    for attempt in (1, 2):
        try:
            return download()
        except Exception as error:  # yt-dlp raises DownloadError with a readable message
            message = str(error)
            if is_refusal(message) and attempt == 1:
                emit({"type": "log", "message": f"YouTube refused the download (403); trying once more in {RETRY_PAUSE_S:g}s"})
                sleep(RETRY_PAUSE_S)
                continue
            if is_refusal(message):
                raise FetchFailure("blocked", "YouTube refused the download twice (403). Viral doesn't work around a "
                                              "block: try again later, or replace this video.") from error
            raise FetchFailure("download", message) from error
    raise FetchFailure("download", "unreachable")
