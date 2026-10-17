import os
import requests
from typing import List, Dict, Any, Tuple, Optional
from transliterate import transliterate_transcript
from asr_quality import logprob_to_confidence

def transcribe_with_groq_pool(
    audio_file_path: str,
    api_keys: List[str],
    language: Optional[str] = None,
    prompt: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], float, Optional[str]]:
    """
    Ultra-fast cloud transcription via Groq Whisper Large-v3 with Key Pool Auto-Rotation.
    Supports:
      - 'en': Translates spoken audio directly into fluent English captions (viral shorts standard).
      - 'roman': Transcribes in Urdu/Hindi and transliterates to Roman Urdu (Latin alphabet).
      - 'ur': Urdu script (نستعلیق).
      - 'hi': Hindi script (देवनागरी).
      - 'auto' / None: Auto-detects spoken language.
    Processes 10 minutes of audio in ~2 to 3 seconds.
    """
    valid_keys = [k.strip() for k in api_keys if k and len(k.strip()) > 10]
    if not valid_keys:
        raise ValueError("No valid Groq API keys available in pool.")

    url = "https://api.groq.com/openai/v1/audio/transcriptions"
    last_error = None

    # Handle language modes: When "urdu" is selected, directly generate Roman Urdu (Latin script)
    is_roman_mode = (language in ["urdu", "ur", "roman", "roman_urdu"])
    api_language = None

    if language in ["ur_script", "urdu_script"]:
        api_language = "ur"
        is_roman_mode = False
    elif is_roman_mode:
        # Request Hindi phonetics from Whisper so transliterate_transcript produces clean Roman Urdu
        api_language = "hi"
    elif language and language != "auto":
        api_language = language

    for idx, key in enumerate(valid_keys):
        try:
            headers = {
                "Authorization": f"Bearer {key}"
            }
            with open(audio_file_path, "rb") as f:
                files = {
                    "file": (os.path.basename(audio_file_path), f, "audio/mpeg"),
                }
                data = {
                    "model": "whisper-large-v3",
                    "response_format": "verbose_json",
                    "timestamp_granularities[]": "word"
                }
                if api_language:
                    data["language"] = api_language
                if prompt:
                    data["prompt"] = prompt

                res = requests.post(url, headers=headers, files=files, data=data, timeout=90)

                # If rate-limited (429), rotate to next key in pool
                if res.status_code == 429:
                    print(f"[groq] Key #{idx+1} hit rate limit (429). Rotating to next key in pool...")
                    last_error = f"Rate limited on key #{idx+1}"
                    continue

                if not res.ok:
                    print(f"[groq] Error on key #{idx+1} ({res.status_code}): {res.text}")
                    last_error = f"HTTP {res.status_code}: {res.text}"
                    continue

                res_data = res.json()
                raw_words: List[Dict[str, Any]] = []
                duration = float(res_data.get("duration", 0.0))
                detected_language = res_data.get("language")
                seg_conf = [
                    (float(sg.get("start", 0.0)), float(sg.get("end", 0.0)), logprob_to_confidence(sg.get("avg_logprob")))
                    for sg in (res_data.get("segments") or [])
                ]

                def conf_at(t: float) -> Optional[float]:
                    for s0, e0, c in seg_conf:
                        if s0 - 0.05 <= t <= e0 + 0.05:
                            return c
                    return None

                if "words" in res_data and res_data["words"]:
                    for w in res_data["words"]:
                        raw_w = str(w.get("word", "")).strip()
                        if raw_w:
                            raw_words.append({
                                "start": round(float(w.get("start", 0.0)), 2),
                                "end": round(float(w.get("end", 0.0)), 2),
                                "word": raw_w,
                                "keyword": False,
                                "confidence": conf_at(float(w.get("start", 0.0)))
                            })
                elif "segments" in res_data and res_data["segments"]:
                    for seg in res_data["segments"]:
                        seg_text = str(seg.get("text", "")).strip()
                        if seg_text:
                            # Split segment text into word tokens
                            s_start = float(seg.get("start", 0.0))
                            s_end = float(seg.get("end", s_start + 1.0))
                            tokens = seg_text.split()
                            if tokens:
                                step = (s_end - s_start) / len(tokens)
                                for ti, tok in enumerate(tokens):
                                    w_start = s_start + ti * step
                                    w_end = w_start + step
                                    raw_words.append({
                                        "start": round(w_start, 2),
                                        "end": round(w_end, 2),
                                        "word": tok.strip(),
                                        "keyword": False
                                    })

                # Clean and sanitize word timestamps
                cleaned_words: List[Dict[str, Any]] = []
                last_end = 0.0
                for w in raw_words:
                    start_t = max(0.0, w["start"])
                    end_t = max(start_t + 0.15, w["end"])
                    # If start timestamp jumps backwards significantly due to segment overlap, adjust
                    if start_t < last_end - 0.5:
                        start_t = last_end
                        end_t = max(start_t + 0.15, end_t)

                    last_end = end_t
                    cleaned_words.append({
                        "start": round(start_t, 2),
                        "end": round(end_t, 2),
                        "word": w["word"],
                        "keyword": False,
                        "confidence": w.get("confidence")
                    })

                # If Roman Urdu requested, transliterate Devanagari/Hindi words
                if is_roman_mode:
                    cleaned_words = transliterate_transcript(cleaned_words)

                print(f"[groq] Success with key #{idx+1}! Extracted {len(cleaned_words)} words in 2-3s (Language: {language or 'auto'}).")
                return cleaned_words, duration, detected_language

        except Exception as e:
            print(f"[groq] Exception on key #{idx+1}: {e}")
            last_error = str(e)
            continue

    raise RuntimeError(f"All Groq keys in pool exhausted or failed: {last_error}")
