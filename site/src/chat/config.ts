// What a fork can change about the demo's script chat, read from VITE_*
// variables when the site is built (site/.env.example). site/vite.config.ts
// runs this parser too, so a bad value stops the build.

export interface DemoChatConfig {
  // A WebLLM prebuilt model id (https://github.com/mlc-ai/web-llm, config.ts).
  model: string;
  // The same model with 32-bit activations, for GPUs without shader-f16.
  f32Model: string | null;
  // Shown before the first download, in megabytes; 0 hides the figure.
  downloadMb: number;
  // The chat's house style and speaking rate when Settings leaves them unset.
  instructions: string;
  wordsPerSecond: number;
}

// Qwen2.5 1.5B Instruct, 4-bit weights with 16-bit activations: small enough
// for most laptops' GPUs (about 1.6 GB of video memory) and it follows a JSON
// schema well. Its weights are 880 MB (Hugging Face API, mlc-ai repository).
export const DEFAULT_CHAT_CONFIG: DemoChatConfig = {
  model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  f32Model: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
  downloadMb: 880,
  instructions: "",
  wordsPerSecond: 2.5,
};

type Env = Record<string, string | boolean | undefined>;

// `knownModels` is WebLLM's list of prebuilt models; the build passes it, so
// an id WebLLM cannot load stops the build instead of a visitor's chat.
export function parseChatConfig(env: Env, knownModels?: readonly string[]): DemoChatConfig {
  const problems: string[] = [];
  const read = (name: string) => {
    const value = env[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };
  const defaults = DEFAULT_CHAT_CONFIG;

  const model = read("VITE_WEBLLM_MODEL");
  if (model !== undefined && !/^[\w.-]+$/.test(model)) problems.push(`VITE_WEBLLM_MODEL must be a WebLLM model id such as ${defaults.model} (got "${model}").`);
  else if (model !== undefined && knownModels && !knownModels.includes(model)) problems.push(`VITE_WEBLLM_MODEL "${model}" is not a WebLLM prebuilt model (see prebuiltAppConfig in @mlc-ai/web-llm).`);
  const chosen = model ?? defaults.model;
  const sibling = /q4f16/.test(chosen) ? chosen.replace("q4f16", "q4f32") : null;
  const f32Model = sibling && (knownModels ? knownModels.includes(sibling) : chosen === defaults.model) ? sibling : null;

  // A size only makes sense for the model it was measured on.
  let downloadMb = model === undefined || model === defaults.model ? defaults.downloadMb : 0;
  const rawMb = read("VITE_WEBLLM_DOWNLOAD_MB");
  if (rawMb !== undefined) {
    const mb = Number(rawMb);
    if (Number.isInteger(mb) && mb >= 0 && mb <= 100_000) downloadMb = mb;
    else problems.push(`VITE_WEBLLM_DOWNLOAD_MB must be a whole number of megabytes (got "${rawMb}").`);
  }

  const instructions = read("VITE_CHAT_INSTRUCTIONS") ?? defaults.instructions;
  if (instructions.length > 2000) problems.push("VITE_CHAT_INSTRUCTIONS must be at most 2000 characters.");

  let wordsPerSecond = defaults.wordsPerSecond;
  const rawRate = read("VITE_CHAT_WORDS_PER_SECOND");
  if (rawRate !== undefined) {
    const rate = Number(rawRate);
    if (Number.isFinite(rate) && rate >= 1 && rate <= 5) wordsPerSecond = rate;
    else problems.push(`VITE_CHAT_WORDS_PER_SECOND must be a number from 1 to 5 (got "${rawRate}").`);
  }

  if (problems.length > 0) throw new Error(`Invalid chat settings:\n- ${problems.join("\n- ")}`);
  return { model: chosen, f32Model, downloadMb, instructions, wordsPerSecond };
}
