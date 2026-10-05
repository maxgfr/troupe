import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createLocalContext } from "~/server/api/local-context";
import { assertMembership, listWorkspacesFor } from "~/modules/identity";
import { addFileItem, addTextItem, LibraryError } from "~/modules/library";
import { cleanFileName, libraryEnvironment, receiveUpload, UploadRefused } from "~/server/library";

// POST /api/library/upload: one file as the request body, streamed to the
// data folder with a size limit and checked by its first bytes, then saved
// as a library item whose analysis starts at once. The studio's pages and
// the CLI use it (docs/LIBRARY.md).
//
//   ?name=<file name>&title=<title>&mine=1&workspaceId=<uuid>
//
// The file stays on this server: originals are never sent elsewhere.

const Query = z.object({
  name: z.string().max(500).optional(),
  title: z.string().max(300).optional(),
  mine: z.enum(["0", "1", "true", "false"]).optional(),
  workspaceId: z.string().uuid().optional(),
});

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  let ctx: Awaited<ReturnType<typeof createLocalContext>>;
  try {
    ctx = await createLocalContext(req.headers);
  } catch (error) {
    if (error instanceof TRPCError) return json(error.code === "UNAUTHORIZED" ? 401 : 403, { error: error.message });
    throw error;
  }
  const library = ctx.library;
  if (!library) return json(503, { error: "The inspiration library is off on this studio (TROUPE_LIBRARY=0)." });
  if (process.env.VERCEL) return json(400, { error: "The library keeps its files on your own server; uploads need the self-hosted studio. Paste text or save links instead." });
  const query = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return json(400, { error: "The upload's query is not valid." });
  const env = libraryEnvironment();
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > env.maxUploadBytes) return json(413, { error: `The file is larger than ${Math.round(env.maxUploadBytes / 1024 / 1024)} MB (TROUPE_LIBRARY_MAX_UPLOAD_MB).` });
  if (!req.body) return json(400, { error: "Send the file as the request body." });

  const workspaceId = query.data.workspaceId ?? (await listWorkspacesFor(ctx.db, ctx.userId!))[0]?.id;
  if (!workspaceId) return json(404, { error: "This studio has no workspace yet." });
  try {
    await assertMembership(ctx.db, { workspaceId, userId: ctx.userId! });
  } catch {
    return json(403, { error: "Not a member of this workspace." });
  }

  const mine = query.data.mine === "1" || query.data.mine === "true";
  const fileName = cleanFileName(query.data.name ?? req.headers.get("x-file-name"));
  const itemId = randomUUID();
  try {
    const received = await receiveUpload(Readable.fromWeb(req.body as unknown as NodeReadableStream<Uint8Array>), { itemId, fileName, maxBytes: env.maxUploadBytes });
    const item =
      received.kind === "text"
        ? await addTextItem(ctx.db, { workspaceId, text: received.text, title: query.data.title, mine, fileName })
        : await addFileItem(ctx.db, { workspaceId, itemId, file: received.file, title: query.data.title, mine }).catch(async (error: unknown) => {
            await library.removeFiles([{ storagePath: received.file.storagePath }]);
            throw error;
          });
    library.schedule();
    return json(200, { item: { id: item.id, kind: item.kind, title: item.title, status: item.status } });
  } catch (error) {
    if (error instanceof UploadRefused || error instanceof LibraryError) return json(error instanceof UploadRefused && /larger than/.test(error.message) ? 413 : 400, { error: error.message });
    console.error(JSON.stringify({ event: "library.upload.failed", message: (error as Error).message }));
    return json(500, { error: "The file could not be saved. The server's log has the details." });
  }
}
