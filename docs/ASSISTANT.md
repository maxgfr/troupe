# Studio assistant

The **Assistant** page is a chat that does things in the studio: ask in your
own words for an actor, a model, a project, a script, a render, a photo or a
voice line, and it does it with the studio's own tools on your
[OpenRouter](https://openrouter.ai) key. It works the same in the self-hosted
studio and in the browser edition, where it calls OpenRouter from the page.

```text
You:        Create a 28-year-old female lifestyle influencer called Nina, curly red hair, warm upbeat voice.
Assistant:  Confirm before it runs — Make Nina (female, 25-34, casual): 6 pictures with FLUX.3 klein, about $0.054.
            [Confirm] [Cancel]
You:        (Confirm)
Assistant:  ✓ Made an actor — Made Nina for $0.054. Nina in Actors
```

## What it needs

An OpenRouter key under Settings → Provider accounts (or `OPENROUTER_API_KEY`
for the self-hosted studio). Without one the page says so, with a link. It
answers with the OpenRouter model of Settings → Script chat (default
`google/gemini-3.5-flash-lite`); any OpenRouter model that takes tools works.
A turn costs a fraction of a cent of chat on OpenRouter, on top of what the
tools render.

## What it can do

| Tool | Does | Costs money |
|---|---|---|
| `list_actors` | the studio's 30 actors and the ones made in this workspace | no |
| `create_actor` | a new actor (an AI influencer persona): six pictures of one fictional person | **yes** |
| `list_models` | the video, photo and voice models, with formats, lengths and prices | no |
| `search_catalog` | a provider's live list of models (OpenRouter by default) | no |
| `add_model` | adds a model from that list to the studio | no |
| `list_projects`, `create_project` | projects: title, actor, platform, format, language, model | no |
| `set_script` | a new script version, a line and an emotion each | no |
| `launch_render` | renders a project's newest script (clip length: the shortest that fits) | **yes** on cloud models |
| `render_status` | a project's newest renders, with errors and video links | no |
| `launch_video_shot`, `launch_photo`, `launch_voice` | Shots: a described video (a talking photo says the text), a photo, a voice line | **yes** |
| `list_shots` | the newest shots | no |

Every tool calls the studio's own API (the same tRPC procedures as the pages,
`createCaller`), so the same checks, limits and workspace rules apply: the
assistant can do nothing the pages would refuse.

## Spending stays your call

A tool that costs money never runs on the model's word. The assistant stops
there and the page shows a **Confirm before it runs** card with what it
will do and its estimated cost (from the model's listed price; "no price
listed" when the provider lists none). It runs only on Confirm; Cancel tells
the model it was cancelled, and it does not ask again unless you do.

## How it works

`src/server/assistant/loop.ts` runs the conversation: OpenRouter's chat
completions with the tools (`tool_choice: "auto"`,
`provider.require_parameters` so only providers that take tools answer),
then each call in turn: free ones at once, a paid one only with the user's
decision, an unknown tool or invalid arguments reported back to the model
as a tool result. It stops when the model answers in words, when a paid call
waits, or after eight steps. `src/server/assistant/tools.ts` holds the tools
and the system prompt; `src/server/api/routers/assistant.ts` the procedures
(`status`, `send`, `decide`).

Nothing is stored on the server: the page keeps the conversation (in
`localStorage`, one per workspace; **New** starts another) and sends it whole
with each turn. In the browser edition the router runs in the page, so the
same code calls OpenRouter from there.

## Testing

`pnpm test` covers the loop with a scripted model (a free tool, a paid one
confirmed and cancelled, unknown tools and bad arguments, the step limit, the
OpenRouter request) and the router against a test database (the key check,
real procedures scoped to the workspace, a paid tool held, a project and its
script made through the tools). On 2026-11-10 the loop ran on OpenRouter's
`google/gemini-3.5-flash-lite` with the real key: "Which female actors can I
cast?" called `list_actors` with `gender: "female"` and answered in 4.7 s;
"Create … Nina …" called `create_actor` and stopped at its quote, without
running it.
