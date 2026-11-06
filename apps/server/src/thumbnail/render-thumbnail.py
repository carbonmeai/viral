# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Compose a 1080x1920 Shorts thumbnail: big text + hero object + reaction face, in one of two layouts.

Usage:
  uv run render-thumbnail.py <thumb.json> [--out thumb.jpg]

Config schema: ThumbConfig in packages/contracts/src/thumb-config.ts. `source` resolves against the config
file's folder; `box` is a crop in source pixels [x0, y0, x1, y1]; x/y are centre fractions of the canvas.

Ported from the viral-shorts skill's thumbnail.py; the layout is unchanged (blurred, darkened full-bleed
background; the hero object big in the middle with a red circle; a tilted, white-bordered reaction inset;
2-4 words of huge outlined text at the top) and is still the `classic` layout.

`layout: "bold"` is the eye-catching one: a saturated gradient (optionally a burst of rays) instead of footage; the
hero and the face lifted out of their frames with thick outlines, a glow and a shadow, the face big and overlapping
the hero; curiosity words; a hand-drawn arrow and/or one emoji.

Cut-outs, per layer: macOS's own subject cut-out first (cutout-apple.py, Vision, macOS 14+; no download), then
rembg (cutout.py) when its models are already on disk. When Apple's fails and rembg's models aren't there, the
layer reports "fallback: needs rembg models" so the caller can fetch them and draw again; any other failure, a
timeout or no clear subject falls back to a framed inset. `done` says which method drew each layer.

Reporting: stdout carries one JSON object per line:
  {"type": "progress", "step": "background" | "hero" | "inset" | "text" | "cutout"}
  {"type": "error", "code": "frame", "message": "..."}   (then exit 1)
  {"type": "done", "output": "...jpg", "width": 1080, "height": 1920, "cutouts": {"hero": "apple", "face": "rembg"}}
"""
import argparse
import json
import math
import os
import platform
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageEnhance, ImageFilter, ImageFont

W, H = 1080, 1920
FONTS = ["/System/Library/Fonts/Supplemental/Impact.ttf", "/System/Library/Fonts/Supplemental/Arial Black.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
RED = "#E8202A"


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


class Failure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def fail(code: str, message: str) -> None:
    raise Failure(code, message)


def frame(src: str, t: float) -> Image.Image:
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "f.png"
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(t), "-i", src, "-frames:v", "1", str(p)],
                           capture_output=True, text=True)
        if r.returncode != 0 or not p.exists():
            fail("frame", f"no frame at {t}s: {r.stderr.strip()[-500:]}")
        return Image.open(p).convert("RGB").copy()


def font(size: int) -> ImageFont.FreeTypeFont:
    for f in FONTS:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default(size)


def punch(img: Image.Image) -> Image.Image:
    """Upscaled 480p frames look soft: sharpen + a little contrast/saturation, thumbnail-style."""
    img = img.filter(ImageFilter.UnsharpMask(radius=3, percent=140, threshold=2))
    img = ImageEnhance.Contrast(img).enhance(1.12)
    return ImageEnhance.Color(img).enhance(1.25)


def placed(img: Image.Image, cfg: dict) -> tuple[Image.Image, int, int]:
    if cfg.get("box"):
        x0, y0, x1, y1 = cfg["box"]
        if not (0 <= x0 < x1 <= img.width and 0 <= y0 < y1 <= img.height):
            fail("crop", f"crop {cfg['box']} is outside the {img.width}x{img.height} frame")
        img = img.crop((x0, y0, x1, y1))
    w = int(W * cfg.get("width", 0.8))
    img = punch(img.resize((w, int(img.height * w / img.width)), Image.LANCZOS))
    return img, int(W * cfg.get("x", 0.5) - img.width / 2), int(H * cfg["y"] - img.height / 2)


def rounded(img: Image.Image, r: int, border: int, color: str = "#FFFFFF") -> Image.Image:
    out = Image.new("RGBA", (img.width + 2 * border, img.height + 2 * border), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    d.rounded_rectangle((0, 0, out.width - 1, out.height - 1), r + border, fill=color)
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1), r, fill=255)
    out.paste(img, (border, border), mask)
    return out


def shadow(canvas: Image.Image, layer: Image.Image, x: int, y: int) -> None:
    sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    sh.putalpha(layer.getchannel("A").point(lambda a: int(a * 0.6)))
    sh = sh.filter(ImageFilter.GaussianBlur(18))
    canvas.alpha_composite(sh, (x + 12, y + 18))
    canvas.alpha_composite(layer, (x, y))


# ---------------------------------------------------------------- the bold layout

EMOJI_FONT = "/System/Library/Fonts/Apple Color Emoji.ttc"


def models_dir() -> str:
    if os.environ.get("VIRAL_MODELS_DIR"):
        return os.environ["VIRAL_MODELS_DIR"]
    home = Path.home()
    return str(home / "Library" / "Caches" / "Viral" / "models" if sys.platform == "darwin" else home / ".cache" / "viral" / "models")


# a layer the caller can still cut out, once it has fetched rembg's models
NEEDS_REMBG = "fallback: needs rembg models"


def apple_available() -> bool:
    """macOS 14+ has Vision's foreground instance mask (the "Lift subject" model in Photos)."""
    forced = os.environ.get("VIRAL_CUTOUT_APPLE")
    if forced in ("on", "off"):
        return forced == "on"
    if sys.platform != "darwin":
        return False
    try:
        return int(platform.mac_ver()[0].split(".")[0]) >= 14
    except ValueError:
        return False


