# Changelog

All notable changes to Kadr (formerly CapShorts) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.2] - 2026-10-20

### Added
- Shorts on the timeline: a Shorts track where a short is selected with a click, trimmed by dragging its edges and moved by dragging it (snaps to word edges when snapping is on).
- Short editor: Duplicate, Split at playhead, and the captions of the short editable in place.

### Fixed
- The background engine kept running after Kadr was closed, crashed or restarted by the updater, which blocked updating and uninstalling (`backend-engine.exe` in use) and could leave an old engine answering after an update. The engine is now tied to the app (Windows job object) and also stops by itself when the app is gone; a leftover engine from an older version is stopped at start.

### Performance
- Text alignment after editing captions: about 2000x faster on long recordings (61 s -> 0.03 s for 3000 words), same results.
- Clean-up after recognition (repeat removal + glossary): 10 s -> 0.9 s for an hour of speech, same results.
- Face search for auto-reframe: about 6x faster (reads frames in order instead of seeking to each one).
- Export and Settings windows no longer re-render on every frame of playback; the Shorts panel neither.
- Removed an unused 2500-line component and its stylesheet (CSS bundle 78 KB -> 58 KB).

## [1.4.1] - 2026-10-18

### Added
- Saved projects and the autosave now bring their video back: the engine keeps a copy (a hard link, no extra disk space) and the project opens it by itself instead of asking for the file.

### Fixed
- Subtitle presets in the Styles tab could not be selected once a font or color had been changed by hand; choosing a preset now replaces those tweaks.
- The installer did not stop the background engine, so uninstalling left `backend-engine.exe` behind.

## [1.4.0] - 2026-10-18

### Added
- Auto-reframe: when a widescreen video is exported as a vertical short, the frame follows the speaker's face (YuNet face detector, smooth camera path); falls back to the blurred background when no face is found. Choice in the Export window.
- "Export all" button: renders every short to the export folder in one go, with progress and an "Open folder" button.
- Autosave of the project draft, recent projects list and recovery after a crash.
- Long recordings in cloud (Groq) mode are split at pauses into parts, so the file size limit no longer blocks them.

### Changed
- Pop / bounce / fade subtitle animations now look the same in the preview and in the rendered video (one shared spec).

## [1.3.0] - 2026-10-18

The app is now called **Kadr** and has a new icon. Built on the open-source CapShorts by Ali Raza (MIT, see LICENSE).

### Added
- Undo / redo (Ctrl+Z, Ctrl+Y) for captions, shorts, cuts, style, B-roll and video settings.
- Emoji in the exported video, drawn above the subtitles like in the preview (Noto Emoji images); Russian words in the emoji dictionary.
- Save / open projects as `.kadr` files (older `.capshorts` files still open): captions, shorts, cuts, style, view state, settings.
- Shorts editor: rename, trim, add and delete shorts; re-detect with min/max length and count.
- Russian support for shorts detection and scoring.
- Speech recognition: Turbo and Large-v3 offline models, language detected from several audio windows, optional audio clean-up, re-check of uncertain parts, per-word confidence highlighted in the editor, glossary sets.
- YouTube import tab (yt-dlp + bundled QuickJS), downloads go to Downloads or a folder you choose.
- Export folder setting and automatic clean-up of old temporary files.

### Changed
- Subtitle preview and exported video now share fonts, sizes, outline and positions; bundled fonts for FFmpeg.
- Updates are checked against https://github.com/Raymond0385/YT/releases.
- Packaged app keeps its data in `%LOCALAPPDATA%\Kadr` (the old `CapShorts` folder is moved over on first start).

### Fixed
- White "outline" in rendered subtitles (rgba shadow colors were parsed as white); missing boxes for box styles.
- Rendering failed on sandboxed Windows profiles ("Path traversal forbidden").
- YouTube links failing with "This video is not available" (a JavaScript engine is now bundled).
- Timeline: every caption word can be selected and edited.
- CI now runs the pytest backend tests and the frontend tests.

### Privacy
- Removed the built-in analytics server address. Telemetry stays off and cannot be enabled unless you configure an endpoint yourself.

## [1.1.4] - 2026-09-25

### Fixed
- **Task Prune & Eviction Lifecycle (`N-001`)**: Resolved high-severity regression where completed/failed tasks were immediately pruned upon finishing due to missing timestamps, breaking progress polling and retrieval endpoints. Added timestamp retention (`_created_at`, `_completed_at`) and protected terminal tasks for full TTL.
- **Cross-Video State Corruption (`N-002`)**: Loading a new video now fully cancels in-flight transcription polling and resets transcription progress/state, preventing out-of-order overwrite.
- **Export Semaphore Saturation (`N-003`)**: Added synchronous `HTTP 429 Too Many Requests` with `Retry-After: 30` header when concurrent export capacity is saturated, eliminating background async task drops.
- **Word Validation & KeyError Prevention (`F-028`)**: Added strict `WordItem` Pydantic model with validation (`HTTP 422`) and defensive accessors in clip generation to prevent `KeyError: 'word'` on incomplete payloads.
- **Dead Session Token Code Removed (`F-001`, `N-006`)**: Removed unwired token generator that wrote to `~/.capshorts/session_token` on every import; loopback security boundary cleanly retained.
- **Dead Code Cleanup (`N-009`)**: Removed unused `generate_demo_transcript()`.
- **Upload Streaming Cleanup (`N-011`)**: Streamlined file upload streaming without redundant file descriptor close calls.
- **Error Sanitization (`F-006`)**: Prevented raw internal exception traces, system paths, and FFmpeg stderr logs from leaking in API responses.
- **Packaged Update UX (`N-004`)**: Fixed misleading "Update applied successfully! Reloading studio..." prompt when downloading official releases.
- **Contrast & UI Ergonomics (`N-016`)**: Improved contrast and formatting of the render failure banner in `ExportModal`.
- **Transcribe Polling Attempt Limit (`F-043`)**: Added 10-minute timeout cap (1200 poll cycles) to transcription store poller.
- **Version Drift Resolution (`N-005`, `N-015`)**: Synchronized version `1.1.4` across root `package.json`, `Cargo.toml`, `tauri.conf.json`, `telemetry.py`, `docs/index.html`, `README.md`, and `DOCUMENTATION.md`.
- **Toolchain Alignment (`N-012`, `N-013`)**: Aligned CI workflow with release toolchain (Python 3.11, Node 22) and keyed npm cache on `package-lock.json`.
- **Secret Scanner Hygiene (`N-014`)**: Replaced `gsk_` sample API key prefix in `.env.example` with non-secret dummy placeholders.
- **Missing Cargo.lock Committed (`F-073`)**: Tracked and committed `CapShorts/src-tauri/Cargo.lock`.

## [1.1.3] - 2026-09-25
### Added
- Multi-platform packaging for Windows and macOS Universal (Apple Silicon & Intel).
- Pinned portable FFmpeg binary with SHA-256 verification in release workflow.

## [1.1.2] - 2026-09-24
### Fixed
- Fixed SSRF prevention in B-roll fetching with DNS resolution and private network filtering.
- Pinned Python package dependencies strictly to exact versions (`==`).
- Enforced 4 GB streaming upload ceiling.

## [1.1.0] - 2026-09-23
### Added
- Initial standalone release with local Faster-Whisper, Groq Turbo cloud transcription, viral shorts extractor, and interactive CapCut timeline.
