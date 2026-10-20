"""
reframe.py - auto-reframe: turns a landscape video into a vertical one by following the speaker's face.

A 9:16 window the full height of the video slides left and right behind the face, like a camera operator:
it stays put while the face moves inside a small dead zone, then glides after it with a speed limit, so the
picture never jitters or jumps. Frames without a face keep the last position. If hardly any face is found
(slides, screen recordings, a landscape scene) the caller falls back to the blurred-background layout.

Face detection: YuNet (OpenCV, MIT license, 233 KB model in backend/face). The path planning is pure Python.
"""

import math
import os
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

MODEL_NAME = "face_detection_yunet_2023mar.onnx"

SAMPLE_FPS = 4.0            # faces are looked for this many times per second of video
MAX_SAMPLES = 1500          # ... but never in more than this many frames (long videos are sampled more sparsely)
DETECT_WIDTH = 480          # frames are shrunk to this width for detection (faster, and faces stay large enough)
MIN_SCORE = 0.7
PATH_RATE = 10.0            # camera position is computed this many times per second

DEAD_ZONE = 0.08            # the face may wander this fraction of the window width around the center without a move
MAX_SPEED = 0.9             # the window never moves faster than this many window-widths per second
SMOOTH_TAU = 0.35           # seconds: how quickly it settles on the face once it moves
HOLD_GAP = 2.0              # seconds a missing face is bridged by holding / interpolating
MIN_COVERAGE = 0.25         # follow only if a face is found in at least this share of the sampled frames
MIN_SAMPLES = 3
SEQUENTIAL_MAX_SKIP = 45     # frames between samples up to which reading straight through beats seeking


@dataclass
class Face:
    cx: float      # center x in source pixels
    cy: float
    w: float
    h: float
    score: float


@dataclass
class Sample:
    t: float
    faces: List[Face]


# ---------------------------------------------------------------------------------------------------- geometry
def crop_geometry(src_w: int, src_h: int, aspect: float = 9 / 16) -> Tuple[int, int]:
    """Window size (even numbers) with the given aspect that is as tall as the source."""
    crop_h = src_h - (src_h % 2)
    crop_w = int(round(crop_h * aspect))
    crop_w -= crop_w % 2
    return min(crop_w, src_w - (src_w % 2)), crop_h


# ---------------------------------------------------------------------------------------------------- planning
def pick_subject(faces: Sequence[Face], prev_cx: Optional[float], src_w: float) -> Optional[Face]:
    """The speaker: the biggest, most certain face, with a preference for staying on the one followed before."""
    best: Optional[Face] = None
    best_value = -1.0
    for f in faces:
        value = f.w * f.h * f.score
        if prev_cx is not None:
            nearness = 1.0 - min(1.0, abs(f.cx - prev_cx) / max(1.0, src_w * 0.3))
            value *= 1.0 + 0.8 * nearness          # a similar face next to the old one does not steal the camera
        if value > best_value:
            best, best_value = f, value
    return best


def subject_track(samples: Sequence[Sample], src_w: float) -> List[Tuple[float, Optional[float]]]:
    """[(time, face center x or None)] following one subject through the samples."""
    track: List[Tuple[float, Optional[float]]] = []
    prev: Optional[float] = None
    for s in samples:
        face = pick_subject(s.faces, prev, src_w)
        if face is not None:
            prev = face.cx
        track.append((s.t, face.cx if face is not None else None))
    return track


def coverage(track: Sequence[Tuple[float, Optional[float]]]) -> float:
    return (sum(1 for _, cx in track if cx is not None) / len(track)) if track else 0.0


def should_follow(track: Sequence[Tuple[float, Optional[float]]]) -> bool:
    return len(track) >= MIN_SAMPLES and coverage(track) >= MIN_COVERAGE


def _target_at(t: float, known: Sequence[Tuple[float, float]]) -> Optional[float]:
    """Where the face is at time t: interpolated between detections, held for a while after the last one."""
    if not known:
        return None
    if t <= known[0][0]:
        return known[0][1]
    for (t0, x0), (t1, x1) in zip(known, known[1:]):
        if t0 <= t <= t1:
            if t1 - t0 <= HOLD_GAP:
                u = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
                return x0 + (x1 - x0) * u
            return x0                                  # long gap: stay until the face shows up again
    return known[-1][1]


