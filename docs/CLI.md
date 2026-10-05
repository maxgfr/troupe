# The `troupe` CLI

`troupe` drives a running self-hosted studio from a terminal: everything the
project pages do, from the sign-in to the downloaded MP4. It calls the same
tRPC API as the browser (`/api/trpc`), signs in with the same access code,
and is type-checked against the server's router, so the two cannot drift.
Every command prints a table for people or JSON with `--json`, for scripts
and agents. A Claude Code skill builds on it: [CLAUDE-SKILL.md](CLAUDE-SKILL.md).

The built CLI needs Node.js 22 or later and a studio to talk to (`pnpm dev`, Docker,
or any deployment you can reach). It does not work with the browser edition,
which has no server.

## Install

From a checkout:

```bash
pnpm install
pnpm --filter troupe-cli build      # cli/dist/troupe.mjs, one self-contained file
npm install -g ./cli                # puts `troupe` on your PATH
troupe --version
```

Without installing it:

- `node cli/dist/troupe.mjs <command>`; the bundle is one self-contained file,
  so a copy of it works anywhere with Node.js 22.
- `npx ./cli <command>` from the checkout, once built; or pack it
  (`cd cli && npm pack`) and run the tarball from anywhere:
  `npx --package ./troupe-cli-0.1.0.tgz troupe <command>`.
- `pnpm --silent troupe <command>` from the checkout runs the TypeScript
  source with Node's type stripping, which needs Node.js 22.6 or later;
  relative paths still mean the folder you typed it in.

The package is not published to npm.

### In the Docker stack

The Compose stack ships the CLI as an image (`ghcr.io/maxgfr/troupe-cli`,
the bundle on Node.js 24) behind the `cli` profile, already signed in:

```bash
docker compose run --rm cli doctor
docker compose run --rm cli projects list
docker compose run --rm cli --json render list --project "Spring drop"
docker compose run --rm cli download --project "Spring drop"
```

It reaches the studio at `http://app:3000`, inside the stack's network
(`TROUPE_INSECURE=1` there), and reads the access code the studio generated
from a volume the studio copies it into for this purpose
(`troupe-cli-access`, read-only), unless `TROUPE_ACCESS_CODE` is set in
`.env`. It never mounts the studio's data volume, which holds `secret.key`. Profiles and the chosen project persist in the `cli-config` volume;
downloads land in the folder with `docker-compose.yml` (`TROUPE_CLI_DIR`
moves them). In the container, `--base-url` for `models add` is the address
the studio reaches, such as `http://renderer:8078`.

## Sign in

```bash
troupe login --url http://127.0.0.1:3000      # pnpm dev
troupe login --url http://localhost:3100      # Docker Compose
troupe login --url studio.example.com         # https://studio.example.com
```

An address without a scheme means `https://`, except on this machine
(`localhost`, `127.x.x.x`, `[::1]`), where studios listen on plain http.
The CLI refuses `http://` to any other host, because the access code and
the cookie that stands for it would cross the network unencrypted. On a
network you trust (a studio on your LAN without TLS), pass `--insecure` or
set `TROUPE_INSECURE=1`; `login --insecure` remembers it for that profile.

`login` asks for the access code without echoing it, sends it to
`/api/access` like the access page does, and keeps the cookie the studio
returns, never the code. A studio started with `pnpm dev` and no
`TROUPE_ACCESS_CODE` lets in requests from its own machine without a code;
`login` notices and saves the address only.

For scripts, pipe the code in (on a terminal, `--code-stdin` asks without
echo instead), or set it in the environment, where it is exchanged on every
command and nothing is saved. `--code-stdin` wins over `TROUPE_ACCESS_CODE`:

```bash
printf %s "$CODE" | troupe login --url https://studio.example.com --code-stdin
TROUPE_URL=https://studio.example.com TROUPE_ACCESS_CODE=… troupe projects list
```

Never pass a code or an API key as a command-line argument: shell history and
`ps` would keep it. No command accepts one.

### Profiles and the config file

Each studio you sign in to is a profile (`default` unless you pass
`--profile <name>`). Profiles live in `~/.config/troupe/config.json`
(`$XDG_CONFIG_HOME/troupe`, or `TROUPE_CONFIG_DIR`), written with mode 0600 in
a 0700 folder. Commands that change it take a lock file
(`config.json.lock`) and write a new file before renaming it over the old
one, so two commands running at once never lose each other's change:

