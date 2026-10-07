# The actors

Troupe ships a library of 30 actor presets
([`src/modules/actors/server/catalog.ts`](../src/modules/actors/server/catalog.ts)):
a name, a gender, an age range, a clothing style and a voice. Each one has six
pictures in [`public/actors/<actor>/v1/`](../public/actors):

| File | Shot | Size |
|---|---|---|
| `front.webp` | facing the camera, relaxed | 768 × 768 |
| `profile-left.webp`, `profile-right.webp` | side views, looking toward the left or right edge of the picture | 512 × 512 |
| `happy.webp`, `calm.webp`, `excited.webp` | expressions | 512 × 512 |

Beside them, `front-160.webp` and `front-320.webp` are smaller copies of the
front picture for the browser edition's landing page, made by
[`scripts/actors/thumbnails.sh`](../scripts/actors/thumbnails.sh) (cwebp).

Each folder also holds the actor's **voice sample**: `voice.webm` (Opus) and
`voice.m4a` (AAC, for browsers that cannot play Opus in WebM), a line of
three to five seconds in which they introduce themselves (see
[Voice samples](#voice-samples)).

The people in them are synthetic: they were generated, nobody was
photographed or named, and any resemblance to a real person is coincidental.
They are released under Troupe's MIT license (see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for the model's license).

## Where they are used

- **The app**, both the self-hosted studio and the browser edition: the actor
  library, the wizard's actor step, the project page and the script chat's
  recast proposals show the front picture, with the actor's initials on their
  colour while it loads or when it is missing. On the Actors page and the
  wizard's "Who plays it?" step, a button on each picture plays the actor's
  voice sample (nothing downloads until it is pressed, and one plays at a
  time).
- **The local renderers** (`renderer/` and the browser's): the actor card of
  each video shows the front picture, and switches (with a quarter-second
  cross-fade) to the happy, calm or excited one on lines tagged with that
  emotion.
- **Video models** receive the pictures' paths with each job
  (`script.actor.portraits`, [LOCAL-MODELS.md](LOCAL-MODELS.md#post-jobs)), so
  a server that animates a picture can start from the actor's own.

The database lists each actor's set (`troupe_actor_asset`); an actor whose set
has fewer than six pictures is shown as unavailable. A test
(`src/modules/actors/actors.test.ts`) fails when a picture or voice sample the
catalog declares is missing from `public/actors`, or when a sample no longer
matches the voice the renderers would cast.

## Replacing the cast

**Swap pictures.** Drop your own files in `public/actors/<actor>/v1/` with the
same names (WebP, square; other sizes are cropped to their centre), then run
`scripts/actors/thumbnails.sh` for the landing page's copies (or delete the
`front-*.webp` files: it falls back to `front.webp`). Rebuild the app and the
browser edition; restart the renderer (or rebuild its Docker image).

**Point at another folder or host**, without touching the repository:

| Where | Variable | Default |
|---|---|---|
| Self-hosted app (browsers load the pictures from here) | `TROUPE_ACTOR_PORTRAITS_URL` | `/actors` (Next serves `public/actors`) |
| Local renderer, run natively | `PORTRAITS_DIR` (absolute, or relative to the repository root) | `public/actors` in the checkout |
| Local renderer in Docker Compose | `TROUPE_RENDERER_PORTRAITS_DIR` | `./public/actors`, mounted read-only |
| Browser edition build | `VITE_PORTRAITS_DIR` | `public/actors`, copied to `/troupe/actors/` |

Each place expects the same layout: `<actor>/v1/front.webp` and so on, where
`<actor>` is the slug from the catalog (`lea-01`, `marcus-02`, …). The voice
samples go beside the pictures (`<actor>/v1/voice.webm`, `voice.m4a`), so the
app finds them wherever the pictures are. A folder without them still works:
an actor's play button goes away the first time their sample fails to load.

**Regenerate them** with the script that made them (below), after changing
the appearances or seeds in
[`scripts/actors/cast.json`](../scripts/actors/cast.json), and the voice
samples with `pnpm actors:voices` after changing an actor's voice or line
([Voice samples](#voice-samples)).

## How they were made

[`scripts/actors/generate.py`](../scripts/actors/generate.py) runs
[FLUX.2 \[klein\] 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
(Apache 2.0) through [MFLUX](https://github.com/filipstrand/mflux) on Apple
silicon, with the 8-bit MLX weights
[`mflux-community/flux2-klein-4b-mflux-q8`](https://huggingface.co/mflux-community/flux2-klein-4b-mflux-q8)
(8.6 GB, downloaded to the Hugging Face cache on first run).

```bash
# Every actor, every shot (needs uv and Node.js). About 70 minutes on a
# 16 GB Apple M5: ~25 s per front portrait, ~20 s per edit.
uv run --project scripts/actors python scripts/actors/generate.py
# Some actors or shots again
uv run --project scripts/actors python scripts/actors/generate.py --only lea-01,tom-23 --shots happy,calm
# A contact sheet of what is in public/actors, for review
uv run --project scripts/actors python scripts/actors/generate.py --sheet
```

1. The **front picture** comes from a prompt built from the catalog and the
   cast file: the actor's age (the middle of their range), appearance and
   clothing style, in the same studio (warm beige backdrop, soft key light,
   head and shoulders, centred, looking into the lens, no text). Each actor has
   a fixed seed in `cast.json`, so the same cast and model give the same
   pictures.
2. The **five other shots are edits of the front one**: FLUX.2 [klein] takes it
   as a reference image with an instruction ("make the person smile broadly …
   keep exactly the same person, clothes, light and backdrop"). This keeps the
   face, the hair and the clothes far better than the alternatives, which the
   script still offers for comparison (`--derive`):
   - `img2img` (the front picture re-noised at strength 0.45 under the shot's
     prompt) keeps the face but cannot turn the head: the "side views" stay
     facing the camera, and the expressions are timid.
   - `prompt` (the front picture's seed under the shot's prompt) changes the
     person: hair length, age and clothes drift, and side views come out as
     three-quarter views.
3. Every picture was reviewed on a contact sheet. The first fronts all wore
   the same six outfits, so 20 actors got their own clothes (`wear` in
   `cast.json`); two looks were rewritten and reseeded (Louis came out with
   too light a skin for his description, Elsa's had a thin frame drawn
   around her). The edits came out right the first time.
4. The full-size PNGs stay in `scripts/actors/raw/` (not committed), which the
   edits read as their reference; the published files are WebP at quality 80.

Settings for the script:

| Variable | Default | |
|---|---|---|
| `ACTOR_IMAGE_MODEL` | `mflux-community/flux2-klein-4b-mflux-q8` | the weights: a Hugging Face repo or a local folder (another FLUX.2 [klein] 4B conversion, e.g. `-q4` for less memory) |
| `ACTOR_IMAGE_STEPS` | `4` | denoising steps |
| `ACTOR_IMAGE_SIZE` | `1024` | the front portraits' side, in pixels |
| `ACTOR_IMAGE_EDIT_SIZE` | `768` | the other shots' side, and the reference they are edited from |

The edits use about 3.5 GB: the five edit instructions are the same for
every actor, so they are encoded once and the text encoder is freed. Fronts
need the whole model, about 11 GB. `--resume` picks an interrupted run up
where it stopped: it keeps the front portraits already in
`scripts/actors/raw/` and the shots already edited from them. To redraw a
front, run without `--resume` for that actor (`--only <actor>`); its five
other shots are then redone from the new one on the next `--resume` run.

## Voice samples

Each library actor has a Kokoro voice of their own, `voice` in the catalog
([`catalog.ts`](../src/modules/actors/server/catalog.ts)): the twelve voices
of the default casting (`KOKORO_VOICES` in
[`src/modules/scene/voice.ts`](../src/modules/scene/voice.ts)), two or three
actors each. Troupe sends it with each job (`script.actor.voice`), and both
renderers read the actor's lines with it, at the speed their voice profile
sets, so an actor sounds the same on every install and like their sample.
Custom actors, and actors whose voice a custom `KOKORO_VOICES` map leaves
out, get one picked from the pools instead (per install, so no sample can
match them).

[`scripts/actors/voices.ts`](../scripts/actors/voices.ts) records the samples
with that same pipeline: `voiceFor` from the scene module picks the voice and
speed (plain delivery), and the renderer's Kokoro setup
(`renderer/src/kokoro.ts`, `onnx-community/Kokoro-82M-v1.0-ONNX` at `q8`)
reads the actor's `line` from `cast.json`. ffmpeg evens out the loudness
(-18 LUFS) and encodes Opus at 24 kb/s in WebM and AAC at 32 kb/s in MP4,
mono: about 11 and 16 KB a sample, 0.8 MB for the cast. A rerun gives the
same bytes. What was used (model, weights, kokoro-js version, voice map,
each actor's voice, speed, line and length) is written to
[`scripts/actors/voices.json`](../scripts/actors/voices.json).

```bash
# Every actor (needs ffmpeg with libopus; the weights, ~90 MB, download once
# into ~/.cache/troupe-renderer, shared with the renderer). Under a minute.
pnpm actors:voices
# Some actors again, after changing their line in cast.json
pnpm actors:voices --only aiko-03,tom-23
# Another cast folder (its settings go to <folder>/voices.json)
pnpm actors:voices --dir /path/to/cast
```

`KOKORO_DTYPE`, `KOKORO_VOICES` and `KOKORO_CACHE` work as for the renderer.
The voices are synthetic: Kokoro-82M and kokoro-js are under the Apache
License 2.0 ([THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)); the
samples are released under Troupe's MIT license.