def run_cutout(script: Path, args: list[str], outs: list[str]) -> dict[str, float]:
    """Runs a cut-out script; the coverage of each `out` it wrote (missing = that one failed)."""
    try:
        r = subprocess.run(["uv", "run", "--quiet", "--script", str(script), *args], capture_output=True, text=True,
                           timeout=float(os.environ.get("VIRAL_CUTOUT_TIMEOUT", "600")))
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return {}
    coverage: dict[str, float] = {}
    for line in r.stdout.splitlines():
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if msg.get("type") == "cutout" and msg.get("out") in outs:
            coverage[msg["out"]] = float(msg.get("coverage", 0))
    return coverage


def usable(coverage: float | None) -> bool:
    """A cut-out that kept almost nothing or almost everything didn't find a subject."""
    return coverage is not None and 0.03 <= coverage <= 0.97


def cutouts(jobs: list[tuple[Image.Image, str]]) -> list[tuple[Image.Image | None, str]]:
    """Lifts each (image, rembg model) out of its background: Apple's cut-out first, then rembg when its model
    is on disk; (None, reason) where neither could. The model names only matter to rembg."""
    if os.environ.get("VIRAL_CUTOUT") == "off":
        return [(None, "fallback: cut-outs are off") for _ in jobs]
    here = Path(__file__).parent
    apple_script = Path(os.environ.get("VIRAL_CUTOUT_APPLE_SCRIPT") or here / "cutout-apple.py")
    rembg_script = Path(os.environ.get("VIRAL_CUTOUT_REMBG_SCRIPT") or here / "cutout.py")
    results: list[tuple[Image.Image | None, str] | None] = [None] * len(jobs)
    with tempfile.TemporaryDirectory() as td:
        ins = []
        for i, (img, _) in enumerate(jobs):
            src = Path(td) / f"in{i}.png"
            img.save(src)
            ins.append(str(src))

        why: dict[int, str] = {}
        if apple_available():
            outs = [str(Path(td) / f"apple{i}.png") for i in range(len(jobs))]
            coverage = run_cutout(apple_script, [a for i in range(len(jobs)) for a in (ins[i], outs[i])], outs)
            for i, out in enumerate(outs):
                if usable(coverage.get(out)):
                    results[i] = (Image.open(out).convert("RGBA").copy(), "apple")
                else:
                    why[i] = "no clear subject" if out in coverage else "cut-out failed"

        rest = [i for i in range(len(jobs)) if results[i] is None]
        models = Path(models_dir())
        ready = [i for i in rest if (models / f"{jobs[i][1]}.onnx").exists()]
        for i in rest:
            if i not in ready:
                results[i] = (None, NEEDS_REMBG)
        if ready:
            outs = {i: str(Path(td) / f"rembg{i}.png") for i in ready}
            args = [str(models)] + [a for i in ready for a in (ins[i], outs[i], jobs[i][1])]
            coverage = run_cutout(rembg_script, args, list(outs.values()))
            for i in ready:
                out = outs[i]
                if usable(coverage.get(out)):
                    results[i] = (Image.open(out).convert("RGBA").copy(), "rembg")
                else:
                    reason = "no clear subject" if out in coverage else why.get(i, "cut-out failed")
                    results[i] = (None, f"fallback: {reason}")
    return [r if r is not None else (None, "fallback: cut-out failed") for r in results]


