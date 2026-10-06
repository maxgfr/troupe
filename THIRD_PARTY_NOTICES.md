# Third-party notices

Troupe's own code is MIT licensed. Some distributions include third-party
programs under other licenses, listed below.

## The GNU GPL parts, in plain words

- **The browser edition and the local renderer include eSpeak NG (GPL
  version 3 or later).** kokoro-js turns text into phonemes with
  [phonemizer](https://github.com/xenova/phonemizer.js), which embeds eSpeak
  NG compiled to WebAssembly. It is bundled into the browser edition's render
  worker (`site/dist`, the `troupe-web` image, any site you publish from it)
  and loaded into the renderer's own process (`troupe-renderer`,
  `pnpm renderer`). Troupe treats each of those builds as a combined work:
  whoever distributes one distributes it under the GNU GPL version 3 or
  later as a whole, with this repository as its source (Troupe's MIT code
  is compatible with the GPL) and eSpeak NG's own source. Troupe's source
  files themselves stay MIT, and so does any part of Troupe you use without
  kokoro-js, such as the studio's server and the CLI.
- **yt-dlp's self-contained build bundles GNU Readline (GPL version 3 or
  later)** and other GNU libraries (below). The studio's image
  (`ghcr.io/maxgfr/troupe`) ships that build as a separate program and runs
  it as one, so the image is an aggregate, not a combined work: the yt-dlp
  binary carries the GPL's terms, the studio does not. Build the image with
  `--build-arg TROUPE_YTDLP=0` to leave it out.
- **FFmpeg** (GPL) is in the studio's and the renderer's images and is run as
  a separate program, the same way.

