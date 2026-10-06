import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { Outputs } from "../client.ts";
import { uploadToLibrary } from "../client.ts";
import { type Command, type Context, flag, int, oneOf, str, strings } from "../command.ts";
import { EXIT, usageError } from "../errors.ts";
import { fields, shortId, table, truncate, when } from "../output.ts";
import { pick } from "../resolve.ts";
import { findActor } from "./projects.ts";

type Item = Outputs["library"]["list"][number];
type Idea = Outputs["library"]["ideas"]["list"][number];

const KINDS = ["video", "audio", "image", "pdf", "text", "article"] as const;
const IDEA_KINDS = ["ideas", "remix", "script", "repurpose"] as const;
const PLATFORMS = ["tiktok", "instagram", "youtube", "linkedin"] as const;

const clock = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined) return "-";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const isLink = (value: string) => /^https?:\/\//i.test(value);

export async function findItem(ctx: Context, ref: string): Promise<Item> {
  const items = await ctx.api.library.list.query({ workspaceId: await ctx.workspaceId() });
  return pick(items, ref, { kind: "item", listCommand: "troupe library list", id: (i) => i.id, names: (i) => [i.title, i.fileName] });
}

async function findIdea(ctx: Context, ref: string): Promise<Idea> {
  const ideas = await ctx.api.library.ideas.list.query({ workspaceId: await ctx.workspaceId() });
  return pick(ideas, ref, { kind: "idea", listCommand: "troupe library ideas", id: (i) => i.id, names: (i) => [i.title] });
}

// Polls an item until its analysis ends (ready or failed), or the timeout.
async function waitForItem(ctx: Context, itemId: string, timeoutS: number) {
  const workspaceId = await ctx.workspaceId();
  const until = Date.now() + timeoutS * 1000;
  let last = "";
  for (;;) {
    const item = await ctx.api.library.get.query({ workspaceId, itemId });
    if (item.status === "ready" || item.status === "failed") return item;
    const stage = item.status === "queued" ? "waiting its turn" : (item.stage ?? "reading");
    if (stage !== last) ctx.note(`${item.title}: ${stage}…`);
    last = stage;
    if (Date.now() > until) return item;
    await ctx.io.sleep(2000);
  }
}

function itemSummary(item: Outputs["library"]["get"]): string {
  const a = item.analysis;
  return fields([
    ["Title", item.title],
    ["Id", item.id],
    ["Kind", `${item.kind}${item.durationS ? `, ${clock(item.durationS)}` : ""}${item.mine ? ", my own" : ""}`],
    ["Status", item.status === "analyzing" ? `reading (${item.stage ?? "…"})` : item.status],
    ["Source", item.sourceUrl ?? item.fileName ?? "pasted"],
    ["Hook", a?.hook ? `"${a.hook.text}"` : "-"],
    ["Why", a?.hook?.why ?? "-"],
    ["Summary", a?.summary ?? "-"],
    ["Structure", a?.structure?.map((p) => `${p.startS !== undefined ? `${clock(p.startS)} ` : ""}${p.part}: ${p.summary}`).join(" | ") ?? "-"],
    ["Pace", a?.pacing ? `${a.pacing.pace}${a.pacing.wordsPerSecond !== undefined ? `, ${a.pacing.wordsPerSecond} words/s` : ""}${a.pacing.cutsPerMinute !== undefined ? `, ${a.pacing.cutsPerMinute} cuts/min` : ""}` : "-"],
    ["Tone", a?.tone?.join(", ") ?? "-"],
    ["Tags", item.tags.join(", ") || "-"],
    ["Pictures", a?.frames?.length ? `${a.frames.length}${a.frames.some((f) => f.description) ? ", described" : ""}` : "-"],
    ["Passages", `${item.passages}, ${item.embedded} indexed by meaning`],
    ["Notes", item.problem ?? "-"],
  ]);
}

