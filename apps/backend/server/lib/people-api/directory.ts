import { ApiError, NotFoundError } from "~/lib/http/api-error";
import { PeopleApiError, peopleApi } from "./client";

const BAD_GATEWAY = 502;
const SEARCH_LIMIT = 20;

type Found = {
  readonly id: string;
  readonly name: string;
  readonly emails: readonly string[];
  readonly avatar: string | null;
};

const shown = ({ id, name, emails, avatar }: Found) => ({ id, name, emails, avatar });

/** Only for the screens' routes: elsewhere a People failure stays a `PeopleApiError`, which the outbox retries on. */
async function answering<T>(ask: () => Promise<T>) {
  try {
    return await ask();
  } catch (error) {
    if (!(error instanceof PeopleApiError)) throw error;
    console.error(error);
    throw new ApiError(error.status === null ? "People is unreachable" : "People refused this", BAD_GATEWAY);
  }
}

/** People as Keep's screens see them: only what they show, through Keep's backend. */
export const findPeople = (q: string) => answering(async () => (await peopleApi.search(q, SEARCH_LIMIT)).map(shown));

const shownGroup = ({ id, name, avatar, leaderId, members }: Awaited<ReturnType<typeof peopleApi.groups>>[number]) => ({
  id,
  name,
  avatar,
  leaderId,
  members: members.map(shown),
});

/** Groups matching `q` with their members, for the pickers. */
export const findGroups = (q?: string) =>
  answering(async () => (await peopleApi.groups(q, SEARCH_LIMIT)).map(shownGroup));

export const addPerson = (name: string) => answering(async () => shown(await peopleApi.create({ name })));

export const personById = (id: string) =>
  answering(async () => {
    const person = await peopleApi.pill(id);
    if (!person) throw new NotFoundError("Person");
    return shown(person);
  });
