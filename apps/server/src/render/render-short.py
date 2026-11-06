# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Render a cut-down Short: the creator's own speech, cut from the long video by story beat into 9:16.

Usage:
  uv run render-short.py <plan.json> [--out out.mp4] [--keep-temp]

Plan schema: CutRenderPlan in packages/contracts/src/cut-plan.ts. Relative paths in the plan resolve against
the plan file's folder.

Ported from the viral-shorts skill's render_short.py. The rendering is unchanged (word-snapped cuts, crop or
blurred-fit framing, 3-word captions with the active word highlighted, a hook title card); added are a credit
line, excluded ranges, caption colour/case and loudness. Reporting changed: stdout carries one JSON object per
line for the server to decode:
  {"type": "progress", "step": "sections", "done": 3, "total": 7}
  {"type": "error", "code": "excluded-range", "message": "..."}   (then exit 1)
  {"type": "done", "output": "...mp4", "captions": "...srt", "duration_s": 41.2, "sections": 7}
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/System/Library/Fonts/Supplemental/Impact.ttf",
    "/Library/Fonts/Arial Black.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)


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


def run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        fail("ffmpeg", f"ffmpeg failed:\n{' '.join(cmd)}\n{r.stderr[-3000:]}")


def probe(path: str) -> tuple[int, int, float]:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height:format=duration", "-of", "json", path],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        fail("ffprobe", f"can't read {path}: {r.stderr.strip()}")
    d = json.loads(r.stdout)
    return d["streams"][0]["width"], d["streams"][0]["height"], float(d["format"]["duration"])


def font(size: int) -> ImageFont.FreeTypeFont:
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def hex_rgba(color: str) -> tuple[int, int, int, int]:
    c = color.lstrip("#")
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), 255)


def fmt_ts(t: float, sep: str = ",") -> str:
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d}{sep}{int(round((s % 1) * 1000)):03d}"


def resolve(base: Path, p: str) -> str:
    return p if Path(p).is_absolute() else str((base / p).resolve())


# ---------------------------------------------------------------- transcript

def load_words(transcript_path: str | None) -> list[dict]:
    if not transcript_path or not Path(transcript_path).exists():
        return []
    data = json.loads(Path(transcript_path).read_text())
    return [w for seg in data["segments"] for w in seg["words"]]


def snap(start: float, end: float, words: list[dict], duration: float) -> tuple[float, float]:
    """Extend in/out so the section never starts or ends mid-word."""
    inside = [w for w in words if w["e"] > start and w["s"] < end]
    if inside:
        start = min(start, inside[0]["s"])
        end = max(end, inside[-1]["e"])
    return max(0.0, start - 0.06), min(duration, end + 0.15)


# ---------------------------------------------------------------- video

def reframe_filter(framing: str, crop_x: float, src_w: int, src_h: int) -> str:
    if src_w / src_h <= W / H + 0.01:  # already vertical
        return f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={FPS}"
    if framing == "blur":
        return (
            f"split=2[bg][fg];"
            f"[bg]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=25:2,eq=brightness=-0.08[bgb];"
            f"[fg]scale={W}:-2[fgs];"
            f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1,fps={FPS}"
        )
    cx = min(max(crop_x, 0.0), 1.0)
    return f"crop=ih*9/16:ih:(iw-ih*9/16)*{cx}:0,scale={W}:{H},setsar=1,fps={FPS}"


def cut_section(src: str, start: float, end: float, vf: str, out: Path) -> None:
    dur = end - start
    fade = min(0.04, dur / 4)
    run([
        "ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.3f}", "-i", src, "-t", f"{dur:.3f}",
        "-filter_complex", f"[0:v]{vf}[v];[0:a]afade=t=in:d={fade},afade=t=out:st={dur - fade:.3f}:d={fade},aresample=48000[a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ac", "2", str(out),
    ])


# ---------------------------------------------------------------- captions

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


def fit_lines(draw: ImageDraw.ImageDraw, words: list[str], size: int, max_w: int):
    """Return (font, lines) where lines is a list of word-lists that fit max_w."""
    while size > 40:
        f = font(size)
        lines, cur = [], []
        for w in words:
            trial = " ".join(cur + [w])
            if cur and draw.textlength(trial, font=f) > max_w:
                lines.append(cur)
                cur = [w]
            else:
                cur.append(w)
        lines.append(cur)
        if len(lines) <= 2 and all(draw.textlength(" ".join(l), font=f) <= max_w for l in lines):
            return f, lines
        size -= 6
    return font(size), [words]


