---
name: troupe
description: Use when the user wants a short video made, scripted, rendered, reviewed, iterated on or exported with Troupe, or wants a Troupe studio checked or set up (actors, video models, the local renderer, provider keys, the script chat) from the terminal.
---

# Troupe

Troupe is a self-hosted studio for short AI videos: a project has an actor, a
platform and format, a versioned script (one spoken line each, an emotion per
line), and renders made by a video model. You drive it with the `troupe` CLI,
which calls the studio's own API.

Run every command with `--json` and read stdout; errors arrive as
`{"error":{"code","message","exitCode"}}` on stderr. Ids accept their first 8
characters; projects, actors and models also accept their title or name.
`troupe <command> --help` is the reference for options.

## Guardrails

- **Secrets stay out of the conversation.** The access code and API keys
  never go in a message, a command line or your output. When `troupe login`
  or `troupe keys set` needs one, ask the user to run that command in their
  own terminal (it prompts without echoing), or to pipe it from a file they
  made: `troupe keys set fal --key-stdin < fal.key`.
- **`--confirm-watched` is the user's statement.** It records that a person
  watched the video and found it ready to publish. Pass it only after the
  user says so in this conversation.
- **Spending is the user's call.** Cloud models (`kind: "cloud"` in
  `troupe models list --json`) bill the user's account. Before launching on
  one, state the cost (`pricePerSecondUsd` × clip seconds, or "not set in
  Settings" when it is null) and wait for a yes. Local models cost nothing.
- **Deleting is the user's call.** `troupe projects delete` only when asked.

## The loop

1. **Check.** `command -v troupe`; if missing, in a Troupe checkout run
   `pnpm install && pnpm --filter troupe-cli build && npm install -g ./cli`.
   Then `troupe doctor --json`. Done when every check is `ok` or `warn`;
   for each `fail`, apply the fix below or tell the user what blocks you.

   | Failing check | Fix |
   |---|---|
   | `studio` | Ask for the studio's address (`pnpm dev`: http://127.0.0.1:3000, Docker: http://localhost:3100) and whether it runs; retry with `--url`. |
   | `sign-in` | Ask the user to run `troupe login --url <address>` in their terminal. |
   | `models` | With the renderer running (`pnpm renderer`), `troupe models add http --name "Local renderer" --base-url http://127.0.0.1:8078 --default`. |
   | `model <key>` | That model's server is down: start it, or pick another. |

   `worker` warnings are fine while you watch renders; a `chat` warning only
   matters if you use the chat.

2. **Brief.** Settle what the video says, for whom, on which platform
   (tiktok, instagram, youtube, linkedin) and how long. Fill gaps with
   sensible defaults (TikTok 9:16, English, 8 to 10 s) and say which you
   chose.

3. **Cast.** `troupe actors list --json`: pick an `active` actor whose age,
   style and `voiceProfile` fit the audience. `troupe models list --json`:
   use `defaultModelKey` unless the user names a model; only models with
   `launchable: true` can render, and `capabilities` lists the formats and
   lengths (`durationsS`) each one offers.
   `troupe projects create --title <t> --actor <name> --platform <p> --json`
   makes it the current project.

4. **Script.** Budget: clip seconds × 2.5 words. Write a file, one spoken
   line each, the hook first and the call to action last, an emotion in
   front (neutral, excited, calm, serious, happy, disappointed):

   ```text
   [excited] Stop scrolling: this jacket folds into its own pocket.
   It weighs less than your phone and shrugs off rain.
   [calm] Tap the link before Friday.
   ```

   Lines hold only the words the actor says. `troupe script set script.txt
   --json` saves a version; done when its `estimatedDurationS` fits the clip.
   To use the studio's chat instead: `troupe chat send "<request>" --json`,
   read `proposal.lines`, then `troupe chat apply <id>` (or
   `chat apply-and-launch <id> --watch`).

5. **Render.** `troupe render launch --duration <seconds> --watch --json`,
   with the brief's length if the model offers it (without `--duration`
   the CLI takes the model's default, or the shortest length that fits the
   script). Exit 0 is
   `completed`; exit 1 is `failed`: read `errorDetail`, fix the cause
   (`troupe models test <model>`), then `troupe render relaunch <id>
   --watch`. Exit 5 means still running: `troupe render watch <id>`.

6. **Review.** Watch it the way you can: `troupe download <id> -o
   review/ --json` prints the file's `path`. Put it in `video` (in zsh,
   `path` is your PATH) and run

   ```bash
   ffprobe -v error -show_entries stream=codec_type,codec_name,width,height:format=duration -of json "$video"
   d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$video")
   for f in 0.1 0.5 0.9; do t=$(LC_ALL=C awk "BEGIN{print $d*$f}"); ffmpeg -v error -y -ss "$t" -i "$video" -frames:v 1 "review/frame-$f.png"; done
   ```

   Open the three frames and look at them. Done when you have checked: a video
   and, for an audio model, an audio stream; width:height matches the
   project's format; the duration is near the clip's (the local renderer
   lasts as long as the voice, often a second or two more); the frames show
   the actor and legible, uncropped captions. Report what you
   saw and the file's path, and ask the user to watch it.

7. **Iterate.** For changes, `troupe script show --text > script.txt`, edit,
   `troupe script set script.txt`, render again; or go through the chat.
   `troupe script versions` and `troupe script restore <n>` bring an older
   version back.

8. **Export.** Once the user has watched it and says it is ready:
   `troupe export create <render> --platform <p> --caption "<c>" --hashtag
   <tag> --confirm-watched --json`, then `troupe download <export-id>`.
   Pass on the `disclosure` it returns: the AI label the platform expects.

## Exit status

| Code | Meaning | Next |
|---|---|---|
| 1 | Refused or failed | Read `message`; it names the cause. |
| 2 | Usage | Check `troupe <command> --help`. |
| 3 | Not signed in | The user runs `troupe login`. |
| 4 | Studio unreachable | Ask whether the studio runs, and where. |
| 5 | Timed out | Keep watching with `troupe render watch`. |
