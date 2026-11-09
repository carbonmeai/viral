# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Render a ranking Short ("Ranking Animal Comebacks"): full-screen clips from several videos with their own sound, a
fixed title on top, and a numbered list down the left whose labels fill in as each entry plays (shuffled order, #1
last).

Usage:
  uv run render-ranking.py <ranking.json> [--out out.mp4] [--keep-temp]

Plan schema: RankingRenderPlan in packages/contracts/src/ranking-plan.ts. Relative paths resolve against the plan
file's folder.

Ported from the viral-shorts skill's render_ranking.py (the final list style). The look is unchanged: the title with
its red accent, the numbered list (1 gold, 2 silver, 3 bronze, the last red) whose label and emoji appear when the
entry plays, landscape footage in a 4:3 window over a blurred fill, upright footage filling the screen, each clip's own
sound evened out to -14 LUFS. Changed: the server has already moved every cut to whole sentences, so the shots play
exactly as planned; a shot names its video by index; an optional "via <channel>" line; a canvas size; and checks of the
finished mp4 (black frames, each shot's first and last frame, loudness). A video read from a 480p scan plays from
its 1080p pieces (`pieces_by_source`, source_pieces.py) wherever they cover a shot. Reporting is one JSON object per
stdout line:
  {"type": "progress", "step": "shots" | "encode" | "checks", "done": 3, "total": 31}
  {"type": "error", "code": "excluded-range", "message": "..."}   (then exit 1)
  {"type": "done", "output": "...mp4", "captions": "...srt", "duration_s": 158.6, "shots": 31, "timeline": [...],
   "checks": {"black": [[s, e]], "lufs": -13.9, "frames": [{"rank", "shot", "start", "end", "first", "last"}]},
   "footage": {"0": {"pieces": 3, "scan": 0}}}
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from source_pieces import Pieces

FPS = 30
BOLD = [
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Black.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
EMOJI = "/System/Library/Fonts/Apple Color Emoji.ttc"
RANK_COLORS = {1: "#F5C518", 2: "#E6E6E6", 3: "#E0954B"}
RED = "#E8202A"


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


class RenderFailure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def fail(code: str, message: str) -> None:
    raise RenderFailure(code, message)


def progress(step: str, done: int, total: int) -> None:
    emit({"type": "progress", "step": step, "done": done, "total": total})


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        fail("ffmpeg", f"ffmpeg failed:\n{' '.join(cmd)}\n{r.stderr[-3000:]}")
    return r


def probe(path: str) -> dict:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", path],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        fail("ffprobe", f"can't read {path}: {r.stderr.strip()}")
    d = json.loads(r.stdout)
    video = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), None)
    if video is None:
        fail("ffprobe", f"{path} has no video")
    audio = any(s.get("codec_type") == "audio" for s in d.get("streams", []))
    return {"w": int(video["width"]), "h": int(video["height"]), "duration": float(d["format"]["duration"]), "audio": audio}


def resolve(base: Path, p: str) -> str:
    return p if Path(p).is_absolute() else str((base / p).resolve())


def bold(size: int) -> ImageFont.FreeTypeFont:
    for f in BOLD:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default(size)


def emoji_img(ch: str, size: int) -> Image.Image | None:
    """Apple Color Emoji only has bitmap strikes (160px is the largest); render there and scale."""
    if not ch or not Path(EMOJI).exists() or size < 1:
        return None
    try:
        f = ImageFont.truetype(EMOJI, 160)
        im = Image.new("RGBA", (220, 220), (0, 0, 0, 0))
        ImageDraw.Draw(im).text((0, 0), ch, font=f, embedded_color=True)
    except Exception:
        return None
    bbox = im.getbbox()
    if not bbox:
        return None
    im = im.crop(bbox)
    return im.resize((max(1, int(im.width * size / im.height)), size), Image.LANCZOS)


def stroke_text(d: ImageDraw.ImageDraw, xy, text: str, f, fill: str, stroke: int) -> float:
    d.text(xy, text, font=f, fill=fill, stroke_width=stroke, stroke_fill="#000000")
    return d.textlength(text, font=f)


