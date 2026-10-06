import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

// Pure modules shared with the studio's pages: the same file names and the
// same AI-disclosure wording as the browser shows.
import { renderFileName } from "../../../src/app/_components/download-name.ts";
import { disclosureFor } from "../../../src/modules/export/disclosure.ts";
import { fetchMedia, type Outputs } from "../client.ts";
import { type Command, flag, oneOf, str, strings } from "../command.ts";
import { CliError, EXIT, usageError } from "../errors.ts";
import { shortId, table, when } from "../output.ts";
import { pick } from "../resolve.ts";
import { findRender, type Render } from "./render.ts";

type ExportRecord = Outputs["export"]["list"][number];

const PLATFORMS = ["tiktok", "instagram", "youtube", "linkedin"] as const;

const create: Command = {
  path: ["export", "create"],
  args: "[render]",
  positionals: { min: 0, max: 1 },
  project: true,
  summary:
    "Export a finished render (default: the newest) for a platform. A person must have watched it: --confirm-watched records that.",
  options: {
    platform: {
      type: "string",
      value: "<platform>",
      description: "tiktok, instagram, youtube or linkedin (default: the project's).",
    },
    caption: { type: "string", value: "<text>", description: "Caption to publish with it (default: empty)." },
    hashtag: { type: "string", multiple: true, value: "<tag>", description: "A hashtag, with or without #." },
    "confirm-watched": {
      type: "boolean",
      description: "Confirm that a person watched the video and that it is ready to publish (required).",
    },
    "accept-mismatch": {
      type: "boolean",
      description: "Export even if the video does not match the platform's documented specs.",
    },
  },
  examples: [
    'troupe export create --platform tiktok --caption "Packs into its own pocket" --hashtag jacket --hashtag spring --confirm-watched',
  ],
  async run(ctx, { positionals, options }) {
    const project = await ctx.project(str(options, "project"));
    const render = await findRender(ctx, project.id, positionals[0] ?? (await newestFinished(ctx, project.id)));
    if (render.status !== "completed")
      throw new CliError(`Render ${shortId(render.id)} is ${render.status}; only a completed render can be exported.`, {
        code: "NOT_FINISHED",
      });
    const platform = oneOf(str(options, "platform") ?? project.platform, PLATFORMS, "platform");
    const specs = await ctx.api.export.checkSpecs.query({ projectId: project.id, generationId: render.id, platform });
    if (!specs.ok && !flag(options, "accept-mismatch")) {
      throw new CliError(
        `This video does not match ${platform}'s specs: ${specs.mismatches.join("; ")}. Pass --accept-mismatch to export anyway.`,
        { code: "SPEC_MISMATCH" },
      );
    }
    if (!flag(options, "confirm-watched")) {
      throw usageError(
        `An export records that a person watched the video and found it ready to publish. Watch it first (troupe download ${shortId(render.id)}), then add --confirm-watched.`,
      );
    }
    const hashtags = strings(options, "hashtag")
      .map((tag) => tag.trim().replace(/^#*/, ""))
      .filter(Boolean)
      .map((tag) => `#${tag}`);
    const record = await ctx.api.export.create.mutate({
      projectId: project.id,
      generationId: render.id,
      platform,
      caption: str(options, "caption") ?? "",
      hashtags,
      qualityConfirmed: true,
      acknowledgeSpecMismatch: !specs.ok,
    });
    const disclosure = disclosureFor(platform);
    return {
      data: { ...record, disclosure },
      text: `Exported render ${shortId(render.id)} for ${platform} (export ${shortId(record.id)}).\n${disclosure.headline}: ${disclosure.detail}\nDownload it: troupe download ${shortId(record.id)}`,
    };
  },
};

async function newestFinished(ctx: Parameters<Command["run"]>[0], projectId: string): Promise<string> {
  const renders = await ctx.api.generation.forProject.query({ projectId });
  const done = renders.find((r) => r.status === "completed");
  if (!done)
    throw new CliError("This project has no completed render to export yet. Follow one with troupe render watch.", {
      code: "NOT_FINISHED",
    });
  return done.id;
}

const list: Command = {
  path: ["export", "list"],
  project: true,
  summary: "List the project's exports, newest first.",
  async run(ctx, { options }) {
    const project = await ctx.project(str(options, "project"));
    const exports = await ctx.api.export.list.query({ projectId: project.id });
    return {
      data: exports,
      text: exports.length
        ? table(
            ["ID", "RENDER", "PLATFORM", "CREATED", "CAPTION"],
            exports.map((e) => [
              shortId(e.id),
              shortId(e.generationId),
              e.platform,
              when(e.createdAt),
              [e.caption, ...e.hashtags].filter(Boolean).join(" "),
            ]),
          )
        : "No exports yet. Make one with troupe export create --confirm-watched.",
    };
  },
};

async function exists(path: string): Promise<"file" | "dir" | null> {
  try {
    return (await stat(path)).isDirectory() ? "dir" : "file";
  } catch {
    return null;
  }
}

const download: Command = {
  path: ["download"],
  args: "[render|export]",
  positionals: { min: 0, max: 1 },
  project: true,
  summary:
    "Save the MP4 of a render or an export (default: the newest completed render), named like the studio names downloads.",
  options: {
    output: {
      type: "string",
      short: "o",
      value: "<path>",
      description: "File or folder to save to (default: the current folder).",
    },
    force: { type: "boolean", description: "Overwrite an existing file." },
  },
  examples: ["troupe download", "troupe download 1a2b3c4d -o review.mp4", "troupe download <export-id> -o ~/Videos/"],
  async run(ctx, { positionals, options }) {
    const project = await ctx.project(str(options, "project"));
    const [renders, exports] = await Promise.all([
      ctx.api.generation.forProject.query({ projectId: project.id }),
      ctx.api.export.list.query({ projectId: project.id }),
    ]);
    let render: Render;
    let record: ExportRecord | null = null;
    const ref = positionals[0];
    if (!ref || ref === "latest") {
      render = renders.find((r) => r.status === "completed") ?? (await findRender(ctx, project.id));
    } else {
      const found = pick(
        [
          ...renders.map((r) => ({ id: r.id, render: r, record: null })),
          ...exports.map((e) => ({ id: e.id, render: renders.find((r) => r.id === e.generationId), record: e })),
        ],
        ref,
        {
          kind: "render or export",
          listCommand: "troupe render list / troupe export list",
          id: (item) => item.id,
        },
      );
      if (!found.render)
        throw new CliError(`The render of export ${shortId(found.id)} no longer exists.`, { code: "NOT_FOUND" });
      render = found.render;
      record = found.record;
    }
    const path = record?.downloadUrl ?? (render.outputAssetUrl ? `${render.outputAssetUrl}?download=1` : null);
    if (render.status !== "completed" || !path)
      throw new CliError(
        `Render ${shortId(render.id)} is ${render.status} and has no video yet. Follow it with troupe render watch ${shortId(render.id)}.`,
        { code: "NOT_FINISHED" },
      );

    const name = renderFileName({ project: project.title, model: render.modelLabel, createdAt: render.createdAt });
    const wanted = resolve(ctx.io.cwd, str(options, "output") ?? ".");
    const target =
      (await exists(wanted)) === "dir" || /[/\\]$/.test(str(options, "output") ?? "") ? join(wanted, name) : wanted;
    if ((await exists(target)) === "file" && !flag(options, "force"))
      throw new CliError(`${target} already exists. Pass --force to overwrite it or -o to choose another name.`, {
        code: "FILE_EXISTS",
      });

    const response = await fetchMedia(ctx.connection, path);
    if (response.status === 401 || response.status === 403)
      throw new CliError(`The studio refused the download (HTTP ${response.status}). Run troupe login.`, {
        exitCode: EXIT.auth,
        code: "UNAUTHORIZED",
      });
    if (!response.ok || !response.body)
      throw new CliError(`The studio could not send the video (HTTP ${response.status}).`, { code: "DOWNLOAD_FAILED" });
    // A fresh name each time: an existing .part file is someone else's.
    const partial = `${target}.${randomBytes(4).toString("hex")}.part`;
    try {
      await mkdir(dirname(target), { recursive: true });
      await pipeline(
        Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
        createWriteStream(partial, { flags: "wx" }),
      );
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { force: true });
      throw new CliError(`Could not save ${target}: ${(error as Error).message}`, { code: "DOWNLOAD_FAILED" });
    }
    const bytes = (await stat(target)).size;
    return {
      data: {
        path: target,
        bytes,
        contentType: response.headers.get("content-type"),
        renderId: render.id,
        exportId: record?.id ?? null,
      },
      text: `Saved ${target} (${(bytes / 1_048_576).toFixed(1)} MB, render ${shortId(render.id)}${record ? `, export ${shortId(record.id)}` : ""}).`,
    };
  },
};

export const exportCommands: Command[] = [create, list, download];