def crop_box(img: Image.Image, cfg: dict) -> Image.Image:
    if cfg.get("box"):
        x0, y0, x1, y1 = cfg["box"]
        if not (0 <= x0 < x1 <= img.width and 0 <= y0 < y1 <= img.height):
            fail("crop", f"crop {cfg['box']} is outside the {img.width}x{img.height} frame")
        img = img.crop((x0, y0, x1, y1))
    return img


def boost(img: Image.Image) -> Image.Image:
    """Bold layers pop more than classic ones: more contrast and colour. A light denoise first, so blowing up a
    small video frame doesn't magnify its compression noise; sharpening happens after scaling (`scaled`)."""
    img = img.filter(ImageFilter.MedianFilter(3))
    img = ImageEnhance.Contrast(img).enhance(1.2)
    return ImageEnhance.Color(img).enhance(1.45)


def scaled(img: Image.Image, width: float | None = None, height: float | None = None) -> Image.Image:
    """Resized to a width or a height, then sharpened at its new size (keeping any alpha)."""
    f = (width / img.width) if width else (height / img.height)
    out = img.resize((max(1, int(img.width * f)), max(1, int(img.height * f))), Image.LANCZOS)
    rgb = out.convert("RGB").filter(ImageFilter.UnsharpMask(radius=2, percent=110, threshold=3))
    if out.mode == "RGBA":
        rgb = rgb.convert("RGBA")
        rgb.putalpha(out.getchannel("A"))
    return rgb


def outlined(cut: Image.Image, stroke: int, color: str) -> Image.Image:
    """A cut-out with a solid outline of `stroke` px around its shape."""
    pad = stroke + 4
    out = Image.new("RGBA", (cut.width + 2 * pad, cut.height + 2 * pad), (0, 0, 0, 0))
    alpha = Image.new("L", out.size, 0)
    alpha.paste(cut.getchannel("A").point(lambda a: 255 if a > 100 else 0), (pad, pad))
    ring = alpha.filter(ImageFilter.MaxFilter(stroke * 2 + 1)).filter(ImageFilter.GaussianBlur(1))
    fill = Image.new("RGBA", out.size, color)
    fill.putalpha(ring)
    out.alpha_composite(fill)
    out.alpha_composite(cut, (pad, pad))
    return out


def trimmed(cut: Image.Image) -> Image.Image:
    bbox = cut.getchannel("A").point(lambda a: 255 if a > 40 else 0).getbbox()
    return cut.crop(bbox) if bbox else cut


def cut_edges(cut: Image.Image) -> set[str]:
    """Which sides of a (trimmed) cut-out are a crop line rather than the subject's own outline: the subject
    still fills a good part of that edge, so it was cut off there."""
    a = cut.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    w, h = a.size
    edges = set()
    for name, box, length in (("left", (0, 0, 2, h), h), ("right", (w - 2, 0, w, h), h), ("top", (0, 0, w, 2), w),
                              ("bottom", (0, h - 2, w, h), w)):
        filled = sum(1 for v in a.crop(box).getdata() if v) / (2 * length)
        if filled > 0.12:
            edges.add(name)
    return edges


def fade_top(cut: Image.Image, share: float = 0.14) -> Image.Image:
    """Fades the top `share` of a cut-out to transparent, for a subject the camera cut off at the top: no flat
    crop line, the head melts into the background instead."""
    n = max(1, int(cut.height * share))
    alpha = cut.getchannel("A")
    ramp = Image.linear_gradient("L").resize((cut.width, n))
    top = Image.composite(alpha.crop((0, 0, cut.width, n)), Image.new("L", (cut.width, n), 0), ramp)
    alpha.paste(top, (0, 0))
    out = cut.copy()
    out.putalpha(alpha)
    return out


def glow(canvas: Image.Image, layer: Image.Image, x: int, y: int, color: str, radius: int = 46) -> None:
    g = Image.new("RGBA", layer.size, color)
    g.putalpha(layer.getchannel("A").point(lambda a: int(a * 0.85)))
    big = Image.new("RGBA", (layer.width + 4 * radius, layer.height + 4 * radius), (0, 0, 0, 0))
    big.alpha_composite(g, (2 * radius, 2 * radius))
    canvas.alpha_composite(big.filter(ImageFilter.GaussianBlur(radius)), (x - 2 * radius, y - 2 * radius))


