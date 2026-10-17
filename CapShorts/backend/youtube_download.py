"""
youtube_download.py - YouTube import for CapShorts (yt-dlp wrapper).
Only download content you own or have permission to use; respect YouTube's Terms of Service.
"""

import os
import re
from typing import Any, Callable, Dict, Optional
from urllib.parse import urlparse

ALLOWED_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"}
QUALITY_HEIGHTS = {"360": 360, "480": 480, "720": 720, "1080": 1080, "1440": 1440, "best": 4320}
MAX_DURATION_SEC = 3 * 3600


def validate_youtube_url(url: str) -> str:
    """Returns the cleaned URL or raises ValueError. Only http(s) youtube hosts are accepted."""
    if not url or not isinstance(url, str):
        raise ValueError("Empty URL")
    url = url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or (parsed.hostname or "").lower() not in ALLOWED_HOSTS:
        raise ValueError("Only YouTube links (youtube.com / youtu.be) are supported")
    return url


def build_format(quality: str) -> str:
    h = QUALITY_HEIGHTS.get(str(quality), 1080)
    return f"bv*[height<={h}][ext=mp4]+ba[ext=m4a]/b[height<={h}][ext=mp4]/bv*[height<={h}]+ba/b[height<={h}]/b"


def _base_opts(ffmpeg_dir: Optional[str]) -> Dict[str, Any]:
    opts: Dict[str, Any] = {"quiet": True, "no_warnings": True, "noplaylist": True, "socket_timeout": 20}
    if ffmpeg_dir and os.path.isdir(ffmpeg_dir):
        opts["ffmpeg_location"] = ffmpeg_dir
    return opts


def fetch_info(url: str, ffmpeg_dir: Optional[str] = None) -> Dict[str, Any]:
    import yt_dlp
    with yt_dlp.YoutubeDL({**_base_opts(ffmpeg_dir), "skip_download": True}) as ydl:
        info = ydl.extract_info(validate_youtube_url(url), download=False)
    return {
        "title": info.get("title") or "YouTube video",
        "duration": int(info.get("duration") or 0),
        "thumbnail": info.get("thumbnail"),
        "uploader": info.get("uploader"),
        "is_live": bool(info.get("is_live")),
    }


def download_video(url: str, out_dir: str, basename: str, quality: str,
                   on_progress: Callable[[int, str], None], ffmpeg_dir: Optional[str] = None) -> str:
    """Downloads into out_dir/<basename>.mp4 and returns the file name. Calls on_progress(percent, step)."""
    import yt_dlp
    url = validate_youtube_url(url)
    info = fetch_info(url, ffmpeg_dir)
    if info["is_live"]:
        raise ValueError("Live streams are not supported")
    if info["duration"] > MAX_DURATION_SEC:
        raise ValueError("Video is longer than 3 hours")

    def hook(d: Dict[str, Any]):
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            pct = int(d.get("downloaded_bytes", 0) / total * 90) if total else 5
            on_progress(min(90, max(1, pct)), "Downloading video...")
        elif d.get("status") == "finished":
            on_progress(92, "Merging audio and video...")

    opts = {
        **_base_opts(ffmpeg_dir),
        "format": build_format(quality),
        "merge_output_format": "mp4",
        "outtmpl": os.path.join(out_dir, f"{basename}.%(ext)s"),
        "progress_hooks": [hook],
        "restrictfilenames": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    for name in os.listdir(out_dir):
        if name.startswith(basename + ".") and not name.endswith((".part", ".ytdl")):
            return name
    raise RuntimeError("Download finished but the file was not found")


def safe_basename(task_id: str) -> str:
    return "yt_" + re.sub(r"[^a-zA-Z0-9]", "", task_id)
