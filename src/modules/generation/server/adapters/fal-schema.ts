import type { ModelCapabilities } from "../adapter";

// What Troupe needs to call a fal.ai text-to-video endpoint it does not ship
// with, read from the endpoint's OpenAPI schema (fal's model API, expand=
// openapi-3.0): which settings it takes, in which shape, and the values the
// pickers may offer. Stored as the model's `connection` (never a secret).
export interface FalInputShape {
  endpoint: string;
  // How the clip length is sent: "5", "5s", 5, or not at all.
  duration: "string" | "suffix-s" | "number" | null;
  aspectRatio: boolean;
  resolution: boolean;
  audio: boolean;
  // Required settings Troupe does not choose, sent with the schema's default.
  fixed: Record<string, unknown>;
}

export interface FalModelDescription {
  capabilities: ModelCapabilities;
  input: FalInputShape;
}

type Schema = {
  type?: string;
  enum?: unknown[];
  anyOf?: Schema[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
};

// fal endpoint ids: "owner/model[/variant…]", no dots between slashes.
export const FAL_ENDPOINT = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/i;

export const isFalEndpoint = (value: string) => FAL_ENDPOINT.test(value) && !value.includes("..");

// The most clip lengths a picker offers for an endpoint that takes any length.
const MAX_LENGTHS = 30;
const RATIO = /^\d{1,2}:\d{1,2}$/;
// The settings Troupe chooses itself.
const CHOSEN = new Set(["prompt", "duration", "aspect_ratio", "resolution", "generate_audio"]);

// One property's own schema, its enum and numeric bounds merged across anyOf.
function flatten(schema: Schema | undefined): Schema | undefined {
  if (!schema?.anyOf) return schema;
  const parts = schema.anyOf.filter((s) => s.type !== "null");
  return {
    ...schema,
    type: parts.find((p) => p.type)?.type,
    enum: parts.flatMap((p) => p.enum ?? []),
    minimum: parts.find((p) => p.minimum !== undefined)?.minimum,
    maximum: parts.find((p) => p.maximum !== undefined)?.maximum,
  };
}

function lengths(schema: Schema | undefined): { durationsS: number[]; shape: FalInputShape["duration"] } | null {
  const d = flatten(schema);
  if (!d) return { durationsS: [], shape: null };
  if (d.enum?.length) {
    const values = d.enum.filter((v): v is string | number => typeof v === "string" || typeof v === "number");
    const suffix = values.some((v) => typeof v === "string" && /^\d+s$/.test(v));
    const seconds = values
      .map((v) => (typeof v === "number" ? v : Number(String(v).replace(/s$/, ""))))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (seconds.length === 0) return null;
    const numeric = values.every((v) => typeof v === "number");
    return {
      durationsS: [...new Set(seconds)].sort((a, b) => a - b),
      shape: numeric ? "number" : suffix ? "suffix-s" : "string",
    };
  }
  if (d.type === "integer" || d.type === "number") {
    const low = Math.max(1, Math.ceil(d.minimum ?? 1));
    const high = Math.floor(d.maximum ?? low + MAX_LENGTHS - 1);
    if (high < low) return null;
    const all = Array.from({ length: Math.min(high - low + 1, MAX_LENGTHS) }, (_, i) => low + i);
    return { durationsS: all, shape: "number" };
  }
  return null;
}

const strings = (schema: Schema | undefined) =>
  (flatten(schema)?.enum ?? []).filter((v): v is string => typeof v === "string");

// The endpoint's text-to-video input, or why Troupe cannot drive it.
export function describeFalModel(
  endpoint: string,
  openapi: unknown,
): { ok: true; model: FalModelDescription } | { ok: false; reason: string } {
  const schemas = (openapi as { components?: { schemas?: Record<string, Schema> } })?.components?.schemas ?? {};
  const input = Object.entries(schemas).find(([name]) => name.endsWith("Input"))?.[1];
  const props = input?.properties ?? {};
  if (!props.prompt) return { ok: false, reason: "This model does not render from a text prompt." };

  const fixed: Record<string, unknown> = {};
  for (const name of input?.required ?? []) {
    if (CHOSEN.has(name)) continue;
    const prop = props[name];
    if (prop?.default === undefined)
      return { ok: false, reason: `This model needs a "${name}" setting Troupe cannot choose.` };
    fixed[name] = prop.default;
  }

  const duration = lengths(props.duration);
  if (!duration) return { ok: false, reason: "This model's clip lengths could not be read." };
  const def = flatten(props.duration)?.default;
  const defaultS = typeof def === "number" ? def : Number(String(def ?? "").replace(/s$/, ""));
  const ratios = strings(props.aspect_ratio).filter((r) => RATIO.test(r));
  const resolutions = strings(props.resolution);
  const durationsS = duration.durationsS.length
    ? duration.durationsS
    : // No length setting: the model picks one; its default if it says.
      [Number.isInteger(defaultS) && defaultS > 0 ? defaultS : 5];

  return {
    ok: true,
    model: {
      capabilities: {
        // Without a format setting the model renders its own; 16:9 is the common one.
        aspectRatios: ratios.length ? ratios : ["16:9"],
        resolutions: resolutions.length ? resolutions : ["720p"],
        durationsS,
        audio: props.generate_audio ? "optional" : "none",
        dialogueLanguages: null,
      },
      input: {
        endpoint,
        duration: duration.durationsS.length ? duration.shape : null,
        aspectRatio: ratios.length > 0,
        resolution: resolutions.length > 0,
        audio: Boolean(props.generate_audio),
        fixed,
      },
    },
  };
}

// The request body for one render, in the endpoint's own shape.
export function falRequestBody(
  input: FalInputShape,
  req: { prompt: string; aspectRatio: string; durationS: number; resolution: string; audio: boolean },
): Record<string, unknown> {
  return {
    ...input.fixed,
    prompt: req.prompt,
    ...(input.duration === "string"
      ? { duration: String(req.durationS) }
      : input.duration === "suffix-s"
        ? { duration: `${req.durationS}s` }
        : input.duration === "number"
          ? { duration: req.durationS }
          : {}),
    ...(input.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
    ...(input.resolution ? { resolution: req.resolution } : {}),
    ...(input.audio ? { generate_audio: req.audio } : {}),
  };
}

// A stored connection read back, or null when it is not one this module wrote.
export function parseFalInput(connection: unknown): FalInputShape | null {
  const c = connection as Partial<FalInputShape> | null;
  if (!c || typeof c.endpoint !== "string" || !isFalEndpoint(c.endpoint)) return null;
  const duration = c.duration === "string" || c.duration === "suffix-s" || c.duration === "number" ? c.duration : null;
  return {
    endpoint: c.endpoint,
    duration,
    aspectRatio: c.aspectRatio === true,
    resolution: c.resolution === true,
    audio: c.audio === true,
    fixed: c.fixed && typeof c.fixed === "object" ? (c.fixed as Record<string, unknown>) : {},
  };
}
