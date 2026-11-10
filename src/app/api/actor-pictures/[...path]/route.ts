import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createLocalContext } from "~/server/api/local-context";
import { LOCAL_WORKSPACE_ID } from "~/modules/identity";
import { actorAssets, actors, customPicturePath } from "~/modules/actors";
import { readActorPicture } from "~/server/actor-pictures";

const PICTURE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// The pictures of an actor made in the studio: <actorId>/v<n>/<shot>.<ext>,
// for a member of the actor's workspace only.
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const ctx = await createLocalContext(req.headers);
    const [actorId, version, file, ...rest] = (await params).path;
    const match = file ? /^[a-z-]{1,40}\.(jpg|jpeg|png|webp)$/.exec(file) : null;
    if (
      rest.length ||
      !actorId ||
      !/^[0-9a-f-]{36}$/i.test(actorId) ||
      !version ||
      !/^v\d{1,6}$/.test(version) ||
      !match
    )
      return new Response("Not found", { status: 404 });
    const storagePath = customPicturePath(actorId, Number(version.slice(1)), file!);
    const [row] = await ctx.db
      .select({ id: actorAssets.id })
      .from(actorAssets)
      .innerJoin(actors, eq(actors.id, actorAssets.actorId))
      .where(
        and(
          eq(actorAssets.actorId, actorId),
          eq(actorAssets.storagePath, storagePath),
          eq(actors.workspaceId, LOCAL_WORKSPACE_ID),
        ),
      )
      .limit(1);
    if (!row) return new Response("Not found", { status: 404 });
    const picture = await readActorPicture(storagePath);
    return new Response(Buffer.from(picture.data), {
      headers: {
        "content-type": PICTURE_TYPES[match[1]!]!,
        // A picture set never changes: a new one is a new version.
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof TRPCError) return new Response(error.message, { status: 403 });
    return new Response("Picture unavailable", { status: 404 });
  }
}
