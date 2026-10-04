import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type TestDb } from "~/test/db";
import { seedFixture, type Fixture } from "~/test/fixture";
import { testCaller } from "~/test/caller";
import { actors, listActors } from "~/modules/actors";
import type { Db } from "~/server/db/types";

const MEMBER = "81111111-1111-4111-8111-111111111111";
const STRANGER = "82222222-2222-4222-8222-222222222222";

let t: TestDb;
let db: Db;
let fx: Fixture;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
  fx = await seedFixture(db, { userId: MEMBER, name: "Recast" });
  await seedFixture(db, { userId: STRANGER, name: "Stranger" });
});

const asMember = (database: Db = db) => testCaller({ db: database, userId: MEMBER });

describe("studio.changeActor", () => {
  it("recasts the project with another available actor", async () => {
    const other = (await listActors(db, {})).find((a) => a.id !== fx.actorId && a.status === "active")!;
    const project = await asMember().studio.changeActor({ projectId: fx.projectId, actorId: other.id });
    expect(project.actorId).toBe(other.id);
  });

  it("refuses an unknown or unavailable actor as a bad request, with the guard's sentence", async () => {
    await expect(asMember().studio.changeActor({ projectId: fx.projectId, actorId: "8aaaaaaa-1111-4111-8111-111111111111" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/not found/) });
    const [benched] = await db.select().from(actors).limit(1);
    await db.update(actors).set({ status: "unavailable" }).where(eq(actors.id, benched!.id));
    await expect(asMember().studio.changeActor({ projectId: fx.projectId, actorId: benched!.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/is unavailable/) });
    await db.update(actors).set({ status: "active" }).where(eq(actors.id, benched!.id));
  });

  it("keeps a stranger out", async () => {
    await expect(testCaller({ db, userId: STRANGER }).studio.changeActor({ projectId: fx.projectId, actorId: fx.actorId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets any other failure through as an internal error, not a bad request", async () => {
    // The database fails as the actor is written.
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "update") return () => { throw new Error("connection lost"); };
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(asMember(failing).studio.changeActor({ projectId: fx.projectId, actorId: fx.actorId })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