const add: Command = {
  path: ["library", "add"],
  args: "<file|link|->",
  positionals: { min: 1, max: 1 },
  summary: "Save a file (video, sound, picture, PDF, text), a link (a video platform or a page) or text from stdin (-) to the inspiration library; its analysis starts at once.",
  options: {
    title: { type: "string", value: "<title>", description: "Title (default: the file's name, the page's title or the text's first line)." },
    mine: { type: "boolean", description: "It is your own content: its hooks, tone and pace shape what Troupe writes in your voice." },
    wait: { type: "boolean", description: "Wait for the analysis to finish, then show it." },
    timeout: { type: "string", value: "<seconds>", description: "With --wait: how long to wait (default 900)." },
  },
  examples: ["troupe library add clip.mp4 --wait", "troupe library add https://www.youtube.com/shorts/… --title \"Cold open\"", "pbpaste | troupe library add - --mine"],
  async run(ctx, { positionals, options }) {
    const source = positionals[0]!;
    const workspaceId = await ctx.workspaceId();
    const title = str(options, "title");
    const mine = flag(options, "mine");
    let itemId: string;
    if (source === "-") {
      const text = await ctx.io.readStdin();
      if (!text.trim()) throw usageError("Nothing came on stdin.");
      itemId = (await ctx.api.library.addText.mutate({ workspaceId, text, title, mine })).id;
    } else if (isLink(source)) {
      ctx.note("Fetching the link…");
      itemId = (await ctx.api.library.addUrl.mutate({ workspaceId, url: source, title, mine })).id;
    } else {
      const path = resolve(ctx.io.cwd, source);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) throw usageError(`${source} is not a file. Pass a file, a link starting with https://, or - for text on stdin.`);
      ctx.note(`Uploading ${basename(path)} (${Math.round(info.size / 1024)} KB)…`);
      itemId = (await uploadToLibrary(ctx.connection, await openAsBlob(path), { name: basename(path), workspaceId, mine, title })).id;
    }
    if (!flag(options, "wait")) {
      const item = await ctx.api.library.get.query({ workspaceId, itemId });
      return { data: item, text: `Saved "${item.title}" (${shortId(item.id)}); its analysis has started.\nFollow it: troupe library show ${shortId(item.id)}` };
    }
    const item = await waitForItem(ctx, itemId, int(options, "timeout", { min: 1 }) ?? 900);
    const full = await ctx.api.library.get.query({ workspaceId, itemId: item.id });
    const exitCode = full.status === "failed" ? EXIT.failed : full.status === "ready" ? EXIT.ok : EXIT.timeout;
    return { data: full, text: itemSummary(full), exitCode };
  },
};

const list: Command = {
  path: ["library", "list"],
  summary: "List the library, newest first, with each item's kind, length, tags and status.",
  options: {
    kind: { type: "string", value: "<kind>", description: `Only this kind (${KINDS.join(", ")}).` },
    mine: { type: "boolean", description: "Only your own content." },
    tag: { type: "string", value: "<tag>", description: "Only items with this tag." },
  },
  async run(ctx, { options }) {
    const kind = str(options, "kind");
    const items = await ctx.api.library.list.query({ workspaceId: await ctx.workspaceId(), ...(kind ? { kind: oneOf(kind, KINDS, "kind") } : {}), ...(flag(options, "mine") ? { mine: true } : {}), ...(str(options, "tag") ? { tag: str(options, "tag") } : {}) });
    return {
      data: items,
      text: items.length
        ? table(["ID", "KIND", "LENGTH", "STATUS", "ADDED", "TITLE"], items.map((i) => [shortId(i.id), i.kind, clock(i.durationS), i.status, when(i.createdAt), `${i.mine ? "[mine] " : ""}${truncate(i.title, 60)}${i.tags.length ? ` (${i.tags.slice(0, 3).join(", ")})` : ""}`]))
        : "The library is empty. Save something with troupe library add <file|link|->.",
    };
  },
};