def cased(word: str, case: str) -> str:
    return word.upper() if case == "upper" else word.lower() if case == "lower" else word


def caption_png(words: list[str], active: int, path: Path, y_center: float, highlight: tuple, case: str) -> None:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    words = [cased(re.sub(r"[.,;:]+$", "", w), case) for w in words]
    f, lines = fit_lines(d, words, 96, int(W * 0.86))
    line_h = int(f.size * 1.15)
    y = int(H * y_center - line_h * len(lines) / 2)
    idx = 0
    space = d.textlength(" ", font=f)
    for line in lines:
        total = d.textlength(" ".join(line), font=f)
        x = (W - total) / 2
        for w in line:
            color = highlight if idx == active else WHITE
            d.text((x, y), w, font=f, fill=color, stroke_width=9, stroke_fill=BLACK)
            x += d.textlength(w, font=f) + space
            idx += 1
        y += line_h
    img.save(path)


def hook_png(text: str, path: Path) -> None:
    """White rounded label with black text, top third: the 'title card' over the hook."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f, lines = fit_lines(d, text.upper().split(), 78, int(W * 0.80))
    lines = [" ".join(l) for l in lines]
    line_h = int(f.size * 1.2)
    box_w = max(d.textlength(l, font=f) for l in lines) + 70
    box_h = line_h * len(lines) + 50
    x0, y0 = (W - box_w) / 2, H * 0.14
    d.rounded_rectangle((x0 + 8, y0 + 10, x0 + box_w + 8, y0 + box_h + 10), 26, fill=(0, 0, 0, 110))
    d.rounded_rectangle((x0, y0, x0 + box_w, y0 + box_h), 26, fill=WHITE)
    y = y0 + 25
    for l in lines:
        d.text(((W - d.textlength(l, font=f)) / 2, y), l, font=f, fill=BLACK)
        y += line_h
    img.save(path)


def credit_png(text: str, path: Path) -> None:
    """A small steady credit in the top-left corner, as the narrated renderer draws it."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(int(W * 0.022))
    x, y = W * 0.035, H * 0.012
    d.text((x + 2, y + 2), text, font=f, fill=(0, 0, 0, 160))
    d.text((x, y), text, font=f, fill=(255, 255, 255, 220))
    img.save(path)


