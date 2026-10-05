# Modules

One folder per domain. `PRODUCT.md` describes what the studio is for.

| Module | Owns |
|---|---|
| `identity` | Local studio bootstrap (one user, one workspace), workspace scoping |
| `actors` | The 30 synthetic actors and their portrait sets |
| `script` | Script versions, lines, emotion tags, spoken-duration estimate |
| `generation` | Video model adapters, launches, the reconciliation queue, render ingestion |
| `benchmark` | Side-by-side model comparisons and votes |
| `studio` | Projects and the creation wizard (platform → format → language → actor) |
| `export` | Platform presets, AI-disclosure guidance, downloads |
| `chat` | The script iteration chat: prompt, proposals (JSON schema + checks), applying them as script versions, chat settings |
| `library` | The inspiration library: saved items, their analysis (transcript, frames, hook, structure, pace, tags), search passages and similarity, the library chat with citations, idea cards and the "in my voice" style profile |
| `scene` | What the local renderers draw and say: timed captions, the actor card, Kokoro voices (pure TS, no DOM or Node) |

Each module exposes its services and types through its barrel (`index.ts`);
other code imports from the barrel. Drizzle table definitions live in
`server/schema.ts` and may be imported directly where a query needs them.
Tests live next to the code as `*.test.ts(x)`.