The GNU GPL version 3's full text is in
[LICENSES/GPL-3.0.txt](LICENSES/GPL-3.0.txt), as published at
<https://www.gnu.org/licenses/gpl-3.0.txt>. The studio's, the renderer's, the
CLI's and the `troupe-web` images carry it in `/usr/share/doc/troupe/` with
Troupe's `LICENSE` and this file; the built browser edition carries all three
at `<base>licenses/` (linked from the landing page's footer).

## Components

- **FFmpeg / FFprobe.** The studio's Docker image installs Alpine Linux's
  `ffmpeg` package and the renderer's image (`troupe-renderer`) Debian's;
  Vercel builds bundle the static `ffprobe` binary from
  [`@ffprobe-installer/linux-x64`](https://www.npmjs.com/package/@ffprobe-installer/linux-x64).
  All are built from [FFmpeg](https://ffmpeg.org) and licensed under the GNU
  GPL (version 2 or later, or version 3 for some builds). Troupe runs them as
  separate programs. Their source is available from
  [ffmpeg.org](https://ffmpeg.org/download.html), the
  [Alpine aports](https://gitlab.alpinelinux.org/alpine/aports) repository and
  [Debian's sources](https://sources.debian.org/src/ffmpeg/).
- **The Docker images' base systems.** The published images
  (`ghcr.io/maxgfr/troupe`, `troupe-renderer`, `troupe-ollama`, `troupe-web`,
  `troupe-cli`) are built on the official [Node.js](https://github.com/nodejs/docker-node)
  images (Node.js: MIT License; Alpine Linux 3 or Debian 12), on
  [Ubuntu](https://ubuntu.com/legal/intellectual-property-policy) 24.04
  (`troupe-ollama`) and on [nginx-unprivileged](https://github.com/nginx/docker-nginx-unprivileged)
  (Alpine Linux with [nginx](https://nginx.org/LICENSE), BSD 2-Clause License;
  `troupe-web`). Each system package keeps its own license, listed in the
  image (`/usr/share/doc`, `/usr/share/licenses` or `apk info`). The stack
  also runs the official [PostgreSQL](https://www.postgresql.org/about/licence/)
  image (`postgres:16-alpine`, PostgreSQL License), which Troupe does not
  rebuild.
- **Ollama** (`troupe-ollama`, the stack's chat server). The image copies the
  `ollama` program and its CPU libraries from the official
  [`ollama/ollama`](https://hub.docker.com/r/ollama/ollama) image, unmodified,
  at the version pinned in `ollama/Dockerfile`, leaving out its GPU libraries.
  [`ollama/NOTICE`](ollama/NOTICE), installed as `/usr/share/doc/ollama/NOTICE`,
  says where each license lives in the image:
  - [Ollama](https://github.com/ollama/ollama): MIT License, vendored from that
    tag as `ollama/LICENSE.ollama` and installed as
    `/usr/share/doc/ollama/LICENSE` (the official image does not carry it).
  - [llama.cpp and ggml](https://github.com/ggml-org/llama.cpp) (MIT License,
    with the code it vendors), [cpp-httplib](https://github.com/yhirose/cpp-httplib)
    (MIT License) and the Go runtime compiled into `ollama` (BSD 3-Clause
    License): their license files, from the official image, under
    `/usr/lib/ollama` (`LLAMA_CPP_LICENSE`, `LLAMA_CPP_VENDORS_LICENSE`,
    `CPP_HTTPLIB_LICENSE`, `GO_LICENSE`).
  - GNU OpenMP (`/usr/lib/ollama/libgomp.so.1`), part of
    [GCC](https://gcc.gnu.org): GNU General Public License version 3 with the
    GCC Runtime Library Exception 3.1; the texts are in the image's
    `/usr/share/doc/gcc-14-base/copyright` and
    `/usr/share/common-licenses/GPL-3`, the source at gcc.gnu.org and in
    Ubuntu's gcc packages.
  - LLVM OpenMP (`/usr/lib/ollama/libomp.so`), part of the
    [LLVM project](https://github.com/llvm/llvm-project): Apache License 2.0
    with LLVM Exceptions (https://llvm.org/LICENSE.txt).
  The image's build fails if one of these files is missing, and
  `pnpm e2e:docker` checks them. `docker-compose.gpu.yml` builds the official
  image itself (the `gpu` target, with the same two files added), which also
  carries NVIDIA's CUDA libraries under [NVIDIA's license](https://docs.nvidia.com/cuda/eula/).
- **ComfyUI workflows.** `ltx2_t2v_fp8.json` and `wan2_2_ti2v_5b.json` in
  `src/modules/generation/server/adapters/comfyui/templates/` are derived from
  [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates)
  (MIT); `ltxv_2b_distilled.json` is Troupe's own (MIT). The model weights they
  reference are not distributed with Troupe and carry their own licenses
  (LTX-2: LTX-2 Community License Agreement, free for commercial use under a
  revenue threshold; Wan 2.2: Apache 2.0; LTX-Video 2B 0.9.8 distilled:
  [LTXV Open Weights License](https://huggingface.co/Lightricks/LTX-Video/blob/main/LTX-Video-Open-Weights-License-0.X.txt),
  a paid license for entities with $10M or more in annual revenue, and the
  use-based restrictions of its Attachment A (section 4), which section 3.1
  requires you to pass on, with notice, to anyone you distribute the model or
  its derivatives to; the T5-XXL text encoder
  (`t5xxl_fp16.safetensors`, Google's T5 v1.1): Apache 2.0).
- **Kokoro-82M voice model.** The in-browser renderer (browser edition) and the
  local renderer (`renderer/`) download
  [`onnx-community/Kokoro-82M-v1.0-ONNX`](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX),
  an ONNX export of [`hexgrad/Kokoro-82M`](https://huggingface.co/hexgrad/Kokoro-82M),
  weights and voice files, from Hugging Face at run time. Both model cards
  declare the Apache License 2.0. Troupe does not distribute the weights.
- **Speech and video libraries bundled into the browser edition** (`site/dist`,
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
- **The browser edition's database.** [PGlite](https://github.com/electric-sql/pglite)
  (`@electric-sql/pglite`) 0.5: PostgreSQL compiled to WebAssembly, bundled
  into the browser edition (a worker, with its `.wasm` and data files) to
  keep projects in the visitor's browser; the test suite runs on it too.
  Dual-licensed under the Apache License 2.0 and the PostgreSQL License, at
  the user's choice; its changes to PostgreSQL are under the PostgreSQL
  License.
- **The rest of the browser edition's bundle.** React and React DOM, React
  Router, HeroUI, TanStack Query, tRPC, superjson and Zod (MIT License) and
  Drizzle ORM (Apache License 2.0), bundled unmodified; their license files
  are in `node_modules`.
- **Geist font.** The browser edition ships Geist (`@fontsource-variable/geist`)
  and draws the video captions with it; the local renderer ships it too
  (`@fontsource/geist-sans`). Geist is licensed under the SIL Open Font
  License 1.1.
- **Bricolage Grotesque and JetBrains Mono fonts.** The browser edition and
  its landing page ship them (`@fontsource-variable/bricolage-grotesque`,
  `@fontsource-variable/jetbrains-mono`), and the presentation video's title
  cards are drawn with them. Both are licensed under the SIL Open Font License
  1.1.
- **Script chat.**
  - [WebLLM](https://github.com/mlc-ai/web-llm) (`@mlc-ai/web-llm`) 0.2.85:
    Apache License 2.0. Bundled into the browser edition (a worker chunk and a
    chunk loaded when the chat is first used). At run time it fetches the
    model's compiled WebGPU library from
    [mlc-ai/binary-mlc-llm-libs](https://github.com/mlc-ai/binary-mlc-llm-libs)
    (Apache License 2.0).
  - Qwen2.5-1.5B-Instruct weights, the browser edition's default chat model, downloaded
    by the visitor's browser from
    [`mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC`](https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC),
    a quantization of [`Qwen/Qwen2.5-1.5B-Instruct`](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct),
    whose model card declares the Apache License 2.0 (other Qwen2.5 sizes,
    such as 3B and 72B, use other licenses). Troupe does not distribute the
    weights.
  - The self-hosted chat's default Ollama model, `qwen3:4b`
    ([Qwen/Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B), Apache License
    2.0), downloaded from the Ollama library by the stack's `ollama` service
    on its first start (or pulled by the user into their own Ollama). The
    Docker end-to-end tests (`pnpm e2e:docker`, CI) download `qwen2.5:0.5b`
    ([Qwen/Qwen2.5-0.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct),
    Apache License 2.0) instead. Troupe does not distribute either model's
    weights.
  - [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
    (`@anthropic-ai/sdk`) 0.131.0: MIT License. Used by the self-hosted
    server only; messages to Claude are billed by Anthropic to the key's owner.
- **The local renderer's AI video mode** (`renderer/ltx/`, opt-in, in none of
  the published images). Troupe distributes none of the following; `uv`
  installs the Python packages into `renderer/ltx/.venv` (or, for the `ltx`
  Compose profile, into an image built on the user's machine from
  `renderer/Dockerfile`, with Debian's Python 3.11 and the
  [uv](https://github.com/astral-sh/uv) binary from its official image, MIT
  License or Apache License 2.0) and Hugging Face serves the weights when the
  user runs `pnpm renderer:ltx:setup` or the mode's first job.
  - LTX-Video 2B 0.9.8 distilled weights
    (`ltxv-2b-0.9.8-distilled.safetensors` from
    [`Lightricks/LTX-Video`](https://huggingface.co/Lightricks/LTX-Video)):
    [LTXV Open Weights License 0.X](https://huggingface.co/Lightricks/LTX-Video/blob/main/LTX-Video-Open-Weights-License-0.X.txt)
    by Lightricks Ltd., not an open-source license. It grants a royalty-free
    license "for any purpose" except that "entities with annual revenues of
    at least $10,000,000" need a paid commercial license, and it binds every
    use to the restrictions of its Attachment A, which anyone redistributing
    the model must pass on. Among them, not to use the model "To generate or
    disseminate information and/or content … without expressly and
    intelligibly disclaiming that the information and/or content is machine
    generated", nor "To impersonate or attempt to impersonate (e.g.
    deepfakes) others without their consent". The 2B 0.9.5 checkpoint, which
    `LTX_MODEL` can select, uses Lightricks' Open RAIL-M license (March 5,
    2025) instead: commercial use with no revenue threshold, under much the
    same use restrictions.
  - T5 v1.1 XXL text encoder and tokenizer, loaded from
    [`Lightricks/LTX-Video-0.9.5`](https://huggingface.co/Lightricks/LTX-Video-0.9.5)
    (a copy of [`google/t5-v1_1-xxl`](https://huggingface.co/google/t5-v1_1-xxl)'s
    encoder, whose model card declares the Apache License 2.0). The LTX-Video
    0.9.5 scheduler and model configs come from the same repository.
  - [PyTorch](https://github.com/pytorch/pytorch) 2.14: BSD 3-Clause License;
    its wheels bundle third-party code under the Apache License 2.0 (some
    with the LLVM exception), BSD 2-Clause, Boost (BSL-1.0) and MIT licenses.
    On Linux (x86-64 and ARM64) its wheels depend on NVIDIA's CUDA libraries (the
    `nvidia-*` packages), under [NVIDIA's license](https://docs.nvidia.com/cuda/eula/).
  - [Diffusers](https://github.com/huggingface/diffusers) 0.40,
    [Transformers](https://github.com/huggingface/transformers) 5.18,
    [Accelerate](https://github.com/huggingface/accelerate) 1.15,
    [huggingface_hub](https://github.com/huggingface/huggingface_hub) 1.33,
    [safetensors](https://github.com/huggingface/safetensors) 0.8,
    [tokenizers](https://github.com/huggingface/tokenizers) 0.23 and
    [SentencePiece](https://github.com/google/sentencepiece) 0.2: Apache
    License 2.0.
  - [NumPy](https://github.com/numpy/numpy) 2.5: BSD 3-Clause License (with
    bundled code under 0BSD, MIT, Zlib and CC0-1.0).
  - [Protocol Buffers](https://github.com/protocolbuffers/protobuf) (`protobuf`)
    7.36, which Transformers needs to read the T5 tokenizer: BSD 3-Clause
    License.
  - Their other dependencies, pinned in `renderer/ltx/uv.lock`, keep their
    own licenses, listed in the installed packages' metadata.
- **The actors' pictures** (`public/actors/`, 180 WebP files, plus 60
  smaller copies of the front pictures made from them with cwebp). They show
  synthetic people: no real person was photographed or described by name,
  and any resemblance to a real person is coincidental. They are released
  under this repository's MIT license. They were generated on a Mac with
  `scripts/actors/generate.py`, which Troupe does not run; `uv` installs its
  Python packages and Hugging Face serves the weights when someone runs it:
  - FLUX.2 [klein] 4B by Black Forest Labs
    ([`black-forest-labs/FLUX.2-klein-4B`](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)),
    Apache License 2.0, including its Qwen3 text encoder; used as the
    8-bit MLX conversion
    [`mflux-community/flux2-klein-4b-mflux-q8`](https://huggingface.co/mflux-community/flux2-klein-4b-mflux-q8),
    which keeps that license. The model card places no restriction on the
    images it makes. (FLUX.2 [klein] 9B uses Black Forest Labs' non-commercial
    license and is not used.)
  - [MFLUX](https://github.com/filipstrand/mflux) 0.21.0 (MIT License) on
    [MLX](https://github.com/ml-explore/mlx) 0.32 (MIT License), and
    [Pillow](https://github.com/python-pillow/Pillow) (MIT-CMU License) for
    the WebP files. Their other dependencies, pinned in
    `scripts/actors/uv.lock`, keep their own licenses.
- **The inspiration library** (`docs/LIBRARY.md`). Troupe distributes no
  model weights; each is downloaded at run time from where it is published.
  - Transcription in the self-hosted studio: the renderer image installs, with
    `uv` from `renderer/whisper/uv.lock`, [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
    1.2.1 (MIT License) on [CTranslate2](https://github.com/OpenNMT/CTranslate2)
    4.8 (MIT License), with [PyAV](https://github.com/PyAV-Org/PyAV) 16.1
    (BSD 3-Clause License; its wheels bundle FFmpeg's libraries, built under
    the GNU LGPL version 2.1 or later), [ONNX Runtime](https://github.com/microsoft/onnxruntime)
    1.30 (MIT License, for the voice detector),
    [tokenizers](https://github.com/huggingface/tokenizers) 0.23 and
    [huggingface_hub](https://github.com/huggingface/huggingface_hub) 1.33
    (Apache License 2.0), [NumPy](https://github.com/numpy/numpy) 2.5 (BSD
    3-Clause), [tqdm](https://github.com/tqdm/tqdm) (MPL 2.0 and MIT) and
    [certifi](https://github.com/certifi/python-certifi) (MPL 2.0); the other
    packages pinned there keep their own licenses. The weights,
    [`Systran/faster-whisper-base`](https://huggingface.co/Systran/faster-whisper-base)
    (or the size `WHISPER_MODEL` names; the end-to-end tests use `tiny`), are
    OpenAI's Whisper converted to CTranslate2, MIT License.
  - Transcription and search in the browser edition, run by Transformers.js
    (above): [`onnx-community/whisper-base`](https://huggingface.co/onnx-community/whisper-base),
    an ONNX export of [`openai/whisper-base`](https://huggingface.co/openai/whisper-base)
    (Apache License 2.0 on its model card; OpenAI released the Whisper code and
    weights on GitHub under the MIT License), and
    [`Xenova/multilingual-e5-small`](https://huggingface.co/Xenova/multilingual-e5-small),
    an ONNX export of [`intfloat/multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small)
    (MIT License). The exports declare no license of their own.
  - Search and vision in the self-hosted studio, pulled by the stack's
    `ollama` service: `qwen3-embedding:0.6b`
    ([Qwen/Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B))
    and `qwen3-vl:2b-instruct`
    ([Qwen/Qwen3-VL-2B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct)),
    both Apache License 2.0; the end-to-end tests use `all-minilm`
    ([sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2),
    Apache License 2.0).
  - [yt-dlp](https://github.com/yt-dlp/yt-dlp) 2026.08.19, in the app image
    (`ghcr.io/maxgfr/troupe`) unless it is built with `TROUPE_YTDLP=0`:
    The Unlicense (public domain). Its self-contained `musllinux` build
    (`yt-dlp_musllinux` on amd64, `yt-dlp_musllinux_aarch64` on arm64), which
    the image downloads and checks against the release's SHA-256 sum, bundles
    CPython 3.14 (PSF License 2.0) and libraries built on Alpine Linux 3.22,
    listed with their licenses in yt-dlp's
    [`THIRD_PARTY_LICENSES.txt`](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/THIRD_PARTY_LICENSES.txt)
    (OpenSSL 3 under the Apache License 2.0, among others). Troupe runs it as a
    separate program. The bundled libraries under the GNU licenses, read from
    both binaries of this release, and their source at those exact versions:
    - GNU Readline 8.2.13 (`libreadline.so.8`), GPL version 3 or later:
      [readline-8.2.tar.gz](https://ftp.gnu.org/gnu/readline/readline-8.2.tar.gz)
      with [patches 001 to 013](https://ftp.gnu.org/gnu/readline/readline-8.2-patches/),
      as packaged in [Alpine's aports, 3.22-stable](https://gitlab.alpinelinux.org/alpine/aports/-/tree/3.22-stable/main/readline);
    - GNU gettext's libintl 0.24.1 (`libintl.so.8`), LGPL version 2.1 or
      later: [gettext-0.24.1.tar.gz](https://ftp.gnu.org/gnu/gettext/gettext-0.24.1.tar.gz),
      as packaged in [aports](https://gitlab.alpinelinux.org/alpine/aports/-/tree/3.22-stable/main/gettext);
    - the GCC 14.2.0 runtime (`libgcc_s.so.1`), GPL version 3 with the GCC
      Runtime Library Exception: [gcc-14.2.0.tar.xz](https://ftp.gnu.org/gnu/gcc/gcc-14.2.0/gcc-14.2.0.tar.xz),
      as packaged in [aports](https://gitlab.alpinelinux.org/alpine/aports/-/tree/3.22-stable/main/gcc).
  - Articles and PDFs: [Readability](https://github.com/mozilla/readability)
    (`@mozilla/readability`) 0.6: Apache License 2.0;
    [linkedom](https://github.com/WebReflection/linkedom) 0.18: ISC License,
    with [htmlparser2](https://github.com/fb55/htmlparser2) (MIT),
    css-select, css-what, domhandler, domutils, entities and nth-check
    (BSD 2-Clause), cssom and html-escaper (MIT), boolbase and uhyphen (ISC);
    [unpdf](https://github.com/unjs/unpdf) 1.8 (MIT License), which bundles a
    build of Mozilla's [PDF.js](https://github.com/mozilla/pdf.js) (Apache
    License 2.0). unpdf is also bundled into the browser edition, in a chunk
    loaded when a PDF is read.
- **The CLI bundle** (`cli/dist/troupe.mjs`, built by `pnpm --filter
  troupe-cli build` with [esbuild](https://github.com/evanw/esbuild) 0.28,
  MIT License, which is not bundled) includes
  [tRPC](https://github.com/trpc/trpc)'s client (`@trpc/client` and the
  parts of `@trpc/server` it imports) 11.18,
  [superjson](https://github.com/flightcontrolhq/superjson) 2.2 with
  [copy-anything](https://github.com/mesqueeb/copy-anything) 4 and
  [is-what](https://github.com/mesqueeb/is-what) 5, and the
  [`@oxc-project/runtime`](https://github.com/oxc-project/oxc) helpers tRPC is
  compiled with: all MIT License.
- Other npm dependencies keep their own licenses, listed in `node_modules`.
