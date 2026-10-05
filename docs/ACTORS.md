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

The people in them are synthetic: they were generated, nobody was
photographed or named, and any resemblance to a real person is coincidental.
They are released under Troupe's MIT license (see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for the model's license).

## Where they are used

- **The app**, both the self-hosted one and the static site: the actor
  library, the wizard's actor step, the project page and the script chat's
  recast proposals show the front picture, with the actor's initials on their
  colour while it loads or when it is missing.
- **The local renderers** (`renderer/` and the browser's): the actor card of
  each video shows the front picture, and switches (with a quarter-second
  cross-fade) to the happy, calm or excited one on lines tagged with that
  emotion.
- **Video models** receive the pictures' paths with each job
  (`script.actor.portraits`, [LOCAL-MODELS.md](LOCAL-MODELS.md#post-jobs)), so
  a server that animates a picture can start from the actor's own.

The database lists each actor's set (`troupe_actor_asset`); an actor whose set
has fewer than six pictures is shown as unavailable. A test
(`src/modules/actors/actors.test.ts`) fails when a file the catalog declares is
missing from `public/actors`.

## Replacing the cast

**Swap pictures.** Drop your own files in `public/actors/<actor>/v1/` with the
same names (WebP, square; other sizes are cropped to their centre). Rebuild the
app and the static site; restart the renderer (or rebuild its Docker image).

**Point at another folder or host**, without touching the repository:

| Where | Variable | Default |
|---|---|---|
| Self-hosted app (browsers load the pictures from here) | `TROUPE_ACTOR_PORTRAITS_URL` | `/actors` (Next serves `public/actors`) |
| Local renderer, run natively | `PORTRAITS_DIR` | `public/actors` in the checkout |
| Local renderer in Docker Compose | `TROUPE_RENDERER_PORTRAITS_DIR` | `./public/actors`, mounted read-only |
| Static site build | `VITE_PORTRAITS_DIR` | `public/actors`, copied to `/troupe/actors/` |

Each place expects the same layout: `<actor>/v1/front.webp` and so on, where
`<actor>` is the slug from the catalog (`lea-01`, `marcus-02`, …).

**Regenerate them** with the script that made them (below), after changing
the appearances or seeds in
[`scripts/actors/cast.json`](../scripts/actors/cast.json).

## How they were made

[`scripts/actors/generate.py`](../scripts/actors/generate.py) runs
[FLUX.2 \[klein\] 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
(Apache 2.0) through [MFLUX](https://github.com/filipstrand/mflux) on Apple
silicon, with the 8-bit MLX weights
[`mflux-community/flux2-klein-4b-mflux-q8`](https://huggingface.co/mflux-community/flux2-klein-4b-mflux-q8)
(8.6 GB, downloaded to the Hugging Face cache on first run).

```bash
# Every actor, every shot (needs uv and Node.js; about 70 minutes on a 16 GB Apple M5: ~25 s per front portrait, ~20 s per edit)
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
   too light a skin for his description, Elsa's crop was off). The edits came
   out right the first time.
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
where it stopped.