```json
{ "profile": "default", "profiles": { "default": { "url": "http://127.0.0.1:3000", "cookie": "…", "project": "3808a42c-…" } } }
```

The last profile you signed in to is used by default. The cookie is only
sent to the address it was issued by: `--url` pointing elsewhere sends none.
`troupe logout` forgets the cookie and keeps the address and project.

### Environment

| Variable | Default | |
|---|---|---|
| `TROUPE_URL` | the profile's address, else `http://127.0.0.1:3000` | studio address (`--url` wins) |
| `TROUPE_ACCESS_CODE` | none | sign every command in with this code instead of the saved cookie |
| `TROUPE_PROFILE` | the last profile signed in to | profile to use (`--profile` wins) |
| `TROUPE_PROJECT` | the profile's current project | project for project commands (`--project` wins) |
| `TROUPE_CONFIG_DIR` | `$XDG_CONFIG_HOME/troupe` or `~/.config/troupe` | where `config.json` lives |
| `TROUPE_INSECURE` | unset | `1` allows plain `http://` to another machine, like `--insecure` |

## Conventions

- `troupe <noun> <verb>`; `troupe --help`, `troupe <noun> --help` and
  `troupe <noun> <verb> --help` list commands and options.
- Ids: tables show the first 8 characters, and every id argument accepts
  that prefix (4 characters at least) or the full id. Projects also match by
  title, actors by name, models by key or name, case ignored.
- The current project: `projects create` and `projects use` set it for the
  profile; `-p/--project` or `TROUPE_PROJECT` override it per command.
- `--json` prints the result as JSON on stdout (dates as ISO 8601 strings).
  Progress (`render watch`) goes to stderr and is silent with `--json`.
  Errors go to stderr, as `troupe: <message>` or, with `--json`, as
  `{"error": {"code": "…", "message": "…", "exitCode": n}}`.

### Exit status

| Code | Meaning |
|---|---|
| 0 | Done (`render watch`: the render completed) |
| 1 | Refused (by the studio, or by the CLI: a file that exists, a script too long for its clip), or the render failed |
| 2 | Wrong command, option or value |
| 3 | Not signed in, or a wrong access code |
| 4 | The studio cannot be reached |
| 5 | `--timeout` passed while the render was still running; it goes on in the studio, so watch it again rather than launching another |

## Commands

### Setup

| Command | Does |
|---|---|
| `login [--code-stdin]` | Sign in and save the profile. |
| `logout` | Forget the profile's cookie. |
| `whoami` | Profile, studio, sign-in state, current project, config file. |
| `doctor [--skip-tests] [--providers]` | Checks the studio and its database, the sign-in, which models can launch (local ones are contacted), the background worker and the script chat (contacted). `--providers` also checks each provider account's key and each cloud model with a free request (rows `account google`, `account fal`, `account anthropic`; `skip` when no key is set). Exit 1 when a check fails. |
| `doctor --live [--model <model>]… [--yes] [-o <folder>]` | Renders one clip per model that can launch, at its cheapest settings (shortest, lowest resolution, silent where allowed), in a new project; downloads each video, runs `ffprobe` on it and asks the script chat once. Without `--yes` it prints the plan and its cost and exits 2. See [LIVE-CHECKS.md](LIVE-CHECKS.md). |
| `models list [--all]` | Every model with where it runs, its state, formats, lengths, audio, and the default. `--all` includes archived ones. |
| `models add http\|comfyui …` | Add a local model, after testing it. See below. |
| `models test <model>` | Contact a model or check its provider key. Exit 1 when it cannot render. |
| `models remove <model> [--restore]` | Archive a local model (its renders stay). |
| `models default [<model>] [--clear]` | Show or set the default model. |
| `models templates` | The bundled ComfyUI workflows. |
| `keys list` | Which provider keys (google, fal, anthropic) are configured, and from where. |
| `keys set <provider> [--key-stdin]` | Save a key, encrypted on the server; read from stdin or a hidden prompt. |
| `keys clear <provider> [--disable]` | Remove the saved key; `--disable` also ignores the server's environment. |
| `keys test <provider>` | Check a key with a free request (Google: the model's metadata; fal.ai: the endpoint's price; Anthropic: the model), and say why it is refused. |

