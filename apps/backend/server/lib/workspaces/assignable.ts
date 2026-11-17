import { z } from "zod";
import { type Assignee, assigneeSchema } from "~/model/properties";
import { groupIdOf, groupUrl, personIdOf, personUrl } from "~/model/urn";
import type { Caller } from "../auth/caller";
import { ApiError } from "../http/api-error";
import { peopleApi } from "../people-api/client";
import { listMembers } from "./members";

/** Who can be assigned: groups from People with their members, then people (assistants among them), the workspace's members first, with their role. */
export async function listAssignable(caller: Caller, workspaceId: string, query?: string) {
  const [members, found, groups] = await Promise.all([
    listMembers(caller, workspaceId),
    peopleApi.search(query),
    peopleApi.groups(query),
  ]);
  const roles = new Map(members.flatMap((m) => (m.peopleId ? [[m.peopleId, m.role] as const] : [])));
  const person = (p: (typeof found)[number]) => ({
    kind: "person" as const,
    id: p.id,
    url: personUrl(p.id),
    name: p.name,
    email: p.emails[0] ?? null,
    role: roles.get(p.id) ?? null,
  });
  return [
    ...groups.map((g) => ({
      kind: "group" as const,
      id: g.id,
      url: groupUrl(g.id),
      name: g.name,
      leader: g.leaderId,
      members: g.members.map(person),
    })),
    ...found.map(person).sort((a, b) => Number(b.role !== null) - Number(a.role !== null)),
  ];
}

/** An assignee as a caller may name one: `{kind, id}`, a People id, or a person's or group's People address (or legacy URN). */
export const assigneeInput = z.union([assigneeSchema, z.string().min(1)]);

/** A bare id may be either, so People is asked which. */
async function named(idOrUrn: string): Promise<Assignee> {
  const group = groupIdOf(idOrUrn);
  if (group) return { kind: "group", id: group };
  const id = personIdOf(idOrUrn) ?? (z.uuid().safeParse(idOrUrn).success ? idOrUrn : null);
  if (!id) throw new ApiError(`Not a People id or address: ${idOrUrn}`);
  return id === idOrUrn && !(await peopleApi.get(id)) && (await peopleApi.group(id))
    ? { kind: "group", id }
    : { kind: "person", id };
}

/** The assignee `input` names, checked to exist in People. */
export async function resolveAssignee(input: z.infer<typeof assigneeInput>): Promise<Assignee> {
  const assignee = typeof input === "string" ? await named(input) : input;
  const found = assignee.kind === "group" ? await peopleApi.group(assignee.id) : await peopleApi.get(assignee.id);
  if (!found) throw new ApiError(`People has no ${assignee.kind} ${assignee.id}`);
  return assignee;
}
