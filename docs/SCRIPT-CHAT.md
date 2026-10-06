# Script chat

The project page has a chat beside the timeline (a sheet opened with **Chat**
on a phone). Ask for a change in plain words ("a punchier hook", "calmer",
"use Marcus instead"); the model answers with a whole new version of the
script, shown line by line against the current one. A follow-up such as "now
make that warmer" builds on the newest proposal you have not applied yet, as
long as the script has not changed since. Nothing changes until you choose:

- **Apply only** adds it as the project's newest script version, with origin
  `chat`, keeping the roles and emotions the model gave each line. When the
  proposal names another actor, the project is recast too.
- **Apply & relaunch** does the same, then launches a draft of the new
  version with the newest render's model, length and resolution (or the
  launch panel's model and its defaults before the first render). A proposal
  too long for that model's longest clip cannot be relaunched; the button
  says why.

A proposal asked on an older version says so ("Asked on version 3; the script
has since changed to version 5. Applying adds these lines as version 6,
without version 5's changes.") before you apply it. Applying always adds a
version; the same proposal applied twice returns the version it already made.

## How an answer is made

`src/modules/chat` builds a short prompt: the project, the actor, the current
lines, the emotions and roles allowed, the other actors, the studio's house
style (followed by your style profile when items in the
[inspiration library](LIBRARY.md) are marked as your own: the hooks you open
with, your tone, pace and sentence length), the last few turns, and a **word budget**: the clip's seconds times the
speaking rate (2.5 words a second by default, the same rate as the script's
duration estimate). The model must answer with a JSON object that follows a
schema (`summary`, every `lines` entry with its `role`, `text` and
`emotion`, and an `actor` or null), enforced by the provider where it can
(Ollama's `format`, Claude's structured outputs, WebLLM's `response_format`),
then checked again with zod. An answer that is not valid, or is over the word
budget, gets one more try with the problem spelled out. If that fails too, the
chat shows what the model wrote, and an over-budget script is kept with its
length marked.

The conversation is stored in `troupe_chat_message` (migration
`drizzle/0018_chat.sql`), readable only by the project's workspace members.

## Providers

| Where | Provider | Default model | Set up |
|---|---|---|---|
| Self-hosted | [Ollama](https://ollama.com): the Docker stack's own, or one on your computer or network | `qwen3:4b` (2.5 GB) | in Docker, nothing: the `ollama` service downloads it on first start; otherwise `ollama pull qwen3:4b`, then keep `ollama serve` (or the app) running |
| Self-hosted | Claude, with your Anthropic API key | `claude-opus-5-5` | Settings → Provider accounts, or `ANTHROPIC_API_KEY` |
| Browser edition | [WebLLM](https://github.com/mlc-ai/web-llm), in the visitor's tab on the GPU | `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` (880 MB) | nothing: downloaded once per browser on the first request |

In the self-hosted studio the chat uses Claude when an Anthropic key is saved
(or set in the environment) and Ollama otherwise; Settings → Script chat can
pin either. Each message to Claude is billed by Anthropic. The browser edition
offers only WebLLM: a page on the web can neither keep an API key nor reach an Ollama
on the visitor's machine. It needs WebGPU (a recent Chrome or Edge on a
computer with a GPU); elsewhere the chat explains why it is off.

### Ollama from Docker

The Compose stack runs its own Ollama (the `ollama` service, on the CPU) and
points the app at it, `http://ollama:11434`. On first start the service
downloads `OLLAMA_MODEL` into the `ollama` volume and reports healthy once it
is there; until then the chat says the model is missing. Change the model with
`OLLAMA_MODEL` in `.env` (the service downloads the new one on its next
start), or add more with `TROUPE_OLLAMA_MODELS`. With an NVIDIA GPU, lay
`docker-compose.gpu.yml` over the stack ([SELF-HOSTING.md](SELF-HOSTING.md#gpus)).

To use the Ollama on the computer running Docker instead (on a Mac, the
native app runs on the Apple GPU, which containers cannot reach), set
`OLLAMA_URL=http://host.docker.internal:11434` and start the stack with
`--scale ollama=0`. Docker Desktop (macOS, Windows) reaches it as it is. On
Linux, Ollama listens on 127.0.0.1 only: start it with `OLLAMA_HOST=0.0.0.0`
(or set its systemd service's environment) so the container can reach it,
and keep the port closed to your network otherwise. Under `pnpm dev` the
default `http://127.0.0.1:11434` works.

Troupe never follows a redirect from the Ollama address: it could lead past
the address checks to a cloud metadata service. Point it at the address Ollama
itself listens on.

Any Ollama model that can follow a JSON schema works; small ones (1–4 B
parameters) answer in a few seconds on a laptop. Settings → Script chat →
**Test** checks that Ollama answers and has the model.

## Settings

Saved in Settings → Script chat (they override the environment); blank fields
use the defaults below.

| Self-hosted (`.env`) | Default | |
|---|---|---|
| `TROUPE_CHAT_PROVIDER` | `auto` | `auto`, `ollama` or `anthropic` |
| `OLLAMA_URL` | `http://127.0.0.1:11434` (Compose: `http://ollama:11434`) | private and loopback addresses are fine; cloud metadata and link-local ones are refused |
| `OLLAMA_MODEL` | `qwen3:4b` | |
| `ANTHROPIC_API_KEY` | — | a key saved in Settings takes precedence |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | what each model is sent comes from a table of its capabilities (`src/server/chat/claude-models.ts`, below) |
| `TROUPE_CHAT_INSTRUCTIONS` | — | the house style, added to every request |
| `TROUPE_CHAT_WORDS_PER_SECOND` | `2.5` | the word budget's rate, 1 to 5 |
| `TROUPE_CHAT_TIMEOUT_S` | `180` | how long one answer may take |
| `TROUPE_CHAT_SEND_TIMEOUT_S` | `300` | how long one request may take in all, its answer and the retry when the first answer is not a usable script; past it the model is stopped, nothing is stored, and the chat says "took longer than N s … Try again, perhaps in fewer words". The browser edition allows 15 minutes, which covers loading its model the first time. A usable script written before the limit (only longer than the clip) is kept. |
| `TROUPE_CHAT_TEMPERATURE` | Ollama `0.4`, Claude its own | sampling temperature, 0 to 2 for Ollama; Claude takes 0 to 1 (a higher value is sent as 1), and only the models marked below accept one |
| `TROUPE_CHAT_HISTORY_TURNS` | `6` | earlier turns sent with each request, 0 to 20 |
| `TROUPE_CHAT_ANTHROPIC_FALLBACK` | `auto` | the server-side fallback below (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`): `auto` sends it only when requests go to `api.anthropic.com` (no `ANTHROPIC_BASE_URL`, or that one), since a gateway may refuse the beta; `on` or `off` decides for any address |

| Browser edition (`site/.env`, at build time) | Default | |
|---|---|---|
| `VITE_WEBLLM_MODEL` | `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` | a WebLLM prebuilt model id; the build stops on one WebLLM does not know. GPUs without `shader-f16` get the `q4f32` build of the same model when there is one |
| `VITE_WEBLLM_DOWNLOAD_MB` | `880` for the default model | the size shown before the first request (0 hides it) |
| `VITE_CHAT_INSTRUCTIONS`, `VITE_CHAT_WORDS_PER_SECOND` | —, `2.5` | defaults for the browser edition's Settings |
| `VITE_WEBLLM_TEMPERATURE`, `VITE_WEBLLM_MAX_TOKENS`, `VITE_CHAT_HISTORY_TURNS` | `0.4`, `1024`, `6` | sampling temperature (0 to 2), the longest answer in tokens (256 to 3072; the default model's context is 4,096 in all), earlier turns sent |

How long an answer may be, by provider. The chat asks for a cap sized to
one proposal: about 200 tokens of summary and keys, 25 for each line (one
every 3 seconds of the clip) and 7 for each second of speech (or 1.4 a word
of the budget when that is more), so a Japanese, Chinese or Thai script fits
too: 331 tokens for 8 s, 515 for 20 s, 1,120 for 60 s.
- **Ollama** stops there (`num_predict`). It asks for a longer context than
  Ollama's default 4,096 tokens (`num_ctx` 8192, about 1 GB more memory for a
  4B model, and a model reload when it changes) only when the prompt and the
  answer could pass it, which the script chat's rarely do.
- **Claude** keeps at least 8,000 tokens, which its adaptive thinking needs;
  structured output and `effort: low` keep its answers short.
- **The browser edition's WebLLM** uses `VITE_WEBLLM_MAX_TOKENS` (1,024 by
  default), raised for the library's longer answers up to 3,072.

### What each Claude model is sent

From Anthropic's API reference. The newer models reject sampling settings
with a 400, so the chat never sends them a temperature, whatever
`TROUPE_CHAT_TEMPERATURE` says.

| Model | Structured output | Effort `low` | Server-side fallback | Temperature |
|---|---|---|---|---|
| `claude-opus-5-5`, `claude-opus-5`, `claude-sonnet-5-5`, `claude-fable-5-1`, `claude-fable-5`, `claude-mythos-5-1` | yes | yes | yes | no |
| `claude-mythos-5` (no safety classifiers, so nothing to fall back from), `claude-sonnet-5`, `claude-opus-4-8` | yes | yes | no | no |
| `claude-opus-4-7` | no | yes | no | no |
| `claude-opus-4-6`, `claude-sonnet-4-6` | no | yes | no | yes |
| `claude-opus-4-5`, `claude-opus-4-5-20251101` | yes | yes | no | yes |
| `claude-haiku-4-5`, `claude-haiku-4-5-20251001` | yes | no | no | yes |
| `claude-sonnet-4-5`, `claude-sonnet-4-5-20250929` | no | no | no | yes |
| any other id | no | no | no | no |

The current models have no dated ids; the older ones answer to their alias
and to their dated id alike. Without structured output the JSON schema goes
in the prompt, and the answer is checked and repaired like any other. An
unknown id gets nothing a model could refuse; add it to the table to give it
more. `claude-opus-4-1` is not listed: Anthropic retired it on 2026-08-05.

## Testing

`pnpm test` covers the prompt, the checks and the repair, applying (origin
`chat`, roles and emotions kept, row-level security), the router against a
fake Ollama over HTTP and the Anthropic SDK against a fake API server: no real
key or paid call. `pnpm site:test:chat` (after `pnpm site:build`) runs the
browser edition's chat for real in headed Chrome: a request, Apply, then Apply &
relaunch rendered in the tab. It needs WebGPU and downloads the chat model
into the render test's browser profile once, so it runs locally, not in CI.
