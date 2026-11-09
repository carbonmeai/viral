# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""How a ranking should frame a video: in a 4:3 window over a blurred fill ("window", landscape footage), or filling
the 9:16 screen ("fill": an upright video, or upright phone footage inside a widescreen file, whose side bars are
blurred or black).

Usage:
  uv run detect-framing.py <video> [<seconds> ...]

Many rescue videos mix both inside one file, so it's decided per moment: for each time given (a shot's middle) one
frame is read, and the detail (edge energy) of its left and right fifths is compared with the middle's; side bars with
far less detail than the middle are a pillarbox. Without times it samples the video and takes the majority. An
upright file always fills. stdout carries one JSON object per line: {"type": "frame", "t": 41.5, "framing": "fill"}
per time, then {"type": "done", "framing": "window" | "fill", "width": 1920, "height": 1080, "pillarboxed": 4,
"sampled": 11} (the majority over the frames read), or {"type": "error", "code", "message"}.
"""
import json
import subprocess
import sys
from io import BytesIO

from PIL import Image, ImageFilter, ImageStat

SAMPLES = tuple(i / 12 for i in range(1, 12))
# sides with on average under this share of the middle's detail are bars (pillarboxed frames measure 0.1–0.4,
# landscape footage 0.6–1.4)
BAR_RATIO = 0.5


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


class Failure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def probe(video: str) -> tuple[int, int, float]:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height:format=duration", "-of", "json", video], capture_output=True, text=True)
    if r.returncode != 0:
        raise Failure("ffprobe", f"can't read {video}: {r.stderr.strip()[-300:]}")
    d = json.loads(r.stdout)
    return int(d["streams"][0]["width"]), int(d["streams"][0]["height"]), float(d["format"].get("duration") or 0)


def frame(video: str, t: float) -> Image.Image | None:
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1",
                        "-vf", "scale=320:-2", "-f", "image2", "-c:v", "png", "-"], capture_output=True)
    if r.returncode != 0 or not r.stdout:
        return None
    return Image.open(BytesIO(r.stdout)).convert("L")


def energy(img: Image.Image, x0: float, x1: float) -> float:
    w, h = img.size
    band = img.crop((int(w * x0), int(h * 0.1), max(int(w * x0) + 1, int(w * x1)), int(h * 0.9)))
    return ImageStat.Stat(band.filter(ImageFilter.FIND_EDGES)).mean[0]


def is_pillarboxed(img: Image.Image) -> bool:
    middle = energy(img, 0.35, 0.65)
    sides = (energy(img, 0.0, 0.2) + energy(img, 0.8, 1.0)) / 2
    return middle > 1.0 and sides < middle * BAR_RATIO


def main() -> None:
    if len(sys.argv) < 2:
        raise Failure("usage", "detect-framing.py <video> [<seconds> ...]")
    video = sys.argv[1]
    times = [float(t) for t in sys.argv[2:]]
    w, h, duration = probe(video)
    upright = w / h <= 1.2
    pillarboxed, sampled = 0, 0
    for t in times or [duration * f for f in SAMPLES]:
        img = None if upright else frame(video, t)
        boxed = upright or (img is not None and is_pillarboxed(img))
        if img is not None or upright:
            sampled += 1
            pillarboxed += 1 if boxed else 0
        if times:
            emit({"type": "frame", "t": t, "framing": "fill" if boxed else "window"})
    framing = "fill" if upright or (sampled > 0 and pillarboxed * 2 > sampled) else "window"
    emit({"type": "done", "framing": framing, "width": w, "height": h, "pillarboxed": pillarboxed, "sampled": sampled})


if __name__ == "__main__":
    try:
        main()
    except Failure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
