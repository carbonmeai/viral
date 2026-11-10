"""The end card after a short's payoff (a style's "End with a comment question"), for render-narrated and render-short.

The skill's way (narrated-short step 7, ranking-short, cutdown-short step 6), measured from its approved spicy and
rescues5 cards at 1080x1920: the question in yellow (#FFD400, Arial Black 58 px with a black outline, wrapped to 80% of
the width, from 14% of the height) and a red SUBSCRIBE pill (#E62117, 536x120, white Arial Black, its top at 81% of the
height), over a held frame. The held frame is the short's own picture a moment before its end, without
captions or headline (taken from the renderer's clean cut, so it's laid out like the shot it ends on and never shows
the source's next scene). The short is held 0.35 s on its last frame (`tpad`), so its last word isn't clipped, and
the card comes in over that with a 0.35 s `xfade` + `acrossfade`; then the whole file is levelled to the plan's
loudness again.

A narrated short plays the narrator's closing line under the card (the voiceover's `vo_start`–`vo_end`, after a
0.35 s lead so the crossfade never eats its first word, then 0.6 s of air); a cut-down short holds the card alone,
silent, for `seconds` (default 3). A plan without `cta` never calls this, so it renders exactly as before.
"""
import os
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFont

YELLOW = "#FFD400"
RED = (230, 33, 23)
CROSSFADE = 0.35
# how far before the short's end the held frame is taken, so a clip that ends on a cut never holds the next scene
HOLD_BACK = 0.2
# narrator: silence before the closing line (the crossfade's length) and after it
LEAD = CROSSFADE
TAIL = 0.6
CARD_SECONDS = 3.0

