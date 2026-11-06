# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["rembg[cpu]==2.0.67", "pillow"]
# ///
"""Lift subjects out of their backgrounds for bold thumbnails (rembg).

Usage:
  uv run cutout.py <models-dir> <in.png> <out.png> <model> [<in.png> <out.png> <model> ...]

Each `out.png` is the input with an alpha channel (the subject kept, the background transparent). `model` is a
rembg model name: isnet-general-use for objects, u2net_human_seg for people. Models download once into
`models-dir`. render-thumbnail.py runs this as a separate script so the thumbnail itself never depends on rembg:
when this fails or times out, it falls back to a framed inset. stdout: one JSON line per image,
{"type": "cutout", "out": "...", "coverage": 0.31}, or {"type": "error", "code", "message"}.
"""
import json
import os
import sys

from PIL import Image


def main_shape(cut: Image.Image) -> Image.Image:
    """Keeps the subject's largest connected shape (and any piece at least a fifth its size), dropping loose
    fragments of the background the model let through."""
    import numpy as np
    from scipy import ndimage

    alpha = np.array(cut.getchannel("A"))
    labels, n = ndimage.label(alpha > 128)
    if n <= 1:
        return cut
    sizes = ndimage.sum(np.ones_like(labels), labels, index=range(1, n + 1))
    keep = {i + 1 for i, size in enumerate(sizes) if size >= 0.2 * sizes.max()}
    mask = np.isin(labels, list(keep))
    # keep the soft edge around what's kept
    mask = ndimage.binary_dilation(mask, iterations=3)
    alpha[~mask] = 0
    out = cut.copy()
    out.putalpha(Image.fromarray(alpha))
    return out


def main() -> None:
    models, rest = sys.argv[1], sys.argv[2:]
    if len(rest) == 0 or len(rest) % 3 != 0:
        raise SystemExit("usage: cutout.py <models-dir> (<in> <out> <model>)+")
    os.environ["U2NET_HOME"] = models
    os.makedirs(models, exist_ok=True)
    from rembg import new_session, remove

    sessions: dict[str, object] = {}
    for i in range(0, len(rest), 3):
        src, out, model = rest[i], rest[i + 1], rest[i + 2]
        session = sessions.get(model) or new_session(model)
        sessions[model] = session
        img = Image.open(src).convert("RGB")
        cut = remove(img, session=session, alpha_matting=True, alpha_matting_foreground_threshold=240,
                     alpha_matting_background_threshold=12, alpha_matting_erode_size=8, post_process_mask=True)
        cut = main_shape(cut)
        cut.save(out)
        alpha = cut.getchannel("A")
        coverage = sum(1 for a in alpha.getdata() if a > 128) / (alpha.width * alpha.height)
        print(json.dumps({"type": "cutout", "out": out, "coverage": round(coverage, 3)}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"type": "error", "code": "cutout", "message": f"{type(error).__name__}: {error}"}), flush=True)
        sys.exit(1)