def build_path(track: Sequence[Tuple[float, Optional[float]]], start: float, end: float, src_w: float, crop_w: float,
               rate: float = PATH_RATE) -> List[int]:
    """Left edge of the window (source pixels) at start, start+1/rate, ... end."""
    known = [(t, cx) for t, cx in track if cx is not None]
    n = max(1, int(math.floor((end - start) * rate)) + 1)
    lo, hi = 0.0, max(0.0, src_w - crop_w)
    dt = 1.0 / rate
    k = 1.0 - math.exp(-dt / SMOOTH_TAU)
    vmax = MAX_SPEED * crop_w
    dead = DEAD_ZONE * crop_w

    first = _target_at(start, known)
    cam = first if first is not None else src_w / 2.0       # camera center
    xs: List[int] = []
    for i in range(n):
        t = start + i * dt
        target = _target_at(t, known)
        if target is not None and abs(target - cam) > dead:
            # move toward the edge of the dead zone, not onto the face: the face may stay off-center
            goal = target - math.copysign(dead * 0.3, target - cam)
            step = max(-vmax * dt, min(vmax * dt, (goal - cam) * k))
            cam += step
        left = max(lo, min(hi, cam - crop_w / 2.0))
        xs.append(int(round(left)) // 2 * 2)               # even x keeps chroma aligned
    return xs


def sendcmd_text(xs: Sequence[int], rate: float = PATH_RATE, label: str = "rf") -> str:
    """FFmpeg sendcmd script that sets the crop's x over time; only changes are written."""
    lines: List[str] = []
    last: Optional[int] = None
    for i, x in enumerate(xs):
        if x != last:
            lines.append(f"{i / rate:.3f} crop@{label} x {x};")
            last = x
    return "\n".join(lines) + "\n"


def follow_filter(cmd_path: str, crop_w: int, crop_h: int, first_x: int, out_w: int = 1080, out_h: int = 1920,
                  label: str = "rf") -> str:
    """Filter chain: slide the window per the sendcmd script, then scale to the output size. Output label: [vcomp]."""
    escaped = cmd_path.replace("\\", "/").replace(":", "\\:")
    return (f"[0:v]sendcmd=f='{escaped}',crop@{label}=w={crop_w}:h={crop_h}:x={first_x}:y=0,"
            f"scale={out_w}:{out_h}:flags=lanczos,setsar=1[vcomp]")


# ---------------------------------------------------------------------------------------------------- detection
def find_model(extra_dirs: Sequence[str] = ()) -> Optional[str]:
    here = os.path.dirname(os.path.abspath(__file__))
    dirs = list(extra_dirs)
    if getattr(sys, "frozen", False):
        dirs += [os.path.join(os.path.dirname(sys.executable), "face"), os.path.join(getattr(sys, "_MEIPASS", ""), "face")]
    dirs.append(os.path.join(here, "face"))
    for d in dirs:
        p = os.path.join(d, MODEL_NAME)
        if d and os.path.isfile(p):
            return p
    return None


def detect_faces(video_path: str, model_path: str, start: float, end: float, sample_fps: float = SAMPLE_FPS,
                 max_samples: int = MAX_SAMPLES) -> Tuple[List[Sample], int, int]:
    """Faces in sampled frames of [start, end]. Returns (samples, source width, source height)."""
    import cv2  # imported here: the rest of the module (and the app without this feature) does not need OpenCV

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("Could not open the video for face detection.")
    try:
        src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if src_w <= 0 or src_h <= 0:
            raise RuntimeError("Could not read the video size.")
        scale = min(1.0, DETECT_WIDTH / float(src_w))
        dw, dh = max(32, int(round(src_w * scale))), max(32, int(round(src_h * scale)))
        detector = cv2.FaceDetectorYN.create(model_path, "", (dw, dh), MIN_SCORE, 0.3, 50)

        span = max(0.0, end - start)
        step = max(1.0 / sample_fps, span / max_samples) if span > 0 else 1.0
        samples: List[Sample] = []

        def detect(frame, t: float):
            small = cv2.resize(frame, (dw, dh)) if scale < 1.0 else frame
            _, found = detector.detect(small)
            faces: List[Face] = []
            if found is not None:
                for f in found:
                    x, y, w, h = (float(v) / scale for v in f[:4])
                    faces.append(Face(cx=x + w / 2.0, cy=y + h / 2.0, w=w, h=h, score=float(f[-1])))
            samples.append(Sample(t - start, faces))

        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        every = int(round(step * fps)) if fps > 0 else 0
        if 0 < every <= SEQUENTIAL_MAX_SKIP:
            # Reading straight through is several times faster than seeking to every sample
            # (each seek decodes again from the previous keyframe).
            cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000.0)
            first = cap.get(cv2.CAP_PROP_POS_FRAMES) or round(start * fps)
            idx = 0
            while True:
                t = (first + idx) / fps
                if t > end + 1e-6:
                    break
                if idx % every == 0:
                    ok, frame = cap.read()
                    if not ok or frame is None:
                        break
                    detect(frame, max(t, start))
                elif not cap.grab():
                    break
                idx += 1
        else:
            t = start
            while t <= end + 1e-6:
                cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
                ok, frame = cap.read()
                if not ok or frame is None:
                    break
                detect(frame, t)
                t += step
        return samples, src_w, src_h
    finally:
        cap.release()


def plan_reframe(video_path: str, start: float, end: float, src_w: int, src_h: int, model_path: Optional[str] = None,
                 detect=detect_faces) -> Dict[str, Any]:
    """
    Decides between following the speaker and the blurred-background fallback.
    Returns {"mode": "follow"|"blur", "reason": str, ...}; in follow mode also crop_w, crop_h, xs, rate, coverage.
    Times in the plan are relative to `start` (the start of the clip being exported).
    """
    model = model_path or find_model()
    if not model:
        return {"mode": "blur", "reason": "face model not installed"}
    try:
        samples, w, h = detect(video_path, model, start, end)
    except Exception as e:
        return {"mode": "blur", "reason": f"face detection failed: {e}"}
    w, h = (w or src_w), (h or src_h)
    crop_w, crop_h = crop_geometry(w, h)
    if crop_w >= w:
        return {"mode": "blur", "reason": "the video is not wider than the vertical frame"}
    track = subject_track(samples, w)
    cov = coverage(track)
    if not should_follow(track):
        return {"mode": "blur", "reason": "no face found" if cov == 0 else "faces found in too few frames", "coverage": cov}
    xs = build_path(track, 0.0, max(0.0, end - start), w, crop_w)
    return {"mode": "follow", "reason": "following the speaker", "coverage": cov, "crop_w": crop_w, "crop_h": crop_h,
            "xs": xs, "rate": PATH_RATE}
