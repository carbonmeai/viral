"""A short's music bed: the song's own build-up looped in whole bars so its drop lands on a chosen moment of
the short, then the drop section to the end. Shared by render-narrated.py (which fits the bed when a plan has
no fitted bed) and fit-music.py (which fits it once at assemble time and saves it with the short).

The audio math is the renderer's, moved here unchanged: the candy goldens render byte-for-byte as before.
"""
import json
import subprocess
from pathlib import Path

import numpy as np

SR = 48000


def resolve(base: Path, p: str) -> str:
    return p if Path(p).is_absolute() else str((base / p).resolve())


def read_audio(path: str) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-vn", "-ac", "2", "-ar", str(SR),
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def write_audio(path: Path, y: np.ndarray) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-",
                    str(path)], input=y.astype(np.float32).tobytes(), check=True)


def build_music(cfg: dict, base: Path, drop_at: float, total: float, out: Path) -> list[dict]:
    """Loop the song's pre-drop groove (whole bars) so its own build-up + drop land exactly at `drop_at`.

    timeline: [groove loop xN, entered mid-loop] -> [last `build_bars` bars before the drop] -> [drop -> end]

    Returns the parts of the song used, in playing order: {kind, from, to, at} in seconds (`from`/`to` in the
    song, `at` in the short).
    """
    y = read_audio(resolve(base, cfg["file"]))
    bar = float(cfg["bar"]) if "bar" in cfg else 240.0 / float(cfg["bpm"])
    d = float(cfg["drop"])                                  # drop time inside the song
    build = int(round(min(float(cfg.get("build_bars", 8)) * bar, d) * SR))
    groove = int(round(float(cfg.get("groove_bars", 4)) * bar * SR))
    ds = int(round(d * SR))
    build_seg = y[ds - build:ds]
    groove_start = ds - build                               # groove = first bars of the build section
    groove_seg = y[groove_start:groove_start + groove]
    pre_need = int(round(drop_at * SR))
    fade = int(0.006 * SR)
    segments: list[dict] = []

    def part(kind: str, start: int, end: int, at: int) -> None:
        segments.append({"kind": kind, "from": round(start / SR, 4), "to": round(end / SR, 4), "at": round(at / SR, 4)})

    def seam(a: np.ndarray) -> np.ndarray:                 # tiny fades so loop seams never click
        a = a.copy()
        a[:fade] *= np.linspace(0, 1, fade)[:, None]
        a[-fade:] *= np.linspace(1, 0, fade)[:, None]
        return a

    if pre_need <= len(build_seg):
        pre = build_seg[len(build_seg) - pre_need:]
        part("build", ds - pre_need, ds, 0)
    else:
        rest = pre_need - len(build_seg)
        reps = -(-rest // len(groove_seg))
        loops = np.concatenate([seam(groove_seg)] * reps)
        pre = np.concatenate([loops[len(loops) - rest:], build_seg])
        # the loops' tail: entered part-way into the first copy, then whole copies
        skip = len(loops) - rest
        at = 0
        for copy in range(reps):
            lo, hi = copy * len(groove_seg), (copy + 1) * len(groove_seg)
            if hi <= skip:
                continue
            offset = max(0, skip - lo)
            part("groove", groove_start + offset, groove_start + len(groove_seg), at)
            at += len(groove_seg) - offset
        part("build", ds - len(build_seg), ds, rest)
    post_need = int(round((total - drop_at) * SR)) + SR
    post = y[ds:ds + post_need]
    part("drop", ds, ds + len(post), pre_need)
    if len(post) < post_need:                               # song ends before the short: loop the drop section
        drop_len = int(round(float(cfg.get("drop_bars", 8)) * bar * SR))
        drop_seg = seam(y[ds:ds + drop_len])
        while len(post) < post_need:
            part("drop-loop", ds, ds + len(drop_seg), pre_need + len(post))
            post = np.concatenate([post, drop_seg])
        post = post[:post_need]
    length = int(round(total * SR))
    write_audio(out, np.concatenate([pre, post])[:length])
    # parts past the short's end are cut off; trim the description the same way
    kept = []
    for s in segments:
        at_s = s["at"]
        if at_s >= total:
            continue
        s["to"] = round(min(s["to"], s["from"] + (total - at_s)), 4)
        kept.append(s)
    return kept


def words_of(transcript: str) -> list[dict]:
    data = json.loads(Path(transcript).read_text())
    return [w for seg in data["segments"] for w in seg["words"]]


def music_timing(plan: dict, vo_words: list[dict], vo_dur: float) -> tuple[float, float]:
    """Where the drop lands in the finished short, and the short's length, worked out exactly as
    render-narrated.py lays out its timeline: the narration, with each insert played after its word, then the
    outro clips."""
    narr_end = float(plan.get("narration_end", vo_dur))
    inserts = []
    for ins in plan.get("inserts", []):
        w = vo_words[int(ins["after_word"])]
        inserts.append({"at": round(w["e"], 3), "dur": float(ins["end"]) - float(ins["start"])})

    def shifted(t: float) -> float:
        return t + sum(i["dur"] for i in inserts if i["at"] < t)

    total = shifted(narr_end)
    for o in plan.get("outro", []):
        total += float(o["end"]) - float(o["start"])
    mcfg = plan["music"]
    if "drop_word" in mcfg:
        drop_at = shifted(vo_words[int(mcfg["drop_word"])]["s"]) + float(mcfg.get("drop_offset", 0))
    else:
        drop_at = float(mcfg.get("drop_at", narr_end))
    return drop_at, total
