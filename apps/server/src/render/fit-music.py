# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""Fit a short's music bed: the song's build-up looped in whole bars so its drop lands on the plan's drop
word, then the drop section to the end of the short; or, when the plan's music has an `arrangement`, the song's
blocks laid out as it says (music_bed.arrange). The library song is only read, never changed.

Usage:
  uv run fit-music.py <narrated.json> <out.wav>

The plan is the short's assembled NarratedPlan (its `music` holds the song's file, bpm and drop, and the drop
word; its voiceover, inserts and outro set the timeline). stdout carries one JSON object per line:
  {"type": "progress", "step": "fit"}
  {"type": "error", "code": "no-music" | "no-drop" | "arrangement" | "audio", "message": "..."}   (then exit 1)
  {"type": "done", "file": "...wav", "duration_s": 49.5, "drop_at_s": 38.2, "song_drop_s": 16.588,
   "bar_s": 2.04, "segments": [{"kind": "groove" | "build" | "drop" | "drop-loop", "from": 4.2, "to": 12.4, "at": 0}],
   "arrangement": {"automatic": true, "drop_bar": 8, "song_bars": 40, "blocks": [{"from_bar": 0, "to_bar": 4,
     "loops": 3, "word": null, "from": 0.25, "to": 8.42, "at": 0, "end": 21.3}]}}
"""
import json
import subprocess
import sys
from pathlib import Path

from music_bed import ArrangementError, arrangement_of, bar_of, build_music, music_timing, resolve, words_of


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


class Failure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def duration(path: str) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise Failure("audio", f"can't read duration of {path}: {r.stderr.strip()}")
    return float(r.stdout.strip())


def main() -> None:
    if len(sys.argv) != 3:
        raise Failure("usage", "fit-music.py <narrated.json> <out.wav>")
    plan_path, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    plan = json.loads(plan_path.read_text())
    base = plan_path.parent
    mcfg = plan.get("music")
    if not isinstance(mcfg, dict):
        raise Failure("no-music", "the plan has no music to fit")
    if "drop" not in mcfg or ("bpm" not in mcfg and "bar" not in mcfg):
        raise Failure("no-drop", "the song's BPM and drop aren't known, so there's nothing to fit")
    emit({"type": "progress", "step": "fit"})
    vo_words = words_of(resolve(base, plan["voiceover_transcript"]))
    drop_at, total = music_timing(plan, vo_words, duration(resolve(base, plan["voiceover"])))
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        segments, arrangement = build_music(mcfg, base, drop_at, total, out, arrangement_of(mcfg, plan, vo_words))
    except ArrangementError as error:
        raise Failure("arrangement", str(error)) from error
    except subprocess.CalledProcessError as error:
        raise Failure("audio", f"ffmpeg couldn't read or write the music: {error}") from error
    emit({"type": "done", "file": str(out), "duration_s": round(total, 3), "drop_at_s": round(drop_at, 3),
          "song_drop_s": float(mcfg["drop"]), "bar_s": round(bar_of(mcfg), 4), "segments": segments,
          "arrangement": arrangement})


if __name__ == "__main__":
    try:
        main()
    except Failure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
