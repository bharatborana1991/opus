# OpusLite — Offline Shorts Maker (Client-only)
A lightweight, client-only demo inspired by "long video to short clips" workflows. It runs fully in the browser, can be hosted on GitHub Pages, and supports offline use via PWA caching.

> Not affiliated with Opus.pro. This is an independent educational project; trademarks belong to their owners.

## What it does
- Load a local video (no upload).
- Analyze audio energy + scene cuts to suggest ~5–8 clip candidates.
- Tweak start/end times.
- Export each clip locally with ffmpeg.wasm (no re-encode by default, just copies the selected segment).

## What it **doesn't** do (yet)
- AI captions / topic detection / titles like commercial tools.
- Fancy templates or multi-track timeline.
- Cloud processing.

## Roadmap (client-only)
- Optional offline captions: integrate a small on-device ASR (e.g., Vosk or Whisper tiny via WebGPU/ONNX). You’ll need to host model files in `/models` and lazy-cache them.
- Auto title/hashtags: small local LLM (tiny) or rules; or allow user-provided API key (if you prefer non-offline).

## One-click deploy to GitHub Pages
1. Create a new repo and add these files to the root.
2. Commit & push.
3. In GitHub: **Settings → Pages → Source = Deploy from a branch**, select `main` and `/ (root)`.
4. Wait for the page to publish. Visit the URL; the app will cache itself for offline use.
5. The first export may take longer while ffmpeg.wasm loads; subsequent runs are faster (cached).

## Local dev
Just open `index.html` with a static server (e.g., `python -m http.server`).

## Legal & Ethics
- Don’t use the brand name or UI that could confuse users. This project is for learning.
- Respect copyrights/terms. Users are responsible for the content they process.

## Adding captions (optional, two paths)
**Fully offline (heavier download):**
- Integrate an in-browser ASR. Candidates: Vosk WASM; Whisper-tiny via ONNX Runtime Web / WebGPU.
- Host model files under `/models`, then fetch them on first run and cache with the service worker.

**API-backed (not offline):**
- Add a "Use API" toggle and ask for a user-supplied API key to call any ASR service.

## Tech
- Pure static PWA: HTML + JavaScript + Tailwind (CDN).
- Heuristics: WebAudio RMS peaks + histogram-based scene cuts.
- Export: `@ffmpeg/ffmpeg` (ffmpeg.wasm) with `-ss/-t` copy.