Adding the [local renderer](LOCAL-MODELS.md#local-renderer) (`pnpm renderer`):

```bash
troupe models add http --name "Local renderer" --base-url http://127.0.0.1:8078 --default
```

HTTP options, with their defaults: `--formats 9:16,16:9,1:1`,
`--resolutions 720p`, `--durations 4,6,8,10,15`, `--audio always`
(`optional`, `none`), `--fps 24`, `--timeout 7200`, `--token-stdin` for a
bearer token. ComfyUI: `--template <id>` (from `models templates`) and
`--negative-prompt`; custom workflows are added in Settings. The model is
tested first and nothing is added when the test fails, unless
`--skip-test`. `--base-url` is where the studio reaches the server, which
differs from your terminal's view when the studio runs in Docker
(`http://host.docker.internal:8078`).

### Projects and scripts

| Command | Does |
|---|---|
| `actors list [--gender] [--age] [--style]` | The actor presets: name, gender, age, style, voice, status. |
| `actors show <actor>` | One actor, with the address of their front picture. |
| `projects list` | Projects, newest first, with their stage (`*` marks the current one). |
| `projects create --title --actor [--platform] [--format] [--language] [--model] [--no-use]` | What the wizard does; makes it the current project. Platform `tiktok` by default, format the platform's preferred one, language `en`. |
| `projects show [<project>]` | Actor, model, newest script version, renders. |
| `projects use <project>` | Make it the current project. |
| `projects delete <project> --yes` | Delete it with its scripts, renders and files. |
| `script show [--version N] [--text]` | A version as a table, or with `--text` in the file format below. |
| `script set <file\|->` | Save a file (or stdin) as the newest version, lines and emotions in one call. |
| `script versions` | Every version, oldest first. |
| `script restore <version>` | Bring a version back as the newest. |

The script file has one spoken line per line, an optional emotion in
brackets, and `#` comments. Roles follow the order, as when a script is
pasted in the studio: the first line is the hook, the last the call to
action, the others the body.

```text
# Rain jacket, 10 s
[excited] Stop scrolling: this jacket folds into its own pocket.
It weighs less than your phone and shrugs off rain.
[calm] Tap the link before Friday.
```

Emotions: `neutral`, `excited`, `calm`, `serious`, `happy`,
`disappointed`. A line without one keeps the emotion the same text had in
the previous version, else neutral. The studio estimates speaking time at 2.5
words per second; a launch refuses a script longer than its clip. The JSON
`script show --json` prints is accepted too (`{"lines": [{"text": "…",
"emotion": "calm"}]}`), so `script show --json > s.json`, an edit, and
`script set s.json` round-trip.

### Chat, renders, exports

| Command | Does |
|---|---|
| `chat send <message…> [--duration S]` | Ask the [script chat](SCRIPT-CHAT.md) for a change. The clip it writes for is the one a launch would use now unless `--duration` says otherwise. |
| `chat history` | The conversation, with each proposal's state (`waiting`, `applied as vN`, `outdated`). |
| `chat apply [<message>]` | Save a proposal (default: the newest waiting one) as a new version. |
| `chat apply-and-launch [<message>] [launch options] [--watch]` | Apply and render at once. |
| `render launch [--version N] [launch options] [--watch]` | Render the newest version (or N) as a draft. |
| `render list` | Renders, newest first, with failures and progress. |
| `render status [<render>]` | One render, once (default: the newest). Exit 1 when it failed. |
| `render watch [<render>] [--interval S] [--timeout S]` | Follow a render until it completes (exit 0) or fails (exit 1). |
| `render relaunch <render> [--watch]` | Try a failed render again with the same settings. |
| `export create [<render>] --confirm-watched [--platform] [--caption] [--hashtag …] [--accept-mismatch]` | Export a completed render (default: the newest). |
| `export list` | Exports, newest first. |
| `download [<render\|export>] [-o path] [--force]` | Save the MP4 (default: the newest completed render). |

Launch options: `--model` (default: the project's model, else the studio
default), `--duration` (default: the model's, grown to the shortest length it
offers that fits the script; a `--duration` shorter than the script is
refused before anything is sent, `SCRIPT_TOO_LONG`), `--resolution` (the model's default),
`--audio` / `--no-audio` (the model's default). Polling the project's
timeline also moves its jobs along, so `render watch` finishes renders even
on a studio without a background worker.

`export create` needs `--confirm-watched`: an export records that a person
watched the video and found it ready to publish, as the export page's
checkbox does. A render whose format or length does not match the
platform's documented specs is refused unless `--accept-mismatch`. The
result carries the platform's AI-disclosure rule (`disclosure`).

`download` names the file as the studio does
(`<project>-<model>-<YYYY-MM-DD-HHMM>.mp4`) in the current folder, or in
`-o <folder>/`, or as `-o <file>`. It writes to a temporary
`<name>.<random>.part` file and renames it when complete, and never
overwrites a file without `--force` (exit 1, `FILE_EXISTS`).

## A whole project

```bash
troupe login --url http://127.0.0.1:3000
troupe doctor
troupe models add http --name "Local renderer" --base-url http://127.0.0.1:8078 --default
troupe projects create --title "Rain jacket drop" --actor Elsa --platform instagram
troupe script set script.txt
troupe chat send "make the hook more surprising"
troupe chat apply
troupe render launch --watch
troupe download -o review/
troupe export create --caption "Folds into its own pocket" --hashtag raincoat --confirm-watched
troupe download <export-id>
```

## JSON shapes

`--json` prints what the studio's API returns, with these additions:

- `login`: `{ profile, url, access: "code" | "open" }`.
- `whoami`: `{ profile, url, reachable, signedIn, credential, project, configFile }`.
- `doctor`: `{ ok, url, checks: [{ name, status: "ok" | "warn" | "fail" | "skip", detail }] }`;
  with `--live`, also `live`: `{ confirmed: false, plans: [{ modelKey, label, kind, durationS, resolution, audio, estimateUsd }] }`
  before `--yes`, then `{ confirmed: true, projectId, folder, results: [{ …plan, renderId, status, detail, file, probe }], chat: { ok, detail } }`.
- `models list`: `{ models, defaultModelKey, savedDefaultModelKey }`; each
  model has `key, label, vendor, kind ("cloud" | "local"), capabilities
  { aspectRatios, resolutions, durationsS, audio }, defaults { resolution,
  durationS, audio }, pricePerSecondUsd, status, enabled, archived` plus
  `state` (`ready`, `disabled`, `archived` or the status) and `launchable`.
- `models add`: `{ modelKey, test: { ok, message, details?, pollEveryS? }, default }`.
- `actors list` / `actors show`: `{ id, name, gender, ageRange, style,
  voiceProfile, status, portraitUrl }` (absolute URL).
- `projects create` / `projects list`: project rows `{ id, title, platform,
  format, language, actorId, modelKey, status, createdAt }` (`list` has the
  computed stage in `status`). `projects show`: `{ project, actor, script,
  renders, latestRender }`.
- Scripts (`script show`, `set`, `restore`, `chat apply`'s `script`):
  `{ id, version, origin, estimatedDurationS, lines: [{ index, role, text, emotion }] }`.
- `chat send`: the assistant message `{ id, content, proposal: { summary,
  lines, actorId? } | null, provider, model, createdAt }`. `chat history`:
  `{ messages, provider }`.
- Renders (`render list`, `status`, `watch`, `launch --watch`): `{ id,
  status ("queued" | "in_progress" | "completed" | "failed"), progress
  (0–1 or null), modelKey, modelLabel, durationS, mediaDurationS,
  resolution, aspectRatio, tier, costUsd, costSource, errorCode,
  errorDetail, relaunched, outputAssetUrl, createdAt, completedAt }`.
  `render launch` without `--watch` returns the new row before polling.
- `export create`: `{ id, generationId, platform, caption, hashtags,
  downloadUrl, disclosure: { requirement, headline, detail } }`. `export
  list`: the records with `downloadUrl`.
- `download`: `{ path, bytes, contentType, renderId, exportId }`.

## Not yet

An embedded mode (`--local`: the router in process on a PGlite database,
no server) is not built: the studio's request context, worker and media
storage are wired for a server process, and a second way to run them would
need its own tests and docs. Run `pnpm dev` (or Docker) and point the CLI at
it instead.
