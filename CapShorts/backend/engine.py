"""
engine.py - Local Python AI & Media Engine Daemon for Kadr
Powered by FastAPI, Faster-Whisper, native FFmpeg, and Master Groq Cloud Turbo Pool.
"""

import os
import sys
import io

# Fix PyInstaller windowed NoneType stdout/stderr bug (causes uvicorn logging crash)
if sys.stdout is None:
    sys.stdout = io.StringIO()
if sys.stderr is None:
    sys.stderr = io.StringIO()

import uuid
import time
import shutil
import wave
import subprocess
import threading
import base64
import json
import re
import tempfile
import platform
import urllib.request
import urllib.parse

# Eliminate all pop-up black console/terminal windows for FFmpeg on Windows safely across platforms
SUBPROCESS_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) if sys.platform == "win32" else 0
SUBPROCESS_EXTRA_KWARGS = {"creationflags": SUBPROCESS_FLAGS} if sys.platform == "win32" else {}

from typing import List, Dict, Any, Optional, Tuple
from pydantic import BaseModel, Field, model_validator
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse

from subtitle_gen import generate_ass_subtitles, generate_srt_subtitles, generate_vtt_subtitles, compute_layout
import emoji_overlay as eo
import groq_chunks as gc
import media_store
import updates
import reframe
import timeline_render as tlr
from broll import search_pexels_videos, download_broll_clip, build_ffmpeg_broll_filter
from clip_generator import detect_viral_clips, summarize as clip_summary
from groq_transcribe import transcribe_with_groq_pool
from transliterate import transliterate_transcript, transliterate_word
import youtube_download as yt
import file_utils as fu
import asr_quality as aq
from text_align import align_words, apply_glossary, collapse_repeats, sanitize_words, fix_durations
from telemetry import telemetry

# Import the speech stack once, up front and on the main thread. In a packaged (PyInstaller) build,
# importing numpy/ctranslate2 from several worker threads at once fails with
# "cannot load module more than once per process".
try:
    import numpy  # noqa: F401
    import ctranslate2  # noqa: F401
    import faster_whisper  # noqa: F401
except Exception as _speech_import_error:
    print(f"[engine] speech stack unavailable: {_speech_import_error}")

app = FastAPI(title="Kadr AI Engine", version="1.4.2")

def get_ffmpeg_bin() -> str:
    """Resolves platform-appropriate FFmpeg executable."""
    for name in ["ffmpeg.exe", "ffmpeg"]:
        p = os.path.join(BIN_DIR, name)
        if os.path.exists(p):
            return p
    return "ffmpeg"

def get_ffprobe_bin() -> str:
    """Resolves platform-appropriate FFprobe executable."""
    for name in ["ffprobe.exe", "ffprobe"]:
        p = os.path.join(BIN_DIR, name)
        if os.path.exists(p):
            return p
    return "ffprobe"

def probe_video_dimensions(video_path: str) -> Tuple[int, int]:
    """Probes video width and height using ffprobe with timeout."""
    try:
        ffprobe_bin = get_ffprobe_bin()
        cmd = [
            ffprobe_bin, "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=s=x:p=0",
            video_path
        ]
        out = subprocess.check_output(cmd, stderr=subprocess.PIPE, text=True, timeout=10, **SUBPROCESS_EXTRA_KWARGS).strip()
        if "x" in out:
            w_str, h_str = out.split("x", 1)
            return int(w_str), int(h_str)
    except subprocess.TimeoutExpired:
        print(f"[engine] probe_video_dimensions timed out after 10s for: {video_path}")
    except Exception as e:
        print(f"[engine] probe_video_dimensions error: {e}")
    return 1080, 1920

