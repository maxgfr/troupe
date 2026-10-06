// What each Claude model accepts, for the parts of a request the chat may
// send. From Anthropic's API reference (models, structured outputs, effort,
// refusals and fallback), as of 2026-09. The current models have no dated
// ids; the older ones are listed under both their alias and dated id. A model missing here gets none of
// them: an unknown id is sent only what every model takes, and the JSON
// schema goes in the prompt instead.

export interface ClaudeCapabilities {
  // output_config.format with a JSON schema.
  structuredOutputs: boolean;
  // output_config.effort ("low" is valid on every model that has effort).
  effort: boolean;
  // fallbacks: "default" under the server-side-fallback-2026-07-01 beta.
  serverFallback: boolean;
  // temperature (0 to 1). The newer models refuse any sampling setting.
  temperature: boolean;
}

const caps = (
  structuredOutputs: boolean,
  effort: boolean,
  serverFallback: boolean,
  temperature: boolean,
): ClaudeCapabilities => ({
  structuredOutputs,
  effort,
  serverFallback,
  temperature,
});

export const CLAUDE_MODELS: Readonly<Record<string, ClaudeCapabilities>> = {
  "claude-fable-5-1": caps(true, true, true, false),
  "claude-mythos-5-1": caps(true, true, true, false),
  "claude-fable-5": caps(true, true, true, false),
  // Runs no safety classifiers, so it never declines: nothing to fall back from.
  "claude-mythos-5": caps(true, true, false, false),
  "claude-opus-5-5": caps(true, true, true, false),
  "claude-opus-5": caps(true, true, true, false),
  "claude-sonnet-5-5": caps(true, true, true, false),
  "claude-sonnet-5": caps(true, true, false, false),
  "claude-opus-4-8": caps(true, true, false, false),
  // Structured outputs are not listed for 4.7, 4.6 and Sonnet 4.6: the schema
  // goes in the prompt there.
  "claude-opus-4-7": caps(false, true, false, false),
  "claude-opus-4-6": caps(false, true, false, true),
  "claude-sonnet-4-6": caps(false, true, false, true),
  "claude-haiku-4-5": caps(true, false, false, true),
  "claude-haiku-4-5-20251001": caps(true, false, false, true),
  "claude-opus-4-5": caps(true, true, false, true),
  "claude-opus-4-5-20251101": caps(true, true, false, true),
  "claude-sonnet-4-5": caps(false, false, false, true),
  "claude-sonnet-4-5-20250929": caps(false, false, false, true),
  // Not claude-opus-4-1: Anthropic retired it on 2026-08-05.
};

const NOTHING_EXTRA = caps(false, false, false, false);

export function claudeCapabilities(model: string): ClaudeCapabilities {
  return CLAUDE_MODELS[model] ?? NOTHING_EXTRA;
}

// Claude's temperature runs from 0 to 1; the chat's setting (shared with
// Ollama) runs to 2, so a higher value is held at 1.
export function claudeTemperature(value: number): number {
  return Math.min(1, Math.max(0, value));
}