def backdrop(cfg: dict) -> Image.Image:
    """A radial gradient from the centre colour to the edge colour, with an optional burst of rays."""
    inner, outer = (ImageColor.getrgb(c) for c in cfg.get("colors", ["#FF2D2D", "#2A0000"]))
    small = Image.new("RGB", (108, 192))
    px = small.load()
    for yy in range(192):
        for xx in range(108):
            d = min(1.0, math.hypot((xx - 54) / 70, (yy - 86) / 120))
            px[xx, yy] = tuple(int(inner[i] + (outer[i] - inner[i]) * d ** 1.2) for i in range(3))
    bg = small.resize((W, H), Image.BICUBIC).convert("RGBA")
    if cfg.get("burst"):
        rays = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(rays)
        cx, cy, n = W / 2, H * 0.45, 22
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 0.5) / n
            d.polygon([(cx, cy), (cx + 3000 * math.cos(a0), cy + 3000 * math.sin(a0)), (cx + 3000 * math.cos(a1), cy + 3000 * math.sin(a1))],
                      fill=(255, 255, 255, 26))
        bg.alpha_composite(rays)
    return bg


def arrow(canvas: Image.Image, start: tuple[float, float], end: tuple[float, float]) -> None:
    """A thick hand-drawn red arrow with a white edge, curving from `start` to `end`. Drawn at twice the size and
    scaled down, with round joints, so the stroke stays smooth."""
    k = 2
    layer = Image.new("RGBA", (W * k, H * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    (x0, y0), (x1, y1) = (start[0] * k, start[1] * k), (end[0] * k, end[1] * k)
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    nx, ny = -(y1 - y0), x1 - x0
    norm = math.hypot(nx, ny) or 1
    bend = 0.22 * math.hypot(x1 - x0, y1 - y0)
    cx, cy = mx + nx / norm * bend, my + ny / norm * bend
    pts = [((1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y1)
           for t in (i / 60 for i in range(61))]
    tip = pts[-1]
    a = math.atan2(tip[1] - pts[-6][1], tip[0] - pts[-6][0])
    hl = 120 * k

    def head(grow: float) -> list[tuple[float, float]]:
        return [(tip[0] + grow * math.cos(a), tip[1] + grow * math.sin(a)),
                (tip[0] - (hl + grow) * math.cos(a - 0.55), tip[1] - (hl + grow) * math.sin(a - 0.55)),
                (tip[0] - (hl + grow) * math.cos(a + 0.55), tip[1] - (hl + grow) * math.sin(a + 0.55))]

    body = [p for p in pts if math.hypot(p[0] - tip[0], p[1] - tip[1]) > hl * 0.7]
    for color, width, grow in (("#FFFFFF", 60 * k, 16 * k), (RED, 38 * k, 0)):
        for p in body:  # round joints and caps
            d.ellipse((p[0] - width / 2, p[1] - width / 2, p[0] + width / 2, p[1] + width / 2), fill=color)
        d.line(body, fill=color, width=width)
        d.polygon(head(grow), fill=color)
    small = layer.resize((W, H), Image.LANCZOS)
    sh = Image.new("RGBA", small.size, (0, 0, 0, 0))
    sh.putalpha(small.getchannel("A").point(lambda v: int(v * 0.5)))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)), (8, 12))
    canvas.alpha_composite(small)


def emoji(canvas: Image.Image, char: str, x: float, y: float, size: int) -> str:
    try:
        f = ImageFont.truetype(EMOJI_FONT, 160)
    except OSError:
        return "skipped: no emoji font"
    tile = Image.new("RGBA", (220, 220), (0, 0, 0, 0))
    ImageDraw.Draw(tile).text((110, 110), char, font=f, embedded_color=True, anchor="mm")
    bbox = tile.getbbox()
    if not bbox:
        return "skipped: the font has no glyph for it"
    tile = scaled(tile.crop(bbox), width=size)
    shadow(canvas, tile, int(W * x - tile.width / 2), int(H * y - tile.height / 2))
    return "drawn"


def text_block(canvas: Image.Image, lines: list[dict], top: float) -> int:
    d = ImageDraw.Draw(canvas)
    y = int(H * top)
    for ln in lines:
        size = ln.get("size", 190)
        f = font(size)
        while d.textlength(ln["text"], font=f) > W * 0.92 and size > 60:
            size -= 6
            f = font(size)
        x = (W - d.textlength(ln["text"], font=f)) / 2
        # a hard drop shadow under the outline, then the outlined text
        d.text((x + 10, y + 14), ln["text"], font=f, fill="#000000", stroke_width=int(size * 0.09), stroke_fill="#000000")
        d.text((x, y), ln["text"], font=f, fill=ln.get("color", "#FFFFFF"), stroke_width=int(size * 0.09), stroke_fill="#000000")
        y += int(size * 1.0)
    return y


