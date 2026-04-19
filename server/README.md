# ClipFarm API server

## Thumbnail img2img — what you need

The thumbnail generator does **not** bundle Stable Diffusion. You must run **AUTOMATIC1111 Stable Diffusion WebUI** (or any app that exposes the same REST API) on your machine, **with the API enabled**, so the Node server can call `POST …/sdapi/v1/img2img`.

1. Install [AUTOMATIC1111 WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) (Python + CUDA/Metal per their docs).
2. Start it with the API flag, for example:  
   `./webui.sh --api` (Linux/macOS) or the Windows equivalent.
3. Confirm it responds at `http://127.0.0.1:7860` (default). If you use another host/port, set `A1111_BASE_URL` before starting ClipFarm’s server.
4. No extra “connector” app is required beyond WebUI running — the error `fetch failed` / `ECONNREFUSED` means nothing is listening on that URL yet (WebUI not started, wrong port, or firewall).

Ollama (titles/descriptions) is separate: run **Ollama** for LLM features; it does not replace AUTOMATIC1111 for thumbnails.

### Troubleshooting local WebUI install

1. **`ModuleNotFoundError: No module named 'pkg_resources'` when installing CLIP**  
   Pip’s build isolation plus **setuptools ≥ 82** can break OpenAI’s old CLIP build. In the WebUI venv run:
   `pip install 'setuptools>=69,<70'` then  
   `pip install "https://github.com/openai/CLIP/archive/d50d76daa670286dd6cacf3bcd80b5e4823fc8e1.zip" --no-build-isolation`

2. **`Couldn't clone Stable Diffusion` / `Stability-AI/stablediffusion` not found**  
   That upstream repo is no longer public. Use a maintained fork, e.g. in `webui-user.sh`:  
   `export STABLE_DIFFUSION_REPO="https://github.com/w-e-w/stablediffusion.git"`  
   (The upstream **dev** branch of AUTOMATIC1111 defaults to this fork.)

3. **`No checkpoints found`**  
   Put at least one `.safetensors` or `.ckpt` under `stable-diffusion-webui/models/Stable-diffusion/` (e.g. SD 1.5 from Hugging Face). The UI can download on first run if the download finishes before load.

4. **ClipFarm says it cannot reach A1111 but the browser opens `http://127.0.0.1:7860`**  
   The app calls WebUI from **Node** (the API middleware), not from the browser. Global `HTTP_PROXY` / `HTTPS_PROXY` used to make Node’s `fetch` fail on `localhost`; ClipFarm now uses a direct HTTP client to `127.0.0.1` so this should not happen. If it still fails, confirm WebUI was started with **`--api`** and try `curl -s http://127.0.0.1:7860/sdapi/v1/options` from the same machine.

## AI thumbnail generation (`POST /api/generate-thumbnails`)

Uses **`/sdapi/v1/txt2img`** (text-to-image from scratch; title + content summary in the prompt). Optional **`stream=1`** form field returns **NDJSON** lines so each image can appear in the UI as it finishes.

Requires **AUTOMATIC1111** WebUI with the HTTP API enabled (`--api`). Defaults to `http://127.0.0.1:7860` if `A1111_BASE_URL` is unset.

| Variable | Purpose |
|----------|---------|
| `A1111_BASE_URL` | WebUI origin, e.g. `http://127.0.0.1:7860` (also toggles `a1111Configured` in `/api/health`) |
| `A1111_TXT2IMG_PATH` | API path (default `/sdapi/v1/txt2img`) |
| `A1111_STEPS` | Sampling steps (default `28`) |
| `A1111_CFG_SCALE` | CFG (default `7`) |
| `A1111_DENOISING` | Denoising strength for img2img (default `0.48`; try `0.35`–`0.55`) |
| `A1111_WIDTH` / `A1111_HEIGHT` | Output size (default `1280`×`720`) |

Each generated image is scored with **Model 4** (`models/model4-thumbnail`); ensure its artifact exists (`train.py --init-default` or Kaggle data).

### Phase 2 (optional, not implemented here)

Training a **LoRA / DreamBooth** on Kaggle thumbnail crops, exporting `.safetensors`, and loading it in A1111 is a separate GPU training pipeline—out of scope for the img2img panel in this repo until you add that pipeline.
