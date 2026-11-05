# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["mlx-whisper"]
# ///
"""Transcribe a video with word-level timestamps (Apple Silicon, mlx-whisper).

Usage:
  uv run transcribe-whisper.py <video> <out_dir> [--model MODEL] [--language en]

Writes:
  <out_dir>/transcript.json  segments + words with start/end seconds (Transcript in contracts)
  <out_dir>/transcript.txt   one line per segment: "[mm:ss.s - mm:ss.s] text" (for reading/planning)

Ported from the viral-shorts skill's transcribe.py; transcription is unchanged. stdout carries one JSON
object per line: {"type": "progress", "step": "audio"|"transcribe"}, an error line, or
{"type": "done", "segments": 412, "duration_s": 2280.4, "language": "en"}.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


class Failure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def fail(code: str, message: str) -> None:
    raise Failure(code, message)


def fmt(t: float) -> str:
    m, s = divmod(t, 60)
    return f"{int(m):02d}:{s:05.2f}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out_dir")
    ap.add_argument("--model", default="mlx-community/whisper-large-v3-turbo")
    ap.add_argument("--language", default=None)
    args = ap.parse_args()

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    wav = out / "audio.wav"
    emit({"type": "progress", "step": "audio"})
    r = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", args.video,
         "-vn", "-ac", "1", "-ar", "16000", str(wav)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        fail("audio", f"can't extract audio: {r.stderr.strip()[-2000:]}")

    import mlx_whisper

    emit({"type": "progress", "step": "transcribe"})
    result = mlx_whisper.transcribe(
        str(wav),
        path_or_hf_repo=args.model,
        word_timestamps=True,
        language=args.language,
        verbose=False,
    )

    segments = []
    for seg in result["segments"]:
        words = []
        for w in seg.get("words", []):
            if not w["word"].strip():
                continue
            # whisper emits sub-word tokens without a leading space ("$10" + ",000") — glue them back
            if words and not w["word"].startswith(" "):
                words[-1]["w"] += w["word"].strip()
                words[-1]["e"] = round(w["end"], 3)
                continue
            words.append({"w": w["word"].strip(), "s": round(w["start"], 3), "e": round(w["end"], 3)})
        segments.append({
            "start": round(seg["start"], 3),
            "end": round(seg["end"], 3),
            "text": seg["text"].strip(),
            "words": words,
        })

    (out / "transcript.json").write_text(json.dumps({
        "source": str(Path(args.video).resolve()),
        "language": result.get("language"),
        "provider": "whisper-local",
        "segments": segments,
    }, indent=1))
    (out / "transcript.txt").write_text(
        "\n".join(f"[{fmt(s['start'])} - {fmt(s['end'])}] {s['text']}" for s in segments) + "\n"
    )
    wav.unlink(missing_ok=True)
    total = segments[-1]["end"] if segments else 0
    emit({"type": "done", "segments": len(segments), "duration_s": total, "language": result.get("language")})


if __name__ == "__main__":
    try:
        main()
    except Failure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
