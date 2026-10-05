"""Generates the actor library's portrait sets (public/actors/<slug>/v1/*.webp).

Each actor in src/modules/actors/server/catalog.ts gets six shots: a front
portrait, two side views and three expressions. The front portrait is drawn
from a text prompt; the five others are edits of it with FLUX.2 [klein] 4B's
reference-image editing, so they keep the same face, hair, clothes and light.

    uv run --project scripts/actors python scripts/actors/generate.py
    uv run --project scripts/actors python scripts/actors/generate.py --only lea-01,tom-23 --shots happy
    uv run --project scripts/actors python scripts/actors/generate.py --sheet

The cast (scripts/actors/cast.json) gives each actor's appearance and seed;
the catalog gives the name, gender, age range and clothing style. Same cast,
same model, same seeds: the same pictures.

Options (all optional):

    --only SLUGS      comma-separated actors to (re)generate (default: all)
    --shots SHOTS     comma-separated shots: front, profile-left,
                      profile-right, happy, calm, excited (default: all);
                      without front, the saved front portrait is reused
    --derive METHOD   how the five other shots are made from the front one:
                      edit (default; reference-image editing), img2img (the
                      front portrait re-noised with --strength) or prompt
                      (the front's seed with a changed prompt)
    --strength N      img2img strength (default 0.45)
    --out DIR         where the WebP files go (default: public/actors)
    --raw DIR         where full-size PNGs are kept for review and as edit
                      references (default: scripts/actors/raw, not committed)
    --sheet           only build raw/contact-sheet.jpg from the WebP files

Environment:

    ACTOR_IMAGE_MODEL   mflux weights: a Hugging Face repo or a local folder
                        (default: mflux-community/flux2-klein-4b-mflux-q8)
    ACTOR_IMAGE_STEPS   denoising steps (default 4, the distilled model's)
    ACTOR_IMAGE_SIZE    side of the front portraits in pixels (default 1024)
    ACTOR_IMAGE_EDIT_SIZE
                        side of the other shots and of the front portrait
                        they are edited from (default 768: published at 512,
                        and about twice as fast as 1024)
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
DEFAULT_MODEL = "mflux-community/flux2-klein-4b-mflux-q8"
SHOTS = ("front", "profile-left", "profile-right", "happy", "calm", "excited")
# Published sizes: the front portrait is the one shown large.
WEBP_SIDE = {"front": 768}
WEBP_SIDE_OTHERS = 512
WEBP_QUALITY = 80

AGES = {"18-24": 22, "25-34": 30, "35-44": 40, "45-54": 50, "55+": 62}
PEOPLE = {"female": "woman", "male": "man", "nonbinary": "person"}
WARDROBE = {
    "casual": "a plain crew-neck t-shirt under an open denim jacket",
    "formal": "a tailored charcoal blazer over a crisp white shirt",
    "sporty": "a fitted athletic zip-up track jacket",
    "streetwear": "an oversized hoodie in a muted colour",
    "creative": "a patterned button-up shirt with a small enamel pin",
    "cozy": "a chunky cream knit sweater",
}

STUDIO = (
    "Plain seamless warm beige studio backdrop, soft key light from the front left with gentle fill, "
    "natural skin texture with visible pores, sharp focus on the eyes, 85mm portrait lens, "
    "photorealistic, high detail. No text, no logo, no watermark, no jewellery added."
)
FRAMING = "Head-and-shoulders portrait, centred in a square frame, with space above the head."

# How each shot differs from the front portrait. Side views use the image's
# own left and right: profile-left looks toward the left edge of the frame.
EXPRESSIONS = {
    "front": "facing the camera and looking straight into the lens with a friendly, relaxed expression and a slight closed-mouth smile",
    "happy": "facing the camera and looking into the lens with a big genuine smile showing teeth, cheeks raised, eyes crinkled",
    "calm": "facing the camera and looking into the lens with a serene, peaceful expression, relaxed brow, lips gently closed",
    "excited": "facing the camera and looking into the lens, thrilled and amazed: eyebrows raised, eyes wide, mouth open in an excited smile",
    "profile-left": "head and shoulders turned to a side profile, facing the left edge of the image, nose pointing left, neutral expression",
    "profile-right": "head and shoulders turned to a side profile, facing the right edge of the image, nose pointing right, neutral expression",
}
KEEP = (
    "Keep exactly the same person: same face, identity, age, skin tone, hair, clothes, lighting, "
    "beige studio backdrop and framing. Photorealistic."
)
EDITS = {
    "happy": "Make the person smile broadly with a big genuine smile showing teeth, cheeks raised and eyes crinkled, still looking into the camera.",
    "calm": "Give the person a serene, peaceful expression with a relaxed brow and gently closed lips, still looking into the camera.",
    "excited": "Make the person look thrilled and amazed: eyebrows raised, eyes wide and mouth open in an excited smile, still looking into the camera.",
    "profile-left": "Turn the person's head and shoulders to show a side profile view facing the left edge of the image (nose pointing left), with a neutral expression.",
    "profile-right": "Turn the person's head and shoulders to show a side profile view facing the right edge of the image (nose pointing right), with a neutral expression.",
}


def env(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def load_cast() -> list[dict]:
    """The catalog's actors, read with Node (it runs the TypeScript file as
    is), joined with their appearance and seed from cast.json."""
    script = (
        "const { ACTOR_CATALOG } = await import(process.argv[1]);"
        "process.stdout.write(JSON.stringify(ACTOR_CATALOG));"
    )
    catalog_file = ROOT / "src/modules/actors/server/catalog.ts"
    out = subprocess.run(
        ["node", "--input-type=module", "-e", script, catalog_file.as_uri()],
        check=True, capture_output=True, text=True,
    ).stdout
    looks = json.loads((HERE / "cast.json").read_text())
    cast = []
    for actor in json.loads(out):
        if actor["slug"] not in looks:
            sys.exit(f"scripts/actors/cast.json has no entry for {actor['slug']}.")
        cast.append({**actor, **looks[actor["slug"]]})
    return cast


def person(actor: dict) -> str:
    return f"a {AGES[actor['ageRange']]}-year-old {actor['look']}"


def prompt_for(actor: dict, shot: str) -> str:
    wardrobe = actor.get("wear") or WARDROBE[actor["style"]]
    return (
        f"{FRAMING} Studio photograph of {person(actor)}, {EXPRESSIONS[shot]}. "
        f"Wearing {wardrobe}. {STUDIO}"
    )


def edit_prompt(actor: dict, shot: str) -> str:
    return f"{EDITS[shot]} {KEEP}"


def seed_for(actor: dict, shot: str) -> int:
    """The actor's seed, unless cast.json pins another for this shot."""
    return int(actor.get("seeds", {}).get(shot, actor["seed"]))