def list_png(W: int, H: int, title: tuple[str, str], n: int, revealed: dict[int, dict], via: str | None, path: Path) -> None:
    k = W / 1080
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # title, auto-fit on one line
    t1, t2 = title
    size = max(8, int(76 * k))
    while d.textlength(t1 + t2, font=bold(size)) > W * 0.92 and size > max(8, int(40 * k)):
        size -= max(1, int(2 * k))
    f = bold(size)
    x = (W - d.textlength(t1 + t2, font=f)) / 2
    y = int(H * 0.115)
    stroke = max(1, int(7 * k))
    x += stroke_text(d, (x, y), t1, f, "#FFFFFF", stroke)
    stroke_text(d, (x, y), t2, f, RED, stroke)
    # numbered list
    top, bottom = H * 0.215, H * 0.70
    step = (bottom - top) / max(n - 1, 1)
    nf = bold(max(8, int(min(66 * k, step * 0.72))))
    lf = bold(max(8, int(min(44 * k, step * 0.5))))
    left = int(44 * k)
    for r in range(1, n + 1):
        y = int(top + (r - 1) * step)
        color = RANK_COLORS.get(r, RED if r == n else "#FFFFFF")
        x = left + stroke_text(d, (left, y), f"{r}.", nf, color, max(1, int(6 * k))) + int(18 * k)
        if r in revealed:
            it = revealed[r]
            ly = y + (nf.size - lf.size) * 0.62
            lw = stroke_text(d, (x, ly), it["label"], lf, "#FFFFFF", max(1, int(5 * k)))
            e = emoji_img(it.get("emoji", ""), int(lf.size * 1.05))
            if e:
                img.alpha_composite(e, (int(x + lw + 10 * k), int(ly + lf.size * 0.05)))
    if via:
        vf = bold(max(8, int(30 * k)))
        text = f"via {via}"
        stroke_text(d, ((W - d.textlength(text, font=vf)) / 2, int(H * 0.93)), text, vf, "#FFFFFF", max(1, int(4 * k)))
    img.save(path)


def even(v: float) -> int:
    i = int(round(v))
    return i - i % 2


def video_filter(W: int, H: int, info: dict, framing: str, crop_x: float, aspect: float) -> str:
    cx = min(max(crop_x, 0.0), 1.0)
    landscape = info["w"] / info["h"] > 1.2
    cover = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}:(iw-ow)*{cx}:(ih-oh)/2"
    if framing == "fill" or not landscape:
        return f"[0:v]fps={FPS},{cover},setsar=1,format=yuv420p[base]"
    mh = min(even(W / aspect), H)
    ar = W / mh
    fg = f"crop='min(iw,ih*{ar:.5f})':'min(ih,iw/{ar:.5f})':'(iw-ow)*{cx}':'(ih-oh)/2',scale={W}:{mh}"
    return (
        f"[0:v]fps={FPS},split=2[a][b];"
        f"[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=30:2,eq=brightness=-0.12[bg];"
        f"[b]{fg}[fg];[bg][fg]overlay=0:(H-h)/2,setsar=1,format=yuv420p[base]"
    )