const show: Command = {
  path: ["library", "show"],
  args: "<item>",
  positionals: { min: 1, max: 1 },
  summary: "Show an item's analysis: hook, summary, structure, pace, tone, tags; --transcript adds the timed transcript.",
  options: { transcript: { type: "boolean", description: "Also print the transcript, with times." } },
  async run(ctx, { positionals, options }) {
    const found = await findItem(ctx, positionals[0]!);
    const item = await ctx.api.library.get.query({ workspaceId: await ctx.workspaceId(), itemId: found.id });
    const transcript = flag(options, "transcript") && item.analysis?.transcript ? `\n\n${item.analysis.transcript.segments.map((s) => `${clock(s.startS).padStart(5)}  ${s.text}`).join("\n")}` : "";
    return { data: item, text: `${itemSummary(item)}${transcript}` };
  },
};

const search: Command = {
  path: ["library", "search"],
  args: "<query...>",
  positionals: { min: 1, max: 100 },
  summary: "Search the library by meaning (by keywords where no embedding model has read it yet); each hit gives the item and the moment.",
  options: {
    item: { type: "string", value: "<item>", description: "Only within this item." },
    limit: { type: "string", value: "<n>", description: "How many passages (default 10, at most 50)." },
  },
  async run(ctx, { positionals, options }) {
    const workspaceId = await ctx.workspaceId();
    const itemRef = str(options, "item");
    const itemId = itemRef ? (await findItem(ctx, itemRef)).id : undefined;
    const result = await ctx.api.library.search.query({ workspaceId, query: positionals.join(" "), ...(itemId ? { itemId } : {}), limit: int(options, "limit", { min: 1, max: 50 }) ?? 10 });
    const header = `${result.hits.length} passage${result.hits.length === 1 ? "" : "s"} ${result.mode === "semantic" ? "by meaning" : "by keywords"}.${result.note ? ` ${result.note}` : ""}`;
    return {
      data: result,
      text: result.hits.length ? `${header}\n${table(["ITEM", "AT", "SCORE", "TITLE", "PASSAGE"], result.hits.map((h) => [shortId(h.itemId), h.startS !== null ? clock(h.startS) : "-", h.score, truncate(h.title, 30), truncate(h.text, 90)]))}` : header,
    };
  },
};

const chat: Command = {
  path: ["library", "chat"],
  args: "<message...>",
  positionals: { min: 1, max: 200 },
  summary: "Ask the library (or one item with --item); the answer cites the items and moments it comes from.",
  options: { item: { type: "string", value: "<item>", description: "Ask about this item only." } },
  examples: ["troupe library chat which hooks open with a question?", "troupe library chat --item \"Cold open\" why does this hook work?"],
  async run(ctx, { positionals, options }) {
    const workspaceId = await ctx.workspaceId();
    const itemRef = str(options, "item");
    const itemId = itemRef ? (await findItem(ctx, itemRef)).id : null;
    ctx.note("Waiting for the chat model…");
    const { assistant } = await ctx.api.library.chat.send.mutate({ workspaceId, itemId, message: positionals.join(" ") });
    const sources = assistant.citations.map((c) => `[${c.n}] ${c.title}${c.startS !== null ? ` at ${clock(c.startS)}` : ""} (troupe library show ${shortId(c.itemId)})`);
    return { data: assistant, text: [assistant.content, ...(sources.length ? ["", "Sources:", ...sources] : [])].join("\n") };
  },
};

function ideaText(ideas: Idea[]): string {
  if (ideas.length === 0) return "No ideas yet. Write some with troupe library ideas generate --item <item>.";
  return ideas
    .map((i) => [`${shortId(i.id)}  ${i.title}${i.projectId ? `  (project ${shortId(i.projectId)})` : ""}`, ...i.lines.map((l) => `    ${l.role.padEnd(4)}  ${l.text}`)].join("\n"))
    .join("\n\n");
}

const ideas: Command = {
  path: ["library", "ideas"],
  summary: "List the idea cards the library wrote (each a whole short script); generate them with library ideas generate.",
  options: { item: { type: "string", value: "<item>", description: "Only ideas written from this item." } },
  async run(ctx, { options }) {
    const itemRef = str(options, "item");
    const list = await ctx.api.library.ideas.list.query({ workspaceId: await ctx.workspaceId(), ...(itemRef ? { itemId: (await findItem(ctx, itemRef)).id } : {}) });
    return { data: list, text: ideaText(list) };
  },
};