QUESTION_FONTS = [
    *([os.environ["VIRAL_CAPTION_FONT"]] if os.environ.get("VIRAL_CAPTION_FONT") else []),
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
PILL_FONTS = [
    *([os.environ["VIRAL_CAPTION_FONT"]] if os.environ.get("VIRAL_CAPTION_FONT") else []),
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _font(size: int, fonts: list[str]) -> ImageFont.FreeTypeFont:
    for p in fonts:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def _wrap(d: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, max_w: float) -> list[str]:
    lines = [""]
    for word in text.split():
        trial = f"{lines[-1]} {word}".strip()
        if lines[-1] and d.textlength(trial, font=f) > max_w:
            lines.append(word)
        else:
            lines[-1] = trial
    return lines


def card_png(question: str, W: int, H: int, path: Path) -> None:
    """The card's overlay: the question on top, the SUBSCRIBE pill below, transparent elsewhere. Sizes as the skill's
    spicy card at 1080 wide: Arial Black 58 px with a 7 px black outline, lines 1.4 apart, its ink from 14.2% of the
    height; the pill 120 px tall, Arial Black 63 px with 63.5 px either side, its top at 81.25%."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = W / 1080
    size = int(58 * k)
    f = _font(size, QUESTION_FONTS)
    lines = _wrap(d, question.strip(), f, W * 0.8)
    while len(lines) > 3 and size > 24:
        size -= 2
        f = _font(size, QUESTION_FONTS)
        lines = _wrap(d, question.strip(), f, W * 0.8)
    stroke = max(2, round(size * 0.12))
    # the first line's ink starts at 14.2% of the height
    y = H * 0.142 - d.textbbox((W / 2, 0), lines[0], font=f, anchor="ma")[1]
    for line in lines:
        d.text((W / 2, y), line, font=f, fill=YELLOW, anchor="ma", stroke_width=stroke, stroke_fill="#000000")
        y += size * 1.4
    pf = _font(int(63 * k), PILL_FONTS)
    label = "SUBSCRIBE"
    tw = d.textlength(label, font=pf)
    pw, ph = tw + 2 * 63.5 * k, 120 * k
    x0, y0 = (W - pw) / 2, H * 0.8125
    d.rounded_rectangle((x0, y0, x0 + pw, y0 + ph), radius=ph / 2, fill=RED)
    d.text((W / 2, y0 + ph / 2), label, font=pf, fill="#FFFFFF", anchor="mm")
    img.save(path)


def append_end_card(out: Path, clean: Path, card: dict, tmp: Path, *, W: int, H: int, fps: int, x264_preset: str,
                    lufs: float, run: Callable[[list[str]], None], duration: Callable[[str], float],
                    voiceover: str | None = None, voice_gain: float = 1.0, credit: Path | None = None) -> dict:
    """Appends the end card to `out` in place. `clean` is the short's picture without captions or headline, on the same
    timeline. Returns {"seconds": the card's length, "voice_at": where the closing line starts in the final file, or
    None}."""
    main = duration(str(out))
    still = tmp / "end_still.png"
    run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{max(0.0, min(main, duration(str(clean))) - HOLD_BACK):.3f}",
         "-i", str(clean), "-frames:v", "1", str(still)])
    overlay = tmp / "end_card.png"
    card_png(str(card["question"]), W, H, overlay)

    has_voice = voiceover is not None and card.get("vo_start") is not None
    if has_voice:
        vo_len = duration(voiceover)
        a = max(0.0, float(card["vo_start"]))
        b = min(vo_len, float(card.get("vo_end", vo_len)))
        line = max(0.0, b - a)
        seconds = LEAD + line + TAIL
    else:
        seconds = float(card.get("seconds", CARD_SECONDS))
    xf = float(card.get("crossfade", CROSSFADE))

    inputs = ["-loop", "1", "-t", f"{seconds:.3f}", "-i", str(still), "-loop", "1", "-t", f"{seconds:.3f}", "-i", str(overlay)]
    graph = [f"[0:v]scale={W}:{H},setsar=1,fps={fps}[bg]", "[bg][1:v]overlay=0:0[c1]"]
    last = "c1"
    if credit is not None:
        inputs += ["-loop", "1", "-t", f"{seconds:.3f}", "-i", str(credit)]
        graph.append(f"[{last}][2:v]overlay=0:0[c2]")
        last = "c2"
    graph.append(f"[{last}]format=yuv420p[v]")
    n = len([x for x in inputs if x == "-i"])
    if has_voice:
        inputs += ["-ss", f"{a:.3f}", "-t", f"{line:.3f}", "-i", str(voiceover)]
        graph.append(f"[{n}:a]aresample=48000,aformat=channel_layouts=stereo,volume={voice_gain},"
                     f"adelay={int(LEAD * 1000)}:all=1,apad=whole_dur={seconds:.3f}[a]")
    else:
        inputs += ["-f", "lavfi", "-t", f"{seconds:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        graph.append(f"[{n}:a]anull[a]")
    card_clip = tmp / "end_card.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]",
         "-t", f"{seconds:.3f}", "-c:v", "libx264", "-preset", x264_preset, "-crf", "19", "-r", str(fps),
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", str(card_clip)])

    # the short held on its last frame for the crossfade, so the card comes in after its last word
    joined = tmp / "with_end_card.mp4"
    norm = f"fps={fps},scale={W}:{H},setsar=1,format=yuv420p,settb=AVTB"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(out), "-i", str(card_clip), "-filter_complex",
         f"[0:v]{norm},tpad=stop_mode=clone:stop_duration={xf:.3f}[m];[1:v]{norm}[c];"
         f"[m][c]xfade=transition=fade:duration={xf:.3f}:offset={main:.3f}[v];"
         f"[0:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur={main + xf:.3f}[ma];"
         f"[1:a]aresample=48000,aformat=channel_layouts=stereo[ca];"
         f"[ma][ca]acrossfade=d={xf:.3f}[mix];[mix]loudnorm=I={lufs}:TP=-1.5:LRA=11,aresample=48000[aout]",
         "-map", "[v]", "-map", "[aout]", "-c:v", "libx264", "-preset", x264_preset, "-crf", "19", "-pix_fmt", "yuv420p",
         "-r", str(fps), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", f"{main + seconds:.3f}",
         str(joined)])
    joined.replace(out)
    return {"seconds": round(seconds, 3), "voice_at": round(main + LEAD, 3) if has_voice else None,
            "vo_start": a if has_voice else None}
