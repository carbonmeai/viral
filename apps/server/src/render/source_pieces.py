"""Full-quality pieces of scanned videos, for the renderers (render-narrated, render-short, render-ranking and
render-thumbnail): a plan's `pieces_by_source` ({"0": [{"path", "start", "end"}]}, by video index like
`exclude_by_source`) lists, per video, the stretches fetched in 1080p. A clip a piece covers is read from that piece
at (clip start − piece start), so every timestamp in the plan stays on the video's own timeline; a clip no piece
covers is read from the video itself (the 480p scan). `counts()` says how many clips came from each, for the render
gate. A plan without pieces renders exactly as before.
"""
from pathlib import Path

# a piece may start or end a few milliseconds off the stretch asked for (rounding)
SLACK = 0.02


class Pieces:
    def __init__(self, plan: dict, base: Path):
        self.by_video: dict[int, list[tuple[float, float, str]]] = {}
        for key, pieces in (plan.get("pieces_by_source") or {}).items():
            self.by_video[int(key)] = sorted(
                (float(p["start"]), float(p["end"]), str((base / p["path"]).resolve()) if not Path(p["path"]).is_absolute() else p["path"])
                for p in pieces)
        self.used: dict[int, dict[str, int]] = {}

    def locate(self, video: int, path: str, start: float, span: float) -> tuple[str, float]:
        """The file to read a clip of `video` from and where in it: the piece covering [start, start + span] when there
        is one (time relative to the piece), else the video's own file at `start`."""
        count = self.used.setdefault(video, {"pieces": 0, "scan": 0})
        for a, b, piece in self.by_video.get(video, []):
            if a <= start + SLACK and b >= start + span - SLACK and Path(piece).exists():
                count["pieces"] += 1
                return piece, max(0.0, start - a)
        count["scan"] += 1
        return path, start

    def counts(self) -> dict[str, dict[str, int]]:
        """Clips read from pieces and from the video's own file, by video index."""
        return {str(v): c for v, c in sorted(self.used.items())}
