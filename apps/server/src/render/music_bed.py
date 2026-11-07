"""A short's music bed: the song's own build-up looped in whole bars so its drop lands on a chosen moment of
the short, then the drop section to the end. Shared by render-narrated.py (which fits the bed when a plan has
no fitted bed) and fit-music.py (which fits it once at assemble time and saves it with the short).

Two ways to lay a bed out:
- automatic (no `arrangement` in the music config): the renderer's original recipe, moved here unchanged, so the
  candy goldens render byte-for-byte as before. It also describes itself as an arrangement of whole bars (`build_auto`),
  so an editor can start from it.
- an arrangement: ordered blocks of the song's bars, each played `loops` times, either straight after the block
  before it or pinned to start on a moment of the short (a voiceover word). See `arrange`.

Bars are counted on a fixed grid: bar 0 is the earliest whole bar before the song's drop, so the drop sits on a
bar line (bar `drop_bar`); the grid assumes the song keeps one tempo.
"""
import json
import math
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


def bar_of(cfg: dict) -> float:
    return float(cfg["bar"]) if "bar" in cfg else 240.0 / float(cfg["bpm"])


def bar_grid(bar: float, drop: float, n_samples: int) -> tuple[int, float, int]:
    """The song's bar grid: the drop's bar, where bar 0 starts (seconds), and how many whole bars the song has."""
    drop_bar = int(math.floor(drop / bar + 1e-6))
    origin = drop - drop_bar * bar
    song_bars = int(math.floor((n_samples / SR - origin) / bar + 1e-6))
    return drop_bar, origin, song_bars


def build_music(cfg: dict, base: Path, drop_at: float, total: float, out: Path,
                arrangement: list[dict] | None = None) -> tuple[list[dict], dict]:
    """Write the short's bed to `out`: the automatic recipe, or `arrangement` (blocks whose pinned starts are
    already resolved to seconds in the short: see `arrangement_of`).

    Returns the parts of the song used, in playing order ({kind, from, to, at} in seconds: `from`/`to` in the
    song, `at` in the short), and the arrangement as played: {automatic, drop_bar, song_bars, blocks: [{from_bar,
    to_bar, loops, word, from, to, at, end}]} (`from`/`to` the block's bars in song seconds, `at`/`end` where it
    plays in the short, its loops and any fill included).
    """
    y = read_audio(resolve(base, cfg["file"]))
    if arrangement is not None:
        return arrange(y, bar_of(cfg), float(cfg["drop"]), arrangement, total, out)
    return build_auto(y, cfg, drop_at, total, out)


def build_auto(y: np.ndarray, cfg: dict, drop_at: float, total: float, out: Path) -> tuple[list[dict], dict]:
    """Loop the song's pre-drop groove (whole bars) so its own build-up + drop land exactly at `drop_at`.

    timeline: [groove loop xN, entered mid-loop] -> [last `build_bars` bars before the drop] -> [drop -> end]
    """
    bar = bar_of(cfg)
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

    # the same recipe as blocks of whole bars, for an editor to start from
    drop_bar, origin, song_bars = bar_grid(bar, d, len(y))
    build_bars = min(int(round(float(cfg.get("build_bars", 8)))), drop_bar)
    groove_bars = max(1, min(int(round(float(cfg.get("groove_bars", 4)))), build_bars))
    drop_word = int(cfg["drop_word"]) if "drop_word" in cfg else None
    blocks: list[dict] = []

    def block(from_bar: int, to_bar: int, loops: int, word: int | None, at: float, end: float) -> None:
        blocks.append({"from_bar": from_bar, "to_bar": to_bar, "loops": loops, "word": word,
                       "from": round(origin + from_bar * bar, 4), "to": round(origin + to_bar * bar, 4),
                       "at": round(min(at, total), 4), "end": round(min(end, total), 4)})

    if pre_need <= len(build_seg):
        pre = build_seg[len(build_seg) - pre_need:]
        part("build", ds - pre_need, ds, 0)
        if build_bars > 0 and pre_need > 0:
            block(drop_bar - build_bars, drop_bar, 1, None, 0, drop_at)
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
        block(drop_bar - build_bars, drop_bar - build_bars + groove_bars, reps, None, 0, rest / SR)
        block(drop_bar - build_bars, drop_bar, 1, None, rest / SR, drop_at)
    post_need = int(round((total - drop_at) * SR)) + SR
    post = y[ds:ds + post_need]
    part("drop", ds, ds + len(post), pre_need)
    block(drop_bar, song_bars, 1, drop_word, drop_at, drop_at + len(post) / SR)
    if len(post) < post_need:                               # song ends before the short: loop the drop section
        drop_len = int(round(float(cfg.get("drop_bars", 8)) * bar * SR))
        drop_seg = seam(y[ds:ds + drop_len])
        loops_from = drop_at + len(post) / SR
        loops = 0
        while len(post) < post_need:
            part("drop-loop", ds, ds + len(drop_seg), pre_need + len(post))
            post = np.concatenate([post, drop_seg])
            loops += 1
        post = post[:post_need]
        drop_bars = max(1, min(int(round(float(cfg.get("drop_bars", 8)))), song_bars - drop_bar))
        block(drop_bar, drop_bar + drop_bars, loops, None, loops_from, total)
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
    played = [b for b in blocks if b["at"] < total]
    return kept, {"automatic": True, "drop_bar": drop_bar, "song_bars": song_bars, "blocks": played}