def build_caption_track(timed_words: list[dict], total: float, tmp: Path, y_center: float, highlight: tuple, case: str) -> Path:
    """Write per-word caption PNGs + an ffconcat list that plays them on the output timeline."""
    blank = tmp / "blank.png"
    Image.new("RGBA", (W, H), (0, 0, 0, 0)).save(blank)
    events: list[tuple[float, float, Path]] = []
    chunks = chunk_words(timed_words)
    for ci, chunk in enumerate(chunks):
        texts = [w["w"] for w in chunk]
        chunk_end = chunks[ci + 1][0]["s"] if ci + 1 < len(chunks) else total
        chunk_end = min(chunk_end, chunk[-1]["e"] + 0.6)
        for wi, w in enumerate(chunk):
            png = tmp / f"cap_{ci:04d}_{wi}.png"
            caption_png(texts, wi, png, y_center, highlight, case)
            s = w["s"]
            e = chunk[wi + 1]["s"] if wi + 1 < len(chunk) else chunk_end
            events.append((s, max(e, s + 0.05), png))

    lines = ["ffconcat version 1.0"]
    t = 0.0
    for s, e, png in events:
        if s < t:
            s = t
        if e <= s:
            continue
        if s - t > 0.001:
            lines += [f"file '{blank}'", f"duration {s - t:.3f}"]
        lines += [f"file '{png}'", f"duration {e - s:.3f}"]
        t = e
    if total - t > 0.001:
        lines += [f"file '{blank}'", f"duration {total - t:.3f}"]
    lines.append(f"file '{blank}'")
    lst = tmp / "captions.ffconcat"
    lst.write_text("\n".join(lines) + "\n")
    return lst


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
    src = resolve(base, plan["source"])
    words = load_words(resolve(base, plan["transcript"]) if plan.get("transcript") else None)
    slug = plan.get("slug", plan_path.stem)
    out = Path(args.out).resolve() if args.out else base / "shorts" / f"{slug}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    src_w, src_h, src_dur = probe(src)
    if not plan.get("sections"):
        fail("no-sections", "the plan has no sections")

    tmp = out.parent / f".{slug}_tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)

    # sponsor reads / ads / end screens must never appear in a short
    for sec in plan["sections"]:
        for a, b in plan.get("exclude", []):
            if float(sec["start"]) < float(b) and float(sec["end"]) > float(a):
                fail("excluded-range", f"section {sec['start']}–{sec['end']}s overlaps the excluded range {a}–{b}s")

    framing = plan.get("framing", "crop")
    timed_words: list[dict] = []
    beats: list[tuple[str, float, float]] = []
    parts: list[Path] = []
    offset = 0.0
    total_sections = len(plan["sections"])
    progress("sections", 0, total_sections)
    for i, sec in enumerate(plan["sections"]):
        start, end = float(sec["start"]), float(sec["end"])
        if plan.get("snap", True):
            start, end = snap(start, end, words, src_dur)
        end = min(end, src_dur)
        vf = reframe_filter(sec.get("framing", framing), float(sec.get("crop_x", plan.get("crop_x", 0.5))), src_w, src_h)
        part = tmp / f"part_{i:02d}.mp4"
        cut_section(src, start, end, vf, part)
        parts.append(part)
        for w in words:
            if w["s"] >= start - 0.01 and w["e"] <= end + 0.01:
                timed_words.append({"w": w["w"], "s": offset + w["s"] - start, "e": offset + w["e"] - start})
        beats.append((sec.get("beat", f"section {i + 1}"), offset, offset + (end - start)))
        offset += end - start
        progress("sections", i + 1, total_sections)
    total = offset

    concat_list = tmp / "parts.txt"
    concat_list.write_text("".join(f"file '{p}'\n" for p in parts))
    joined = tmp / "joined.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(joined)])

    progress("overlays", 0, 1)
    inputs = ["-i", str(joined)]
    graph, last = [], "0:v"
    highlight = hex_rgba(plan.get("caption_highlight", "#FFD600"))
    case = plan.get("caption_case", "upper")
    if plan.get("captions", True) and timed_words:
        caps = build_caption_track(timed_words, total, tmp, float(plan.get("caption_y", 0.70)), highlight, case)
        inputs += ["-f", "concat", "-safe", "0", "-i", str(caps)]
        graph.append(f"[{last}][1:v]overlay=0:0:eof_action=pass[vc]")
        last = "vc"
    hook_text = plan.get("hook_text")
    if hook_text:
        hook_until = float(plan.get("hook_text_seconds", beats[0][2]))
        hp = tmp / "hook.png"
        hook_png(hook_text, hp)
        idx = len([x for x in inputs if x == "-i"])
        inputs += ["-loop", "1", "-i", str(hp)]
        graph.append(f"[{last}][{idx}:v]overlay=0:0:enable='lt(t,{hook_until:.2f})':shortest=1[vh]")
        last = "vh"
    if plan.get("credit"):
        cp = tmp / "credit.png"
        credit_png(plan["credit"], cp)
        idx = len([x for x in inputs if x == "-i"])
        inputs += ["-loop", "1", "-i", str(cp)]
        graph.append(f"[{last}][{idx}:v]overlay=0:0:shortest=1[vcr]")
        last = "vcr"
    progress("overlays", 1, 1)

    progress("encode", 0, 1)
    audio = ["-af", f"loudnorm=I={plan['lufs']}:TP=-1.5:LRA=11,aresample=48000", "-c:a", "aac", "-b:a", "192k"] \
        if plan.get("lufs") is not None else ["-c:a", "copy"]
    if graph:
        run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(graph),
             "-map", f"[{last}]", "-map", "0:a", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
             "-pix_fmt", "yuv420p", "-r", str(FPS), *audio, "-movflags", "+faststart", "-t", f"{total:.3f}", str(out)])
    else:
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(joined), "-map", "0:v", "-map", "0:a", "-c:v", "copy",
             *audio, "-movflags", "+faststart", str(out)])
    progress("encode", 1, 1)

    # srt (uploadable as captions)
    srt = []
    for n, chunk in enumerate(chunk_words(timed_words), 1):
        srt.append(f"{n}\n{fmt_ts(chunk[0]['s'])} --> {fmt_ts(chunk[-1]['e'])}\n{' '.join(w['w'] for w in chunk)}\n")
    out.with_suffix(".srt").write_text("\n".join(srt))

    if not args.keep_temp:
        shutil.rmtree(tmp, ignore_errors=True)
    emit({"type": "done", "output": str(out), "captions": str(out.with_suffix(".srt")), "duration_s": round(total, 3),
          "sections": len(parts)})


if __name__ == "__main__":
    try:
        main()
    except RenderFailure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
