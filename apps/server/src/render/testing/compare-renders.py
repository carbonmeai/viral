# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Compare a render against a golden render. Prints one JSON object:
  {"duration": [golden, actual], "video_frames": [...], "audio_duration": [...],
   "samples": [{"t": 0.5, "distance": 2}, ...]}
`distance` is the Hamming distance (0-64) between 64-bit difference hashes of the frame at `t`, so
x264's non-deterministic bytes don't matter but a wrong shot, crop or caption does.
"""
import io
import json
import subprocess
import sys

from PIL import Image


def probe(path: str, stream: str, entry: str) -> str:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", stream, "-show_entries", f"stream={entry}",
                        "-of", "csv=p=0", path], capture_output=True, text=True, check=True)
    return r.stdout.strip()


def frame_hash(path: str, t: float) -> int:
    png = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1",
                          "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, check=True).stdout
    img = Image.open(io.BytesIO(png)).convert("L").resize((9, 8), Image.LANCZOS)
    px = list(img.getdata())
    bits = [px[r * 9 + c] > px[r * 9 + c + 1] for r in range(8) for c in range(8)]
    return sum(1 << i for i, b in enumerate(bits) if b)


def main() -> None:
    golden, actual = sys.argv[1], sys.argv[2]
    duration = [float(probe(p, "v:0", "duration")) for p in (golden, actual)]
    frames = [int(probe(p, "v:0", "nb_frames")) for p in (golden, actual)]
    audio = [float(probe(p, "a:0", "duration")) for p in (golden, actual)]
    samples = []
    t = 0.5
    while t < min(duration):
        samples.append({"t": t, "distance": bin(frame_hash(golden, t) ^ frame_hash(actual, t)).count("1")})
        t += 1.0
    print(json.dumps({"duration": duration, "video_frames": frames, "audio_duration": audio, "samples": samples}))


if __name__ == "__main__":
    main()