# ---------------------------------------------------------------- arrangements

XFADE = 0.04     # an equal-power crossfade where two parts of the song that don't follow each other meet
SEAM = 0.006     # loop seams: the automatic recipe's tiny fades, so a loop never clicks


class ArrangementError(ValueError):
    """An arrangement that can't be played, in plain words."""


def check_arrangement(blocks: list[dict], song_bars: int, total: float) -> None:
    if not blocks:
        raise ArrangementError("the arrangement has no blocks")
    last_pin = None
    for i, b in enumerate(blocks, start=1):
        if not (0 <= b["from_bar"] < b["to_bar"] <= song_bars):
            raise ArrangementError(f"block {i} plays bars {b['from_bar']}-{b['to_bar']}, but the song has bars 0-{song_bars}")
        if int(b["loops"]) < 1:
            raise ArrangementError(f"block {i} has to play at least once")
        at = b.get("at")
        if at is None:
            continue
        if at >= total:
            raise ArrangementError(f"block {i} is pinned to {at:.2f}s, after the short ends at {total:.2f}s")
        if last_pin is not None and at <= last_pin:
            raise ArrangementError(f"block {i} is pinned before the block pinned ahead of it; pins follow the voiceover in order")
        last_pin = at


def arrange(y: np.ndarray, bar: float, drop: float, blocks: list[dict], total: float,
            out: Path) -> tuple[list[dict], dict]:
    """Lay the song's blocks out on the short.

    Blocks play in order, each `loops` times. A pinned block (`at`, seconds in the short) starts exactly there:
    its first bar lands on the moment. Between pins, the blocks play on from the earlier pin and the last of them
    keeps looping in whole bars until the next pin, cut there under a crossfade. Blocks before the first pin end
    exactly on it: the first of them loops as often as needed, entered part-way at the start of the short (as the
    automatic recipe enters its groove). If the first block itself is pinned, the short is silent until then. The
    last block loops until the short ends.

    Joins: a part running straight on in the song needs nothing; a block looping back to its own start gets the
    6 ms seam fades; any other join is a short equal-power crossfade that ends on the incoming bar line, so the
    incoming block's first bar is heard in full on time.
    """
    drop_bar, origin, song_bars = bar_grid(bar, drop, len(y))
    check_arrangement(blocks, song_bars, total)
    length = int(round(total * SR))

    def bs(b: int) -> int:
        return int(round((origin + b * bar) * SR))

    spans = [(bs(b["from_bar"]), bs(b["to_bar"])) for b in blocks]
    # runs of blocks: each pinned block starts a run that plays forward until the next pin
    pins = [i for i, b in enumerate(blocks) if b.get("at") is not None]
    starts = [int(round(blocks[i]["at"] * SR)) for i in pins]
    pieces: list[dict] = []          # {block, src0, src1, dst0}, back to back within a run

    def lay(order: list[int], copies: list[int], t0: int, t1: int, fill_last: bool) -> None:
        cursor = t0
        for n, (i, count) in enumerate(zip(order, copies)):
            src0, src1 = spans[i]
            k = 0
            while k < count or (fill_last and n == len(order) - 1 and cursor < t1):
                if cursor >= t1:
                    return
                pieces.append({"block": i, "src0": src0, "src1": src1, "dst0": cursor})
                cursor += src1 - src0
                k += 1

    first_pin = pins[0] if pins else None
    if first_pin is None:
        lay(list(range(len(blocks))), [int(b["loops"]) for b in blocks], 0, length, True)
    else:
        if first_pin > 0:
            # the lead-in ends exactly on the first pin; its first block loops to fill the start
            order = list(range(first_pin))
            copies = [int(blocks[i]["loops"]) for i in order]
            content = sum((spans[i][1] - spans[i][0]) * c for i, c in zip(order, copies))
            pin = starts[0]
            if content < pin:
                first_len = spans[0][1] - spans[0][0]
                copies[0] += -(-(pin - content) // first_len)
                content = sum((spans[i][1] - spans[i][0]) * c for i, c in zip(order, copies))
            lay(order, copies, pin - content, pin, False)
        for n, i in enumerate(pins):
            end_i = pins[n + 1] if n + 1 < len(pins) else len(blocks)
            t1 = starts[n + 1] if n + 1 < len(pins) else length
            order = list(range(i, end_i))
            lay(order, [int(blocks[j]["loops"]) for j in order], starts[n], t1, True)

    # clip to the short (the lead-in starts before 0; a run ends at the next pin or the short's end)
    clipped: list[dict] = []
    bounds = sorted(starts) + [length]
    for p in pieces:
        n = p["src1"] - p["src0"]
        end = p["dst0"] + n
        limit = next((b for b in bounds if b > p["dst0"]), length)
        end = min(end, limit)
        if p["dst0"] < 0:
            p["src0"] += -p["dst0"]
            p["dst0"] = 0
        p["src1"] = p["src0"] + max(0, end - p["dst0"])
        if p["src1"] > p["src0"]:
            clipped.append(p)
    pieces = clipped

    xf, seam_n = int(round(XFADE * SR)), int(SEAM * SR)
    bed = np.zeros((length, 2), dtype=np.float32)
    fade_in = [0] * len(pieces)      # per piece: samples of crossfade pre-roll, or -1 for a seam fade-in
    fade_out: list[tuple[str, int]] = [("", 0)] * len(pieces)
    for n in range(1, len(pieces)):
        a, b = pieces[n - 1], pieces[n]
        touching = a["dst0"] + (a["src1"] - a["src0"]) == b["dst0"]
        if touching and a["src1"] == b["src0"]:
            continue                                         # the song simply runs on
        if touching and a["block"] == b["block"] and b["src0"] == spans[b["block"]][0] and a["src1"] == spans[a["block"]][1]:
            fade_out[n - 1], fade_in[n] = ("seam", seam_n), -1
            continue
        w = min(xf, a["src1"] - a["src0"], b["src0"], b["dst0"]) if touching else 0
        if w > 0:
            fade_out[n - 1], fade_in[n] = ("xfade", w), w
        else:
            fade_out[n - 1], fade_in[n] = ("seam", seam_n) if touching else ("", 0), -1
    for n, p in enumerate(pieces):
        pre = max(0, fade_in[n])
        seg = y[p["src0"] - pre:p["src1"]].copy()
        if fade_in[n] > 0:                                   # equal-power rise, ending on the block's first bar
            seg[:pre] *= np.sin(np.linspace(0, np.pi / 2, pre))[:, None]
        elif fade_in[n] == -1:
            k = min(seam_n, len(seg))
            seg[:k] *= np.linspace(0, 1, k)[:, None]
        kind, k = fade_out[n]
        k = min(k, len(seg) - pre)
        if kind == "xfade" and k > 0:
            seg[len(seg) - k:] *= np.cos(np.linspace(0, np.pi / 2, k))[:, None]
        elif kind == "seam" and k > 0:
            seg[len(seg) - k:] *= np.linspace(1, 0, k)[:, None]
        at = p["dst0"] - pre
        bed[at:at + len(seg)] += seg[:length - at]
    write_audio(out, bed)

    drop_s = bs(drop_bar)
    segments: list[dict] = []
    seen_drop: set[int] = set()
    for n, p in enumerate(pieces):
        loop = n > 0 and pieces[n - 1]["block"] == p["block"]
        if p["src0"] >= drop_s:
            kind = "drop-loop" if p["block"] in seen_drop else "drop"
            seen_drop.add(p["block"])
        else:
            kind = "groove" if loop or (n + 1 < len(pieces) and pieces[n + 1]["block"] == p["block"]) else "build"
        segments.append({"kind": kind, "from": round(p["src0"] / SR, 4), "to": round(p["src1"] / SR, 4),
                         "at": round(p["dst0"] / SR, 4)})
    played = []
    for i, b in enumerate(blocks):
        mine = [p for p in pieces if p["block"] == i]
        at = mine[0]["dst0"] / SR if mine else None
        end = (mine[-1]["dst0"] + mine[-1]["src1"] - mine[-1]["src0"]) / SR if mine else None
        played.append({"from_bar": b["from_bar"], "to_bar": b["to_bar"], "loops": int(b["loops"]),
                       "word": b.get("word"), "from": round(spans[i][0] / SR, 4), "to": round(spans[i][1] / SR, 4),
                       "at": None if at is None else round(at, 4), "end": None if end is None else round(end, 4)})
    return segments, {"automatic": False, "drop_bar": drop_bar, "song_bars": song_bars, "blocks": played}


def words_of(transcript: str) -> list[dict]:
    data = json.loads(Path(transcript).read_text())
    return [w for seg in data["segments"] for w in seg["words"]]


def shifter(plan: dict, vo_words: list[dict]):
    """Voiceover seconds -> seconds in the short: each insert plays after its word and pushes the rest later."""
    inserts = []
    for ins in plan.get("inserts", []):
        w = vo_words[int(ins["after_word"])]
        inserts.append({"at": round(w["e"], 3), "dur": float(ins["end"]) - float(ins["start"])})

    def shifted(t: float) -> float:
        return t + sum(i["dur"] for i in inserts if i["at"] < t)
    return shifted


def arrangement_of(mcfg: dict, plan: dict, vo_words: list[dict]) -> list[dict] | None:
    """The music config's arrangement with each pinned block's word turned into seconds in the short (`at`), or
    None when the bed is automatic."""
    blocks = mcfg.get("arrangement")
    if not blocks:
        return None
    shifted = shifter(plan, vo_words)
    resolved = []
    for i, b in enumerate(blocks, start=1):
        word = b.get("word")
        if word is not None and not (0 <= int(word) < len(vo_words)):
            raise ArrangementError(f"block {i} is pinned to word {word}, but the voiceover has {len(vo_words)} words")
        resolved.append({"from_bar": int(b["from_bar"]), "to_bar": int(b["to_bar"]), "loops": int(b.get("loops", 1)),
                         "word": None if word is None else int(word),
                         "at": None if word is None else shifted(vo_words[int(word)]["s"])})
    return resolved


def music_timing(plan: dict, vo_words: list[dict], vo_dur: float) -> tuple[float, float]:
    """Where the drop lands in the finished short, and the short's length, worked out exactly as
    render-narrated.py lays out its timeline: the narration, with each insert played after its word, then the
    outro clips."""
    narr_end = float(plan.get("narration_end", vo_dur))
    shifted = shifter(plan, vo_words)

    total = shifted(narr_end)
    for o in plan.get("outro", []):
        total += float(o["end"]) - float(o["start"])
    mcfg = plan["music"]
    if "drop_word" in mcfg:
        drop_at = shifted(vo_words[int(mcfg["drop_word"])]["s"]) + float(mcfg.get("drop_offset", 0))
    else:
        drop_at = float(mcfg.get("drop_at", narr_end))
    return drop_at, total