def probe_media_duration(path: str) -> float:
    """Duration in seconds of an audio/video file (0.0 if it cannot be read)."""
    try:
        out = subprocess.check_output(
            [get_ffprobe_bin(), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
            stderr=subprocess.PIPE, text=True, timeout=30, **SUBPROCESS_EXTRA_KWARGS).strip()
        return float(out) if out else 0.0
    except Exception as e:
        print(f"[engine] probe_media_duration error: {e}")
        return 0.0

LOCAL_ALLOWED_ORIGINS = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

@app.middleware("http")
async def add_cors_and_pna_headers(request: Request, call_next):
    # Handle Chromium Private Network Access (PNA) preflights
    if request.method == "OPTIONS" and request.headers.get("access-control-request-private-network"):
        response = JSONResponse(content={})
        response.headers["Access-Control-Allow-Origin"] = request.headers.get("origin", "*")
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

# Base directory detection (handles PyInstaller standalone .exe as well as dev script)
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
    # PyInstaller extracted temp folder for internal assets
    MEIPASS_DIR = getattr(sys, '_MEIPASS', BASE_DIR)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    MEIPASS_DIR = BASE_DIR

BIN_DIR = os.path.join(BASE_DIR, "bin")
if not os.path.exists(BIN_DIR) and os.path.exists(os.path.join(MEIPASS_DIR, "bin")):
    BIN_DIR = os.path.join(MEIPASS_DIR, "bin")

if os.path.exists(BIN_DIR):
    os.environ["PATH"] = BIN_DIR + os.pathsep + os.environ.get("PATH", "")

# Writable data location: the installed app lives in a read-only folder (e.g. Program Files),
# so a packaged build keeps temp files, exports, keys and settings in the user profile.
if getattr(sys, 'frozen', False):
    _data_base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    DATA_DIR = os.path.join(_data_base, "Kadr")
    _legacy_dir = os.path.join(_data_base, "CapShorts")      # folder used before the app was renamed
    if not os.path.exists(DATA_DIR) and os.path.isdir(_legacy_dir):
        try:
            os.rename(_legacy_dir, DATA_DIR)
        except OSError:
            DATA_DIR = _legacy_dir                           # locked or read-only: keep working in the old folder
else:
    DATA_DIR = BASE_DIR
os.makedirs(DATA_DIR, exist_ok=True)

# A packaged (windowed) build has no console, so everything printed would be lost: keep a log file instead.
if getattr(sys, 'frozen', False):
    try:
        _log_path = os.path.join(DATA_DIR, "engine.log")
        if os.path.exists(_log_path) and os.path.getsize(_log_path) > 5 * 1024 * 1024:
            os.remove(_log_path)
        _log_file = open(_log_path, "a", encoding="utf-8", buffering=1)
        sys.stdout = _log_file
        sys.stderr = _log_file
    except OSError:
        pass

def setup_fontconfig():
    """
    FFmpeg's subtitle renderer (libass) finds fonts through fontconfig, and the bundled FFmpeg has no config,
    so it silently drew every style in a fallback font. Point it at our bundled fonts plus the system fonts.
    """
    try:
        fonts_dirs = []
        for candidate in (os.path.join(BASE_DIR, "fonts"), os.path.join(MEIPASS_DIR, "fonts"),
                          os.path.join(BASE_DIR, "..", "frontend", "public", "fonts")):
            candidate = os.path.normpath(candidate)
            if os.path.isdir(candidate) and candidate not in fonts_dirs:
                fonts_dirs.append(candidate)
        if sys.platform == "win32":
            fonts_dirs.append(os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts"))
        elif sys.platform == "darwin":
            fonts_dirs += ["/System/Library/Fonts", "/Library/Fonts", os.path.expanduser("~/Library/Fonts")]
        else:
            fonts_dirs += ["/usr/share/fonts", os.path.expanduser("~/.fonts")]
        cache_dir = os.path.join(DATA_DIR, "fontcache")
        os.makedirs(cache_dir, exist_ok=True)
        dirs_xml = "".join(f"  <dir>{d.replace(chr(92), '/')}</dir>\n" for d in fonts_dirs)
        conf = (
            '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n'
            + dirs_xml + f"  <cachedir>{cache_dir.replace(chr(92), '/')}</cachedir>\n</fontconfig>\n"
        )
        conf_path = os.path.join(DATA_DIR, "fonts.conf")
        with open(conf_path, "w", encoding="utf-8") as f:
            f.write(conf)
        os.environ["FONTCONFIG_FILE"] = conf_path
    except Exception as font_err:
        print(f"[engine] font setup skipped: {font_err}")

TEMP_DIR = os.path.join(DATA_DIR, "temp")
OUTPUT_DIR = os.path.join(DATA_DIR, "outputs")
MEDIA_DIR = os.path.join(DATA_DIR, "media")
ENV_FILE = os.path.join(DATA_DIR, ".env")
os.makedirs(TEMP_DIR, exist_ok=True)
setup_fontconfig()
os.makedirs(OUTPUT_DIR, exist_ok=True)

def get_safe_contained_path(base_dir: str, filename: str) -> str:
    """
    Validates and resolves a file path strictly within base_dir.
    Rejects directory traversal sequences, embedded null bytes, and absolute path escapes.
    """
    if not filename or not isinstance(filename, str):
        raise HTTPException(status_code=400, detail="Filename cannot be empty")

    target = fu.contained_path(base_dir, filename)
    if target is None:
        raise HTTPException(status_code=400, detail="Path traversal forbidden")
    return target

def verify_loopback_request(request: Request):
    """Ensures caller is strictly local machine loopback."""
    client_host = request.client.host if request.client else ""
    allowed_hosts = {"127.0.0.1", "::1", "localhost"}
    if os.environ.get("CAPSHORTS_TESTING") == "1":
        allowed_hosts.add("testclient")
    if client_host not in allowed_hosts:
        raise HTTPException(status_code=403, detail="Remote network access forbidden. Local loopback only.")

# Asynchronous Tasks, Concurrency Control & Thread Locks
MAX_CONCURRENT_EXPORTS = max(1, min(4, (os.cpu_count() or 2) - 1))
EXPORT_SEMAPHORE = threading.Semaphore(MAX_CONCURRENT_EXPORTS)
MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024  # 4 GB streaming ceiling
TASK_TTL_SECONDS = 1800  # 30 minutes
MAX_TASK_ENTRIES = 200

EXPORT_TASKS: Dict[str, Dict[str, Any]] = {}
TRANSCRIBE_JOBS: Dict[str, Dict[str, Any]] = {}
YOUTUBE_JOBS: Dict[str, Dict[str, Any]] = {}
MODEL_LOAD_LOCK = threading.Lock()
TRANSCRIBE_LOCK = threading.Lock()
TASKS_LOCK = threading.Lock()

def update_task_state(task_dict: Dict[str, Dict[str, Any]], task_id: str, new_fields: Dict[str, Any]):
    """
    Safely updates a task dictionary while strictly preserving _created_at timestamp
    and recording _completed_at timestamp for terminal states.
    """
    with TASKS_LOCK:
        now = time.time()
        existing = task_dict.get(task_id, {})
        created_at = existing.get("_created_at") or new_fields.get("_created_at") or now
        merged = {**existing, **new_fields, "_created_at": created_at}
        status = str(merged.get("status", "")).lower()
        if any(term in status for term in ("completed", "failed", "error")) and "_completed_at" not in merged:
            merged["_completed_at"] = now
        task_dict[task_id] = merged

def prune_stale_tasks(task_dict: Dict[str, Dict[str, Any]]):
    """
    Evicts terminal tasks older than TASK_TTL_SECONDS (30 mins).
    Active jobs (processing/encoding/rendering/starting) are NEVER evicted.
    Enforces MAX_TASK_ENTRIES cap by evicting oldest terminal tasks first.
    """
    with TASKS_LOCK:
        now = time.time()
        stale_keys = []
        for tid, info in list(task_dict.items()):
            status = str(info.get("status", "")).lower()
            is_active = any(s in status for s in ("processing", "encoding", "rendering", "starting", "queued"))
            if is_active:
                continue
            completion_time = info.get("_completed_at") or info.get("_created_at") or now
            if (now - completion_time) > TASK_TTL_SECONDS:
                stale_keys.append(tid)

        for k in stale_keys:
            task_dict.pop(k, None)

        if len(task_dict) > MAX_TASK_ENTRIES:
            terminal_keys = [
                k for k, v in task_dict.items()
                if not any(s in str(v.get("status", "")).lower() for s in ("processing", "encoding", "rendering", "starting", "queued"))
            ]
            terminal_keys.sort(key=lambda k: task_dict[k].get("_completed_at") or task_dict[k].get("_created_at") or 0)
            excess = len(task_dict) - MAX_TASK_ENTRIES
            for k in terminal_keys[:excess]:
                task_dict.pop(k, None)

class WordItem(BaseModel):
    start: float = Field(ge=0.0)
    end: float = Field(ge=0.0)
    word: str = Field(min_length=0)
    keyword: Optional[bool] = False
    confidence: Optional[float] = None

    @model_validator(mode="after")
    def validate_word_timestamps(self):
        if self.end < self.start:
            raise ValueError("Word 'end' timestamp must be greater than or equal to 'start'")
        return self

# High-impact viral keywords for auto-highlighting
VIRAL_KEYWORDS = {
    "money", "millions", "billion", "dollars", "secret", "secrets", "crazy", "insane",
    "stop", "never", "hack", "boost", "revenue", "viral", "profit", "game-changer",
    "rule", "warning", "win", "free", "ai", "supercharge", "strategy", "10x", "automate",
    "crypto", "power", "cash", "grow", "rich", "mistake", "truth", "unlock", "future",
    "system", "fast", "simple", "easy", "step", "first", "millionaire", "results"
}

# Whisper Model Cache
WHISPER_MODELS: Dict[str, Any] = {}

def get_master_groq_keys() -> List[str]:
    """Reads Groq API Keys from .env or environment variables."""
    keys = []
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("GROQ_API_KEYS="):
                        val = line.split("=", 1)[1].strip()
                        for k in val.split(","):
                            clean_k = k.strip()
                            if len(clean_k) > 10:
                                keys.append(clean_k)
                    elif line.startswith("GROQ_API_KEY="):
                        val = line.split("=", 1)[1].strip()
                        if len(val) > 10:
                            keys.append(val)
        except Exception:
            pass

    env_val = os.environ.get("GROQ_API_KEYS") or os.environ.get("GROQ_API_KEY")
    if env_val:
        for k in env_val.split(","):
            clean_k = k.strip()
            if len(clean_k) > 10:
                keys.append(clean_k)

    return list(dict.fromkeys(keys))

def save_master_groq_key(new_key: str):
    """Appends or updates Master Groq Key in .env while preserving all other configuration keys."""
    clean_k = new_key.strip()
    if not clean_k:
        return
    existing = get_master_groq_keys()
    if clean_k not in existing:
        existing.append(clean_k)
    joined = ",".join(existing)

    lines = []
    found_key = False
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("GROQ_API_KEYS="):
                        lines.append(f"GROQ_API_KEYS={joined}\n")
                        found_key = True
                    elif line.startswith("GROQ_API_KEY="):
                        continue
                    else:
                        lines.append(line)
        except Exception:
            pass

    if not found_key:
        lines.append(f"GROQ_API_KEYS={joined}\n")

    temp_env = f"{ENV_FILE}.tmp_{uuid.uuid4().hex[:8]}"
    try:
        with open(temp_env, "w", encoding="utf-8") as f:
            f.writelines(lines)
        try:
            os.chmod(temp_env, 0o600)
        except Exception:
            pass
        os.replace(temp_env, ENV_FILE)
    finally:
        if os.path.exists(temp_env):
            try:
                os.remove(temp_env)
            except Exception:
                pass

def check_ffmpeg() -> bool:
    """Checks whether ffmpeg executable is available in PATH or local directory with timeout."""
    ffmpeg_bin = get_ffmpeg_bin()
    try:
        res = subprocess.run([ffmpeg_bin, "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, **SUBPROCESS_EXTRA_KWARGS)
        return res.returncode == 0
    except (subprocess.TimeoutExpired, Exception):
        alt_paths = [
            r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
            r"C:\ffmpeg\bin\ffmpeg.exe",
            "/opt/homebrew/bin/ffmpeg",
            "/usr/local/bin/ffmpeg",
            os.path.join(BIN_DIR, "ffmpeg.exe"),
            os.path.join(BIN_DIR, "ffmpeg")
        ]
        for p in alt_paths:
            if os.path.exists(p):
                return True
        return False

LOCAL_BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "base")

# UI/API model names -> faster-whisper model ids ("turbo"/"large" no longer silently fall back to base)
LOCAL_MODEL_ALIASES = {"turbo": "large-v3-turbo", "large": "large-v3"}
LOCAL_MODEL_CHOICES = {"tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"}

def get_whisper_model(model_size: str = "base"):
    """Thread-safe loader for faster-whisper model."""
    # Normalize model size for offline faster-whisper engine (preserves large model selection)
    model_size = LOCAL_MODEL_ALIASES.get(model_size, model_size)
    if not model_size or model_size not in LOCAL_MODEL_CHOICES:
        model_size = "base"

    with MODEL_LOAD_LOCK:
        if model_size in WHISPER_MODELS:
            return WHISPER_MODELS[model_size]
        
        try:
            from faster_whisper import WhisperModel
            import ctranslate2
            
            has_cuda = False
            try:
                has_cuda = ctranslate2.get_cuda_device_count() > 0
            except Exception:
                pass
            
            device = "cuda" if has_cuda else "cpu"
            compute_type = "float16" if has_cuda else "int8"
            cpu_threads = min(4, os.cpu_count() or 4)
            
            target_model = LOCAL_BASE_DIR if os.path.exists(LOCAL_BASE_DIR) and model_size == "base" else model_size
            print(f"[engine] Loading Faster-Whisper from '{target_model}' on {device.upper()} ({compute_type}, threads={cpu_threads})...")
            
            model = WhisperModel(target_model, device=device, compute_type=compute_type, cpu_threads=cpu_threads)
            WHISPER_MODELS[model_size] = model
            print("[engine] Faster-Whisper ready in memory!")
            return model
        except Exception as e:
            print(f"[engine] Warning: Faster-Whisper could not be loaded: {e}")
            return None

AUDIO_ENHANCE_FILTER = "highpass=f=80,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11"

def audio_filter_args(enhance: bool) -> List[str]:
    """FFmpeg args that clean up speech before recognition (rumble, noise, uneven loudness)."""
    return ["-af", AUDIO_ENHANCE_FILTER] if enhance else []

def glossary_prompt(glossary: Optional[List[str]]) -> Optional[str]:
    """Builds a Whisper prompt biasing recognition toward user-supplied names/terms."""
    terms = [t.strip() for t in (glossary or []) if t and t.strip()]
    return (", ".join(terms))[:200] or None

def clean_transcript(words: List[Dict[str, Any]], glossary: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Levenshtein-based post-processing: drop junk/loops, fix timings, apply glossary."""
    words = sanitize_words(collapse_repeats(words))
    return apply_glossary(words, glossary) if glossary else words

def tag_keywords(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Tags high-impact words as keywords for styling and B-roll discovery."""
    for item in words:
        clean_w = item["word"].strip().lower().strip(".,!?:;\"'()[]{}")
        if clean_w in VIRAL_KEYWORDS or (len(clean_w) > 3 and clean_w.isupper()):
            item["keyword"] = True
        elif any(char.isdigit() for char in clean_w):
            item["keyword"] = True
        else:
            item["keyword"] = item.get("keyword", False)
    return words

CACHED_HW_ENCODER = None

def detect_hardware_encoder() -> Tuple[str, List[str]]:
    """
    Detects and verifies available GPU hardware video encoders.
    Tries in order:
      1. h264_nvenc (NVIDIA CUDA / RTX)
      2. h264_qsv (Intel QuickSync Video)
      3. h264_amf (AMD Radeon)
      4. h264_mf (Windows MediaFoundation DirectX)
      5. libx264 (CPU fallback)
    """
    global CACHED_HW_ENCODER
    with MODEL_LOAD_LOCK:
        if CACHED_HW_ENCODER is not None:
            return CACHED_HW_ENCODER

        ffmpeg_bin = get_ffmpeg_bin()

        candidates = [
            ("h264_videotoolbox", ["-c:v", "h264_videotoolbox", "-b:v", "6000k"]),
            ("h264_nvenc", ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr"]),
            ("h264_qsv", ["-c:v", "h264_qsv", "-global_quality", "23"]),
            ("h264_amf", ["-c:v", "h264_amf", "-quality", "speed"]),
            ("h264_mf", ["-c:v", "h264_mf", "-rate_control", "cbr", "-b:v", "5000k"]),
            ("libx264", ["-c:v", "libx264", "-preset", "fast", "-crf", "18"]),
        ]

        for name, args in candidates:
            if name == "libx264":
                CACHED_HW_ENCODER = (name, args)
                return CACHED_HW_ENCODER
            try:
                test_cmd = [ffmpeg_bin, "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.05"] + args + ["-f", "null", "-"]
                res = subprocess.run(test_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3, **SUBPROCESS_EXTRA_KWARGS)
                if res.returncode == 0:
                    print(f"[engine] GPU Hardware Encoder verified: {name}")
                    CACHED_HW_ENCODER = (name, args)
                    return CACHED_HW_ENCODER
            except Exception:
                pass

        CACHED_HW_ENCODER = ("libx264", ["-c:v", "libx264", "-preset", "fast", "-crf", "18"])
        return CACHED_HW_ENCODER

@app.get("/api/health")
def health_check():
    """Returns local system diagnostics, hardware acceleration, and engine status."""
    has_cuda = False
    try:
        import ctranslate2
        has_cuda = ctranslate2.get_cuda_device_count() > 0
    except Exception as e:
        print(f"[health] ctranslate2 diagnostic notice: {e}")

    has_whisper = False
    whisper_error = None
    try:
        import faster_whisper
        has_whisper = True
    except Exception as e:
        import traceback
        whisper_error = f"{type(e).__name__}: {e} | " + " > ".join(l.strip() for l in traceback.format_exc().splitlines()[-14:] if l.strip().startswith("File"))[-900:]
        print(f"[health] faster_whisper diagnostic notice: {e}")

    has_ffmpeg = check_ffmpeg()
    master_keys = get_master_groq_keys()
    hw_name, _ = detect_hardware_encoder()

    return {
        "status": "online",
        "device": "CUDA (NVIDIA GPU)" if has_cuda else "CPU (CTranslate2 Multi-Threaded)",
        "cuda_available": has_cuda,
        "whisper_available": has_whisper,
        "whisper_error": whisper_error,
        "ffmpeg_available": has_ffmpeg,
        "hardware_encoder": hw_name,
        "master_groq_active": len(master_keys) > 0,
        "master_keys_count": len(master_keys),
        "active_models": list(WHISPER_MODELS.keys())
    }

def get_audio_duration_wave(wav_path: str) -> float:
    """Gets audio duration in seconds quickly via standard wave header."""
    try:
        with wave.open(wav_path, 'rb') as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            return frames / float(rate)
    except Exception:
        return 0.0

def run_transcribe_job(
    task_id: str,
    target_video: str,
    model: str,
    language: Optional[str],
    groq_api_key: Optional[str] = None,
    range_mode: str = "full",
    glossary: Optional[List[str]] = None,
    enhance_audio: bool = True,
    retry_weak: bool = False
):
    """
    Background worker executing either ultra-fast Groq Cloud AI (~2 seconds)
    with Key Pool Auto-Rotation, or local offline Faster-Whisper.
    """
    ffmpeg_bin = get_ffmpeg_bin()

    # Assemble Key Pool (Client Key + Backend Master Keys)
    key_pool = []
    if groq_api_key and len(groq_api_key.strip()) > 10:
        key_pool.append(groq_api_key.strip())
    key_pool.extend(get_master_groq_keys())
    key_pool = list(dict.fromkeys(key_pool))

    # MODE 1: ULTRA-FAST CLOUD AI WITH KEY POOL ROTATION (CapCut Speed: 2-3 Seconds)
    if key_pool:
        try:
            update_task_state(TRANSCRIBE_JOBS, task_id, {
                "progress": 25,
                "step": "⚡ Turbo Mode: Extracting compressed audio...",
                "status": "processing"
            })
            audio_mp3 = os.path.join(TEMP_DIR, f"audio_turbo_{task_id}.mp3")
            try:
                trim_args = []
                if range_mode == "short_60s":
                    trim_args = ["-t", "60"]
                elif range_mode == "short_180s":
                    trim_args = ["-t", "180"]

                cmd = [
                    ffmpeg_bin, "-y", "-i", target_video
                ] + trim_args + [
                    "-vn"
                ] + audio_filter_args(enhance_audio) + [
                    "-ar", "16000", "-ac", "1", "-b:a", "32k",
                    audio_mp3
                ]
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=900, **SUBPROCESS_EXTRA_KWARGS)

                update_task_state(TRANSCRIBE_JOBS, task_id, {
                    "progress": 55,
                    "step": f"⚡ Turbo Mode: Running Groq Whisper Large-v3 ({len(key_pool)} key pool active)...",
                    "status": "processing"
                })

                audio_seconds = probe_media_duration(audio_mp3)
                audio_bytes = os.path.getsize(audio_mp3) if os.path.exists(audio_mp3) else 0
                if gc.needs_chunking(audio_seconds, audio_bytes):
                    # Long recording: Groq limits the file size, so it is sent in chunks cut at pauses
                    def on_chunk(done: int, total: int):
                        update_task_state(TRANSCRIBE_JOBS, task_id, {
                            "progress": 55 + int(30 * done / max(1, total)),
                            "step": f"⚡ Cloud: transcribing part {min(done + 1, total)} of {total}...",
                            "status": "processing"
                        })
                    words_result, dur, detected_lang = gc.run_chunked(
                        audio_mp3, audio_seconds, ffmpeg_bin, key_pool, language, glossary_prompt(glossary),
                        TEMP_DIR, task_id, progress=on_chunk)
                else:
                    words_result, dur, detected_lang = transcribe_with_groq_pool(audio_mp3, key_pool, language, prompt=glossary_prompt(glossary))
                words_result = tag_keywords(clean_transcript(words_result, glossary))

                update_task_state(TRANSCRIBE_JOBS, task_id, {
                    "progress": 90,
                    "step": "⚡ Generating viral shorts & highlight clips...",
                    "status": "processing"
                })

                video_dur = dur if dur > 0 else (words_result[-1]["end"] if words_result else 60.0)
                clips_result = detect_viral_clips(words_result, video_dur, api_keys=key_pool)

                update_task_state(TRANSCRIBE_JOBS, task_id, {
                    "progress": 100,
                    "step": f"Complete in ~4s! Extracted {len(words_result)} words and {len(clips_result)} viral clips.",
                    "status": "completed",
                    "words": words_result,
                    "clips": clips_result,
                    "duration": video_dur,
                    "language": detected_lang,
                    "video_path": target_video
                })
                return
            finally:
                if os.path.exists(audio_mp3):
                    try:
                        os.remove(audio_mp3)
                    except Exception:
                        pass

        except Exception as e:
            print(f"[engine] Cloud Turbo pool exhausted, falling back to local CPU: {e}")
            update_task_state(TRANSCRIBE_JOBS, task_id, {
                "progress": 30,
                "step": "Cloud busy or exhausted. Automatically switching to Local AI...",
                "status": "processing"
            })

    # MODE 2: LOCAL OFFLINE WHISPER ON CPU/GPU
    with TRANSCRIBE_LOCK:
        try:
            update_task_state(TRANSCRIBE_JOBS, task_id, {
                "progress": 15,
                "step": "Extracting audio with FFmpeg...",
                "status": "processing"
            })

            audio_wav = os.path.join(TEMP_DIR, f"audio_{task_id}.wav")
            trim_args = []
            if range_mode == "short_60s":
                trim_args = ["-t", "60"]
            elif range_mode == "short_180s":
                trim_args = ["-t", "180"]

            if check_ffmpeg():
                cmd = [
                    ffmpeg_bin, "-y", "-i", target_video
                ] + trim_args + audio_filter_args(enhance_audio) + [
                    "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
                    audio_wav
                ]
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, **SUBPROCESS_EXTRA_KWARGS)
            else:
                audio_wav = target_video

            audio_duration = get_audio_duration_wave(audio_wav)
            total_sec = int(audio_duration) if audio_duration > 0 else 60

            update_task_state(TRANSCRIBE_JOBS, task_id, {
                "progress": 25,
                "step": f"Audio extracted ({total_sec//60:02d}:{total_sec%60:02d}). Starting Whisper CPU...",
                "status": "processing"
            })

            update_task_state(TRANSCRIBE_JOBS, task_id, {
                "progress": 26,
                "step": "Loading speech model (the first run downloads it, large models are ~1.5 GB)...",
                "status": "processing"
            })
            whisper_engine = get_whisper_model(model)
            words_result = []
            detected_lang = None
            detected_prob = None
            weak_ranges: List[Tuple[float, float]] = []

            if whisper_engine and os.path.exists(audio_wav):
                is_roman = (language in ["urdu", "ur", "roman", "roman_urdu"])
                if language in ["ur_script", "urdu_script"]:
                    whisper_lang = "ur"
                elif is_roman:
                    whisper_lang = "hi"
                else:
                    whisper_lang = language if language and language != "auto" else None

                segments, info = whisper_engine.transcribe(
                    audio_wav,
                    word_timestamps=True,
                    beam_size=5,
                    language=whisper_lang,
                    vad_filter=True,
                    condition_on_previous_text=False,
                    initial_prompt=glossary_prompt(glossary),
                    language_detection_segments=3,
                    language_detection_threshold=0.5
                )
                detected_lang = getattr(info, "language", None)
                detected_prob = getattr(info, "language_probability", None)

                actual_dur = audio_duration if audio_duration > 0 else 60.0

                for segment in segments:
                    if actual_dur > 0:
                        current_sec = int(segment.end)
                        pct = min(92, 25 + int((segment.end / actual_dur) * 65))
                        update_task_state(TRANSCRIBE_JOBS, task_id, {
                            "progress": pct,
                            "step": f"Transcribing speech: {current_sec//60:02d}:{current_sec%60:02d} / {int(actual_dur)//60:02d}:{int(actual_dur)%60:02d} ({pct}%)...",
                            "status": "processing"
                        })

                    seg_words = []
                    if segment.words:
                        for w in segment.words:
                            seg_words.append({
                                "start": round(w.start, 2),
                                "end": round(w.end, 2),
                                "word": w.word.strip(),
                                "keyword": False,
                                "confidence": round(float(w.probability), 2) if getattr(w, "probability", None) is not None else None
                            })
                    else:
                        seg_words.append({
                            "start": round(segment.start, 2),
                            "end": round(segment.end, 2),
                            "word": segment.text.strip(),
                            "keyword": False,
                            "confidence": aq.logprob_to_confidence(getattr(segment, "avg_logprob", None))
                        })
                    words_result.extend(seg_words)
                    if aq.is_weak_segment(getattr(segment, "avg_logprob", None),
                                          getattr(segment, "compression_ratio", None),
                                          getattr(segment, "no_speech_prob", None), seg_words):
                        weak_ranges.append((float(segment.start), float(segment.end)))

                # Second pass: re-run only the doubtful parts with a larger model
                if retry_weak and weak_ranges and words_result and LOCAL_MODEL_ALIASES.get(model, model) not in ("large-v3", "large-v3-turbo"):
                    ranges = aq.limit_retry_ranges(aq.merge_ranges(weak_ranges, total=actual_dur), actual_dur)
                    big_model = get_whisper_model("turbo") if ranges else None
                    if big_model:
                        retry_lang = whisper_lang or detected_lang
                        for idx, (r_start, r_end) in enumerate(ranges):
                            update_task_state(TRANSCRIBE_JOBS, task_id, {
                                "progress": 93,
                                "step": f"Re-checking uncertain parts with the large model ({idx + 1}/{len(ranges)})...",
                                "status": "processing"
                            })
                            chunk_path = os.path.join(TEMP_DIR, f"retry_{task_id}_{idx}.wav")
                            try:
                                subprocess.run(
                                    [ffmpeg_bin, "-y", "-ss", str(r_start), "-t", str(max(0.5, r_end - r_start)), "-i", audio_wav,
                                     "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", chunk_path],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, **SUBPROCESS_EXTRA_KWARGS)
                                if not os.path.exists(chunk_path):
                                    continue
                                re_segments, _ = big_model.transcribe(
                                    chunk_path, word_timestamps=True, beam_size=5, language=retry_lang,
                                    vad_filter=True, condition_on_previous_text=False,
                                    initial_prompt=glossary_prompt(glossary))
                                new_words = []
                                for rs in re_segments:
                                    for w in (rs.words or []):
                                        new_words.append({
                                            "start": round(w.start + r_start, 2),
                                            "end": round(w.end + r_start, 2),
                                            "word": w.word.strip(),
                                            "keyword": False,
                                            "confidence": round(float(w.probability), 2)
                                        })
                                if new_words:
                                    words_result = aq.replace_range(words_result, r_start, r_end, new_words)
                            except Exception as retry_err:
                                print(f"[engine] weak-segment retry skipped: {retry_err}")
                            finally:
                                if os.path.exists(chunk_path):
                                    try:
                                        os.remove(chunk_path)
                                    except Exception:
                                        pass

            if not words_result:
                raise RuntimeError("No speech could be extracted from this audio file. Please check audio volume and quality.")

            if language in ["urdu", "ur", "roman", "roman_urdu"]:
                words_result = transliterate_transcript(words_result)

            words_result = tag_keywords(clean_transcript(words_result, glossary))

            update_task_state(TRANSCRIBE_JOBS, task_id, {
                "progress": 95,
                "step": "Detecting viral shorts & clips (Opus Clip Engine)...",
                "status": "processing"
            })

            video_duration = words_result[-1]["end"] if words_result else (audio_duration or 60.0)
            available_keys = key_pool if key_pool else get_master_groq_keys()
            clips_result = detect_viral_clips(words_result, video_duration, api_keys=available_keys)

            update_task_state(TRANSCRIBE_JOBS, task_id, {
                "progress": 100,
                "step": f"Complete! Extracted {len(words_result)} words and {len(clips_result)} viral clips.",
                "status": "completed",
                "words": words_result,
                "clips": clips_result,
                "duration": video_duration,
                "language": detected_lang,
                "language_probability": round(float(detected_prob), 2) if detected_prob is not None else None,
                "video_path": os.path.basename(target_video)
            })
            try:
                telemetry.record_transcribe()
            except Exception:
                pass

        except Exception as e:
            print(f"[engine] Transcribe job error: {e}")
            err_msg = str(e) if "No speech could be extracted" in str(e) else "Transcription failed. Please check audio quality and format."
            update_task_state(TRANSCRIBE_JOBS, task_id, {
                "progress": 100,
                "step": err_msg,
                "status": "failed",
                "error": err_msg,
                "words": [],
                "clips": []
            })
        finally:
            prune_stale_tasks(TRANSCRIBE_JOBS)
            if audio_wav and os.path.exists(audio_wav) and audio_wav != target_video:
                try:
                    os.remove(audio_wav)
                except Exception:
                    pass

def save_upload_file_capped(upload_file: UploadFile, destination_path: str, max_bytes: int = MAX_UPLOAD_BYTES):
    """Safely streams upload file to destination up to max_bytes cap, cleaning up on overflow."""
    total_written = 0
    buffer = None
    try:
        buffer = open(destination_path, "wb")
        while True:
            chunk = upload_file.file.read(1024 * 1024)
            if not chunk:
                break
            total_written += len(chunk)
            if total_written > max_bytes:
                buffer.close()
                buffer = None
                try:
                    os.remove(destination_path)
                except Exception:
                    pass
                raise HTTPException(status_code=413, detail=f"File exceeds maximum allowed upload size ({max_bytes // (1024 * 1024 * 1024)} GB)")
            buffer.write(chunk)
    except HTTPException:
        raise
    except Exception:
        if buffer and not buffer.closed:
            buffer.close()
        try:
            os.remove(destination_path)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Failed to save uploaded video file")
    finally:
        if buffer and not buffer.closed:
            buffer.close()

@app.post("/api/transcribe")
def start_transcription(
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(None),
    video_path: Optional[str] = Form(None),
    model: str = Form("base"),
    language: Optional[str] = Form(None),
    groq_api_key: Optional[str] = Form(None),
    range_mode: str = Form("full"),
    glossary: Optional[str] = Form(None),
    enhance_audio: str = Form("1"),
    retry_weak: str = Form("0")
):
    """
    Begins transcribing video speech and extracting viral shorts via threadpool background worker.
    Automatically utilizes Master Key pool or user-supplied key for CapCut speed.
    """
    prune_stale_tasks(TRANSCRIBE_JOBS)
    task_id = str(uuid.uuid4())[:8]
    target_video = None

    if file:
        file_ext = os.path.splitext(file.filename or ".mp4")[1]
        target_video = os.path.join(TEMP_DIR, f"input_{task_id}{file_ext}")
        save_upload_file_capped(file, target_video)
    elif video_path:
        target_video = resolve_video_file(video_path)
    else:
        raise HTTPException(status_code=400, detail="No video file or video_path provided")

    update_task_state(TRANSCRIBE_JOBS, task_id, {
        "progress": 5,
        "step": "Video uploaded. Initializing audio pipeline...",
        "status": "processing"
    })

    background_tasks.add_task(
        run_transcribe_job,
        task_id,
        target_video,
        model,
        language,
        groq_api_key,
        range_mode,
        [t.strip() for t in re.split(r"[,\n]", glossary) if t.strip()] if glossary else None,
        enhance_audio.strip().lower() in ("1", "true", "yes", "on"),
        retry_weak.strip().lower() in ("1", "true", "yes", "on")
    )
    return {"status": "started", "task_id": task_id, "video_path": os.path.basename(target_video)}

@app.post("/api/upload-video")
def upload_video_file(file: UploadFile = File(...)):
    """Receives and caches video file on server for editing and export in threadpool."""
    task_id = str(uuid.uuid4())[:8]
    clean_name = os.path.basename((file.filename or "video.mp4").strip().replace("\\", "/"))
    file_ext = os.path.splitext(clean_name)[1] or ".mp4"
    target_video = os.path.join(TEMP_DIR, f"input_{task_id}{file_ext}")
    save_upload_file_capped(file, target_video)
    return {
        "status": "success",
        "video_path": os.path.basename(target_video),
        "filename": clean_name
    }

@app.get("/api/transcribe/progress/{task_id}")
def get_transcribe_progress(task_id: str):
    """Returns live percentage progress, status step, and result when completed."""
    if task_id not in TRANSCRIBE_JOBS:
        raise HTTPException(status_code=404, detail="Transcription task not found")
    return TRANSCRIBE_JOBS[task_id]

class MasterKeyPayload(BaseModel):
    key: str

@app.post("/api/settings/master-key", dependencies=[Depends(verify_loopback_request)])
def save_master_key_api(payload: MasterKeyPayload):
    """Saves a new Master Groq Key to the server's .env pool."""
    save_master_groq_key(payload.key)
    active_keys = get_master_groq_keys()
    return {"status": "success", "master_groq_active": len(active_keys) > 0, "count": len(active_keys)}

class GenerateClipsPayload(BaseModel):
    words: List[WordItem]
    duration: float = Field(ge=0.0)
    min_clip_duration: Optional[float] = Field(default=25.0, gt=0.0)
    max_clip_duration: Optional[float] = Field(default=60.0, gt=0.0)
    # None: as many shorts as the video gives (automatic)
    target_clips_count: Optional[int] = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_durations(self):
        if self.min_clip_duration is not None and self.max_clip_duration is not None:
            if self.max_clip_duration < self.min_clip_duration:
                raise ValueError("max_clip_duration must be greater than or equal to min_clip_duration")
        return self

@app.post("/api/clips/generate")
def generate_clips_endpoint(payload: GenerateClipsPayload):
    """Regenerates viral shorts from given transcript with customized duration parameters."""
    words_dicts = [w.model_dump() if hasattr(w, "model_dump") else (w.dict() if hasattr(w, "dict") else w) for w in payload.words]
    clips = detect_viral_clips(
        words=words_dicts,
        total_duration=payload.duration,
        min_clip_duration=payload.min_clip_duration if payload.min_clip_duration is not None else 25.0,
        max_clip_duration=payload.max_clip_duration if payload.max_clip_duration is not None else 60.0,
        target_clips_count=payload.target_clips_count,
        api_keys=get_master_groq_keys()
    )
    return {"status": "success", "clips": clips,
            "summary": clip_summary(clips, payload.duration, auto=payload.target_clips_count is None)}

@app.get("/api/broll/search")
def broll_search(keyword: str, api_key: Optional[str] = None, x_pexels_key: Optional[str] = Header(None)):
    """Searches vertical stock video clips matching keyword."""
    effective_key = x_pexels_key or api_key
    clips = search_pexels_videos(keyword, api_key=effective_key)
    return {"results": clips}

class ExportPayload(BaseModel):
    video_path: Optional[str] = None
    transcript: List[WordItem]
    preset: Dict[str, Any]
    custom_overrides: Optional[Dict[str, Any]] = None
    broll_clips: Optional[List[Dict[str, Any]]] = None
    output_filename: Optional[str] = "kadr_export.mp4"
    clip_start: Optional[float] = Field(default=None, ge=0.0)
    clip_end: Optional[float] = Field(default=None, ge=0.0)
    resolution: Optional[str] = "1080x1920"
    aspect_ratio: Optional[str] = "9:16"
    # [{"start": s, "end": e, "emoji": "..."}] in source-video seconds: drawn above the subtitles like in the preview
    emojis: Optional[List[Dict[str, Any]]] = None
    # How a landscape video is fitted into a vertical frame: "auto" follows the speaker's face (and falls back to a
    # blurred background when there is no face to follow), "blur" always uses the blurred background.
    framing: Optional[str] = "auto"
    # Hook title over the first seconds: {"text": str, "duration": seconds, "style": "box" | "dark" | "outline"}
    title_overlay: Optional[Dict[str, Any]] = None
    # The edit on the timeline (see timeline_render.py): which parts of the source play, in order, and how
    segments: Optional[List[Dict[str, Any]]] = None
    speed: Optional[float] = 1.0
    volume: Optional[float] = 1.0
    fade_in: Optional[float] = 0.0
    fade_out: Optional[float] = 0.0
    # Extra video layers and sounds: [{"kind": "video"|"audio", "volume", "muted", "items": [{"mediaId"|"path",
    # "start", "duration", "sourceStart", "volume", "x", "y", "scale", "opacity", "fadeIn", "fadeOut"}]}]
    tracks: Optional[List[Dict[str, Any]]] = None

    @model_validator(mode="after")
    def validate_clip_range(self):
        if self.clip_start is not None and self.clip_end is not None:
            if self.clip_end <= self.clip_start:
                raise ValueError("Export 'clip_end' must be strictly greater than 'clip_start'")
        return self

def run_export_job(task_id: str, payload: ExportPayload):
    """Background task executing FFmpeg ASS subtitle burning, clip trimming, dynamic scaling, and B-roll composite."""
    ass_path = None
    reframe_cmd_path = None
    try:
        prune_stale_tasks(EXPORT_TASKS)
        update_task_state(EXPORT_TASKS, task_id, {"progress": 10, "status": "Generating Subtitles (.ass)...", "error": None})

        if not check_ffmpeg():
            raise RuntimeError("FFmpeg is not installed or not found on system PATH. Please install FFmpeg to export videos.")

        transcript_raw = [
            (w.model_dump() if hasattr(w, "model_dump") else (w.dict() if hasattr(w, "dict") else w))
            for w in payload.transcript
        ]
        is_clip_export = payload.clip_start is not None and payload.clip_end is not None and payload.clip_end > payload.clip_start

        if is_clip_export:
            c_start = payload.clip_start
            c_end = payload.clip_end
            shifted = []
            for w in transcript_raw:
                w_start = float(w.get("start", 0.0))
                w_end = float(w.get("end", 0.0))
                if w_end >= c_start and w_start <= c_end:
                    shifted.append({
                        **w,
                        "start": max(0.0, round(w_start - c_start, 2)),
                        "end": max(0.0, round(w_end - c_start, 2))
                    })
            transcript_to_use = shifted
        else:
            transcript_to_use = transcript_raw

        safe_output_name = os.path.basename((payload.output_filename or "kadr_export.mp4").strip().replace("\\", "/"))
        if not safe_output_name.endswith(".mp4"):
            safe_output_name += ".mp4"
        output_file = get_safe_contained_path(OUTPUT_DIR, f"export_{task_id}_{safe_output_name}")
        ffmpeg_bin = get_ffmpeg_bin()

        # Resolve input video safely strictly within approved directories
        if not payload.video_path:
            raise HTTPException(status_code=400, detail="Missing video path for export")
        input_video = resolve_video_file(payload.video_path)

        # Probe input video dimensions
        in_w, in_h = probe_video_dimensions(input_video) if os.path.exists(input_video) else (1080, 1920)

        # Determine target dimensions based on resolution / aspect_ratio
        is_vertical_short = (payload.aspect_ratio == "9:16" or payload.resolution == "1080x1920" or (is_clip_export and payload.aspect_ratio != "16:9"))
        if is_vertical_short:
            target_w, target_h = 1080, 1920
        elif payload.aspect_ratio == "16:9" or payload.resolution == "1920x1080":
            target_w, target_h = (1920, 1080) if in_w >= 1920 else (in_w, in_h)
        elif payload.aspect_ratio == "1:1" or payload.resolution == "1080x1080":
            target_w, target_h = 1080, 1080
        else:
            target_w, target_h = 1080, 1920

        # Generate ASS subtitles matching the target resolution
        ass_content = generate_ass_subtitles(
            transcript=transcript_to_use,
            preset=payload.preset,
            video_width=target_w,
            video_height=target_h,
            custom_overrides=payload.custom_overrides,
            title_overlay=payload.title_overlay,
        )
        ass_path = os.path.join(TEMP_DIR, f"subtitles_{task_id}.ass")
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(ass_content)
        
        update_task_state(EXPORT_TASKS, task_id, {"progress": 30, "status": "Processing Overlays..."})

        downloaded_broll = []
        if payload.broll_clips:
            for c in payload.broll_clips:
                if c.get("enabled", True):
                    v_url = c.get("video_url") or c.get("preview_url")
                    if v_url:
                        local_clip = download_broll_clip(v_url, c.get("id", str(uuid.uuid4())[:6]))
                        if local_clip:
                            start_time = c.get("start", 0.0)
                            end_time = c.get("end", 3.0)
                            if is_clip_export:
                                start_time = max(0.0, start_time - payload.clip_start)
                                end_time = max(0.0, end_time - payload.clip_start)
                            downloaded_broll.append({
                                "local_path": local_clip,
                                "start": start_time,
                                "end": end_time
                            })
        
        update_task_state(EXPORT_TASKS, task_id, {"progress": 50, "status": "Encoding Video with FFmpeg..."})

        escaped_ass = ass_path.replace("\\", "/").replace(":", "\\:")
        
        # The timeline: which source ranges play (cuts), how fast, and the window being exported
        speed = tlr.clamp_speed(payload.speed)
        source_len = probe_media_duration(input_video) or 0.0
        all_ranges = tlr.clean_segments(payload.segments) or [(0.0, source_len or 1e9)]
        has_cuts = not tlr.is_trivial(all_ranges, source_len or None)
        timeline_len = sum(b - a for a, b in all_ranges)
        win_start = payload.clip_start if is_clip_export else 0.0
        win_end = payload.clip_end if is_clip_export else timeline_len
        play_ranges = tlr.timeline_to_source_ranges(all_ranges, win_start, win_end) if has_cuts else [
            (win_start, win_end if is_clip_export else (source_len or win_end))]
        if not play_ranges:
            raise RuntimeError("Nothing to export in this range of the timeline.")
        src_from, src_to = play_ranges[0][0], play_ranges[-1][1]
        out_len = tlr.output_duration(play_ranges, speed)

        trim_args = []
        if is_clip_export or has_cuts:
            trim_args = ["-ss", f"{src_from:.3f}", "-t", f"{max(0.1, src_to - src_from):.3f}"]

        # Captions, emoji and B-roll are timed on the timeline; sped up, they come sooner
        if abs(speed - 1.0) > 0.01:
            transcript_to_use = tlr.scale_times(transcript_to_use, speed)
            for b in downloaded_broll:
                b["start"], b["end"] = b["start"] / speed, b["end"] / speed
            with open(ass_path, "w", encoding="utf-8") as f:
                f.write(generate_ass_subtitles(transcript=transcript_to_use, preset=payload.preset, video_width=target_w,
                                               video_height=target_h, custom_overrides=payload.custom_overrides,
                                               title_overlay=payload.title_overlay))

        is_landscape_input = (in_w > in_h)

        hw_encoder_name, hw_args = detect_hardware_encoder()

        # Ultra-fast cinematic background blur: downscale to 270x480, single light blur pass, scale to 1080x1920 (16x faster render)
        fast_vert_blur = "[bg]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=6:1,scale=1080:1920[bg_b]"

        # Fitting a landscape video into the vertical frame: follow the speaker's face, or a blurred background
        blur_prep = f"[0:v]split=2[fg][bg];{fast_vert_blur};[fg]scale=1080:1920:force_original_aspect_ratio=decrease[fg_s];[bg_b][fg_s]overlay=(W-w)/2:(H-h)/2[vcomp];"
        follow_prep: Optional[str] = None
        framing = "none"
        framing_note: Optional[str] = None
        reframe_cmd_path: Optional[str] = None
        if is_vertical_short and is_landscape_input:
            framing = "blur"
            if (payload.framing or "auto") != "blur":
                update_task_state(EXPORT_TASKS, task_id, {"progress": 40, "status": "Finding the speaker..."})
                span_from, span_to = src_from, src_to
                plan = reframe.plan_reframe(input_video, span_from, span_to, in_w, in_h)
                if plan["mode"] == "follow" and (has_cuts or abs(speed - 1.0) > 0.01):
                    plan["xs"] = tlr.remap_camera_path(plan["xs"], plan["rate"], 0.0,
                                                       [(a - span_from, b - span_from) for a, b in play_ranges], speed, out_len)
                if plan["mode"] == "follow":
                    reframe_cmd_path = os.path.join(TEMP_DIR, f"reframe_{task_id}.txt")
                    with open(reframe_cmd_path, "w", encoding="utf-8") as f:
                        f.write(reframe.sendcmd_text(plan["xs"], plan["rate"]))
                    follow_prep = reframe.follow_filter(reframe_cmd_path, plan["crop_w"], plan["crop_h"], plan["xs"][0]) + ";"
                    framing, framing_note = "follow", "Followed the speaker"
                else:
                    framing_note = f"Used a blurred background ({plan['reason']})"
                print(f"[export] framing: {framing} ({plan.get('reason')}, coverage {plan.get('coverage')})")
                update_task_state(EXPORT_TASKS, task_id, {"progress": 50, "status": "Encoding Video with FFmpeg..."})

        def build_filter_args(vert_prep: str):
            """(extra ffmpeg inputs, filter arguments) for the given vertical-fitting prefix."""
            extra: List[str] = []
            if downloaded_broll:
                extra, filter_chains, last_stream = build_ffmpeg_broll_filter(downloaded_broll)
                if is_vertical_short and is_landscape_input:
                    full_filter = f"{vert_prep}{filter_chains.replace('[0:v]', '[vcomp]')};{last_stream}ass='{escaped_ass}'[vfinal]"
                else:
                    full_filter = f"{filter_chains};{last_stream}ass='{escaped_ass}'[vfinal]"
                return extra, ["-filter_complex", full_filter, "-map", "[vfinal]", "-map", "0:a?"]
            if is_vertical_short and is_landscape_input:
                return extra, ["-filter_complex", f"{vert_prep}[vcomp]ass='{escaped_ass}'[vfinal]", "-map", "[vfinal]", "-map", "0:a?"]
            return extra, ["-vf", f"ass='{escaped_ass}'"]

        extra_inputs, filter_args = build_filter_args(follow_prep or blur_prep)
        blur_filter_args = build_filter_args(blur_prep)[1] if follow_prep else None

        # Emoji above the subtitles (libass cannot draw color emoji, so they are images laid over the video)
        plain_filter_args = list(filter_args)
        emoji_inputs: List[str] = []
        emoji_graph = None
        if payload.emojis:
            try:
                events = tlr.scale_times(eo.shift_events(
                    payload.emojis,
                    payload.clip_start if is_clip_export else None,
                    payload.clip_end if is_clip_export else None,
                ), speed)
                emoji_dir = eo.find_emoji_dir([os.path.join(BASE_DIR, "emoji"), os.path.join(MEIPASS_DIR, "emoji")])
                layout = compute_layout({**payload.preset, **(payload.custom_overrides or {})}, target_w, target_h)
                emoji_inputs, emoji_graph = eo.build_overlay_graph(
                    events, emoji_dir, transcript_to_use, target_w, target_h, layout, 1 + extra_inputs.count("-i"))
                if emoji_graph:
                    filter_args = eo.attach_to_filters(filter_args, emoji_graph)
                else:
                    emoji_inputs = []
            except Exception as emoji_err:
                print(f"[export] emoji overlay skipped: {emoji_err}")
                emoji_inputs, filter_args, emoji_graph = [], plain_filter_args, None

        # Extra tracks (picture in picture, music) and the main sound
        track_items = tlr.clip_items(payload.tracks, win_start, win_end, speed)

        def resolve_item(it: Dict[str, Any]) -> Optional[str]:
            mid = it.get("mediaId")
            if mid:
                found = media_store.find(MEDIA_DIR, str(mid))
                if found:
                    return found
            try:
                return resolve_video_file(it.get("path")) if it.get("path") else None
            except HTTPException:
                return None

        for kind in ("video", "audio"):
            track_items[kind] = [dict(it, file=resolve_item(it)) for it in track_items[kind]]
            missing = [it for it in track_items[kind] if not it["file"]]
            if missing:
                print(f"[export] {len(missing)} {kind} track item(s) skipped: media not found")
            track_items[kind] = [it for it in track_items[kind] if it["file"]]
        main_has_audio = probe_has_audio(input_video)
        fade_in = max(0.0, min(5.0, float(payload.fade_in or 0.0)))
        fade_out = max(0.0, min(5.0, float(payload.fade_out or 0.0)))
        vol = float(payload.volume if payload.volume is not None else 1.0)
        timeline_inputs = tlr.item_inputs(track_items["video"] + track_items["audio"], lambda it: it["file"])

        def apply_timeline(fargs: List[str], inputs_before: int) -> List[str]:
            """The timeline edit on top of one variant of the filters (cuts, speed, layers, fades, sound)."""
            prefix = tlr.video_prefix(play_ranges, src_from, speed, has_cuts)
            needs_audio = main_has_audio and (has_cuts or abs(speed - 1.0) > 0.01 or abs(vol - 1.0) > 0.01 or fade_in or fade_out)
            if not (prefix or track_items["video"] or track_items["audio"] or fade_in or fade_out or needs_audio):
                return fargs
            args = list(fargs)
            if "-vf" in args:                                    # same mapping as the other variants
                i = args.index("-vf")
                args[i:i + 2] = ["-filter_complex", f"[0:v]{args[i + 1]}[vfinal]", "-map", "[vfinal]", "-map", "0:a?"]
            gi = args.index("-filter_complex") + 1
            graph = args[gi]
            if prefix:
                uses = graph.count("[0:v]")
                if uses == 1:
                    graph = f"[0:v]{prefix}[vsrc];" + graph.replace("[0:v]", "[vsrc]")
                elif uses > 1:
                    names = "".join(f"[vsrc{k}]" for k in range(uses))
                    graph = f"[0:v]{prefix},split={uses}{names};" + graph
                    for k in range(uses):
                        graph = graph.replace("[0:v]", f"[vsrc{k}]", 1)
            cut = graph.rfind("[vfinal]")
            graph = graph[:cut] + "[vbase]" + graph[cut + len("[vfinal]"):]
            first_track_input = inputs_before
            graph += ";" + tlr.overlay_graph(track_items["video"], first_track_input, target_w, target_h, "vbase", "vlayers")
            fades = tlr.video_fades(fade_in, fade_out, out_len)
            graph += f";[vlayers]{fades or 'null'}[vfinal]"
            audio_first = first_track_input + len(track_items["video"])
            main_label = None
            if main_has_audio:
                graph += ";[0:a]" + tlr.audio_chain(play_ranges, src_from, speed, has_cuts, vol, fade_in, fade_out, out_len) + "[amain]"
                main_label = "amain"
            if track_items["audio"] or main_label:
                graph += ";" + tlr.audio_mix_graph(track_items["audio"], audio_first, main_label, "aout")
                mi = args.index("0:a?") if "0:a?" in args else -1
                if mi >= 0:
                    args[mi] = "[aout]"
                else:
                    args += ["-map", "[aout]"]
            args[gi] = graph
            if not main_has_audio and track_items["audio"]:
                args += ["-shortest"]
            return args

        def command(inputs: List[str], fargs: List[str]) -> List[str]:
            before = 1 + extra_inputs.count("-i") + inputs.count("-i")
            return ([ffmpeg_bin, "-y"] + trim_args + ["-i", input_video] + extra_inputs + inputs + timeline_inputs
                    + apply_timeline(fargs, before))

        base_cmd = command(emoji_inputs, filter_args)
        cmd = base_cmd + hw_args + ["-c:a", "aac", output_file]

        def run_ffmpeg(full_cmd: List[str], what: str) -> subprocess.CompletedProcess:
            try:
                return subprocess.run(full_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300, **SUBPROCESS_EXTRA_KWARGS)
            except subprocess.TimeoutExpired:
                raise RuntimeError(f"FFmpeg {what} timed out after 300 seconds.")

        proc = run_ffmpeg(cmd, "video render")
        if proc.returncode != 0:
            print(f"[export] FFmpeg error ({hw_encoder_name}): {proc.stderr.decode('utf-8', errors='ignore')}")
            # Fallback to software libx264 if hardware encoder fails during render, retaining all filters & B-roll
            print("[export] Retrying with CPU libx264 fallback...")
            cpu_args = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "20"]
            proc2 = run_ffmpeg(base_cmd + cpu_args + ["-c:a", "aac", output_file], "software fallback")

            # Never lose the render because of an optional layer: drop emoji, then the face-following crop
            retries: List[Tuple[str, List[str], List[str], Optional[str]]] = []
            if emoji_inputs:
                retries.append(("without emoji", [], plain_filter_args, None))
            if follow_prep and blur_filter_args is not None:
                if emoji_graph:
                    retries.append(("blurred background", emoji_inputs, eo.attach_to_filters(blur_filter_args, emoji_graph),
                                    "Used a blurred background (following the speaker failed)"))
                retries.append(("blurred background without emoji", [], blur_filter_args,
                                "Used a blurred background (following the speaker failed)"))
            for label, inputs, fargs, note in retries:
                if proc2.returncode == 0:
                    break
                print(f"[export] FFmpeg error: {proc2.stderr.decode('utf-8', errors='ignore')[-1500:]}")
                print(f"[export] Retrying {label}...")
                proc2 = run_ffmpeg(command(inputs, fargs) + cpu_args + ["-c:a", "aac", output_file], "software fallback")
                if proc2.returncode == 0 and note:
                    framing, framing_note = "blur", note

            if proc2.returncode != 0:
                raise RuntimeError("FFmpeg render failed on both hardware and software encoders.")

        saved_to = None
        save_error = None
        try:
            saved_to = fu.copy_to_folder(output_file, current_export_dir(), fu.clean_filename(payload.output_filename or "kadr_export.mp4"))
        except Exception as copy_err:
            print(f"[export] could not copy result to the export folder: {copy_err}")
            save_error = "Rendered, but could not save to the chosen folder. Use Download instead."

        update_task_state(EXPORT_TASKS, task_id, {
            "progress": 100,
            "status": f"Complete! Video rendered using {hw_encoder_name}.",
            "output_path": output_file,
            "saved_to": saved_to,
            "save_error": save_error,
            "framing": framing,
            "framing_note": framing_note,
            "download_url": f"/api/download/{os.path.basename(output_file)}"
        })
        try:
            telemetry.record_export()
        except Exception:
            pass

    except Exception as e:
        print(f"[export] Job {task_id} failed: {e}")
        import traceback
        print(traceback.format_exc())
        safe_msg = str(e) if isinstance(e, (RuntimeError, ValueError)) else "Video rendering failed during processing or encoding."
        update_task_state(EXPORT_TASKS, task_id, {
            "progress": 100,
            "status": f"Export Error: {safe_msg}",
            "error": safe_msg
        })
    finally:
        EXPORT_SEMAPHORE.release()
        prune_stale_tasks(EXPORT_TASKS)
        try:
            housekeeping()
        except Exception as hk_err:
            print(f"[export] housekeeping skipped: {hk_err}")
        for leftover in (ass_path, reframe_cmd_path):
            if leftover and os.path.exists(leftover):
                try:
                    os.remove(leftover)
                except Exception:
                    pass

@app.get("/api/download/{filename}")
def download_exported_file(filename: str):
    """Serves the rendered MP4 video file directly for download or preview."""
    target_path = get_safe_contained_path(OUTPUT_DIR, filename)
    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail="Exported video file not found")
    
    safe_name = os.path.basename(target_path)
    return FileResponse(
        path=target_path,
        media_type="video/mp4",
        filename=safe_name
    )

class YoutubeUrlPayload(BaseModel):
    url: str

class YoutubeDownloadPayload(BaseModel):
    url: str
    quality: str = "1080"

class YoutubeSettingsPayload(BaseModel):
    download_dir: Optional[str] = None

APP_SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")
LOCAL_ORIGIN_HOSTS = {"localhost", "127.0.0.1", "[::1]", "tauri.localhost"}

def verify_local_origin(request: Request):
    """Blocks browser pages from other sites (CORS is open) from changing settings or writing files."""
    origin = request.headers.get("origin")
    if origin and origin != "null":
        host = urllib.parse.urlparse(origin).hostname or ""
        if host not in LOCAL_ORIGIN_HOSTS and f"[{host}]" not in LOCAL_ORIGIN_HOSTS:
            raise HTTPException(status_code=403, detail="Forbidden origin")
    elif origin == "null":
        raise HTTPException(status_code=403, detail="Forbidden origin")

def load_app_settings() -> Dict[str, Any]:
    try:
        with open(APP_SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def current_download_dir() -> str:
    """Saved download folder if still valid, otherwise the user's Downloads folder."""
    try:
        return yt.resolve_download_dir(load_app_settings().get("youtube_download_dir"))
    except ValueError:
        return yt.default_download_dir()

@app.get("/api/youtube/settings")
def youtube_get_settings():
    return {"download_dir": current_download_dir(), "default_dir": yt.default_download_dir()}

@app.post("/api/youtube/settings", dependencies=[Depends(verify_loopback_request), Depends(verify_local_origin)])
def youtube_set_settings(payload: YoutubeSettingsPayload):
    """Saves the folder YouTube downloads go to (empty = Downloads folder)."""
    try:
        folder = yt.resolve_download_dir(payload.download_dir)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    settings = load_app_settings()
    settings["youtube_download_dir"] = folder
    with open(APP_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
    return {"download_dir": folder}

def current_export_dir() -> str:
    """Folder finished exports are copied to: saved setting if valid, else the Downloads folder."""
    try:
        return yt.resolve_download_dir(load_app_settings().get("export_dir"))
    except ValueError:
        return yt.default_download_dir()

@app.get("/api/export/settings")
def export_get_settings():
    return {"export_dir": current_export_dir(), "default_dir": yt.default_download_dir()}

@app.post("/api/export/settings", dependencies=[Depends(verify_loopback_request), Depends(verify_local_origin)])
def export_set_settings(payload: YoutubeSettingsPayload):
    """Saves the folder exports are copied to (empty = Downloads folder)."""
    try:
        folder = yt.resolve_download_dir(payload.download_dir)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    settings = load_app_settings()
    settings["export_dir"] = folder
    with open(APP_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
    return {"export_dir": folder}

def open_in_file_manager(path: str) -> None:
    """Shows a folder in Explorer / Finder / the default file manager."""
    if sys.platform == "win32":
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])

class KeepMediaPayload(BaseModel):
    video_path: str

@app.post("/api/media/keep", dependencies=[Depends(verify_loopback_request), Depends(verify_local_origin)])
def keep_media(payload: KeepMediaPayload):
    """Keeps the uploaded video for a saved project so it can be reopened without choosing the file again."""
    src = fu.contained_path(TEMP_DIR, payload.video_path)
    if not src or not os.path.isfile(src):
        raise HTTPException(status_code=404, detail="Video not found")
    try:
        return {"media_id": media_store.keep(MEDIA_DIR, src)}
    except OSError as e:
        print(f"[media] could not keep the video: {e}")
        raise HTTPException(status_code=507, detail="Could not store the video")

@app.get("/api/media/{media_id}", dependencies=[Depends(verify_loopback_request), Depends(verify_local_origin)])
def get_media(media_id: str):
    """Returns a video kept by a saved project."""
    path = media_store.find(MEDIA_DIR, media_id)
    if not path:
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(path)

@app.post("/api/export/open-folder", dependencies=[Depends(verify_loopback_request), Depends(verify_local_origin)])
def export_open_folder():
    """Opens the folder finished exports are saved to (only that folder, never a path from the request)."""
    folder = current_export_dir()
    try:
        os.makedirs(folder, exist_ok=True)
        open_in_file_manager(folder)
    except Exception as e:
        print(f"[export] could not open folder: {e}")
        raise HTTPException(status_code=500, detail="Could not open the folder")
    return {"opened": folder}

def housekeeping():
    """Deletes stale working files so temp/exports do not pile up (only our own prefixed files)."""
    media_store.prune(MEDIA_DIR)
    fu.cleanup_old_files(OUTPUT_DIR, ("export_", "kadr_subtitles_", "capshorts_subtitles_"), 24 * 3600)
    fu.cleanup_old_files(TEMP_DIR, ("audio_", "subtitles_", "retry_", "concat_"), 24 * 3600)
    fu.cleanup_old_files(TEMP_DIR, ("input_",), 7 * 24 * 3600)

def _ffmpeg_dir() -> Optional[str]:
    ffmpeg = get_ffmpeg_bin()
    return os.path.dirname(ffmpeg) if os.path.isabs(ffmpeg) else None

@app.post("/api/youtube/info")
def youtube_info(payload: YoutubeUrlPayload):
    """Returns title/duration/thumbnail for a YouTube link without downloading."""
    try:
        return yt.fetch_info(payload.url, _ffmpeg_dir())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[youtube] info error: {e}")
        raise HTTPException(status_code=502, detail=yt.explain_error(e))

YOUTUBE_FILES: Dict[str, str] = {}

def run_youtube_job(task_id: str, url: str, quality: str, out_dir: str):
    try:
        def on_progress(pct: int, step: str):
            update_task_state(YOUTUBE_JOBS, task_id, {"progress": pct, "step": step, "status": "processing"})
        file_path = yt.download_video(url, out_dir, quality, on_progress, _ffmpeg_dir())
        YOUTUBE_FILES[task_id] = file_path
        update_task_state(YOUTUBE_JOBS, task_id, {
            "progress": 100, "step": "Download complete", "status": "completed",
            "saved_to": file_path, "file_name": os.path.basename(file_path)
        })
    except ValueError as e:
        update_task_state(YOUTUBE_JOBS, task_id, {"progress": 0, "step": str(e), "status": "error", "error": str(e)})
    except Exception as e:
        print(f"[youtube] download error: {e}")
        update_task_state(YOUTUBE_JOBS, task_id, {
            "progress": 0, "step": "Download failed", "status": "error",
            "error": yt.explain_error(e)
        })

@app.post("/api/youtube/download", dependencies=[Depends(verify_loopback_request), Depends(verify_local_origin)])
def youtube_download(payload: YoutubeDownloadPayload, background_tasks: BackgroundTasks):
    """Starts a background download into the chosen folder (default: Downloads); poll /api/youtube/progress/{id}."""
    try:
        url = yt.validate_youtube_url(payload.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    out_dir = current_download_dir()
    prune_stale_tasks(YOUTUBE_JOBS)
    task_id = str(uuid.uuid4())[:8]
    update_task_state(YOUTUBE_JOBS, task_id, {"progress": 1, "step": "Starting download...", "status": "processing"})
    background_tasks.add_task(run_youtube_job, task_id, url, payload.quality, out_dir)
    return {"status": "started", "task_id": task_id, "download_dir": out_dir}

@app.get("/api/youtube/progress/{task_id}")
def youtube_progress(task_id: str):
    if task_id not in YOUTUBE_JOBS:
        raise HTTPException(status_code=404, detail="Download task not found")
    return YOUTUBE_JOBS[task_id]

@app.get("/api/youtube/file/{task_id}")
def youtube_file(task_id: str):
    """Streams the file downloaded by this session's task so the editor can open it (nothing is copied to temp)."""
    path = YOUTUBE_FILES.get(task_id)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Downloaded file not found")
    return FileResponse(path=path, media_type="video/mp4", filename=os.path.basename(path))

class ScriptConvertPayload(BaseModel):
    words: List[WordItem]
    target_script: str  # "roman_urdu" | "english"

@app.post("/api/transcript/convert-script")
def convert_script(payload: ScriptConvertPayload):
    """Converts existing transcript words into Roman Urdu or clean English on the fly."""
    words_dicts = [w.model_dump() if hasattr(w, "model_dump") else (w.dict() if hasattr(w, "dict") else w) for w in payload.words]
    if payload.target_script in ["roman_urdu", "roman"]:
        converted = transliterate_transcript(words_dicts)
        return {"words": converted}
    return {"words": words_dicts}

class AlignPayload(BaseModel):
    words: List[WordItem]
    text: str

class GlossaryPayload(BaseModel):
    words: List[WordItem]
    glossary: List[str]
    threshold: float = Field(default=0.25, ge=0.0, le=0.6)

def _dump_words(words) -> List[Dict[str, Any]]:
    return [w.model_dump() for w in words]

@app.post("/api/transcript/align")
def align_transcript(payload: AlignPayload):
    """Re-times an edited/pasted script onto the existing word timings (token-level Levenshtein alignment)."""
    return {"words": fix_durations(align_words(_dump_words(payload.words), payload.text))}

@app.post("/api/transcript/glossary")
def glossary_transcript(payload: GlossaryPayload):
    """Fuzzy-replaces misheard words with user glossary terms (normalized Levenshtein)."""
    return {"words": apply_glossary(_dump_words(payload.words), payload.glossary, payload.threshold)}

def probe_has_audio(path: str) -> bool:
    """Whether the file has an audio stream (filters must not ask for one that is not there)."""
    try:
        out = subprocess.run([get_ffprobe_bin(), "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                              "-of", "csv=p=0", path], capture_output=True, text=True, timeout=30, **SUBPROCESS_EXTRA_KWARGS)
        return bool(out.stdout.strip())
    except Exception:
        return True

def resolve_video_file(path: Optional[str]) -> str:
    """Helper to resolve a video file path safely strictly within approved directories (TEMP_DIR, OUTPUT_DIR)."""
    if not path or not isinstance(path, str):
        raise HTTPException(status_code=400, detail="Missing video path")
    clean_name = os.path.basename(path.strip().replace("\\", "/"))
    if not clean_name:
        raise HTTPException(status_code=400, detail="Invalid video path")
    for d in [TEMP_DIR, OUTPUT_DIR]:
        cand = get_safe_contained_path(d, clean_name)
        if os.path.exists(cand):
            return cand
    raise HTTPException(status_code=404, detail="Video file not found")

class ReframePlanPayload(BaseModel):
    video_path: str
    start: float = Field(ge=0.0)
    end: float = Field(gt=0.0)

REFRAME_PLAN_CACHE: Dict[Tuple[str, float, float, float], Dict[str, Any]] = {}

@app.post("/api/reframe/plan")
def reframe_plan(payload: ReframePlanPayload):
    """
    The camera path the export uses to follow the speaker in a vertical short, so the editor preview can show the
    same framing: left edge of the crop window (source pixels) every 1/rate seconds from `start`.
    """
    input_video = resolve_video_file(payload.video_path)
    if payload.end <= payload.start:
        raise HTTPException(status_code=400, detail="end must be after start")
    key = (input_video, round(payload.start, 2), round(payload.end, 2), os.path.getmtime(input_video))
    if key not in REFRAME_PLAN_CACHE:
        w, h = probe_video_dimensions(input_video)
        if w <= h:
            plan = {"mode": "none", "reason": "the video is already vertical"}
        else:
            plan = reframe.plan_reframe(input_video, payload.start, payload.end, w, h)
        plan.update(src_w=w, src_h=h, start=payload.start)
        if len(REFRAME_PLAN_CACHE) > 64:
            REFRAME_PLAN_CACHE.clear()
        REFRAME_PLAN_CACHE[key] = plan
    return REFRAME_PLAN_CACHE[key]

class SilenceDetectPayload(BaseModel):
    video_path: Optional[str] = None
    noise_threshold_db: Optional[float] = -30.0
    min_duration: Optional[float] = 0.5

@app.post("/api/silence/detect")
def detect_silence(payload: SilenceDetectPayload):
    """
    Scans video audio using ultra-fast FFmpeg silencedetect (-vn).
    Takes ~1.5 seconds for 10 minutes of video.
    Returns detected silence gaps [{start, end, duration}] and total seconds saved.
    """
    ffmpeg_bin = get_ffmpeg_bin()
    video_file = resolve_video_file(payload.video_path)
            
    thresh = payload.noise_threshold_db if payload.noise_threshold_db is not None else -30.0
    min_dur = payload.min_duration if payload.min_duration is not None else 0.5

    cmd = [
        ffmpeg_bin, "-vn", "-i", video_file,
        "-af", f"silencedetect=noise={thresh}dB:d={min_dur}",
        "-f", "null", "-"
    ]

    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="ignore", timeout=45, **SUBPROCESS_EXTRA_KWARGS)
        stderr_output = proc.stderr

        silence_regions = []
        current_start = None

        for line in stderr_output.splitlines():
            if "silence_start:" in line:
                try:
                    parts = line.split("silence_start:")
                    current_start = float(parts[1].strip().split()[0])
                except Exception:
                    pass
            elif "silence_end:" in line:
                try:
                    parts = line.split("silence_end:")
                    end_and_dur = parts[1].split("|")
                    s_end = float(end_and_dur[0].strip().split()[0])
                    s_dur = float(end_and_dur[1].split("silence_duration:")[1].strip().split()[0]) if len(end_and_dur) > 1 else (s_end - (current_start or 0.0))
                    
                    s_start = current_start if current_start is not None else max(0.0, s_end - s_dur)
                    silence_regions.append({
                        "start": round(s_start, 2),
                        "end": round(s_end, 2),
                        "duration": round(s_dur, 2)
                    })
                    current_start = None
                except Exception:
                    pass

        total_silence = round(sum(r["duration"] for r in silence_regions), 2)
        return {
            "status": "success",
            "silence_regions": silence_regions,
            "total_silence_duration": total_silence,
            "count": len(silence_regions)
        }
    except Exception as e:
        print(f"[silence] Error: {e}")
        raise HTTPException(status_code=500, detail="Silence detection failed during audio analysis.")

class VideoSegmentItem(BaseModel):
    start: float = Field(ge=0.0)
    end: float = Field(ge=0.0)

    @model_validator(mode="after")
    def validate_range(self):
        if self.end <= self.start:
            raise ValueError("Segment 'end' must be strictly greater than 'start'")
        return self

class VideoSplitPayload(BaseModel):
    video_path: Optional[str] = None
    segments: List[VideoSegmentItem]
    output_filename: Optional[str] = None

@app.post("/api/video/split")
def split_video_segments(payload: VideoSplitPayload):
    """
    Instantly splits, trims, or ripple-joins video segments using FFmpeg stream copying (-c copy).
    Zero re-encoding means sub-second completion (<200ms) with zero quality loss!
    """
    if not payload.segments:
        raise HTTPException(status_code=400, detail="No segments provided for splitting")

    ffmpeg_bin = get_ffmpeg_bin()
    video_file = resolve_video_file(payload.video_path)

    safe_out_name = os.path.basename((payload.output_filename or f"split_{uuid.uuid4().hex[:8]}.mp4").strip().replace("\\", "/"))
    if not safe_out_name.endswith(".mp4"):
        safe_out_name += ".mp4"
    out_path = get_safe_contained_path(OUTPUT_DIR, safe_out_name)

    chunk_files = []
    concat_list_path = None
    try:
        # Case 1: Single segment trim (instant -c copy)
        if len(payload.segments) == 1:
            seg = payload.segments[0]
            cmd = [
                ffmpeg_bin, "-y",
                "-ss", str(seg.start),
                "-to", str(seg.end),
                "-i", video_file,
                "-c", "copy",
                "-avoid_negative_ts", "make_zero",
                out_path
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, **SUBPROCESS_EXTRA_KWARGS)
            if res.returncode != 0:
                raise Exception(f"FFmpeg copy error: {res.stderr.decode('utf-8', errors='ignore')}")
        else:
            # Case 2: Multiple segments (ripple-concatenation without re-encoding)
            for idx, seg in enumerate(payload.segments):
                chunk_name = f"chunk_{uuid.uuid4().hex[:8]}_{idx}.mp4"
                chunk_path = os.path.join(TEMP_DIR, chunk_name)
                cmd = [
                    ffmpeg_bin, "-y",
                    "-ss", str(seg.start),
                    "-to", str(seg.end),
                    "-i", video_file,
                    "-c", "copy",
                    "-avoid_negative_ts", "make_zero",
                    chunk_path
                ]
                res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, **SUBPROCESS_EXTRA_KWARGS)
                if res.returncode == 0 and os.path.exists(chunk_path):
                    chunk_files.append(chunk_path)

            if not chunk_files:
                raise Exception("Failed to generate segment chunks")

            # Concat demuxer list
            concat_list_path = os.path.join(TEMP_DIR, f"concat_{uuid.uuid4().hex[:8]}.txt")
            with open(concat_list_path, "w", encoding="utf-8") as f:
                for cf in chunk_files:
                    # Escape single quotes and backslashes for FFmpeg
                    safe_path = cf.replace("\\", "/")
                    f.write(f"file '{safe_path}'\n")

            concat_cmd = [
                ffmpeg_bin, "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_list_path,
                "-c", "copy",
                out_path
            ]
            res = subprocess.run(concat_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, **SUBPROCESS_EXTRA_KWARGS)
            if res.returncode != 0:
                raise Exception(f"FFmpeg concat error: {res.stderr.decode('utf-8', errors='ignore')}")

        total_dur = round(sum(s.end - s.start for s in payload.segments), 2)
        return {
            "status": "success",
            "output_path": out_path,
            "filename": safe_out_name,
            "download_url": f"/api/download/{safe_out_name}",
            "segments_count": len(payload.segments),
            "total_duration": total_dur
        }
    except Exception as e:
        print(f"[split] Error: {e}")
        raise HTTPException(status_code=500, detail="Stream copy split failed during video slicing.")
    finally:
        for cf in chunk_files:
            try:
                if os.path.exists(cf):
                    os.remove(cf)
            except Exception:
                pass
        if concat_list_path and os.path.exists(concat_list_path):
            try:
                os.remove(concat_list_path)
            except Exception:
                pass

@app.post("/api/export")
def start_export(payload: ExportPayload, background_tasks: BackgroundTasks):
    """Triggers asynchronous video rendering with live progress tracking."""
    prune_stale_tasks(EXPORT_TASKS)
    if not EXPORT_SEMAPHORE.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail="Maximum concurrent export limit reached. Please wait for active exports to complete and try again.",
            headers={"Retry-After": "30"}
        )
    task_id = str(uuid.uuid4())[:8]
    update_task_state(EXPORT_TASKS, task_id, {"progress": 0, "status": "Queued...", "error": None})
    background_tasks.add_task(run_export_job, task_id, payload)
    return {"status": "started", "task_id": task_id}

@app.get("/api/export/progress/{task_id}")
def get_export_progress(task_id: str):
    """Returns real-time render percentage and status."""
    if task_id not in EXPORT_TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    return EXPORT_TASKS[task_id]

class SubtitleExportPayload(BaseModel):
    transcript: List[WordItem]
    format: str = "srt"  # "srt", "vtt", or "ass"
    preset: Optional[Dict[str, Any]] = None
    custom_overrides: Optional[Dict[str, Any]] = None
    video_width: int = Field(default=1080, gt=0)
    video_height: int = Field(default=1920, gt=0)

@app.post("/api/export-subtitles")
def export_subtitles(payload: SubtitleExportPayload):
    """Exports transcript to standalone SRT, VTT, or ASS subtitle content."""
    fmt = payload.format.lower().strip()
    words_dicts = [w.model_dump() if hasattr(w, "model_dump") else (w.dict() if hasattr(w, "dict") else w) for w in payload.transcript]
    if fmt == "srt":
        content = generate_srt_subtitles(words_dicts)
        media_type = "application/x-subrip"
        ext = "srt"
    elif fmt == "vtt":
        content = generate_vtt_subtitles(words_dicts)
        media_type = "text/vtt"
        ext = "vtt"
    elif fmt == "ass":
        preset = payload.preset or {}
        content = generate_ass_subtitles(
            words_dicts,
            preset,
            video_width=payload.video_width,
            video_height=payload.video_height,
            custom_overrides=payload.custom_overrides
        )
        media_type = "text/plain"
        ext = "ass"
    else:
        raise HTTPException(status_code=400, detail="Unsupported subtitle format. Use srt, vtt, or ass.")

    filename = f"kadr_subtitles_{uuid.uuid4().hex[:6]}.{ext}"
    out_path = os.path.join(OUTPUT_DIR, filename)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(content)

    return {
        "status": "ready",
        "format": ext,
        "filename": filename,
        "content": content,
        "download_url": f"/api/download-subtitles/{filename}"
    }

@app.get("/api/download-subtitles/{filename}")
def download_subtitles_file(filename: str):
    """Serves subtitle files with appropriate media types strictly contained within OUTPUT_DIR."""
    path = get_safe_contained_path(OUTPUT_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")
    media_type = "application/x-subrip" if filename.endswith(".srt") else "text/vtt" if filename.endswith(".vtt") else "text/plain"
    return FileResponse(path, media_type=media_type, filename=os.path.basename(path))

CURRENT_ENGINE_VERSION = "1.4.2"
# GitHub repo the in-app updater checks for releases (owner/name)
UPDATE_REPO = os.environ.get("CAPSHORTS_UPDATE_REPO", "Raymond0385/YT")

UPDATE_CACHE = {
    "last_checked": 0.0,
    "data": None
}
UPDATE_CACHE_TTL = 60.0

UPDATE_DOWNLOAD_STATE = {
    "status": "idle",
    "progress": 0,
    "downloaded_bytes": 0,
    "total_bytes": 0,
    "file_path": None,
    "file_name": None,
    "error": None
}
UPDATE_DOWNLOAD_LOCK = threading.Lock()

def parse_semver(v: str) -> Tuple[int, int, int]:
    """Extracts major, minor, patch semver from string like 'v1.1.5' or '1.1.5'."""
    parts = re.findall(r"\d+", v.lstrip("v").strip())
    if len(parts) >= 3:
        return (int(parts[0]), int(parts[1]), int(parts[2]))
    elif len(parts) == 2:
        return (int(parts[0]), int(parts[1]), 0)
    elif len(parts) == 1:
        return (int(parts[0]), 0, 0)
    return (0, 0, 0)

def fetch_latest_github_release() -> Optional[Dict[str, Any]]:
    """Fetches latest release info from GitHub API with caching."""
    now = time.time()
    if UPDATE_CACHE["data"] and (now - UPDATE_CACHE["last_checked"] < UPDATE_CACHE_TTL):
        return UPDATE_CACHE["data"]
    
    url = f"https://api.github.com/repos/{UPDATE_REPO}/releases/latest"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": f"Kadr-Desktop-App/{CURRENT_ENGINE_VERSION}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                UPDATE_CACHE["data"] = data
                UPDATE_CACHE["last_checked"] = now
                return data
    except Exception as e:
        print(f"[engine] GitHub release check note: {e}")
        if UPDATE_CACHE["data"]:
            return UPDATE_CACHE["data"]
    return None

def download_update_worker(download_url: str, filename: str):
    """Downloads installer in background thread with chunk streaming and progress tracking."""
    global UPDATE_DOWNLOAD_STATE
    try:
        parsed = urllib.parse.urlparse(download_url)
        if parsed.netloc not in ("github.com", "objects.githubusercontent.com"):
            raise ValueError(f"Untrusted download host: {parsed.netloc}")
        
        target_dir = os.path.join(tempfile.gettempdir(), "Kadr_Updates")
        os.makedirs(target_dir, exist_ok=True)
        safe_name = os.path.basename(filename)
        dest_path = os.path.join(target_dir, safe_name)
        
        req = urllib.request.Request(
            download_url,
            headers={"User-Agent": f"Kadr-Desktop-App/{CURRENT_ENGINE_VERSION}"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            total_size = int(resp.headers.get("content-length", 0))
            with UPDATE_DOWNLOAD_LOCK:
                UPDATE_DOWNLOAD_STATE.update({
                    "status": "downloading",
                    "progress": 0,
                    "downloaded_bytes": 0,
                    "total_bytes": total_size,
                    "file_path": dest_path,
                    "file_name": safe_name,
                    "error": None
                })
            
            downloaded = 0
            chunk_size = 128 * 1024
            with open(dest_path, "wb") as f:
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    progress = int((downloaded / total_size) * 100) if total_size > 0 else 50
                    with UPDATE_DOWNLOAD_LOCK:
                        UPDATE_DOWNLOAD_STATE["downloaded_bytes"] = downloaded
                        UPDATE_DOWNLOAD_STATE["progress"] = min(progress, 99)
            
            with UPDATE_DOWNLOAD_LOCK:
                UPDATE_DOWNLOAD_STATE.update({
                    "status": "completed",
                    "progress": 100,
                    "downloaded_bytes": downloaded,
                    "file_path": dest_path
                })
            print(f"[engine] Update successfully downloaded to: {dest_path}")
    except Exception as e:
        print(f"[engine] Download update failed: {e}")
        with UPDATE_DOWNLOAD_LOCK:
            UPDATE_DOWNLOAD_STATE.update({
                "status": "error",
                "error": str(e)
            })

@app.get("/api/system/update-status")
def get_update_status():
    """Checks whether a new update is available from GitHub Releases (supports macOS DMG, Windows Setup EXE, and MSI)."""
    current_os = platform.system().lower()
    
    project_root = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))
    if not os.path.exists(os.path.join(project_root, ".git")):
        project_root = os.path.abspath(os.path.join(BASE_DIR, ".."))
    is_git_repo = os.path.exists(os.path.join(project_root, ".git"))
    
    current_commit = "unknown"
    if is_git_repo:
        try:
            current_commit = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=project_root,
                text=True,
                timeout=5,
                **SUBPROCESS_EXTRA_KWARGS
            ).strip()
        except Exception:
            pass
            
    release_data = fetch_latest_github_release()
    latest_tag = "unknown"
    latest_version = CURRENT_ENGINE_VERSION
    update_available = False
    release_title = "Kadr Release"
    release_notes = ""
    release_url = f"https://github.com/{UPDATE_REPO}/releases/latest"
    
    selected_asset_name = ""
    selected_download_url = ""
    selected_asset_size = 0
    msi_download_url = ""
    dmg_download_url = ""
    exe_download_url = ""
    
    if release_data:
        latest_tag = release_data.get("tag_name", "unknown")
        latest_version = latest_tag.lstrip("v")
        release_title = release_data.get("name") or f"Kadr {latest_tag}"
        release_notes = release_data.get("body", "")
        release_url = release_data.get("html_url") or release_url
        
        remote_sem = parse_semver(latest_tag)
        local_sem = parse_semver(CURRENT_ENGINE_VERSION)
        update_available = (remote_sem > local_sem)
        
        assets = release_data.get("assets", [])
        
        for a in assets:
            name = a.get("name", "")
            dl_url = a.get("browser_download_url", "")
            
            if name.endswith(".msi"):
                msi_download_url = dl_url
            if name.endswith(".dmg"):
                dmg_download_url = dl_url
            if name.endswith(".exe") and "backend-engine" not in name:
                exe_download_url = dl_url
        
        if current_os == "windows":
            setup_asset = next((a for a in assets if a.get("name", "").endswith("-setup.exe") or ("setup" in a.get("name", "").lower() and a.get("name", "").endswith(".exe"))), None)
            if not setup_asset:
                setup_asset = next((a for a in assets if a.get("name", "").endswith(".exe") and "backend-engine" not in a.get("name", "")), None)
            if not setup_asset:
                setup_asset = next((a for a in assets if a.get("name", "").endswith(".msi")), None)
            
            if setup_asset:
                selected_asset_name = setup_asset.get("name", "")
                selected_download_url = setup_asset.get("browser_download_url", "")
                selected_asset_size = setup_asset.get("size", 0)
        elif current_os == "darwin":
            dmg_asset = next((a for a in assets if a.get("name", "").endswith(".dmg")), None)
            if dmg_asset:
                selected_asset_name = dmg_asset.get("name", "")
                selected_download_url = dmg_asset.get("browser_download_url", "")
                selected_asset_size = dmg_asset.get("size", 0)
    
    details = f"New version {latest_tag} is ready to install!" if update_available else "Kadr is up to date."
    changes = remote_changes(latest_tag) if update_available else []
    
    return {
        "current_version": CURRENT_ENGINE_VERSION,
        "latest_version": latest_version,
        "latest_tag": latest_tag,
        "current_commit": current_commit,
        "update_available": update_available,
        "is_git_repo": is_git_repo,
        "platform": current_os,
        "details": details,
        "release_title": release_title,
        "release_notes": release_notes,
        "changes": changes,
        "release_url": release_url,
        "asset_name": selected_asset_name,
        "download_url": selected_download_url,
        "asset_size_bytes": selected_asset_size,
        "asset_size_mb": round(selected_asset_size / (1024 * 1024), 1) if selected_asset_size > 0 else 0,
        "exe_download_url": exe_download_url or selected_download_url,
        "msi_download_url": msi_download_url or release_url,
        "dmg_download_url": dmg_download_url or release_url
    }

def version_from_asset_name(name: str) -> Optional[str]:
    m = re.search(r"(\d+\.\d+\.\d+)", name or "")
    return m.group(1) if m else None

RELEASES_CACHE: Dict[str, Any] = {"at": 0.0, "data": None}
REMOTE_CHANGELOG_CACHE: Dict[str, Any] = {}

def fetch_github_json(url: str, timeout: float = 10) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": f"Kadr-Desktop-App/{CURRENT_ENGINE_VERSION}",
                                               "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_releases() -> List[Dict[str, Any]]:
    now = time.time()
    if RELEASES_CACHE["data"] is not None and now - RELEASES_CACHE["at"] < 600:
        return RELEASES_CACHE["data"]
    data = fetch_github_json(f"https://api.github.com/repos/{UPDATE_REPO}/releases?per_page=20")
    RELEASES_CACHE.update(at=now, data=data if isinstance(data, list) else [])
    return RELEASES_CACHE["data"]

def remote_changes(tag: str) -> List[Dict[str, str]]:
    """What changed between this version and release `tag`, from that release's CHANGELOG.md."""
    if tag not in REMOTE_CHANGELOG_CACHE:
        url = f"https://raw.githubusercontent.com/{UPDATE_REPO}/{urllib.parse.quote(tag)}/CHANGELOG.md"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": f"Kadr-Desktop-App/{CURRENT_ENGINE_VERSION}"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                REMOTE_CHANGELOG_CACHE[tag] = updates.parse_changelog(resp.read().decode("utf-8", errors="replace"))
        except Exception as e:
            print(f"[update] changelog of {tag} not available: {e}")
            return []
    return updates.changes_between(REMOTE_CHANGELOG_CACHE[tag], CURRENT_ENGINE_VERSION, tag.lstrip("v"))

def local_changelog_sections() -> List[Dict[str, str]]:
    path = updates.find_changelog([BASE_DIR, MEIPASS_DIR, os.path.join(BASE_DIR, ".."), os.path.join(BASE_DIR, "..", "..")])
    if not path:
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            return updates.parse_changelog(f.read())
    except OSError:
        return []

@app.get("/api/system/whats-new")
def whats_new():
    """After an update: what changed since the version the user saw last (read from the bundled CHANGELOG)."""
    state = updates.load_state(DATA_DIR)
    shown, new_state = updates.whats_new(state, CURRENT_ENGINE_VERSION, local_changelog_sections())
    if new_state != state:
        try:
            updates.save_state(DATA_DIR, new_state)
        except OSError as e:
            print(f"[update] could not save the update state: {e}")
    return shown

@app.post("/api/system/whats-new/seen", dependencies=[Depends(verify_loopback_request), Depends(verify_local_origin)])
def whats_new_seen():
    updates.save_state(DATA_DIR, updates.mark_seen(updates.load_state(DATA_DIR), CURRENT_ENGINE_VERSION))
    return {"success": True}

@app.get("/api/system/releases")
def list_releases():
    """Recent releases with an installer for this computer: to roll back to an earlier version."""
    try:
        data = fetch_releases()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach GitHub: {e}")
    return {"current_version": CURRENT_ENGINE_VERSION, "releases": updates.release_list(data, platform.system().lower(), CURRENT_ENGINE_VERSION)}

class InstallVersionPayload(BaseModel):
    version: str

@app.post("/api/system/install-version", dependencies=[Depends(verify_loopback_request), Depends(verify_local_origin)])
def install_version(payload: InstallVersionPayload):
    """Downloads the installer of a given release (only one listed on GitHub for this repo), e.g. to roll back."""
    try:
        listed = updates.release_list(fetch_releases(), platform.system().lower(), CURRENT_ENGINE_VERSION, limit=50)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach GitHub: {e}")
    match = next((r for r in listed if updates.semver(r["version"]) == updates.semver(payload.version)), None)
    if not match:
        raise HTTPException(status_code=404, detail="No installer for that version")
    return start_download_update({"download_url": match["download_url"], "file_name": match["asset_name"], "version": match["version"]})

@app.post("/api/system/download-update", dependencies=[Depends(verify_loopback_request)])
def start_download_update(payload: Optional[Dict[str, Any]] = None):
    """Starts background download of the specified or auto-detected installer asset."""
    with UPDATE_DOWNLOAD_LOCK:
        if UPDATE_DOWNLOAD_STATE["status"] == "downloading":
            return {"success": True, "message": "Download already in progress."}
    
    download_url = ""
    file_name = ""
    if payload and payload.get("download_url"):
        download_url = payload.get("download_url", "")
        file_name = payload.get("file_name", "") or os.path.basename(urllib.parse.urlparse(download_url).path)
    else:
        status_info = get_update_status()
        download_url = status_info.get("download_url", "")
        file_name = status_info.get("asset_name", "")
    
    if not download_url:
        raise HTTPException(status_code=400, detail="No suitable update asset available for your platform.")
    
    target = (payload or {}).get("version") or version_from_asset_name(file_name)
    with UPDATE_DOWNLOAD_LOCK:
        UPDATE_DOWNLOAD_STATE["target_version"] = target
    worker = threading.Thread(target=download_update_worker, args=(download_url, file_name), daemon=True)
    worker.start()
    return {"success": True, "message": "Download started.", "file_name": file_name}

@app.get("/api/system/download-update-progress")
def get_download_update_progress():
    """Returns current state and byte progress of in-app update download."""
    with UPDATE_DOWNLOAD_LOCK:
        return dict(UPDATE_DOWNLOAD_STATE)

def launch_detached_windows(cmd: List[str]) -> str:
    """
    Starts a program that has to keep running after Kadr exits (the update installer). The engine lives in a job
    that Windows ends together with Kadr; the program is started outside of it. Returns how it was started.
    """
    CREATE_BREAKAWAY_FROM_JOB = 0x01000000
    DETACHED_PROCESS = 0x00000008
    CREATE_NEW_PROCESS_GROUP = 0x00000200
    try:
        subprocess.Popen(cmd, shell=False, close_fds=True,
                         creationflags=CREATE_BREAKAWAY_FROM_JOB | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        return "breakaway"
    except OSError:
        # The job does not allow leaving it (older Kadr): let Explorer start it, as its own child
        explorer = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "explorer.exe")
        subprocess.Popen([explorer, cmd[-1]], shell=False)      # explorer opens .exe and .msi files alike
        return "explorer"

@app.post("/api/system/launch-installer", dependencies=[Depends(verify_loopback_request)])
def launch_installer():
    """Launches the downloaded installer (.exe, .msi, or .dmg)."""
    with UPDATE_DOWNLOAD_LOCK:
        status = UPDATE_DOWNLOAD_STATE.get("status")
        file_path = UPDATE_DOWNLOAD_STATE.get("file_path")
    
    if status != "completed" or not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=400, detail="No completed update package ready to install.")
    
    with UPDATE_DOWNLOAD_LOCK:
        target_version = UPDATE_DOWNLOAD_STATE.get("target_version")
    if target_version:
        try:
            updates.save_state(DATA_DIR, updates.mark_pending(updates.load_state(DATA_DIR), CURRENT_ENGINE_VERSION, target_version))
        except OSError as e:
            print(f"[update] could not remember the pending update: {e}")

    temp_dir = os.path.realpath(tempfile.gettempdir())
    real_path = os.path.realpath(file_path)
    if not real_path.startswith(temp_dir):
        raise HTTPException(status_code=403, detail="Unauthorized installer location.")
    
    current_os = platform.system().lower()
    try:
        if current_os == "windows":
            # The installer closes Kadr to replace its files, so it must not belong to the app's process group
            launch_detached_windows(["msiexec", "/i", file_path] if file_path.lower().endswith(".msi") else [file_path])
        elif current_os == "darwin":
            subprocess.Popen(["open", file_path], shell=False)
        else:
            subprocess.Popen(["xdg-open", file_path], shell=False)
            
        return {"success": True, "message": "Installer launched successfully."}
    except Exception as e:
        print(f"[engine] Failed to launch installer: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to launch installer: {e}")

@app.post("/api/system/apply-update", dependencies=[Depends(verify_loopback_request)])
def apply_update():
    """Backward compatible update router: initiates in-app download in packaged mode or runs git pull in dev."""
    if getattr(sys, "frozen", False) or not os.path.exists(os.path.join(BASE_DIR, "..", ".git")):
        return start_download_update()
    
    try:
        project_root = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))
        if not os.path.exists(os.path.join(project_root, ".git")):
            project_root = os.path.abspath(os.path.join(BASE_DIR, ".."))
        
        proc = subprocess.run(
            ["git", "pull", "origin", "main"],
            cwd=project_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=60,
            **SUBPROCESS_EXTRA_KWARGS
        )
        if proc.returncode != 0:
            return {"success": False, "error": "Git pull failed."}
        return {"success": True, "message": "Kadr updated successfully! Reloading studio...", "action_required": "reload"}
    except Exception as e:
        return {"success": False, "error": f"Update failed: {e}"}