def bold(cfg: dict, src: str, out: Path) -> None:
    emit({"type": "progress", "step": "background"})
    canvas = backdrop(cfg.get("backdrop", {}))

    hero_cfg, face_cfg = cfg["hero"], cfg.get("inset")
    hero_img = boost(crop_box(frame(src, hero_cfg["src"]), hero_cfg))
    face_img = boost(crop_box(frame(src, face_cfg["src"]), face_cfg)) if face_cfg else None
    emit({"type": "progress", "step": "cutout"})
    jobs = [(hero_img, "isnet-general-use")] + ([(face_img, "u2net_human_seg")] if face_img is not None else [])
    cuts = cutouts(jobs)
    report = {"hero": cuts[0][1]}

    # the face: big, outlined, overlapping the hero's lower edge, anchored to the bottom of the frame
    face_box = None
    face_layer = None
    under = False
    if face_img is not None and face_cfg is not None:
        emit({"type": "progress", "step": "inset"})
        face_h = H * face_cfg.get("height", 0.48)
        edges: set[str] = set()
        if cuts[1][0] is not None:
            cut = trimmed(cuts[1][0])
            edges = cut_edges(cut)
            face = outlined(scaled(cut, height=face_h), 14, face_cfg.get("outline", "#FFFFFF"))
            if "top" in edges:
                # cut off at the top by the camera: fade the crop line away and tuck it under the hero
                face, under = fade_top(face), True
        else:
            face = rounded(scaled(face_img, height=face_h), 28, 14, face_cfg.get("outline", "#FFFFFF"))
        report["face"] = cuts[1][1]
        face = face.rotate(face_cfg.get("tilt", 0), expand=True, resample=Image.BICUBIC)
        side = face_cfg.get("side", "right")
        fx = face_cfg.get("x", 0.68 if side == "right" else 0.32)
        left = int(W * fx - face.width / 2)
        # bold anchors the face by its bottom: y is where the bottom sits (1.0 = the canvas's bottom edge)
        top = int(H * face_cfg.get("y", 1.0) - face.height)
        # a side the crop cut through bleeds off the frame, so the crop line (and its outline) never shows
        bleed = 20
        if "bottom" in edges:
            top = H - face.height + bleed
        if side == "right" and "right" in edges:
            left = max(left, W - face.width + bleed)
        if side == "left" and "left" in edges:
            left = min(left, -bleed)
        face_layer = (face, left, top)
        face_box = (left, top, left + face.width, top + face.height)

    # the hero: big, outlined, glowing, slightly turned
    emit({"type": "progress", "step": "hero"})
    hero_w = W * hero_cfg.get("width", 0.82)
    if cuts[0][0] is not None:
        hero = outlined(scaled(trimmed(cuts[0][0]), width=hero_w), 16, hero_cfg.get("outline", "#FFFFFF"))
    else:
        hero = rounded(scaled(hero_img, width=hero_w), 30, 14, hero_cfg.get("outline", "#FFFFFF"))
    hero = hero.rotate(hero_cfg.get("rotate", -6), expand=True, resample=Image.BICUBIC)
    hx, hy = int(W * hero_cfg.get("x", 0.5) - hero.width / 2), int(H * hero_cfg["y"] - hero.height / 2)
    glow(canvas, hero, hx, hy, hero_cfg.get("glow", "#FFE14D"))
    if face_layer is not None and under:
        shadow(canvas, *face_layer)
    shadow(canvas, hero, hx, hy)
    if hero_cfg.get("circle"):
        dd = ImageDraw.Draw(canvas)
        cx = hx + hero.width * hero_cfg.get("circle_x", 0.5)
        cy = hy + hero.height * hero_cfg.get("circle_y", 0.5)
        r = hero.width * hero_cfg.get("circle_r", 0.42)
        dd.ellipse((cx - r, cy - r, cx + r, cy + r), outline="#FFFFFF", width=26)
        dd.ellipse((cx - r, cy - r, cx + r, cy + r), outline=RED, width=16)

    if face_layer is not None and not under:
        shadow(canvas, *face_layer)

    # the arrow: from the empty side (opposite the face) up to the hero's edge
    if cfg.get("arrow"):
        side = face_cfg.get("side", "right") if face_cfg else "right"
        start = (W * (0.16 if side == "right" else 0.84), H * 0.80)
        hcx, hcy = hx + hero.width / 2, hy + hero.height / 2
        ang = math.atan2(start[1] - hcy, start[0] - hcx)
        reach = min(hero.width, hero.height) * 0.36
        arrow(canvas, start, (hcx + reach * math.cos(ang), hcy + reach * math.sin(ang)))

    if cfg.get("emoji"):
        e = cfg["emoji"]
        report["emoji"] = emoji(canvas, e["char"], e.get("x", 0.16), e.get("y", 0.62), e.get("size", 220))

    emit({"type": "progress", "step": "text"})
    text_block(canvas, cfg["lines"], cfg.get("text_y", 0.03))

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out, quality=92)
    emit({"type": "done", "output": str(out), "width": W, "height": H, "cutouts": report})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    cfgp = Path(args.config).resolve()
    cfg = json.loads(cfgp.read_text())
    src = str((cfgp.parent / cfg["source"]).resolve())
    if not Path(src).exists():
        fail("source", f"no video at {src}")
    out = Path(args.out) if args.out else cfgp.with_suffix(".jpg")
    if cfg.get("layout") == "bold":
        bold(cfg, src, out)
        return

    # background
    emit({"type": "progress", "step": "background"})
    bg = frame(src, cfg["background"]["src"])
    s = max(W / bg.width, H / bg.height)
    bg = bg.resize((int(bg.width * s) + 1, int(bg.height * s) + 1), Image.LANCZOS)
    bg = bg.crop(((bg.width - W) // 2, (bg.height - H) // 2, (bg.width - W) // 2 + W, (bg.height - H) // 2 + H))
    bg = ImageEnhance.Brightness(bg.filter(ImageFilter.GaussianBlur(22))).enhance(0.45)
    canvas = bg.convert("RGBA")

    # hero object
    emit({"type": "progress", "step": "hero"})
    hero, hx, hy = placed(frame(src, cfg["hero"]["src"]), cfg["hero"])
    hero_l = rounded(hero, 36, 10)
    shadow(canvas, hero_l, hx - 10, hy - 10)
    d = ImageDraw.Draw(canvas)
    if cfg["hero"].get("circle"):
        c = cfg["hero"]
        cx = hx + hero.width * c.get("circle_x", 0.5)
        cy = hy + hero.height * c.get("circle_y", 0.5)
        r = hero.width * c.get("circle_r", 0.36)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=RED, width=16)

    # reaction inset
    if cfg.get("inset"):
        emit({"type": "progress", "step": "inset"})
        ins, ix, iy = placed(frame(src, cfg["inset"]["src"]), cfg["inset"])
        ins_l = rounded(ins, 28, 12).rotate(cfg["inset"].get("tilt", 0), expand=True, resample=Image.BICUBIC)
        ix -= (ins_l.width - ins.width) // 2
        iy -= (ins_l.height - ins.height) // 2
        if cfg.get("arrow"):
            # arrow from the inset's top-left toward the hero's lower-left
            x0, y0 = ix + 40, iy + 20
            x1, y1 = hx + hero.width * 0.28, hy + hero.height * 0.86
            d.line((x0, y0, x1, y1), fill=RED, width=26)
            a = math.atan2(y1 - y0, x1 - x0)
            for s_ in (-0.55, 0.55):
                d.line((x1, y1, x1 - 70 * math.cos(a + s_), y1 - 70 * math.sin(a + s_)), fill=RED, width=26)
        shadow(canvas, ins_l, ix, iy)

    # text (top), heavy outline for small-screen legibility
    emit({"type": "progress", "step": "text"})
    y = int(H * cfg.get("text_y", 0.035))
    d = ImageDraw.Draw(canvas)
    for ln in cfg["lines"]:
        size = ln.get("size", 180)
        f = font(size)
        while d.textlength(ln["text"], font=f) > W * 0.94 and size > 60:
            size -= 6
            f = font(size)
        x = (W - d.textlength(ln["text"], font=f)) / 2
        d.text((x, y), ln["text"], font=f, fill=ln.get("color", "#FFFFFF"), stroke_width=int(size * 0.07), stroke_fill="#000000")
        y += int(size * 1.02)

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out, quality=92)
    emit({"type": "done", "output": str(out), "width": W, "height": H})


if __name__ == "__main__":
    try:
        main()
    except Failure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
