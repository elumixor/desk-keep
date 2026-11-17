import { z } from "zod";
import { env } from "~/lib/env";
import { groupUrn, personUrn } from "~/model/urn";
import type { ChangeItem, NotificationType } from "~/model/watch";

/** A person as People answers: the fields Keep reads, the rest passed through untouched. */
const peoplePersonSchema = z.looseObject({
  id: z.uuid(),
  urn: z.string(),
  name: z.string(),
  emails: z.array(z.string()),
  avatar: z.string().nullable(),
  userId: z.string().nullable(),
});

/** What People's `/api/urn` answers: anyone it ever had, the deleted too. */
const peoplePillSchema = peoplePersonSchema.omit({ userId: true });

/** A group as People answers. */
const peopleGroupSchema = z.looseObject({
  id: z.uuid(),
  urn: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  leaderId: z.uuid().nullable(),
  members: z.array(peoplePersonSchema),
});

interface NewPeoplePerson {
  readonly name: string;
  readonly emails?: readonly string[];
  readonly avatar?: string | null;
}

/** People did not answer as asked: unreachable (`status` null), a refusal, or an answer of the wrong shape. */
export class PeopleApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
    detail: string,
  ) {
    super(`People ${path}: ${detail}`);
    this.name = "PeopleApiError";
  }
}

/** What Keep asks People to pass on to a person (`POST /api/notify`); People routes it to their channels. */
export interface PeopleNotification {
  readonly id: string;
  readonly to: string;
  readonly source: "keep";
  readonly type: NotificationType;
  readonly title: string;
  readonly text?: string;
  readonly url: string;
  readonly subject: string;
  readonly actor?: string;
  readonly client?: string;
  readonly createdAt: string;
  readonly data: {
    readonly workspace: string;
    readonly page: string;
    readonly comment?: string;
    readonly mention?: "body" | "title" | "property" | "comment";
    readonly property?: string;
    readonly role?: string;
    readonly changes?: readonly ChangeItem[];
    readonly more?: number;
    readonly since?: string;
    readonly via?: string;
  };
}

const NOT_FOUND = 404;
/** Well inside the outbox's lease, so a hung People never has a notification sent twice. */
const TIMEOUT_MS = 10_000;
const SEARCH_LIMIT = 50;

/** People's REST API as Keep's backend, with Keep's service key: people are looked up, found and made there. */
class PeopleApi {
  readonly #url: string;
  readonly #notifyUrl: string;
  readonly #key: string;

  constructor(url: string, key: string, notifyUrl = url) {
    this.#url = url.replace(/\/$/, "");
    this.#notifyUrl = notifyUrl.replace(/\/$/, "");
    this.#key = key;
  }

  async search(q?: string, limit = SEARCH_LIMIT) {
    const query = new URLSearchParams({ limit: String(limit), ...(q ? { q } : {}) });
    return z.array(peoplePersonSchema).parse(await this.#request("GET", `/api/people?${query}`));
  }

  async byUserId(userId: string) {
    const [person] = z
      .array(peoplePersonSchema)
      .parse(await this.#request("GET", `/api/people?${new URLSearchParams({ userId, limit: "1" })}`));
    return person ?? null;
  }

  /** The person with exactly this email, of those whose fields contain it. */
  async byEmail(email: string) {
    const address = email.toLowerCase();
    return (await this.search(address)).find((p) => p.emails.includes(address)) ?? null;
  }

  /** A person by id, or null when People has none (or it was deleted). */
  async get(id: string) {
    const answer = await this.#request("GET", `/api/people/${id}`, undefined, true);
    return answer === null ? null : peoplePersonSchema.parse(answer);
  }

  /** Who an id is, person or group, deleted or not, so an old author keeps their name; null when People never had them. */
  async pill(id: string) {
    for (const urn of [personUrn(id), groupUrn(id)]) {
      const answer = await this.#request("GET", `/api/urn?${new URLSearchParams({ urn })}`, undefined, true);
      if (answer !== null) return peoplePillSchema.parse(answer);
    }
    return null;
  }

  /** A group by id, or null when People has none (or it was deleted). */
  async group(id: string) {
    const answer = await this.#request("GET", `/api/groups/${id}`, undefined, true);
    return answer === null ? null : peopleGroupSchema.parse(answer);
  }

  async groups(q?: string, limit = SEARCH_LIMIT) {
    const query = new URLSearchParams({ limit: String(limit), ...(q ? { q } : {}) });
    return z.array(peopleGroupSchema).parse(await this.#request("GET", `/api/groups?${query}`));
  }

  /** Who stands in for an id that holds no access itself (a group, or someone who exists only inside one), if anyone. */
  async leaderFor(id: string) {
    const answer = await this.#request("GET", `/api/leader/${id}`, undefined, true);
    return answer === null ? null : z.object({ id: z.uuid().nullable() }).parse(answer).id;
  }

  async create(person: NewPeoplePerson) {
    return peoplePersonSchema.parse(await this.#request("POST", "/api/people", person));
  }

  /** The person with this email (any of theirs, any case), written down there now when nobody has it: an invite. */
  async ensureByEmail(email: string, name?: string) {
    return peoplePersonSchema.parse(
      await this.#request("POST", "/api/people/ensure", { email: email.trim().toLowerCase(), ...(name && { name }) }),
    );
  }

  /** The person a Clerk user is, claimed by any of their verified emails or made, as People's own sign-in does. */
  async claim(userId: string) {
    return peoplePersonSchema.parse(await this.#request("POST", "/api/people/claim", { userId }));
  }

  /** The person an account is in People: by its Clerk id, then by email, else written down there now. */
  async ensure(account: {
    readonly userId: string | null;
    readonly email: string | null;
    readonly name: string;
    readonly avatar: string | null;
  }) {
    const found =
      (account.userId ? await this.byUserId(account.userId) : null) ??
      (account.email ? await this.byEmail(account.email) : null);
    return (
      found ??
      (await this.create({ name: account.name, emails: account.email ? [account.email] : [], avatar: account.avatar }))
    );
  }

  /** Hands a notification to People, which delivers it (and dedupes by `id`); throws `PeopleApiError` otherwise. */
  async notify(notification: PeopleNotification) {
    await this.#request("POST", "/api/notify", notification, false, this.#notifyUrl);
  }

  async #request(
    method: string,
    path: string,
    body?: unknown,
    allowMissing = false,
    base = this.#url,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.#key}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new PeopleApiError(path, null, error instanceof Error ? error.message : String(error));
    }
    if (allowMissing && response.status === NOT_FOUND) return null;
    if (!response.ok) throw new PeopleApiError(path, response.status, (await response.text()).slice(0, 300));
    return response.json();
  }
}

export const peopleApi = new PeopleApi(env.PEOPLE_URL, env.PEOPLE_API_KEY, env.PEOPLE_NOTIFY_URL);
