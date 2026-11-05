# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow", "numpy"]
# ///
"""Render a narrated-recap Short: a voiceover drives the timeline, b-roll shots from the long
video are cut under it, and the creator's real reaction (original audio) plays at the end.

Usage:
  uv run render-narrated.py <plan.json> [--out out.mp4] [--keep-temp]

Plan schema: NarratedPlan in packages/contracts/src/narrated-plan.ts. Relative paths in the plan
resolve against the plan file's folder.

Ported from the viral-shorts skill's render_narrated.py. The rendering is unchanged; only reporting
changed: stdout carries one JSON object per line for the server to decode:
  {"type": "progress", "step": "shots", "done": 3, "total": 31}
  {"type": "log", "message": "..."}
  {"type": "error", "code": "excluded-range", "message": "..."}   (then exit 1)
  {"type": "done", "output": "...mp4", "captions": "...srt", "duration_s": 47.2, ...}
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FPS = 30
# Caption font. Arial Rounded Bold is macOS-only and can't be redistributed; set VIRAL_CAPTION_FONT
# to an open-licensed font file on other platforms.
FONTS = [
    *([os.environ["VIRAL_CAPTION_FONT"]] if os.environ.get("VIRAL_CAPTION_FONT") else []),
    "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


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


def duration(path: str) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    if r.returncode != 0:
        fail("ffprobe", f"can't read duration of {path}: {r.stderr.strip()}")
    return float(r.stdout.strip())


def font(size: int) -> ImageFont.FreeTypeFont:
    for p in FONTS:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def resolve(base: Path, p: str) -> str:
    return p if Path(p).is_absolute() else str((base / p).resolve())


def words_of(transcript: str) -> list[dict]:
    data = json.loads(Path(transcript).read_text())
    return [w for seg in data["segments"] for w in seg["words"]]


# ---------------------------------------------------------------- layout

class Layout:
    def __init__(self, plan: dict):
        self.W, self.H = plan.get("canvas", [1080, 1920])
        self.main_h = int(plan.get("main_height", round(self.H * 2 / 3)))
        self.main_h -= self.main_h % 2

    def filter(self, crop_x: float = 0.5, crop_y: float = 0.5, zoom: float = 1.0, speed: float = 1.0,
               fit: bool = False) -> str:
        W, H, mh = self.W, self.H, self.main_h
        ar = W / mh
        zoom = max(zoom, 1.0)
        if fit:  # whole source frame, letterboxed on the blur (graphics, text cards, wide shots)
            fg = f"scale={W}:-2"
        else:
            fg = (f"crop='min(iw,ih*{ar:.5f})/{zoom}':'min(ih,iw/{ar:.5f})/{zoom}':"
                  f"'(iw-ow)*{crop_x}':'(ih-oh)*{crop_y}',scale={W}:{mh}")
        pts = f"setpts=PTS/{speed}," if speed != 1 else ""
        return (
            f"[0:v]{pts}fps={FPS},split=2[a][b];"
            f"[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=30:2,eq=brightness=-0.12[bg];"
            f"[b]{fg}[fg];[bg][fg]overlay=0:(H-h)/2,setsar=1,format=yuv420p[v]"
        )


def cut(src: str, start: float, dur: float, lay: Layout, out: Path, shot: dict, with_audio: bool) -> None:
    speed = float(shot.get("speed", 1.0))
    vf = lay.filter(float(shot.get("crop_x", 0.5)), float(shot.get("crop_y", 0.5)), float(shot.get("zoom", 1.0)), speed,
                    bool(shot.get("fit", False)))
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{dur * speed + 0.1:.3f}", "-i", src,
           "-filter_complex", vf, "-map", "[v]", "-t", f"{dur:.3f}"]
    if with_audio:
        cmd += ["-map", "0:a", "-af", "aresample=48000", "-c:a", "aac", "-b:a", "192k", "-ac", "2"]
    else:
        cmd += ["-an"]
    run(cmd + ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", str(FPS), str(out)])


# ---------------------------------------------------------------- overlays

def color_for(word: str, highlights: dict[str, str]) -> str | None:
    key = re.sub(r"[^\w$%]", "", word.lower())
    return highlights.get(key)


def word_png(word: str, lay: Layout, path: Path, y_frac: float, highlights: dict[str, str], lower: bool) -> None:
    img = Image.new("RGBA", (lay.W, lay.H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    text = word.lower() if lower else word
    text = re.sub(r"[,.;:]+$", "", text)
    size = int(lay.W * 0.105)
    f = font(size)
    while d.textlength(text, font=f) > lay.W * 0.9 and size > 30:
        size -= 4
        f = font(size)
    fill = color_for(word, highlights) or "#FFFFFF"
    x = (lay.W - d.textlength(text, font=f)) / 2
    y = lay.H * y_frac - size / 2
    d.text((x + 4, y + 6), text, font=f, fill=(0, 0, 0, 150), stroke_width=int(size * 0.12), stroke_fill=(0, 0, 0, 150))
    d.text((x, y), text, font=f, fill=fill, stroke_width=int(size * 0.1), stroke_fill="#000000")
    img.save(path)


def annotation_png(a: dict, lay: Layout, path: Path) -> None:
    """Red circle / arrow / big emoji-ish mark. x,y are fractions of the MAIN band."""
    img = Image.new("RGBA", (lay.W, lay.H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    top = (lay.H - lay.main_h) / 2
    x, y = a["x"] * lay.W, top + a["y"] * lay.main_h
    red = a.get("color", "#E8202A")
    if a["type"] == "circle":
        r = a.get("r", 0.12) * lay.W
        d.ellipse((x - r, y - r * 0.8, x + r, y + r * 0.8), outline=red, width=int(lay.W * 0.012))
    elif a["type"] == "arrow":
        # arrow pointing at (x,y) from direction `from` (degrees, 0 = from the right, 90 = from below)
        import math
        ang = math.radians(a.get("from", 225))
        L = a.get("len", 0.16) * lay.W
        tail = (x + L * math.cos(ang), y + L * math.sin(ang))
        d.line((tail, (x, y)), fill=red, width=int(lay.W * 0.022))
        hw = lay.W * 0.045
        for s in (-0.5, 0.5):
            d.line(((x, y), (x + hw * math.cos(ang + s), y + hw * math.sin(ang + s))), fill=red, width=int(lay.W * 0.022))
    elif a["type"] == "text":
        f = font(int(a.get("size", 0.12) * lay.W))
        d.text((x, y), a["text"], font=f, fill=red, stroke_width=6, stroke_fill="#FFFFFF", anchor="mm")
    img.save(path)


def write_track(events: list[tuple[float, float, Path]], total: float, tmp: Path, name: str, blank: Path) -> Path:
    lines, t = ["ffconcat version 1.0"], 0.0
    for s, e, png in sorted(events, key=lambda x: x[0]):
        s = max(s, t)
        if e - s < 0.02:
            continue
        if s - t > 0.001:
            lines += [f"file '{blank}'", f"duration {s - t:.3f}"]
        lines += [f"file '{png}'", f"duration {e - s:.3f}"]
        t = e
    if total - t > 0.001:
        lines += [f"file '{blank}'", f"duration {total - t:.3f}"]
    lines.append(f"file '{blank}'")
    p = tmp / f"{name}.ffconcat"
    p.write_text("\n".join(lines) + "\n")
    return p


# ---------------------------------------------------------------- music

SR = 48000


def read_audio(path: str) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-vn", "-ac", "2", "-ar", str(SR),
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def write_audio(path: Path, y: np.ndarray) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-",
                    str(path)], input=y.astype(np.float32).tobytes(), check=True)


def build_music(cfg: dict, base: Path, drop_at: float, total: float, out: Path) -> None:
    """Loop the song's pre-drop groove (whole bars) so its own build-up + drop land exactly at `drop_at`.

    timeline: [groove loop xN, entered mid-loop] -> [last `build_bars` bars before the drop] -> [drop -> end]
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

    def seam(a: np.ndarray) -> np.ndarray:                 # tiny fades so loop seams never click
        a = a.copy()
        a[:fade] *= np.linspace(0, 1, fade)[:, None]
        a[-fade:] *= np.linspace(1, 0, fade)[:, None]
        return a

    if pre_need <= len(build_seg):
        pre = build_seg[len(build_seg) - pre_need:]
    else:
        rest = pre_need - len(build_seg)
        reps = -(-rest // len(groove_seg))
        loops = np.concatenate([seam(groove_seg)] * reps)
        pre = np.concatenate([loops[len(loops) - rest:], build_seg])
    post_need = int(round((total - drop_at) * SR)) + SR
    post = y[ds:ds + post_need]
    if len(post) < post_need:                               # song ends before the short: loop the drop section
        drop_seg = seam(y[ds:ds + int(round(float(cfg.get("drop_bars", 8)) * bar * SR))])
        while len(post) < post_need:
            post = np.concatenate([post, drop_seg])
        post = post[:post_need]
    write_audio(out, np.concatenate([pre, post])[: int(round(total * SR))])


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
    vo = resolve(base, plan["voiceover"])
    vo_words = words_of(resolve(base, plan["voiceover_transcript"]))
    src_words = words_of(resolve(base, plan["source_transcript"])) if plan.get("source_transcript") else []
    lay = Layout(plan)
    slug = plan.get("slug", plan_path.stem)
    out = Path(args.out).resolve() if args.out else base / "shorts" / f"{slug}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.parent / f".{slug}_tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)

    # sponsor reads / ads / end screens must never appear in a short
    excluded = [(float(a), float(b)) for a, b in plan.get("exclude", [])]

    def check(label: str, s: float, e: float) -> None:
        for a, b in excluded:
            if s < b and e > a:
                fail("excluded-range",
                     f"{label} uses source {s:.1f}-{e:.1f}s, which overlaps excluded range {a}-{b}s (ad/sponsor)")

    vo_dur = duration(vo)
    narr_end = float(plan.get("narration_end", vo_dur))

    # shots/annotations may anchor to a voiceover word ("word": index into the VO transcript) instead of
    # a fixed second, so swapping the voice or re-speeding it never knocks the b-roll out of sync
    def anchor(item: dict) -> None:
        if "word" in item:
            w = vo_words[int(item["word"])]
            if item.get("word_text") and re.sub(r"\W", "", item["word_text"].lower()) != re.sub(r"\W", "", w["w"].lower()):
                fail("anchor-mismatch", f"word {item['word']} is {w['w']!r}, plan expects {item['word_text']!r}")
            item["at"] = 0.0 if int(item["word"]) == 0 else round(w["s"] + float(item.get("offset", 0)), 3)
    for item in plan["shots"] + plan.get("annotations", []):
        anchor(item)

    # 1. b-roll under the voiceover
    shots = sorted(plan["shots"], key=lambda s: s["at"])
    if shots[0]["at"] > 0:
        fail("first-shot", "first shot must start at 0")
    parts = []
    progress("shots", 0, len(shots))
    for i, sh in enumerate(shots):
        end = shots[i + 1]["at"] if i + 1 < len(shots) else narr_end
        dur = end - sh["at"]
        if dur <= 0.03:
            continue
        check(f"shot at {sh['at']}s", float(sh["src"]), float(sh["src"]) + dur * float(sh.get("speed", 1.0)))
        p = tmp / f"shot_{i:03d}.mp4"
        cut(src, float(sh["src"]), dur, lay, p, sh, with_audio=False)
        parts.append(p)
        progress("shots", i + 1, len(shots))
    lst = tmp / "shots.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    broll = tmp / "broll.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(broll)])

    # voiceover (music is mixed later, across the whole timeline)
    narr = tmp / "narr.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(broll), "-i", vo, "-filter_complex",
         f"[1:a]atrim=0:{narr_end:.3f},aresample=48000,volume={plan.get('voice_gain', 1.0)}[a]",
         "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2",
         "-t", f"{narr_end:.3f}", str(narr)])

    # 2. outro clips with the creator's original audio
    segs = [narr]
    caption_words = [w for w in vo_words if w["s"] < narr_end]
    t = narr_end
    outro = plan.get("outro", [])
    for j, o in enumerate(outro):
        progress("outro", j, len(outro))
        s, e = float(o["start"]), float(o["end"])
        check(f"outro {j}", s, e)
        p = tmp / f"outro_{j}.mp4"
        cut(src, s, e - s, lay, p, o, with_audio=True)
        segs.append(p)
        if o.get("captions", True):
            caption_words += [{"w": w["w"], "s": t + w["s"] - s, "e": t + w["e"] - s}
                              for w in src_words if w["s"] >= s - 0.01 and w["e"] <= e + 0.01]
        t += e - s
    total = t

    joined = tmp / "joined.mp4"
    if len(segs) > 1:
        ins = sum((["-i", str(p)] for p in segs), [])
        fc = "".join(f"[{i}:v][{i}:a]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=1:a=1[v][a]"
        run(["ffmpeg", "-y", "-loglevel", "error", *ins, "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
             "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", str(joined)])
    else:
        shutil.copy(narr, joined)

    # 3. captions (one word at a time) + annotations
    progress("overlays", 0, 1)
    blank = tmp / "blank.png"
    Image.new("RGBA", (lay.W, lay.H), (0, 0, 0, 0)).save(blank)
    highlights = {k.lower(): v for k, v in plan.get("highlights", {}).items()}
    events = []
    for i, w in enumerate(caption_words):
        png = tmp / f"w_{i:04d}.png"
        word_png(w["w"], lay, png, float(plan.get("caption_y", 0.76)), highlights, plan.get("lowercase", True))
        nxt = caption_words[i + 1]["s"] if i + 1 < len(caption_words) else total
        events.append((w["s"], min(nxt, w["e"] + 0.5) if nxt - w["e"] > 0.5 else nxt, png))
    graph, inputs, last, n = [], ["-i", str(joined)], "0:v", 1
    if plan.get("captions", True) and events:
        inputs += ["-f", "concat", "-safe", "0", "-i", str(write_track(events, total, tmp, "caps", blank))]
        graph.append(f"[{last}][{n}:v]overlay=0:0:eof_action=pass[c{n}]")
        last, n = f"c{n}", n + 1
    for k, a in enumerate(plan.get("annotations", [])):
        png = tmp / f"ann_{k}.png"
        annotation_png(a, lay, png)
        inputs += ["-loop", "1", "-t", f"{total:.3f}", "-i", str(png)]
        graph.append(f"[{last}][{n}:v]overlay=0:0:enable='between(t,{a['at']},{a['at'] + a.get('dur', 1.0)})'[c{n}]")
        last, n = f"c{n}", n + 1
    # background music: looped, ducked under any speech (sidechain), faded in/out
    graph.append(f"[0:a]loudnorm=I={plan.get('lufs', -14)}:TP=-1.5:LRA=11,aresample=48000[aout]")
    audio_map, audio_codec = ["-map", "[aout]"], ["-c:a", "aac", "-b:a", "192k"]
    if plan.get("music"):
        graph.pop()
        m = n
        mcfg = plan["music"] if isinstance(plan["music"], dict) else {"file": plan["music"]}
        if "drop" in mcfg:
            if "drop_word" in mcfg:
                drop_at = vo_words[int(mcfg["drop_word"])]["s"] + float(mcfg.get("drop_offset", 0))
            else:
                drop_at = float(mcfg.get("drop_at", narr_end))
            built = tmp / "music_built.wav"
            build_music(mcfg, base, drop_at, total, built)
            inputs += ["-i", str(built)]
            start = 0.0
            emit({"type": "log", "message": f"music: drop lands at {drop_at:.2f}s (song {mcfg['drop']}s)"})
            # the build usually sits under the narration; the drop comes in louder (as in the reference short)
            g1, g2 = float(plan.get("music_gain", 0.35)), float(mcfg.get("drop_gain", plan.get("music_gain", 0.35)))
            music_vol = f"volume='{g1}+({g2}-{g1})*clip((t-{drop_at:.3f})/0.05,0,1)':eval=frame"
        else:
            inputs += ["-stream_loop", "-1", "-i", resolve(base, mcfg["file"])]
            start = float(plan.get("music_start", 0))
            music_vol = f"volume={plan.get('music_gain', 0.35)}"
        fade = min(2.0, total / 4)
        graph.append(
            f"[0:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[sp][sc];"
            f"[{m}:a]aresample=48000,aformat=channel_layouts=stereo,atrim={start}:{start + total:.3f},asetpts=PTS-STARTPTS,"
            f"{music_vol},afade=t=in:d=0.3,afade=t=out:st={total - fade:.3f}:d={fade:.3f}[mu];"
            f"[mu][sc]sidechaincompress=threshold={plan.get('duck_threshold', 0.02)}:ratio={plan.get('duck_ratio', 8)}"
            f":attack=15:release=350[duck];"
            f"[sp][duck]amix=inputs=2:duration=first:normalize=0[mix];"
            f"[mix]loudnorm=I={plan.get('lufs', -14)}:TP=-1.5:LRA=11,aresample=48000[aout]")
        audio_map, audio_codec = ["-map", "[aout]"], ["-c:a", "aac", "-b:a", "192k"]
    progress("encode", 0, 1)
    if graph:
        vmap = ["-map", f"[{last}]"] if last != "0:v" else ["-map", "0:v"]
        run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(graph),
             *vmap, *audio_map, "-c:v", "libx264", "-crf", "19", "-preset", "medium",
             "-pix_fmt", "yuv420p", "-r", str(FPS), *audio_codec, "-movflags", "+faststart",
             "-t", f"{total:.3f}", str(out)])
    else:
        shutil.copy(joined, out)

    # srt for CapCut / YouTube
    srt = [f"{i + 1}\n{_ts(w['s'])} --> {_ts(w['e'])}\n{w['w']}\n" for i, w in enumerate(caption_words)]
    out.with_suffix(".srt").write_text("\n".join(srt))
    if not args.keep_temp:
        shutil.rmtree(tmp, ignore_errors=True)
    emit({"type": "done", "output": str(out), "captions": str(out.with_suffix(".srt")), "duration_s": round(total, 3),
          "shots": len(parts), "narration_s": round(narr_end, 3), "outro_s": round(total - narr_end, 3)})


def _ts(t: float) -> str:
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s % 1) * 1000)):03d}"


if __name__ == "__main__":
    try:
        main()
    except RenderFailure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:  # anything unexpected still reaches the server as one JSON line
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