@app.get("/api/system/telemetry-stats")
def get_telemetry_stats():
    """Returns local anonymous session stats."""
    return {
        "enabled": telemetry.is_enabled(),
        "available": telemetry.is_available(),
        "machine_id": telemetry.machine_id,
        "os": telemetry.os_info,
        "session_seconds": telemetry.get_session_seconds(),
        "videos_transcribed": telemetry.videos_transcribed,
        "videos_exported": telemetry.videos_exported,
        "telemetry_url": telemetry.get_telemetry_url()
    }

@app.get("/api/system/telemetry-settings")
def get_telemetry_settings():
    """Returns telemetry opt-in status."""
    return {
        "enabled": telemetry.is_enabled(),
        "available": telemetry.is_available(),
        "machine_id": telemetry.machine_id,
        "os": telemetry.os_info,
        "app_version": telemetry.app_version
    }

@app.post("/api/system/telemetry-settings")
def update_telemetry_settings(payload: Dict[str, Any]):
    """Allows user to toggle anonymous telemetry on or off."""
    enabled = bool(payload.get("enabled", True))
    telemetry.set_enabled(enabled)
    return {
        "success": True,
        "enabled": telemetry.is_enabled()
    }

if __name__ == "__main__":
    import uvicorn
    import parent_watch
    parent_watch.exit_with_parent()      # started by the app: stop together with it
    try:
        housekeeping()
    except Exception as hk_err:
        print(f"[engine] housekeeping skipped: {hk_err}")
    threading.Thread(target=get_whisper_model, daemon=True).start()
    threading.Thread(target=telemetry.start_heartbeat_loop, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False, log_config=None)



