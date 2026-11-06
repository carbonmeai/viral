# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Compose a 1080x1920 Shorts thumbnail: big text + hero object + reaction-face inset.

Usage:
  uv run render-thumbnail.py <thumb.json> [--out thumb.jpg]

Config schema: ThumbConfig in packages/contracts/src/thumb-config.ts. `source` resolves against the config
file's folder; `box` is a crop in source pixels [x0, y0, x1, y1]; x/y are centre fractions of the canvas.

Ported from the viral-shorts skill's thumbnail.py; the layout is unchanged (blurred, darkened full-bleed
background; the hero object big in the middle with a red circle; a tilted, white-bordered reaction inset;
2-4 words of huge outlined text at the top). Reporting changed: stdout carries one JSON object per line:
  {"type": "progress", "step": "background" | "hero" | "inset" | "text"}
  {"type": "error", "code": "frame", "message": "..."}   (then exit 1)
  {"type": "done", "output": "...jpg", "width": 1080, "height": 1920}
"""
import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

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

    out = Path(args.out) if args.out else cfgp.with_suffix(".jpg")
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
