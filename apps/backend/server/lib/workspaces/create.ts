import { randomUUID } from "node:crypto";
import { db } from "~/db";
import { memberships, pages } from "~/db/schema";
import type { Account } from "../auth/caller";
import { assertCanOwn } from "./members";

/** A workspace is a root page, made with its owner. */
export async function createWorkspace(owner: Account, title: string, icon?: string) {
  assertCanOwn(owner);
  return db.transaction(async (tx) => {
    const id = randomUUID();
    const [root] = await tx
      .insert(pages)
      .values({ id, workspaceId: id, title, icon, createdBy: owner.peopleId })
      .returning();
    await tx.insert(memberships).values({ personId: owner.id, workspaceId: id, role: "owner" });
    return root;
  });
}
