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
- npm dependencies keep their own licenses, listed in `node_modules`.
