import { z } from "zod";

import { SUPPORTED_EMOTIONS } from "~/modules/script";
import type { createCaller } from "~/server/api/root";
import type { AssistantTool, ToolOutcome } from "./loop";

// The studio assistant's tools. Each one calls the studio's own router, so
// every check, limit and workspace rule of the pages applies to the
// assistant too. The ones that spend money have a quote: the assistant
// waits for the user's Confirm before running them.

export interface ToolContext {
  caller: ReturnType<typeof createCaller>;
  workspaceId: string;
}

type Tool<A> = AssistantTool<A, ToolContext>;
const tool = <A>(t: Tool<A>) => t as unknown as AssistantTool<never, ToolContext>;

const ok = (summary: string, data?: unknown, link?: ToolOutcome["link"]): ToolOutcome => ({
  ok: true,
  summary,
  ...(data === undefined ? {} : { data }),
  ...(link ? { link } : {}),
});

const usd = (n: number | null) => (n === null ? "price not listed" : `about $${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`);
const total = (parts: (number | null)[]): number | null =>
  parts.some((p) => p === null) ? null : Math.round(parts.reduce<number>((sum, p) => sum + (p ?? 0), 0) * 1000) / 1000;

const EMOTION = z.enum(SUPPORTED_EMOTIONS as unknown as [string, ...string[]]);
const UUID = z.string().uuid();

// The video models, with what each renders and costs.
async function videoModels(ctx: ToolContext) {
  const { models, defaultModelKey } = await ctx.caller.shots.models({ workspaceId: ctx.workspaceId });
  return { models, defaultModelKey };
}

async function videoModel(ctx: ToolContext, key: string) {
  const { models } = await videoModels(ctx);
  const model = models.find((m) => m.key === key);
  if (!model) throw new Error(`No video model "${key}". Call list_models for the keys.`);
  return model;
}

async function mediaModel(ctx: ToolContext, key: string) {
  const model = (await ctx.caller.shots.mediaModels({ workspaceId: ctx.workspaceId })).find((m) => m.key === key);
  if (!model) throw new Error(`No photo or voice model "${key}". Call list_models for the keys.`);
  return model;
}

const mediaPrice = (
  m: { price?: { usd: number; per: string } | null },
  amount: { images?: number; chars?: number },
): number | null =>
  !m.price
    ? null
    : m.price.per === "image"
      ? m.price.usd * (amount.images ?? 1)
      : (m.price.usd * (amount.chars ?? 0)) / 1_000_000;

// The project's newest script and the clip it needs.
async function latestScript(ctx: ToolContext, projectId: string) {
  const history = await ctx.caller.script.history({ projectId });
  const latest = history.at(-1);
  if (!latest) throw new Error("This project has no script yet. Call set_script first.");
  return latest;
}

async function renderPlan(ctx: ToolContext, input: { projectId: string; modelKey?: string; durationS?: number }) {
  const [project, script, { models, defaultModelKey }] = await Promise.all([
    ctx.caller.studio.getProject({ projectId: input.projectId }),
    latestScript(ctx, input.projectId),
    videoModels(ctx),
  ]);
  const key = input.modelKey ?? project.modelKey ?? defaultModelKey;
  const model = models.find((m) => m.key === key);
  if (!model) throw new Error(`No video model "${key ?? "(none set)"}". Call list_models and pass modelKey.`);
  if (!model.available) throw new Error(`${model.label} cannot render: ${model.unavailableReason ?? "not ready"}.`);
  const lengths = model.capabilities.durationsS;
  const durationS = input.durationS ?? lengths.find((d) => d >= script.estimatedDurationS) ?? lengths.at(-1)!;
  const resolution = model.defaults?.resolution ?? model.capabilities.resolutions[0]!;
  const cost = model.pricePerSecondUsd === null ? null : model.pricePerSecondUsd * durationS;
  return { project, script, model, durationS, resolution, cost };
}

