import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createLocalContext } from "~/server/api/local-context";
import { LOCAL_WORKSPACE_ID } from "~/modules/identity";
import { mediaAssets } from "~/modules/generation";
import { supabaseDownloadUrl } from "~/server/media/supabase";
import { serveMediaFile } from "~/server/media/serve";
import { libraryMediaHeaders } from "~/server/media/store";

export async function GET(req: Request, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const ctx = await createLocalContext(req.headers);
    const id = z
      .string()
      .uuid()
      .safeParse((await params).assetId);
    if (!id.success) return new Response("Not found", { status: 404 });
    const [asset] = await ctx.db
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, id.data),
          eq(mediaAssets.workspaceId, LOCAL_WORKSPACE_ID),
          inArray(mediaAssets.kind, ["render", "library", "frame"]),
        ),
      )
      .limit(1);
    if (!asset) return new Response("Not found", { status: 404 });
    const download = new URL(req.url).searchParams.get("download");
    if (asset.kind !== "render")
      return await serveMediaFile(
        asset.storagePath,
        req.headers.get("range"),
        download,
        libraryMediaHeaders(asset.mimeType, download),
      );
    if (asset.meta.storage === "supabase")
      return Response.redirect(await supabaseDownloadUrl(asset.storagePath, download));
    return await serveMediaFile(asset.storagePath, req.headers.get("range"), download);
  } catch (error) {
    if (error instanceof TRPCError) return new Response(error.message, { status: 403 });
    return new Response("File unavailable", { status: 404 });
  }
}