def save_webp(image: Image.Image, path: Path, shot: str) -> None:
    side = WEBP_SIDE.get(shot, WEBP_SIDE_OTHERS)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").resize((side, side), Image.LANCZOS).save(path, "WEBP", quality=WEBP_QUALITY, method=6)


def contact_sheet(cast: list[dict], out: Path, raw: Path) -> Path:
    """Every published picture in a grid, one actor per row, for review."""
    cell, label = 192, 220
    sheet = Image.new("RGB", (label + cell * len(SHOTS), cell * len(cast)), "white")
    draw = ImageDraw.Draw(sheet)
    for row, actor in enumerate(cast):
        draw.text((8, row * cell + 8), f"{actor['slug']}\n{actor['gender']} {actor['ageRange']}\n{actor['style']}", fill="black")
        for col, shot in enumerate(SHOTS):
            file = out / actor["slug"] / "v1" / f"{shot}.webp"
            if file.exists():
                sheet.paste(Image.open(file).convert("RGB").resize((cell, cell)), (label + col * cell, row * cell))
    raw.mkdir(parents=True, exist_ok=True)
    path = raw / "contact-sheet.jpg"
    sheet.save(path, quality=85)
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", default="")
    parser.add_argument("--shots", default=",".join(SHOTS))
    parser.add_argument("--derive", choices=("edit", "img2img", "prompt"), default="edit")
    parser.add_argument("--strength", type=float, default=0.45)
    parser.add_argument("--out", type=Path, default=ROOT / "public/actors")
    parser.add_argument("--raw", type=Path, default=HERE / "raw")
    parser.add_argument("--sheet", action="store_true")
    args = parser.parse_args()

    cast = load_cast()
    if args.only:
        wanted = set(args.only.split(","))
        unknown = wanted - {a["slug"] for a in cast}
        if unknown:
            sys.exit(f"Unknown actors: {', '.join(sorted(unknown))}.")
        cast = [a for a in cast if a["slug"] in wanted]
    if args.sheet:
        print(contact_sheet(cast, args.out, args.raw))
        return
    shots = [s for s in SHOTS if s in args.shots.split(",")]
    if not shots:
        sys.exit(f"--shots takes some of: {', '.join(SHOTS)}.")

    # Imported here so --help and --sheet work without the model's packages.
    import mlx.core as mx
    from mflux.models.common.config import ModelConfig
    from mflux.models.flux2.variants import Flux2Klein, Flux2KleinEdit

    model_path = env("ACTOR_IMAGE_MODEL", DEFAULT_MODEL)
    steps = int(env("ACTOR_IMAGE_STEPS", "4"))
    size = int(env("ACTOR_IMAGE_SIZE", "1024"))
    edit_size = int(env("ACTOR_IMAGE_EDIT_SIZE", "768"))

    def load(pipeline):
        return pipeline(model_config=ModelConfig.flux2_klein_4b(), model_path=model_path)

    def save(actor: dict, shot: str, image: Image.Image, seed: int, started: float) -> None:
        # Free MLX's buffer cache between pictures: on a 16 GB Mac it otherwise
        # grows into swap and each picture takes twice as long as the last.
        mx.clear_cache()
        image.save(args.raw / actor["slug"] / f"{shot}.png")
        save_webp(image, args.out / actor["slug"] / "v1" / f"{shot}.webp", shot)
        print(json.dumps({"actor": actor["slug"], "shot": shot, "seed": seed, "seconds": round(time.monotonic() - started, 1)}), flush=True)

    # Pictures drawn from a prompt alone (the fronts, and every shot with
    # --derive prompt) come first, then the shots made from the front one.
    # One pipeline is loaded at a time: each holds the whole model.
    drawn = [s for s in shots if s == "front" or args.derive == "prompt"]
    derived = [s for s in shots if s not in drawn]
    if drawn:
        model = load(Flux2Klein)
        for actor in cast:
            (args.raw / actor["slug"]).mkdir(parents=True, exist_ok=True)
            for shot in drawn:
                started, seed = time.monotonic(), seed_for(actor, shot)
                image = model.generate_image(seed=seed, prompt=prompt_for(actor, shot), num_inference_steps=steps, width=size, height=size).image
                save(actor, shot, image, seed, started)
        del model
        gc.collect()
        mx.clear_cache()
    if derived:
        missing = [a["slug"] for a in cast if not (args.raw / a["slug"] / "front.png").exists()]
        if missing:
            sys.exit(f"No front portrait in {args.raw} for {', '.join(missing)}: generate it first (--shots front).")
        model = load(Flux2Klein if args.derive == "img2img" else Flux2KleinEdit)
        for actor in cast:
            # The reference at the edit size: fewer image tokens to attend to.
            front = args.raw / actor["slug"] / f"front-{edit_size}.png"
            Image.open(args.raw / actor["slug"] / "front.png").convert("RGB").resize((edit_size, edit_size), Image.LANCZOS).save(front)
            for shot in derived:
                started, seed = time.monotonic(), seed_for(actor, shot)
                if args.derive == "img2img":
                    image = model.generate_image(
                        seed=seed, prompt=prompt_for(actor, shot), num_inference_steps=steps, width=edit_size, height=edit_size,
                        image_path=front, image_strength=args.strength,
                    ).image
                else:
                    image = model.generate_image(
                        seed=seed, prompt=edit_prompt(actor, shot), num_inference_steps=steps, width=edit_size, height=edit_size,
                        image_paths=[front],
                    ).image
                save(actor, shot, image, seed, started)

    print(contact_sheet(cast, args.out, args.raw))


if __name__ == "__main__":
    main()