def segment(src: str, info: dict, shot: dict, W: int, H: int, aspect: float, png: Path, out: Path) -> None:
    dur = float(shot["dur"])
    vf = video_filter(W, H, info, shot.get("framing", "window"), float(shot.get("crop_x", 0.5)), aspect)
    vf += ";[base][1:v]overlay=0:0,format=yuv420p[v]"
    fade = min(0.03, dur / 4)
    inputs = ["-ss", f"{float(shot['src']):.3f}", "-t", f"{dur + 0.1:.3f}", "-i", src, "-loop", "1", "-i", str(png)]
    if info["audio"]:
        a_in = "[0:a]"
    else:
        inputs += ["-f", "lavfi", "-t", f"{dur + 0.1:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        a_in = "[2:a]"
    af = (f"{a_in}aresample=48000,aformat=channel_layouts=stereo,"
          f"afade=t=in:d={fade:.3f},afade=t=out:st={max(0.0, dur - fade):.3f}:d={fade:.3f}[a]")
    run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", f"{vf};{af}", "-map", "[v]", "-map", "[a]",
         "-t", f"{dur:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", str(FPS),
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", str(out)])


# ---------------------------------------------------------------- captions

def load_words(transcript_path: str | None) -> list[dict]:
    if not transcript_path or not Path(transcript_path).exists():
        return []
    data = json.loads(Path(transcript_path).read_text())
    return [w for seg in data.get("segments", []) for w in seg.get("words", [])]


def chunk_words(words: list[dict], max_words: int = 3, max_chars: int = 16) -> list[list[dict]]:
    chunks, cur = [], []
    for w in words:
        cur.append(w)
        text = " ".join(x["w"] for x in cur)
        if len(cur) >= max_words or len(text) >= max_chars or re.search(r"[.,!?;:]$", w["w"]):
            chunks.append(cur)
            cur = []
    if cur:
        chunks.append(cur)
    return chunks


def fmt_ts(t: float) -> str:
    ms = int(round(max(t, 0.0) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


# ---------------------------------------------------------------- checks

def black_ranges(path: Path) -> list[list[float]]:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-vf", "blackdetect=d=0.03:pic_th=0.80:pix_th=0.12",
                        "-an", "-f", "null", "-"], capture_output=True, text=True)
    out = []
    for m in re.finditer(r"black_start:([\d.]+)\s+black_end:([\d.]+)", r.stderr):
        out.append([round(float(m.group(1)), 3), round(float(m.group(2)), 3)])
    return out


def loudness(path: Path) -> float | None:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn", "-af", "ebur128", "-f", "null", "-"],
                       capture_output=True, text=True)
    summary = r.stderr.split("Summary:")[-1]
    m = re.search(r"I:\s*(-?[\d.]+)\s*LUFS", summary)
    if not m:
        return None
    v = float(m.group(1))
    return None if v <= -70 else v


def grab(path: Path, t: float, out: Path) -> None:
    run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{max(t, 0.0):.3f}", "-i", str(path), "-frames:v", "1",
         "-vf", "scale=360:-2", "-q:v", "4", str(out)])