export const ASSISTANT_TOOLS: AssistantTool<never, ToolContext>[] = [
  tool({
    name: "list_actors",
    description:
      "List the actors that can be cast: the studio's 30 and the ones made in this workspace (custom: true). Returns ids for create_project and the shot tools.",
    parameters: { type: "object", properties: { gender: { type: "string", enum: ["female", "male", "nonbinary"] } } },
    args: z.object({ gender: z.enum(["female", "male", "nonbinary"]).optional() }),
    async run(args, ctx) {
      const actors = await ctx.caller.actors.list(args.gender ? { gender: args.gender } : undefined);
      const data = actors.map((a) => ({
        id: a.id,
        name: a.name,
        gender: a.gender,
        ageRange: a.ageRange,
        style: a.style,
        voice: a.voiceProfile,
        custom: a.custom,
        available: a.status === "active",
      }));
      return ok(`${data.length} actors.`, data);
    },
  }),

  tool({
    name: "create_actor",
    description:
      "Make a new actor (an AI influencer persona): six photorealistic pictures of the same fictional person, drawn by a photo model on the user's OpenRouter key. Costs money: the user confirms first.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        gender: { type: "string", enum: ["female", "male", "nonbinary"] },
        ageRange: { type: "string", description: 'e.g. "25-34"' },
        style: { type: "string", description: 'e.g. "casual", "streetwear", "formal"' },
        look: { type: "string", description: "Face, hair, skin, build and clothes, in one or two sentences." },
        voiceProfile: { type: "string", description: 'How they speak, e.g. "warm and upbeat, mid-tempo".' },
      },
      required: ["name", "gender", "ageRange", "style", "look", "voiceProfile"],
    },
    args: z.object({
      name: z.string().min(1).max(60),
      gender: z.enum(["female", "male", "nonbinary"]),
      ageRange: z.string().min(1).max(20),
      style: z.string().min(1).max(40),
      look: z.string().min(10).max(1000),
      voiceProfile: z.string().min(3).max(200),
    }),
    async quote(args, ctx) {
      const options = await ctx.caller.actors.createOptions({ workspaceId: ctx.workspaceId });
      const model = options.models.find((m) => m.available) ?? options.models[0];
      if (!model && !options.openrouterKey)
        throw new Error("Making an actor needs an OpenRouter key. The user adds it in Settings → Provider accounts.");
      const cost = model?.estimatedCostUsd ?? null;
      return {
        summary: `Make ${args.name} (${args.gender}, ${args.ageRange}, ${args.style}): ${options.pictureCount} pictures with ${model?.label ?? options.defaultModel.id}, ${usd(cost)}.`,
        estimatedCostUsd: cost,
      };
    },
    async run(args, ctx) {
      const actor = await ctx.caller.actors.create({ workspaceId: ctx.workspaceId, ...args });
      return ok(
        `Made ${actor.name}${actor.costUsd !== null ? ` for $${actor.costUsd.toFixed(3)}` : ""}.`,
        { id: actor.id, name: actor.name, portraitUrl: actor.portraitUrl },
        { label: `${actor.name} in Actors`, href: "/actors" },
      );
    },
  }),

  tool({
    name: "list_models",
    description:
      "List the studio's models: video models (for renders and video shots: key, formats, lengths, price per second, whether it can render now) and photo and voice models.",
    parameters: { type: "object", properties: {} },
    args: z.object({}),
    async run(_args, ctx) {
      const [{ models, defaultModelKey }, media] = await Promise.all([
        videoModels(ctx),
        ctx.caller.shots.mediaModels({ workspaceId: ctx.workspaceId }),
      ]);
      return ok(`${models.length} video models, ${media.length} photo and voice models.`, {
        defaultVideoModel: defaultModelKey,
        video: models.map((m) => ({
          key: m.key,
          label: m.label,
          kind: m.kind,
          available: m.available,
          why: m.available ? undefined : m.unavailableReason,
          aspectRatios: m.capabilities.aspectRatios,
          durationsS: m.capabilities.durationsS,
          resolutions: m.capabilities.resolutions,
          audio: m.capabilities.audio,
          pricePerSecondUsd: m.pricePerSecondUsd,
        })),
        media: media.map((m) => ({
          key: m.key,
          label: m.label,
          medium: m.medium === "image" ? "photo" : "voice",
          available: m.available,
          aspectRatios: m.medium === "image" ? m.aspectRatios : undefined,
          price: m.price,
        })),
      });
    },
  }),

  tool({
    name: "search_catalog",
    description:
      "Search a provider's live list of models that can be added to the studio (video, photo or voice). OpenRouter by default. Returns provider, id, price and whether it is already added (modelKey).",
    parameters: {
      type: "object",
      properties: {
        medium: { type: "string", enum: ["video", "image", "speech"] },
        query: { type: "string", description: 'Words in the name or id, e.g. "veo", "kling", "flux".' },
        provider: { type: "string", description: 'Default "openrouter"; "any" for every provider.' },
      },
      required: ["medium"],
    },
    args: z.object({
      medium: z.enum(["video", "image", "speech"]),
      query: z.string().max(100).optional(),
      provider: z.string().max(40).optional(),
    }),
    async run(args, ctx) {
      const provider = args.provider ?? "openrouter";
      const words = (args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const match = (m: { provider: string; id: string; name: string }) =>
        (provider === "any" || m.provider === provider) &&
        words.every((w) => `${m.id} ${m.name}`.toLowerCase().includes(w));
      const rows =
        args.medium === "video"
          ? (await ctx.caller.settings.models.videoCatalog()).filter(match).map((m) => ({
              provider: m.provider,
              id: m.id,
              name: m.name,
              pricePerSecondUsd: m.pricePerSecondUsd,
              durations: m.durations,
              aspectRatios: m.aspectRatios,
              audio: m.audio,
              cannotAdd: m.unavailable,
              modelKey: m.modelKey,
            }))
          : (await ctx.caller.settings.models.mediaCatalog({ medium: args.medium })).filter(match).map((m) => ({
              provider: m.provider,
              id: m.id,
              name: m.name,
              price: m.price,
              summary: m.summary,
              cannotAdd: m.unavailable,
              modelKey: m.modelKey,
            }));
      return ok(
        `${rows.length} models match${rows.length > 25 ? "; the first 25 are listed" : ""}.`,
        rows.slice(0, 25),
      );
    },
  }),

  tool({
    name: "add_model",
    description:
      "Add a model from a provider's list to the studio (free; it renders on the provider's key). Use search_catalog for provider and id.",
    parameters: {
      type: "object",
      properties: {
        medium: { type: "string", enum: ["video", "image", "speech"] },
        provider: { type: "string" },
        id: { type: "string" },
      },
      required: ["medium", "provider", "id"],
    },
    args: z.object({
      medium: z.enum(["video", "image", "speech"]),
      provider: z.string().min(1),
      id: z.string().min(1),
    }),
    async run(args, ctx) {
      const added =
        args.medium === "video"
          ? await ctx.caller.settings.models.addVideo({
              provider: args.provider as Parameters<typeof ctx.caller.settings.models.addVideo>[0]["provider"],
              id: args.id,
            })
          : await ctx.caller.settings.models.addMedia({ medium: args.medium, provider: args.provider, id: args.id });
      return ok(`Added ${added.label} (key ${added.modelKey}).`, added, {
        label: "Models in Settings",
        href: "/settings",
      });
    },
  }),

  tool({
    name: "list_projects",
    description: "List the workspace's projects with their stage.",
    parameters: { type: "object", properties: {} },
    args: z.object({}),
    async run(_args, ctx) {
      const projects = await ctx.caller.identity.projects({ workspaceId: ctx.workspaceId });
      return ok(
        `${projects.length} projects.`,
        projects.map((p) => ({ id: p.id, title: p.title, platform: p.platform, format: p.format, status: p.status })),
      );
    },
  }),

  tool({
    name: "create_project",
    description:
      "Create a project: a title, an actor (id from list_actors), a platform and format. Optionally the video model it renders on.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        actorId: { type: "string" },
        platform: { type: "string", enum: ["tiktok", "instagram", "youtube", "linkedin"] },
        format: { type: "string", enum: ["9:16", "1:1", "16:9"] },
        language: { type: "string", description: 'BCP 47, e.g. "en", "fr". Default "en".' },
        modelKey: { type: "string" },
      },
      required: ["title", "actorId", "platform"],
    },
    args: z.object({
      title: z.string().min(1).max(200),
      actorId: UUID,
      platform: z.enum(["tiktok", "instagram", "youtube", "linkedin"]),
      format: z.enum(["9:16", "1:1", "16:9"]).optional(),
      language: z.string().min(1).max(20).optional(),
      modelKey: z.string().optional(),
    }),
    async run(args, ctx) {
      const project = await ctx.caller.studio.createFromWizard({
        workspaceId: ctx.workspaceId,
        title: args.title,
        actorId: args.actorId,
        platform: args.platform,
        format: args.format ?? (args.platform === "youtube" || args.platform === "linkedin" ? "16:9" : "9:16"),
        language: args.language ?? "en",
        modelKey: args.modelKey ?? null,
      });
      return ok(
        `Created "${project.title}".`,
        { id: project.id, title: project.title },
        {
          label: project.title,
          href: `/projects/${project.id}`,
        },
      );
    },
  }),

  tool({
    name: "set_script",
    description:
      "Save a new script version for a project: one spoken line each, the hook first and the call to action last, each with an emotion. About 2.5 words a second of clip.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: { text: { type: "string" }, emotion: { type: "string", enum: [...SUPPORTED_EMOTIONS] } },
            required: ["text", "emotion"],
          },
        },
      },
      required: ["projectId", "lines"],
    },
    args: z.object({
      projectId: UUID,
      lines: z
        .array(z.object({ text: z.string().min(1).max(500), emotion: EMOTION }))
        .min(1)
        .max(20),
    }),
    async run(args, ctx) {
      const lines = args.lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }));
      const script = await ctx.caller.script.paste({
        projectId: args.projectId,
        text: lines.map((l) => l.text).join("\n"),
        emotions: lines.map((l) => l.emotion as never),
      });
      return ok(
        `Saved script version ${script.version} (about ${script.estimatedDurationS} s spoken).`,
        { scriptId: script.id, version: script.version, estimatedDurationS: script.estimatedDurationS },
        { label: "The script", href: `/projects/${args.projectId}` },
      );
    },
  }),

  tool({
    name: "launch_render",
    description:
      "Render a project's newest script on a video model (the project's, else the studio default). Costs money on cloud models: the user confirms first. The clip length defaults to the shortest that fits the script.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        modelKey: { type: "string" },
        durationS: { type: "integer" },
      },
      required: ["projectId"],
    },
    args: z.object({
      projectId: UUID,
      modelKey: z.string().optional(),
      durationS: z.number().int().positive().optional(),
    }),
    async quote(args, ctx) {
      const plan = await renderPlan(ctx, args);
      return {
        summary: `Render "${plan.project.title}" (script v${plan.script.version}) on ${plan.model.label}: ${plan.durationS} s at ${plan.resolution}, ${plan.model.kind === "cloud" ? usd(plan.cost) : "free (local)"}.`,
        estimatedCostUsd: plan.model.kind === "cloud" ? plan.cost : 0,
      };
    },
    async run(args, ctx) {
      const plan = await renderPlan(ctx, args);
      const render = await ctx.caller.generation.launchText({
        projectId: args.projectId,
        scriptId: plan.script.id,
        modelKey: plan.model.key,
        durationS: plan.durationS,
        resolution: plan.resolution,
      });
      return ok(
        render.status === "failed"
          ? `The render failed at once: ${render.errorDetail ?? "no reason given"}.`
          : `Launched on ${plan.model.label}; it is ${render.status}. Check it with render_status.`,
        { generationId: render.id, status: render.status },
        { label: "The project's renders", href: `/projects/${args.projectId}` },
      );
    },
  }),

  tool({
    name: "render_status",
    description: "The newest renders of a project, with their status, error and video address.",
    parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
    args: z.object({ projectId: UUID }),
    async run(args, ctx) {
      const renders = (await ctx.caller.generation.forProject({ projectId: args.projectId })).slice(0, 5);
      return ok(
        renders.length ? `Newest render: ${renders[0]!.status}.` : "No render yet.",
        renders.map((r) => ({
          id: r.id,
          status: r.status,
          model: r.modelLabel,
          durationS: r.durationS,
          costUsd: r.costUsd,
          error: r.errorDetail,
          video: r.outputAssetUrl,
        })),
        { label: "The project", href: `/projects/${args.projectId}` },
      );
    },
  }),

  tool({
    name: "launch_video_shot",
    description:
      "Render a described shot (no project or script) on one to four video models, optionally with an actor whose picture starts the video. For a talking-photo model the text is what the actor says. Costs money: the user confirms first.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        modelKeys: { type: "array", items: { type: "string" } },
        aspectRatio: { type: "string" },
        durationS: { type: "integer" },
        resolution: { type: "string" },
        audio: { type: "boolean" },
        actorId: { type: "string" },
      },
      required: ["text", "modelKeys", "aspectRatio", "durationS"],
    },
    args: z.object({
      text: z.string().min(1).max(4000),
      modelKeys: z.array(z.string()).min(1).max(4),
      aspectRatio: z.string(),
      durationS: z.number().int().positive(),
      resolution: z.string().optional(),
      audio: z.boolean().optional(),
      actorId: UUID.optional(),
    }),
    async quote(args, ctx) {
      const models = await Promise.all(args.modelKeys.map((k) => videoModel(ctx, k)));
      const cost = total(
        models.map((m) =>
          m.kind !== "cloud" ? 0 : m.pricePerSecondUsd === null ? null : m.pricePerSecondUsd * args.durationS,
        ),
      );
      return {
        summary: `Render the shot on ${models.map((m) => m.label).join(", ")}: ${args.durationS} s, ${args.aspectRatio}, ${usd(cost)}.`,
        estimatedCostUsd: cost,
      };
    },
    async run(args, ctx) {
      const first = await videoModel(ctx, args.modelKeys[0]!);
      const launched = await ctx.caller.shots.launch({
        workspaceId: ctx.workspaceId,
        text: args.text,
        modelKeys: args.modelKeys,
        aspectRatio: args.aspectRatio,
        durationS: args.durationS,
        resolution: args.resolution ?? first.defaults?.resolution ?? first.capabilities.resolutions[0]!,
        audio: args.audio,
        actorId: args.actorId ?? null,
        count: 1,
      });
      return ok(
        `Launched ${launched.length} render${launched.length === 1 ? "" : "s"}: ${launched.map((l) => l.status).join(", ")}. Check them with list_shots.`,
        launched,
        { label: "Shots", href: "/shots" },
      );
    },
  }),

  tool({
    name: "launch_photo",
    description:
      "Draw a described photo on one to four photo models, optionally of an actor (their picture is the reference). Costs money: the user confirms first.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        modelKeys: { type: "array", items: { type: "string" } },
        aspectRatio: { type: "string" },
        actorId: { type: "string" },
      },
      required: ["text", "modelKeys", "aspectRatio"],
    },
    args: z.object({
      text: z.string().min(1).max(4000),
      modelKeys: z.array(z.string()).min(1).max(4),
      aspectRatio: z.string(),
      actorId: UUID.optional(),
    }),
    async quote(args, ctx) {
      const models = await Promise.all(args.modelKeys.map((k) => mediaModel(ctx, k)));
      const cost = total(models.map((m) => mediaPrice(m, { images: 1 })));
      return {
        summary: `Draw the photo on ${models.map((m) => m.label).join(", ")} (${args.aspectRatio}), ${usd(cost)}.`,
        estimatedCostUsd: cost,
      };
    },
    async run(args, ctx) {
      const done = await ctx.caller.shots.launchPhoto({
        workspaceId: ctx.workspaceId,
        text: args.text,
        modelKeys: args.modelKeys,
        aspectRatio: args.aspectRatio,
        actorId: args.actorId ?? null,
        count: 1,
      });
      return ok(done.map((d) => (d.status === "failed" ? `failed: ${d.errorDetail}` : d.status)).join("; "), done, {
        label: "Shots",
        href: "/shots",
      });
    },
  }),

  tool({
    name: "launch_voice",
    description:
      "Say a text with a voice model, optionally in an actor's delivery. Costs money: the user confirms first.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        modelKey: { type: "string" },
        voice: { type: "string" },
        language: { type: "string" },
        actorId: { type: "string" },
      },
      required: ["text", "modelKey"],
    },
    args: z.object({
      text: z.string().min(1).max(4000),
      modelKey: z.string(),
      voice: z.string().optional(),
      language: z.string().optional(),
      actorId: UUID.optional(),
    }),
    async quote(args, ctx) {
      const model = await mediaModel(ctx, args.modelKey);
      const cost = mediaPrice(model, { chars: args.text.length });
      return {
        summary: `Say ${args.text.length} characters with ${model.label}, ${usd(cost)}.`,
        estimatedCostUsd: cost,
      };
    },
    async run(args, ctx) {
      const done = await ctx.caller.shots.launchVoice({
        workspaceId: ctx.workspaceId,
        text: args.text,
        modelKey: args.modelKey,
        voice: args.voice ?? null,
        language: args.language ?? null,
        actorId: args.actorId ?? null,
      });
      return ok(done.map((d) => (d.status === "failed" ? `failed: ${d.errorDetail}` : d.status)).join("; "), done, {
        label: "Shots",
        href: "/shots",
      });
    },
  }),

  tool({
    name: "list_shots",
    description: "The newest shots (videos, photos, voice clips) with their status and file address.",
    parameters: { type: "object", properties: {} },
    args: z.object({}),
    async run(_args, ctx) {
      const shots = (await ctx.caller.shots.list({ workspaceId: ctx.workspaceId })).slice(0, 10);
      return ok(
        `${shots.length} newest shots.`,
        shots.map((s) => ({
          id: s.id,
          medium: s.medium,
          model: s.modelLabel,
          status: s.status,
          error: s.errorDetail,
          file: s.videoUrl,
          text: s.prompt.slice(0, 120),
        })),
        { label: "Shots", href: "/shots" },
      );
    },
  }),
];

