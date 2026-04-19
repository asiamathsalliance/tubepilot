# Model 1 — Transcriber (Whisper)

**Model 1** is the **English speech-to-text** pipeline used by Clipfarm:

- **Runtime:** [`server/app.js`](../../server/app.js) — routes `POST /api/transcribe`, `POST /api/pipeline` (Whisper CLI + optional Ollama).
- **CLI:** OpenAI Whisper (`whisper` on `PATH`), with **ffmpeg** for decoding.
- **UI:** User runs transcription from the **Input** page; results are stored on the project (`transcript`, etc.).

There is no separate weights file: the “model” is the **Whisper checkpoint** selected via `WHISPER_MODEL` (e.g. `base`, `small`).

See the main app README or [`models/model2-title-confidence/README.md`](../model2-title-confidence/README.md) for the title-confidence model (Model 2).
