---
name: troupe-influencer
description: Use when the user wants a synthetic (fictional) influencer, spokesperson or UGC creator made with Troupe and their own API keys, then a series of short videos or photos with that same person (lip-synced talking heads, clips that keep the face, still posts); or wants a Troupe actor made from a description.
---

# Troupe influencer

Troupe makes a fictional person from a description and keeps them the same
from one video to the next: a photo model draws their six pictures (front,
two side views, three expressions), and every render that can take a picture
starts from their front picture. Everything runs on the user's own provider
keys; one OpenRouter key covers it all. You drive it with the `troupe` CLI
(see the `troupe` skill for the whole project loop: briefs, scripts, renders,
review, export).

Run every command with `--json` and read stdout. A refusal arrives on stderr
as `{"error":{"code","message","exitCode"}}`: the `message` says what to
change. `troupe <command> --help` is the reference for options.

## Guardrails

- **Fictional people only.** Describe a person who does not exist. Never a
  real or famous person's face, name or likeness, never "looks like <someone>",
  never a copy of a real creator's persona, channel or catchphrases. If the
  user asks for one, say no and offer an original character instead.
- **Label it as AI.** Every video and photo of this person is synthetic.
  When the user publishes, pass on the `disclosure` that `troupe export
  create` returns, and remind them to use the platform's AI label; never
  write captions that pass the person off as real.
- **Secrets stay out of the conversation.** Never ask for an API key or the
  access code in a message, a command line or your output. Ask the user to run
  `troupe keys set openrouter` in their own terminal (it prompts without
  echoing), or `troupe keys set openrouter --key-stdin < openrouter.key` from a
  file they made. Leave `~/.config/troupe/config.json` unread.
- **Spending is the user's call.** Every step below bills the user's account
  except the checks. Before each paid command, state what it costs and wait
  for a yes:

  | Step | Model | Price (OpenRouter list) |
  |---|---|---|
  | Make the actor | `black-forest-labs/flux-3-image-klein` | about $0.009 a picture, $0.05 for the six |
  | A photo of them | the same photo model | about $0.01 a photo |
  | Talking head, lip-synced | `heygen/avatar-iv` | $0.05 a second said |
  | Clip with sound from their picture | `google/veo-3.1-lite` | $0.05 a second at 720p with sound (4, 6 or 8 s) |
  | Cheap silent motion | `x-ai/grok-imagine-video` | $0.05 a second at 480p (1 to 15 s) |

  For a render, read `pricePerSecondUsd` from `troupe models list --json` and
  multiply by the clip's seconds; a talking head is billed for the seconds
  actually said, so its estimate is an upper bound. A series is several
  launches: give the total before the first one.
- **One launch per render.** Give every `--watch` `--timeout 500` and a Bash
  timeout of 600000 ms. After a command that was cut off or ended with exit 5,
  run `troupe render list --json` (or `troupe shots list --json`) before any
  launch: a running render is still yours; watch it, never launch it again.
- **Deleting is the user's call.** `troupe actors delete` only when asked.

## The loop

1. **Check.** `troupe doctor --providers --json`. Done when the row `account
   openrouter` is `ok` (a free request, nothing generated). If it is `skip`
   or `fail`, ask the user to save their key as above, then check again. If
   `troupe` itself is missing or not signed in, follow step 1 of the `troupe`
   skill.

2. **Persona.** Settle with the user who the person is: a first name, gender
   (`female`, `male` or `nonbinary`), an age range (`25-34`), a style
   (`casual`, `streetwear`, `formal`…), the look in one or two sentences
   (face, hair, skin, build, the clothes they wear in every video) and how
   they speak ("warm and upbeat, mid-tempo"). Specific, distinctive details
   (freckles, a yellow beanie, round glasses) keep them recognisable. Fill gaps
   with your own choices, say which, and check the name is not already taken
   (`troupe actors list --json`).

3. **Make them.** After the user agrees to about $0.05:

   ```bash
   troupe actors create --name Jade --gender female --age 25-34 --style casual \
     --look "Curly auburn hair, freckles, green eyes, mustard knit sweater" \
     --voice "warm and upbeat, mid-tempo" --json
   ```

   Bash timeout 300000 ms. It draws the front, then the five other pictures
   from it, and prints `costUsd` and `portraitUrl`. Done when `status` is
   `active` with `portraitCount` 6. Ask the user to look at the six pictures
   on the studio's Actors page and say whether the face is right. If not,
   `troupe actors delete <name> --yes` (once they agree) and make them again
   with a sharper `--look`.

