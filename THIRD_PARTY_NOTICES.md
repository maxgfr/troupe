# Third-party notices

Troupe's own code is MIT licensed. Some distributions include third-party
programs under other licenses:

- **FFmpeg / FFprobe.** The Docker image installs Alpine Linux's `ffmpeg`
  package; Vercel builds bundle the static `ffprobe` binary from
  [`@ffprobe-installer/linux-x64`](https://www.npmjs.com/package/@ffprobe-installer/linux-x64).
  Both are built from [FFmpeg](https://ffmpeg.org) and licensed under the GNU
  GPL (version 2 or later, or version 3 for some builds). Troupe runs them as
  separate programs. Their source is available from
  [ffmpeg.org](https://ffmpeg.org/download.html) and the
  [Alpine aports](https://gitlab.alpinelinux.org/alpine/aports) repository.
- **ComfyUI workflows.** `src/modules/generation/server/adapters/comfyui/templates/*.json`
  are derived from [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates)
  (MIT). The model weights they reference are not distributed with Troupe and
  carry their own licenses (LTX-2: LTX-2 Community License Agreement, free for
  commercial use under a revenue threshold; Wan 2.2:
  Apache 2.0).
- **Kokoro-82M voice model.** The in-browser renderer (static demo) and the
  local renderer (`renderer/`) download
  [`onnx-community/Kokoro-82M-v1.0-ONNX`](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX),
  an ONNX export of [`hexgrad/Kokoro-82M`](https://huggingface.co/hexgrad/Kokoro-82M),
  weights and voice files, from Hugging Face at run time. Both model cards
  declare the Apache License 2.0. Troupe does not distribute the weights.
- **Speech and video libraries bundled into the static demo** (`site/dist`,
  in the render worker), also used by the local renderer:
  - [kokoro-js](https://github.com/hexgrad/kokoro) 1.2.1: Apache License 2.0.
  - [phonemizer](https://github.com/xenova/phonemizer.js) 1.2.1: published
    under the Apache License 2.0, it embeds [eSpeak NG](https://github.com/espeak-ng/espeak-ng)
    compiled to WebAssembly, with its language data. eSpeak NG is licensed
    under the GNU GPL version 3 or later; its source is available from that
    repository.
  - [Transformers.js](https://github.com/huggingface/transformers.js)
    (`@huggingface/transformers`) 3.8.1: Apache License 2.0.
  - [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.22
    (`onnxruntime-web`), including its WebAssembly binary, which the site
    serves itself: MIT License.
  - [Mediabunny](https://github.com/Vanilagy/mediabunny) 1.61: Mozilla Public
    License 2.0. Bundled unmodified; its source is available from that
    repository and npm.
- **Geist font.** The static demo ships Geist (`@fontsource-variable/geist`)
  and draws the video captions with it; the local renderer ships it too
  (`@fontsource/geist-sans`). Geist is licensed under the SIL Open Font
  License 1.1.
- **Script chat.**
  - [WebLLM](https://github.com/mlc-ai/web-llm) (`@mlc-ai/web-llm`) 0.2.85:
    Apache License 2.0. Bundled into the static demo (a worker chunk and a
    chunk loaded when the chat is first used). At run time it fetches the
    model's compiled WebGPU library from
    [mlc-ai/binary-mlc-llm-libs](https://github.com/mlc-ai/binary-mlc-llm-libs)
    (Apache License 2.0).
  - Qwen2.5-1.5B-Instruct weights, the demo's default chat model, downloaded
    by the visitor's browser from
    [`mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC`](https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC),
    a quantization of [`Qwen/Qwen2.5-1.5B-Instruct`](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct),
    whose model card declares the Apache License 2.0 (other Qwen2.5 sizes,
    such as 3B and 72B, use other licenses). Troupe does not distribute the
    weights.
  - The self-hosted chat's default Ollama model, `qwen3:4b`
    ([Qwen/Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B), Apache License
    2.0), is pulled by the user with Ollama ([MIT](https://github.com/ollama/ollama/blob/main/LICENSE)),
    which Troupe neither bundles nor installs.
  - [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
    (`@anthropic-ai/sdk`) 0.131.0: MIT License. Used by the self-hosted
    server only; messages to Claude are billed by Anthropic to the key's owner.
- Other npm dependencies keep their own licenses, listed in `node_modules`.
