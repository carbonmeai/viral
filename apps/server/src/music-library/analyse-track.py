# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = ["librosa>=0.10.2", "numpy", "soundfile", "pyloudnorm>=0.1.1"]
# ///
"""Analyse a music track: tempo, where the drop hits, and loudness.

Usage:
  uv run analyse-track.py <audio>

The drop is found the way the viral-shorts skill does it by ear: the bass (below 150 Hz) jumps by 20-30 dB
when the drop lands. The largest sustained rise in that band after the first 4 seconds is the candidate; it
is snapped to the nearest beat, and reported only when the rise is clear (otherwise drop_s is null). Tempo
comes from librosa's beat tracker, loudness is integrated LUFS (ITU-R BS.1770).

stdout carries one JSON object per line: {"type": "progress", "step": "load"|"tempo"|"drop"|"loudness"}, an
error line {"type": "error", "code": ..., "message": ...}, or
{"type": "done", "bpm": 117.5, "drop_s": 16.59, "loudness_lufs": -9.8, "duration_s": 42.1, "confidence": 0.9}.
"""
import json
import sys

LOW_HZ = 150
# a drop must come after this many seconds, and be followed by this many seconds of track
MIN_START_S = 4.0
WINDOW_S = 2.0
# a rise in the low band below this (dB) isn't a drop; at this rise confidence is 1
MIN_RISE_DB = 10.0
FULL_RISE_DB = 20.0


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


class Failure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def main() -> None:
    if len(sys.argv) != 2:
        raise Failure("usage", "analyse-track.py <audio>")
    import numpy as np
    import librosa
    import pyloudnorm

    emit({"type": "progress", "step": "load"})
    try:
        stereo, sr = librosa.load(sys.argv[1], sr=None, mono=False)
    except Exception as error:  # noqa: BLE001 - any decoder failure is the same to the caller
        raise Failure("decode", f"can't read the audio: {error}") from error
    mono = librosa.to_mono(stereo) if stereo.ndim > 1 else stereo
    duration = float(len(mono) / sr)
    if duration < 1.0:
        raise Failure("too-short", "the track is shorter than a second")

    emit({"type": "progress", "step": "tempo"})
    # librosa's tempo estimate sits on a grid of frame sizes (at 44.1 kHz, 114.8 and 116.1 are neighbours), so
    # track the beats finely and fit a straight line through their times: the slope is the real beat length
    beat_sr, beat_hop = 22050, 128
    y_beat = librosa.resample(mono, orig_sr=sr, target_sr=beat_sr) if sr != beat_sr else mono
    tempo, beat_frames = librosa.beat.beat_track(y=y_beat, sr=beat_sr, hop_length=beat_hop)
    beats = librosa.frames_to_time(beat_frames, sr=beat_sr, hop_length=beat_hop)
    if len(beats) >= 8:
        bpm = 60.0 / float(np.polyfit(np.arange(len(beats)), beats, 1)[0])
    else:
        bpm = float(np.atleast_1d(tempo)[0])

    emit({"type": "progress", "step": "drop"})
    hop = 512
    spectrum = np.abs(librosa.stft(mono, n_fft=4096, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
    low = spectrum[freqs < LOW_HZ].sum(axis=0)
    low_db = librosa.amplitude_to_db(low, ref=np.max(low) if low.max() > 0 else 1.0)
    times = librosa.frames_to_time(np.arange(len(low_db)), sr=sr, hop_length=hop)
    per_s = sr / hop
    w = max(1, int(WINDOW_S * per_s))
    # mean level in the window after each frame minus the window before it: a sustained jump, not a single hit
    csum = np.concatenate([[0.0], np.cumsum(low_db)])
    rise = np.full(len(low_db), -np.inf)
    for i in range(w, len(low_db) - w):
        rise[i] = (csum[i + w] - csum[i]) / w - (csum[i] - csum[i - w]) / w
    valid = (times >= MIN_START_S) & (times <= duration - WINDOW_S)
    rise[~valid] = -np.inf
    drop_s = None
    confidence = 0.0
    if np.isfinite(rise).any():
        best = int(np.argmax(rise))
        best_rise = float(rise[best])
        confidence = float(min(1.0, max(0.0, best_rise / FULL_RISE_DB)))
        if best_rise >= MIN_RISE_DB:
            t = float(times[best])
            # the rise window straddles the drop; snap to the nearest beat so the music lands on the bar
            if len(beats) > 0:
                t = float(beats[int(np.argmin(np.abs(beats - t)))])
            drop_s = round(t, 3)

    emit({"type": "progress", "step": "loudness"})
    channels = stereo.T if stereo.ndim > 1 else stereo
    loudness = float(pyloudnorm.Meter(sr).integrated_loudness(channels))
    loudness_lufs = round(loudness, 1) if np.isfinite(loudness) else None

    emit({
        "type": "done",
        "bpm": round(bpm, 1),
        "drop_s": drop_s,
        "loudness_lufs": loudness_lufs,
        "duration_s": round(duration, 3),
        "confidence": round(confidence, 2)
    })


if __name__ == "__main__":
    try:
        main()
    except Failure as failure:
        emit({"type": "error", "code": failure.code, "message": str(failure)})
        sys.exit(1)
    except Exception as error:  # noqa: BLE001
        emit({"type": "error", "code": "internal", "message": f"{type(error).__name__}: {error}"})
        sys.exit(1)