4. **Models.** Add the ones the series needs, once (free):

   ```bash
   troupe models catalog-add openrouter heygen/avatar-iv --json
   troupe models catalog-add openrouter google/veo-3.1-lite --json
   troupe models catalog-add openrouter x-ai/grok-imagine-video --json
   ```

   Their keys are `openrouter-heygen-avatar-iv`, `openrouter-google-veo-3-1-lite`
   and `openrouter-x-ai-grok-imagine-video` (`troupe models list --json`
   lists `capabilities`: formats, `durationsS`, sound). `troupe models catalog
   --provider openrouter --json` shows the others with their prices.

5. **Plan the series.** With the user, list the posts: each one's goal, hook
   and length. Mix formats:
   - **Talking head** (Avatar IV): the person says the script to camera, lip
     synced, in a stock HeyGen voice of their gender and language (English,
     Spanish or French voices; other languages are read by the English one).
     Best for hooks, reviews, tips and calls to action.
   - **Clip with sound** (Veo 3.1 Lite): starts on their picture, then moves
     and speaks the line in a voice drawn from `--voice`; 4 to 8 s. Best for a
     reaction or a one-liner with some motion.
   - **Silent motion** (Grok Imagine Video): starts on their picture, no
     sound; for b-roll under a voice-over.
   - **Photos** for still posts: `troupe shots photo "<scene>" --actor <name>
     --format 3:4 --json` draws them from their front picture (`--format` is
     one the photo model lists).

6. **Script.** One project per post: `troupe projects create --title <t>
   --actor <name> --platform <p> --json`. Budget: clip seconds × 2.5 words.
   One spoken line each, hook first, call to action last, an emotion in front;
   lines hold only the words said:

   ```text
   [excited] Okay, this sweater changed my whole autumn.
   It's warm, it's soft, and it goes with literally everything.
   [calm] Link's in my bio.
   ```

   `troupe script set script.txt --json`; done when `estimatedDurationS` fits
   the clip.

7. **Render.** State the cost, wait for the yes, then:

   ```bash
   troupe render launch --model openrouter-heygen-avatar-iv --duration 10 --watch --timeout 500 --json
   ```

   For a talking head pick the shortest `durationsS` step the script fits
   (its clip lasts as long as the lines). For Veo 3.1 Lite, `--duration 4|6|8
   --resolution 720p`. A shot outside a project (no script):
   `troupe shots launch "<what happens>" --model <key> --actor <name>
   --duration 4 --format 9:16 --json`, then `troupe shots list --json`
   until it is `completed` (a talking head without `--actor` is refused before
   anything is billed). Exit 1 with a render on stdout: read `errorDetail`,
   fix the cause, `troupe render relaunch <id> --watch --timeout 500`. Exit 5:
   watch it again.

8. **Review.** `troupe download <id> -o review/ --json`, then `ffprobe` and
   three frames as in step 6 of the `troupe` skill. Check: a video and an
   audio stream (none for Grok Imagine), the format the post needs, a length
   near the script's, and on every frame the same person as the actor's
   pictures (hair, face, clothes), with no extra people or text. Say what you
   saw, that you cannot hear the voice or judge the lip sync, and ask the user
   to watch it.

9. **Export.** Only once the user says they watched it and it is ready:
   `troupe export create <render> --platform <p> --caption "<c>" --hashtag
   <tag> --confirm-watched --json`, then `troupe download <export-id>`. Pass on
   the `disclosure` it returns.

10. **Next posts.** Same actor, same models: repeat from step 6. Keep a list
    of what was posted so the hooks do not repeat; the `troupe` skill's
    inspiration library can supply hooks from references the user gives you.

## Exit status

| Code | Meaning | Next |
|---|---|---|
| 1 | Refused (stderr) or render failed (stdout) | Act on `message` or `errorDetail`. `NO_KEY`: the user saves the OpenRouter key. |
| 2 | Usage | Check `troupe <command> --help`. |
| 3 | Not signed in | The user runs `troupe login`. |
| 4 | Studio unreachable | Ask whether the studio runs, and where. |
| 5 | Render still running | `troupe render watch <id> --timeout 500`; never relaunch. |
