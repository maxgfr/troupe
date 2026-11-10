import type { z } from "zod";

import { OPENROUTER_API } from "~/server/chat/openrouter";

// The studio assistant: a chat on OpenRouter that drives the studio with
// tool calls (chat completions `tools`). Plain fetch, so the browser
// edition runs it in the page too. The conversation is the caller's: every
// turn comes in with the whole history and goes back with what was added,
// so nothing is kept between requests in either edition.

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type AssistantMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

// What a tool sends back, to the model and to the page (which shows the
// summary and the link).
export interface ToolOutcome {
  ok: boolean;
  summary: string;
  data?: unknown;
  link?: { label: string; href: string };
}

// A tool that spends money waits for the user: its quote is shown with
// Confirm and Cancel, and it runs only once confirmed.
export interface AssistantTool<A = unknown, C = unknown> {
  name: string;
  description: string;
  // JSON schema of the arguments, as the model sees it.
  parameters: Record<string, unknown>;
  args: z.ZodType<A>;
  quote?: (args: A, ctx: C) => Promise<{ summary: string; estimatedCostUsd: number | null }>;
  run: (args: A, ctx: C) => Promise<ToolOutcome>;
}

export interface PendingAction {
  toolCallId: string;
  tool: string;
  summary: string;
  estimatedCostUsd: number | null;
}

// One answer of the model: its text and the tools it calls.
export type AssistantModel = (
  messages: ({ role: "system"; content: string } | AssistantMessage)[],
  tools: AssistantTool<never, never>[],
) => Promise<{ content: string | null; tool_calls?: ToolCall[] }>;

export class AssistantError extends Error {}

const MAX_RESULT_CHARS = 6000;

function outcomeText(outcome: ToolOutcome): string {
  const text = JSON.stringify(outcome);
  if (text.length <= MAX_RESULT_CHARS) return text;
  // Too long for the model: the summary and the link, and the data cut short.
  return JSON.stringify({
    ...outcome,
    data: `${JSON.stringify(outcome.data).slice(0, MAX_RESULT_CHARS - 500)}… (cut short)`,
  });
}

const failure = (summary: string): ToolOutcome => ({ ok: false, summary });

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // tRPC's input errors arrive as a JSON list of issues: their messages are enough.
  try {
    const issues = JSON.parse(message) as { message?: string; path?: unknown[] }[];
    if (Array.isArray(issues))
      return issues.map((i) => `${(i.path ?? []).join(".") || "input"}: ${i.message ?? "invalid"}`).join("; ");
  } catch {
    // Not JSON: the message as it is.
  }
  return message.slice(0, 500);
}

// The calls of the last assistant message that have no result yet.
function unanswered(messages: AssistantMessage[]): ToolCall[] {
  let index = messages.length - 1;
  while (index >= 0 && messages[index]!.role !== "assistant") index--;
  const last = messages[index];
  if (!last || last.role !== "assistant" || !last.tool_calls?.length) return [];
  const answered = new Set(messages.slice(index + 1).flatMap((m) => (m.role === "tool" ? [m.tool_call_id] : [])));
  return last.tool_calls.filter((c) => !answered.has(c.id));
}

export interface RunInput<C> {
  system: string;
  messages: AssistantMessage[];
  tools: AssistantTool<never, C>[];
  ctx: C;
  model: AssistantModel;
  // The paid call the user just confirmed or cancelled.
  decision?: { toolCallId: string; approve: boolean };
  maxSteps?: number;
}

export interface RunResult {
  messages: AssistantMessage[];
  pending: PendingAction | null;
}

