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
- Other npm dependencies keep their own licenses, listed in `node_modules`.