const generate: Command = {
  path: ["library", "ideas", "generate"],
  summary: "Write idea cards from saved items: ideas in their style (as many as the studio's TROUPE_LIBRARY_IDEAS, 10 unless set), a remix of a hook, a script for one actor, or a long item cut into short scripts.",
  options: {
    item: { type: "string", multiple: true, value: "<item>", description: "An item to work from (repeat for several)." },
    kind: { type: "string", value: "<kind>", description: `${IDEA_KINDS.join(", ")} (default ideas).` },
    count: { type: "string", value: "<n>", description: "How many (1 to 10; default: the studio's TROUPE_LIBRARY_IDEAS ideas, 10 unless set; 5 remixes, 3 cuts)." },
    actor: { type: "string", value: "<actor>", description: "With --kind script: the actor who will say it." },
    duration: { type: "string", value: "<seconds>", description: "How long each script lasts (default 20, or the default video model's longest clip when shorter)." },
    brief: { type: "string", value: "<text>", description: "What you want, in your words." },
  },
  examples: ["troupe library ideas generate --item \"Cold open\"", "troupe library ideas generate --item 3f2a --kind script --actor Maya", "troupe library ideas generate --item 3f2a --kind remix --count 3"],
  async run(ctx, { options }) {
    const workspaceId = await ctx.workspaceId();
    const kind = oneOf(str(options, "kind") ?? "ideas", IDEA_KINDS, "kind");
    const itemIds = await Promise.all(strings(options, "item").map(async (ref) => (await findItem(ctx, ref)).id));
    if (itemIds.length === 0 && !str(options, "brief")) throw usageError("Pass --item <item> (or --brief for ideas from your words).");
    const actorRef = str(options, "actor");
    if (kind === "script" && !actorRef) throw usageError("--kind script needs --actor <name>.");
    const actorId = actorRef ? (await findActor(ctx, actorRef)).id : null;
    ctx.note("The chat model is writing…");
    const written = await ctx.api.library.ideas.generate.mutate({ workspaceId, kind, itemIds, actorId, count: int(options, "count", { min: 1, max: 10 }), durationS: int(options, "duration", { min: 4, max: 120 }), brief: str(options, "brief") });
    return { data: written, text: `${ideaText(written as Idea[])}\n\nMake one a project: troupe library ideas project <idea>` };
  },
};

const project: Command = {
  path: ["library", "ideas", "project"],
  args: "<idea>",
  positionals: { min: 1, max: 1 },
  summary: "Create a project from an idea card, its script as version 1, and make it the current project.",
  options: {
    actor: { type: "string", value: "<actor>", description: "The actor (default: the idea's, or the first available)." },
    platform: { type: "string", value: "<platform>", description: `${PLATFORMS.join(", ")} (default tiktok).` },
  },
  async run(ctx, { positionals, options }) {
    const idea = await findIdea(ctx, positionals[0]!);
    const actorRef = str(options, "actor");
    const platform = str(options, "platform");
    const result = await ctx.api.library.ideas.createProject.mutate({
      workspaceId: await ctx.workspaceId(),
      ideaId: idea.id,
      ...(actorRef ? { actorId: (await findActor(ctx, actorRef)).id } : {}),
      ...(platform ? { platform: oneOf(platform, PLATFORMS, "platform") } : {}),
    });
    const current = await ctx.rememberProject(result.projectId);
    return {
      data: result,
      text: `${result.created ? "Created" : "Already made:"} project ${shortId(result.projectId)} "${idea.title}" with the idea's script as version 1.${current ? " It is now the current project." : ""}\nRender it: troupe render launch --watch`,
    };
  },
};

export const libraryCommands: Command[] = [add, list, show, search, chat, ideas, generate, project];