// Run the conversation on: answer the calls waiting for a result (free
// tools at once, a paid one only once confirmed), then ask the model again,
// until it answers in words or a paid call needs the user.
export async function runAssistant<C>(input: RunInput<C>): Promise<RunResult> {
  const messages = [...input.messages];
  const byName = new Map(input.tools.map((t) => [t.name, t]));
  const maxSteps = input.maxSteps ?? 8;
  for (let step = 0; ; step++) {
    const waiting = unanswered(messages);
    for (const call of waiting) {
      const tool = byName.get(call.function.name) as AssistantTool<unknown, C> | undefined;
      const answer = (outcome: ToolOutcome) =>
        messages.push({ role: "tool", tool_call_id: call.id, content: outcomeText(outcome) });
      if (!tool) {
        answer(failure(`There is no tool "${call.function.name}". Use one of: ${[...byName.keys()].join(", ")}.`));
        continue;
      }
      let raw: unknown;
      try {
        raw = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
      } catch {
        answer(failure("The arguments are not valid JSON. Call the tool again with a JSON object."));
        continue;
      }
      const parsed = tool.args.safeParse(raw);
      if (!parsed.success) {
        answer(
          failure(
            `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`,
          ),
        );
        continue;
      }
      if (tool.quote) {
        const decided = input.decision?.toolCallId === call.id ? input.decision : undefined;
        if (!decided) {
          let quote: { summary: string; estimatedCostUsd: number | null };
          try {
            quote = await tool.quote(parsed.data, input.ctx);
          } catch (error) {
            answer(failure(errorText(error)));
            continue;
          }
          return {
            messages,
            pending: {
              toolCallId: call.id,
              tool: tool.name,
              summary: quote.summary,
              estimatedCostUsd: quote.estimatedCostUsd,
            },
          };
        }
        if (!decided.approve) {
          answer(failure("The user cancelled this. Do not run it again unless they ask for it."));
          continue;
        }
      }
      try {
        answer(await tool.run(parsed.data, input.ctx));
      } catch (error) {
        answer(failure(errorText(error)));
      }
    }
    const last = messages.at(-1);
    if (last?.role === "assistant" && !last.tool_calls?.length) return { messages, pending: null };
    if (step >= maxSteps) {
      messages.push({
        role: "assistant",
        content: "I stopped there: that took many steps. Tell me how to go on.",
      });
      return { messages, pending: null };
    }
    const reply = await input.model([{ role: "system", content: input.system }, ...messages], input.tools);
    messages.push({
      role: "assistant",
      content: reply.content ?? null,
      ...(reply.tool_calls?.length ? { tool_calls: reply.tool_calls } : {}),
    });
  }
}

// The model: OpenRouter's chat completions with the tools.
export function openRouterAssistantModel(options: {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): AssistantModel {
  return async (messages, tools) => {
    const doFetch = options.fetch ?? fetch;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
    let response: Response;
    try {
      response = await doFetch(`${OPENROUTER_API}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
          "x-title": "Troupe",
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          tools: tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          tool_choice: "auto",
          // Only providers that take tools answer.
          provider: { require_parameters: true },
          max_tokens: 2000,
        }),
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError")
        throw new AssistantError("OpenRouter took too long to answer. Try again.");
      throw new AssistantError("OpenRouter could not be reached. Check the internet connection.");
    }
    const body = (await response.json().catch(() => ({}))) as {
      choices?: { message?: { content?: unknown; tool_calls?: ToolCall[] } }[];
      error?: { message?: unknown };
    };
    if (!response.ok || body.error) {
      const detail = typeof body.error?.message === "string" ? body.error.message.slice(0, 300) : "";
      if (response.status === 401 || response.status === 403)
        throw new AssistantError("OpenRouter refused the API key. Check it under Provider accounts in Settings.");
      if (response.status === 402)
        throw new AssistantError("OpenRouter says the account is out of credits. Add some at openrouter.ai.");
      if (response.status === 404)
        throw new AssistantError(`OpenRouter has no model "${options.model}" that takes tools. Choose another one.`);
      throw new AssistantError(`OpenRouter could not answer (${response.status}${detail ? `: ${detail}` : ""}).`);
    }
    const message = body.choices?.[0]?.message;
    const calls = (message?.tool_calls ?? []).filter(
      (c) => c && typeof c.id === "string" && typeof c.function?.name === "string",
    );
    return {
      content: typeof message?.content === "string" && message.content ? message.content : null,
      ...(calls.length
        ? {
            tool_calls: calls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.function.name, arguments: c.function.arguments ?? "{}" },
            })),
          }
        : {}),
    };
  };
}
