# /// script
# requires-python = ">=3.10"
# ///
"""Probe render job: encodes a synthetic 9:16 clip with ffmpeg and reports progress.

Emits one JSON object per stdout line:
  {"type": "progress", "pct": 42.0}
  {"type": "done", "output": "/abs/path.mp4"}
The server owns cancellation by signalling this process group, which also stops ffmpeg.
"""
import argparse
import json
import subprocess
import sys


def emit(obj):
    print(json.dumps(obj), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=20)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    total_us = args.seconds * 1_000_000
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", f"testsrc2=size=1080x1920:rate=30:duration={args.seconds}",
        "-c:v", "libx264", "-preset", "slow", "-pix_fmt", "yuv420p",
        "-progress", "pipe:1", "-nostats", args.out,
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True)
    assert proc.stdout is not None
    for line in proc.stdout:
        key, _, value = line.strip().partition("=")
        if key == "out_time_us" and value.isdigit():
            emit({"type": "progress", "pct": round(min(100.0, int(value) / total_us * 100), 1)})
    code = proc.wait()
    if code != 0:
        sys.exit(code)
    emit({"type": "done", "output": args.out})


if __name__ == "__main__":
    main()