# ---------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("--out", default=None)
    ap.add_argument("--keep-temp", action="store_true")
    args = ap.parse_args()
    plan_path = Path(args.plan).resolve()
    base = plan_path.parent
    plan = json.loads(plan_path.read_text())
    W, H = (plan.get("canvas") or [1080, 1920])[:2]
    W, H = even(W), even(H)
    aspect = float(plan.get("landscape_aspect", 4 / 3))
    slug = plan.get("slug", plan_path.stem)
    out = Path(args.out).resolve() if args.out else base / "shorts" / f"{slug}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)

    items_list = plan.get("items") or []
    if not items_list:
        fail("no-items", "the plan has no entries")
    items = {int(it["rank"]): it for it in items_list}
    n = len(items)
    order = [int(r) for r in plan.get("order") or sorted(items, reverse=True)]
    if sorted(order) != sorted(items) or len(items) != len(items_list):
        fail("order", f"the play order {order} must list every rank ({sorted(items)}) exactly once")
    videos = [resolve(base, v["path"]) for v in plan.get("videos", [])]
    transcripts = [resolve(base, v["transcript"]) if v.get("transcript") else None for v in plan.get("videos", [])]
    excluded = plan.get("exclude_by_source", {}) or {}
    title = tuple((plan.get("title") or ["", ""])[:2])
    via_on = bool(plan.get("via", False))
    # a scanned video's clips play from its 1080p pieces when the plan has them (pieces_by_source)
    pieces = Pieces(plan, base)
    piece_infos: dict[str, dict] = {}

    # every shot checked before anything renders
    infos: dict[int, dict] = {}
    for rank in order:
        for k, shot in enumerate(items[rank]["shots"]):
            i = int(shot.get("source", 0))
            if not 0 <= i < len(videos):
                fail("unknown-source", f"#{rank} shot {k + 1} plays from video {i + 1}, but the plan has {len(videos)}")
            if i not in infos:
                infos[i] = probe(videos[i])
            s, e = float(shot["src"]), float(shot["src"]) + float(shot["dur"])
            for a, b in excluded.get(str(i), []):
                if s < float(b) and e > float(a):
                    fail("excluded-range", f"#{rank} shot {k + 1} uses video {i + 1} {s:.1f}–{e:.1f}s, overlapping the "
                         f"excluded range {float(a):.1f}–{float(b):.1f}s")
            if e > infos[i]["duration"] + 0.05:
                fail("too-short", f"#{rank} shot {k + 1}: video {i + 1} is {infos[i]['duration']:.1f}s, shorter than "
                     f"{s:.1f}+{float(shot['dur']):.1f}s")

    tmp = out.parent / f".{slug}_tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    words_of: dict[int, list[dict]] = {}
    total_shots = sum(len(items[r]["shots"]) for r in order)
    progress("shots", 0, total_shots)
    parts, revealed, t, timeline, shot_times, timed = [], {}, 0.0, [], [], []
    for rank in order:
        it = items[rank]
        revealed[rank] = it
        png = tmp / f"list_{len(revealed):02d}.png"
        list_png(W, H, title, n, revealed, it.get("channel") if via_on else None, png)
        start = t
        for k, shot in enumerate(it["shots"]):
            i = int(shot.get("source", 0))
            dur = float(shot["dur"])
            src = float(shot["src"])
            p = tmp / f"seg_{len(parts):03d}.mp4"
            clip, at = pieces.locate(i, videos[i], src, dur)
            if clip == videos[i]:
                segment(videos[i], infos[i], shot, W, H, aspect, png, p)
            else:
                if clip not in piece_infos:
                    piece_infos[clip] = probe(clip)
                segment(clip, piece_infos[clip], {**shot, "src": at}, W, H, aspect, png, p)
            parts.append(p)
            if i not in words_of:
                words_of[i] = load_words(transcripts[i] if i < len(transcripts) else None)
            for w in words_of[i]:
                if w["s"] >= src - 0.01 and w["e"] <= src + dur + 0.01:
                    timed.append({"w": w["w"], "s": t + w["s"] - src, "e": t + w["e"] - src})
            shot_times.append((rank, k, t, t + dur))
            t += dur
            progress("shots", len(parts), total_shots)
        timeline.append({"rank": rank, "start": round(start, 3), "end": round(t, 3)})

    progress("encode", 0, 1)
    lst = tmp / "parts.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    joined = tmp / "joined.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(joined)])
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(joined), "-af",
         f"loudnorm=I={float(plan.get('lufs', -14))}:TP=-1.5:LRA=11,aresample=48000", "-c:v", "copy",
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)])
    progress("encode", 1, 1)

    srt = []
    for num, chunk in enumerate(chunk_words(timed), 1):
        srt.append(f"{num}\n{fmt_ts(chunk[0]['s'])} --> {fmt_ts(chunk[-1]['e'])}\n{' '.join(w['w'] for w in chunk)}\n")
    captions = out.with_suffix(".srt")
    captions.write_text("\n".join(srt))

    # checks of the finished mp4
    checks_dir = out.parent / "checks"
    shutil.rmtree(checks_dir, ignore_errors=True)
    checks_dir.mkdir(parents=True)
    steps = len(shot_times) + 2
    progress("checks", 0, steps)
    black = black_ranges(out)
    progress("checks", 1, steps)
    frames = []
    for idx, (rank, k, s, e) in enumerate(shot_times):
        first = checks_dir / f"rank-{rank}-shot-{k + 1}-first.jpg"
        last = checks_dir / f"rank-{rank}-shot-{k + 1}-last.jpg"
        grab(out, s + 0.05, first)
        grab(out, max(s + 0.05, e - 0.1), last)
        frames.append({"rank": rank, "shot": k, "start": round(s, 3), "end": round(e, 3), "first": str(first), "last": str(last)})
        progress("checks", idx + 2, steps)
    lufs = loudness(out)
    progress("checks", steps, steps)

    if not args.keep_temp:
        shutil.rmtree(tmp, ignore_errors=True)
    emit({"type": "done", "output": str(out), "captions": str(captions), "duration_s": round(t, 3), "shots": len(parts),
          "timeline": timeline, "checks": {"black": black, "lufs": lufs, "frames": frames}, "footage": pieces.counts()})


if __name__ == "__main__":
    try:
        main()
    except RenderFailure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