export const ASSISTANT_SYSTEM_PROMPT = `You are Troupe's studio assistant. Troupe makes short videos for TikTok, Instagram, YouTube and LinkedIn: projects with an actor (a synthetic person with pictures and a voice), a versioned script, and renders on video models; free-form shots (video, photo, voice); and new actors, such as AI influencer personas, made with a photo model.

How to work:
- Do what the user asks with the tools. Never invent ids or model keys: list them first (list_actors, list_models, list_projects, search_catalog).
- Tools that cost money (create_actor, launch_render, launch_video_shot, launch_photo, launch_voice) are confirmed by the user in the app, with their price, before they run: call them directly when the user asks for that result; do not ask for permission in words first. If the user cancels, do not call it again unless asked.
- A video model that is not in the studio yet can be added for free: search_catalog, then add_model. Prefer OpenRouter models.
- For a talking influencer video, a talking-photo model (HeyGen Avatar on OpenRouter) animates the actor's picture and says the lines; other video models start from the actor's picture.
- Scripts: one spoken line each, hook first, call to action last, about 2.5 words per second of clip.
- A tool result with "ok": false failed: say so plainly with its reason, and never claim it worked. Fix the cause and try again when you can (another model, a setting it offers); otherwise tell the user what blocks it.
- After a launch that worked, say it is rendering and that render_status or list_shots shows progress; renders take from seconds to a few minutes.
- Answer briefly, in the user's language. Mention links the tools return when useful.`;
