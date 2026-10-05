# Product

Troupe is a personal, self-hosted studio for short AI-generated videos: one
person, their own API keys or their own GPU, no account, payments or team
features. MIT licensed.

It comes in two editions with the same pages: the self-hosted studio (Docker
or a server) and the browser edition, a static site where the studio runs
entirely in the visitor's browser with its own in-browser model and keeps
the projects on that device. The browser edition is Troupe, not a demo of it.

The core path: project → actor preset → short script with an emotion per line →
model (cloud or local) → follow the render → preview → MP4 download. Comparing
two or three models on the same script is part of it.

Principles:

- Self-hosting comes first (one Docker command); Vercel + Supabase is the
  alternative.
- Offer only what a model can do: formats, resolutions, lengths and audio come
  from its declared capabilities, and limits are explained before any paid call.
- Keep credentials on the server, encrypted at rest; the browser never sees them.
- Explain failures in plain sentences and never resubmit a paid job by itself.
- Never promise a fixed actor identity, dubbing, automatic cropping or free
  cloud inference. Actor presets guide the prompt; fidelity depends on the model.
- Keep the quiet light/dark workbench design (DESIGN.md).

Out of scope: payments, multi-user administration, posting to social networks.
