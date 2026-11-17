# Keep

Projects, tasks and docs in one tree of pages. People live in [People](https://people.example.com): Keep points at
`https://people.example.com/p/<id>` and keeps only accounts. A workspace is a root page; the tree holds three kinds of node: pages
(with properties), traits (a named set of properties: a page having them all has the trait, so a task is a page with
status, due date and assignee) and views (saved queries of the pages having some traits). Pages link to each other and to things outside Keep by https address, and assistants read and
write all of it over MCP.

- Local development uses a `keep_dev` Postgres database

## Model

Fourteen tables (`apps/backend/server/db/schema`), and three the sync keeps (`sync_mutation`, `sync_tombstone`, `sync_revocation`):

| table              | what it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`             | every node of the tree, its `kind` a page, trait or view: `body` (editor JSON; a trait's or view's description), `schema` (property definitions; a trait's are what its pages have), `properties` (values by property name), `traits` (the traits a page has, worked out by the server), `sort`, `deleted_at`, `archived_at`, `workspace_id` (written by the server from the ancestry), `text` + a generated `tsvector` for search. Titles are unique under a parent |
| `view`             | a view node's query (same id): `traits` (pages having all of them; any page when none), filters (values, `$title`, `$created`, `$updated`, `$parent`, `$under`), sorts, grouping, shown properties, layout, `new_parent` (where "New" puts a page; asked when null), `show_archived`, `cleanup` (its cleanup rule)                                                                                                                                                   |
| `person`           | an account: who signs in (`user_id`, Clerk), was invited (pending until `joined_at`), or neither (an assistant like Pai, with a key), with memberships, shares and keys; `people_id` is who they are in People                                                                                                                                                                                                                                                       |
| `membership`       | person × workspace × role (`owner`, `member`, `guest`), who invited them and when                                                                                                                                                                                                                                                                                                                                                                                    |
| `page_share`       | person × page × role (`view`, `comment`, `edit`, `full`): the page and everything under it shared with an account, who shared it and when                                                                                                                                                                                                                                                                                                                            |
| `comment`          | a note on a page: `body` (text, mentions as `[Label](urn)`), author (`author_id`, a People id), `reply_to` (the comment it answers), `created_at`, `edited_at`; synced                                                                                                                                                                                                                                                                                               |
| `comment_reaction` | an emoji on a comment, once per person (`people_id`, a People id) and emoji; synced                                                                                                                                                                                                                                                                                                                                                                                  |
| `link`             | what a page points to (page and person mentions, embeds, relation and person properties), rebuilt on every write: backlinks, and how outside services find pages that reference them                                                                                                                                                                                                                                                                                 |
| `webhook`, `token` | outbound events per workspace (signing secret sealed as extension tokens are); API keys (hashed) for accounts                                                                                                                                                                                                                                                                                                                                                        |
| `extension`        | an app plugged into a workspace: its manifest URL, the token Keep sends it (AES-GCM sealed under `EXTENSION_SECRET`, else the Clerk secret; never returned) and the last manifest fetched                                                                                                                                                                                                                                                                            |
| `custom_emoji`     | a workspace's own emoji: a name unique in the workspace and the image as a data URL (PNG, JPEG, GIF, WebP or SVG, up to 256 kB)                                                                                                                                                                                                                                                                                                                                      |
| `notification`     | somebody's inbox entry (`recipient`, `actor`: People ids): type (mention, reply, watch, share, invite), page, comment, title, text, deep link, `data` (`changes`, `since`, `via`), a watch's `base` snapshot and coalescing window, `read_at`, and its delivery to People (outbox `state`, `attempts`, `next_attempt_at`); synced to its recipient                                                                                                                   |
| `page_watch`       | a page somebody (`people_id`) watches explicitly, under a client tag (`client`, null for the person's own); unwatching stamps `deleted_at`; synced to its owner                                                                                                                                                                                                                                                                                                      |
| `webhook_delivery` | one event to one hook (`event`, a v2 payload), sent from the outbox with retries                                                                                                                                                                                                                                                                                                                                                                                     |

People live in the People app. A person property holds `{kind: "person", id: <People person id>}`, or `{kind: "group", id}` for a People group (its leader answers for it, and a group or someone who exists only inside one reads a page with the leader's access, which is all Keep knows of them); so does every
author (`page.created_by`, `comment.author_id`, `page_version.author_id`, `custom_emoji.created_by`), and `GET /api/me`
gives the caller's `peopleId` beside the account `id`. Assistants are people too: Pai is a People person with a Keep
account of its own (no Clerk user, no email), a member like anyone, working with a key. The picker searches People through Keep's backend (`/api/people`, members first) and can
create a person there; names and avatars come the same way, cached by id. Every account is linked to its
People person on sign-in and on invite (by Clerk id, then email, else created) with Keep's service key
(`lib/people-api/client.ts`, `PEOPLE_URL` + `PEOPLE_API_KEY`). `bun run db:migrate` also runs `lib/people-api/backfill.ts`, which links
unlinked accounts and rewrites person values and authors that still name Keep accounts.

Property types: text, number, select, multi-select, date (with an optional end), person, relation, checkbox,
url, formula, button, and extension (see below). Formulas are the same JavaScript as a button's script,
read only: the body of a function whose `return` is the value (none is empty), given `self` with its `props` (a relation
as its pages, read one step). They run on the server in QuickJS's synchronous build (`lib/pages/formulas.ts`, 8 MB,
1 s; what throws is empty) and are cached in `properties` as the property their result would be (`{type, value}`: a
number, checkbox, text, date, or pages as a relation), drawn by that type's renderer, read only. The browser computes them too (`lib/scripts/formula.svelte.ts`, the same
`model/formula/run.ts`) from the synced pages, so a value changes the moment what it reads does. A page whose formulas read another page is recomputed when
that page changes. They are edited in the buttons' editor, which marks what reaches outside the page.

A **button** holds no value: it has a `label` and `code`, plain JavaScript (no classes, `function`, `var`,
`typeof`; arrows, `const` and `let`) checked strictly with inferred types in the editor. Pressed in the app, it runs in
the browser (`frontend/src/lib/scripts`) on the synced pages, so its writes show at once and sync behind (an
extension's action is asked of the server); pressed over MCP, it runs on the server (`lib/scripts`), as whoever pressed
it. Both share `model/script` (sandbox, prelude, how values read). Any leftover type syntax is stripped (`sucrase`) and the code runs in QuickJS compiled to
WebAssembly (a module of its own per press, 32 MB, 20 s), which reaches nothing but what the prelude gives it, all
synchronous: `self` (the pressed page), `page("<id, address or title>")`, `workspace`, `findPages(query)`;
a page's `prop("Name").value` (assigning it writes it; `props` lists them all), `children` (`add(page)` moves a page there or makes
a new one, `remove(page)` trashes it), `parent`, `copy()`; `new Page({title, traits, properties: [new Property(name,
type, value)]})`, made once added under a page; lists' `first`, `last` and `sum`; `log`, `notify(text)`, `open(url)`,
`console`, `ask(question, kind?)` for text, a `"number"`, a `"checkbox"`, a `"date"`, one of `["A", "B"]` or of a
`select("<page id>/<property>")` (in the app the script waits for the answer; over MCP it stops and runs again from
the start with the answers, so it must ask before it changes anything); and each installed extension as a namespace with a method per action (`dev.setupProject()`, also
`ext.dev`). Reads and writes go through the same functions as the API, each checked against the presser's rights. What
it said, opened and logged is answered (`POST /api/pages/:id/buttons`, MCP `run_automation`), and what it threw with its
line. The editor (Monaco, loaded when opened) is given the same API as declarations (`model/script/types.ts`), with
the page's properties and their options typed, a page picked by name inside `page(` and drawn as a pill of its title
(the id it is written as hidden), and what a script can use listed under the code with examples to insert
(`model/script/terms.ts`); it grows with its code, shows the type checker's problems, runs the code on the page, and
has a bar for the assistant to come. Renaming a property rewrites `prop("Old")` in buttons and formulas.

**Properties** are a name and a type (with its options, formula, extension type); values are keyed by the name (in any
case). A select is written by option name or id and kept as the id. A select's options are shared by every select of
its name in the workspace (`model/options.ts`): each definition keeps a copy, a new select of a known name takes the
list (its own options joining it by name), and an option added, renamed or removed on one is carried to the others.

**Traits** are like TypeScript interfaces: a trait is a node of the tree (anywhere, its `schema` its properties) and
a page has it when it has all of its properties, same name in any case and same type (`inferTraits` in
`model/traits.ts`). Nobody gives a page a trait: the server works out which it has on every write and keeps them in
`page.traits` (GIN-indexed); which pages could have a trait is found through an index on `prop_keys(schema)`, a page's
lowercased property names. A trait of no properties has no pages; one in the trash is nobody's. Editing a trait, on
its node, changes every page having it (`followTrait`): a rename moves values (and views and formulas naming it), a
type change carries each value across, a new property is added, and a property taken off stays on the pages unless
they are to lose it too. On a page, renaming, retyping or deleting a property one of its traits has asks first: on
that trait (every page having it follows), or on this page alone, which then no longer has the trait. A relation may
be constrained to pages with a trait (`trait` on its definition). A trait made from a database (`0006`) sits under the
database's page.

**Views** are nodes too: the workspace's pages having all of the view's traits (any page when none), kept to where
they are when asked (`$parent`: right under a page; `$under`: anywhere below it) and filtered, sorted, grouped, as a
table, board, list or timeline. Columns are the union of the shown pages' properties, the traits' first. A view shows
on its own node, and inline in any page's body as a block (`/` › View; `[view <id>]` in Markdown) that turns into a
mention (a link) and back. "New" in a view makes a page with its traits' properties and the values its `is` filters
ask for, under the view's `new_parent`, or asks where (the view itself first; "Always here" keeps the choice). A
column added to a view goes to its first trait; a property added in its settings, to all of them. A view of no trait
can create a linked one: empty, under it, with its name. The server runs the same query for assistants (`lib/views.ts`).

**Archiving** puts a page away without trashing it (`page.archived_at`, `lib/pages/archive.ts`): Archive in the page's
top bar or its right-click menu, MCP `edit_page` with `archived: true`. An archived page leaves the sidebar (what is
under it hides with it), views and `find_pages`, yet stays on devices like any page (the sync carries the stamp), opens
by id with a banner and Restore, is found by the app's search, and by `find_pages` with `archived: "include"` or
`"only"`. A view shows archived pages too when its settings say "Show archived". Archiving is a quiet write: no version,
notification or webhook.

A view's **cleanup rule** ("archive pages in this view when Status is Done for 7 days", `view.cleanup`
`{property, value, days}`, set in its settings under "Clean up" or MCP `view.cleanup`) archives the pages the view shows
once the property has held that value (as an `is` filter reads it: an option's name) for that many days, counted from
the page's last change of that property in its history (the oldest version in the unbroken run of its newest versions
holding the value), else from its last update. It runs once when the rule is saved and every day (`lib/cleanup.ts`,
run by `plugins/outbox.ts`); pages it archived come back with Restore.

Under a page's title show every property it has (each marked with the traits having it), the traits it has and its
references (the pages that link to it) once there are some, then "Add property". A trait's node shows its properties
and the pages having it; a view's, its toolbar and what it shows. In the sidebar, the pages under a trait or view fold
into one row ("12 pages · 3 filtered out"). A property with several values (tags, people, linked pages) stays on one line, showing as many
as fit and "N more" for the rest; on references, "N more" opens the full list.

A page has **comments** under its properties, oldest first: a table of its own (`comment`, synced like pages), written
by a person (an assistant like Pai is one). Anyone who may comment on the page (guests too) adds one with Enter; the author edits or deletes their own.
A comment is text written in Keep's editor, so `@` mentions people and pages as in a body; it is stored with its
mentions as `[Label](urn)`. Comments are flat: Reply quotes the comment answered (`reply_to`), and anyone who may
comment puts emoji on a comment (`comment_reaction`, synced). `@` in a body, a title or a comment offers the workspace's
members, then anyone in People, then pages; mentioning (or assigning) somebody who cannot see the page says so and
offers to share it (`POST /api/pages/:id/access` answers who of some People ids can read it).

**Extensions** (`server/lib/extensions`) let another app plug into a workspace without Keep knowing it: Settings ›
Extensions takes a manifest URL and a token. The manifest (fetched on add, cached, refetched hourly or on demand)
lists property types and actions. An `extension` property (`{type: "extension", extension, extType}`) holds
`{urn, label, fields}` values (a list when the type is `multiple`), picked from the app's options endpoint, which
Keep's server calls (`GET …/extensions/:id/options?type=&q=`) so the token never reaches a browser. "Add property" (and a
property's type picker) lists each extension's property types; its actions are called from buttons' scripts
(`dev.setupProject()`). Keep posts the page (effective
values, body text) and the user to the app, writes what it answers in `set` (keyed by property name or the app's type
id; a key the page has no property for becomes one of its own: the app's type, else text/number/checkbox), and its
`message` and `open` reach whoever pressed; an answer with `ok: false` stops the script.

A ` ```mermaid ` code block is a **diagram**: the `/` menu's "Diagram" makes one, the editor draws it under its
source as it is typed and alone when reading, `<keep-page>` draws it too (Mermaid loads only when a page has one),
and it travels as a ` ```mermaid ` fence in Markdown over MCP.

Every write to a page keeps a **version** of it (`page_versions`: title, icon, body, every property it had and values, who and when,
and a summary of what changed), from REST, sync and MCP alike (`lib/pages/record-version.ts`). One author's edits
less than 10 minutes apart grow the same version, so a version is an editing session rather than a keystroke. The
clock button in a page's top bar opens the trail: versions by day with their author, and for the one picked, the
words that changed in the title and body (`model/history.ts`, Markdown lines with unchanged runs folded) and each
property's value before and after. Restoring a version writes it back as a new version of its own.

An **icon** (a page's or a trait's, in the `icon` column) is one string (`model/icons.ts`): an emoji as itself,
`lucide:<name>` or `lucide:<name>:<color>` for a Lucide icon, `noto:<codepoints>` for one of Google's animated Noto
emoji (drawn still from their SVG, played on a loop with Lottie from their CDN while on screen), or `custom:<id>` for
one of the workspace's own emoji. A body holds a Unicode emoji as text and anything else as an inline `emoji` node
(`{icon, name}`), which travels as the emoji, or `:name:`, in Markdown and search.

Links are https addresses: a page `https://keep.example.com/p/<id>`, a person `https://people.example.com/p/<id>` (a group `/g/<id>`), a pai thread `https://pai.example.com/#/thread/<id>` (`model/urn.ts`; parsers still read the legacy `keep:page/<id>`/`people:person/<id>` URNs, which stay the internal keys, as do `balance:block/<id>` (written `https://balance.example.com/calendar?event=<id>`), `money:tx/<id>`, `git:<repo>#<n>`).

## API

REST under `/api` (Zod at the boundary, types reach the frontend through `@elumixor/nitro-client`):

- `GET/POST /api/workspaces`, `GET /api/workspaces/:id/tree|search?q=&by=name|content|both|trash`
- `GET|POST|PATCH|DELETE /api/workspaces/:id/members[/:personId]` (invite `{person | email, role}`), `POST …/members/:personId/resend`, `…/webhooks[/:hookId]`
- `GET|POST /api/workspaces/:id/extensions`, `DELETE …/extensions/:extId`, `POST …/:extId/refresh`, `GET …/:extId/options?type=&q=`
- `GET|POST /api/workspaces/:id/emoji` (`{name, image}`, a data URL), `DELETE …/emoji/:emojiId`
- `POST /api/pages`, `GET|PATCH|DELETE /api/pages/:id` (`schema`, `addProperties`, `renames`, `traits`, `removeTraits`), `POST /api/pages/:id/move|restore|views|actions|buttons`
- `GET /api/pages/:id/versions`, `GET …/versions/:versionId` (the version, the one before it and the diff), `POST …/versions/:versionId/restore`
- `DELETE /api/pages/:id/permanent` (a page in the trash, with everything under it, for good)
- `GET|POST /api/workspaces/:id/traits`, `PATCH|DELETE /api/traits/:id` (`renames`, `drop`), `GET /api/traits/:id/pages?q=`
- `PATCH|DELETE /api/views/:id`, `GET|POST /api/views/:id/rows` (what it shows; "New"), `POST /api/views/:id/properties`
- `GET|POST /api/pages/:id/shares` (`{person | email, role}`), `PATCH|DELETE …/shares/:shareId`, `GET /api/me/shared`
- `GET /api/pages/:id/watchers` (who watches it), `PATCH /api/workspaces/:id/webhooks/:hookId` (`{events}`)
- `GET /api/urn?urn=` (what a pill shows: a page's title, icon and status; a Balance block (its address or `balance:block/<id>`) also carries the block, read from Balance's MCP with `BALANCE_MCP_KEY`), `GET /api/me`, `GET|POST|DELETE /api/me/tokens`

A `PATCH` with `baseUpdatedAt` answers `409` when the page changed since.

A page stays in the trash for 30 days. The server (`plugins/outbox.ts`) empties it every hour, deleting for good
whatever has been there longer, read notifications older than 90 days and webhook deliveries done for 14, and every
15 s sends what the outbox holds that is due and seals webhook secrets still stored plain.

### Sync

The app does not read pages over REST. It keeps every node (page, trait, view), view query, comment and reaction of the person's workspaces, and their own notifications and watches, on the device
(IndexedDB) and writes through one queue, with [`@elumixor/synced`](https://github.com/elumixor/synced): a title, a
block, a value, an icon, a move, a new page or view is drawn the moment it is made, kept queued (on disk too) until the
server takes it, retried when the server cannot be reached, and sent once however often it is retried. Moving
many pages at once is one write (the `move` action, drawn on every page it moves), applied in one transaction.
`POST /api/sync` (`server/lib/sync.ts`) takes the queued writes and answers with everything in the caller's workspaces
that changed since the device last asked (`synced_at`, stamped by a trigger on every write to a page, view or comment;
comments, reactions and pages deleted outright leave a `sync_tombstone`, and once a session a device sends the ids of the pages
it holds to `POST /api/sync/gone`, which buries the ones gone without one, so its next pull takes them off; a view goes to the trash with its node). The tree, a page's
children, ancestors and backlinks, which traits each page has and what each view selects are worked out on the device
with the same `server/model` code the server uses. A trait's properties change through its own route (every page
having it is rewritten), and so do a restore
from the trash, an extension's action and a column added from a view; the app syncs after each.

A visible tab also holds `GET /api/sync/live` open, which checks every 2 s and says when something changed in its workspaces, so an edit made elsewhere (another device, an assistant over MCP) shows within seconds; the tab pulls on it, and every 30 s should the stream be down. An open editor applies only the part that differs, so the cursor stays and undo leaves it alone.

Permissions are one function, `may(access, action)` in `server/model/access.ts` (shared with the app): access is
`none < view < comment < edit < full < owner`, actions read, comment, write, delete, share and admin. A workspace role
gives owners everything, members `full` (all but running the workspace) and guests `comment` (they read and comment).
A page can be shared, with everything under it, as view, comment, edit or full (full may share it on and move it to
the trash): access to a page is the better of the workspace role and the share nearest it up its ancestry
(`accessFor` in `server/lib/access.ts`). A page the caller cannot read is a `404`.

**Sharing and invites.** A share or an invite names a People person or an email: People finds the person with that
email (any of theirs) or writes one down (`POST /api/people/ensure`), and Keep makes them an account that stays pending
until they first sign in or use a key; signing in claims it by People (any verified email, `POST /api/people/claim`),
and only somebody who belongs nowhere yet gets a workspace of their own. Somebody with shares but no membership (a
visitor) sees them under "Shared with me", and their devices sync only those subtrees and the workspace's traits;
taking a share back (or a membership, or moving a page out from under a share) writes a `sync_revocation`, and the
next pull takes off the device whatever it may no longer read. A grant since the last pull sends the whole subtree (or
workspace). Search, views and assistants see the same scope. Owners invite to a workspace (Settings › People), anyone
with full access shares a page (the share button in its top bar, MCP `share_page`).

Callers authenticate with a Clerk session (`Authorization: Bearer` or the `__session` cookie) or a key
(`keep_…`, minted in Settings › Your keys). Pai's key is minted with `bun run pai:key --out <file>` (Pai's account by
`PAI_PEOPLE_ID`; `--workspace <id>` makes it a member there). A request may carry `x-keep-client: <tag>`
(`[A-Za-z0-9._:/-]`, up to 200; an MCP tool's `client` argument overrides it), an opaque tag of the client it writes
through.

### MCP

`POST /mcp`, stateless JSON-RPC. Fourteen tools: `list_workspaces`, `find_pages`, `read_page`, `create_page`,
`edit_page`, `list_workspace_traits`, `list_workspace_views`, `list_people`, `list_extensions`, `share_page`, `comment`,
`watch`, `inbox`, `run_automation` (`list_workspaces` answers `{workspaces, shared}`: memberships, and pages shared from
elsewhere). `create_page`, `edit_page`, `comment`, `watch` and `run_automation` take `client`, the write's tag in place
of `x-keep-client`.
Bodies travel as GitHub-flavored Markdown, mentions as `[Name](https://people.example.com/p/<id>)` and `[Title](https://keep.example.com/p/<id>)` both ways, so a body
read and written back keeps them. Another app's record (`[Title](https://balance.example.com/calendar?event=<id>)`) is a mention too, drawn as `@desk/core`'s
shared pill (title, time, sphere colour; a press opens Balance); its kinds are registered in `apps/frontend/src/lib/pills.ts`. `comment` adds a comment (`reply_to` answers one), edits or deletes your own, and
reacts with an emoji. `read_page` gives a node whole: `kind`, `schema`, `traits` (names), `properties` (by name), body, children,
views, backlinks, comments (with `replyTo` and `reactions`), `ancestors` (`{id, url, title}`, root first; for a
visitor from the share down), and for a view its query and the pages it shows; with `since` (a watch notification's
`data.since`, only the caller's own, or an ISO time) it adds `changes`: what changed since then. A long page is read in
parts: `outline: true` gives the body's top-level headings with each section's length instead of the body, `section`
(a heading's text) only that heading's part, and both give children as `{id, title}` and a `commentCount`
(`model/sections.ts`). `create_page` makes a page, a trait or
a view (`kind`); it and `edit_page` take `traits` (their properties are given), `properties` (a person property by
People id or address) and `define`; on a trait `edit_page` changes every page having it
(`renames`, `drop`). Traits are named by id, name or path (`Projects/Task`) when names repeat. `run_automation` runs a
button property.

Search finds pages two ways (`by`, `both` by default, names first). By name: titles matched fuzzily with
`fuzzysort` (`$model/search`), the same code the app runs on the synced records, so `@`, a relation, `space e` and
⌘K show those at once and offline. By content: Postgres full-text over title (weight A), headings (B) and body plus
property text (C), newer first between equals; every word must match (the last as a prefix), and when that finds
too little, pages matching any meaningful word follow. The app asks the server for these once typing pauses and
lists them under "In the text". `find_pages` leaves archived pages out unless `archived` is `include` or `only`. `find_pages` with `text` alone searches every workspace the key sees unless one is given; with `traits`, `under` or `filter` it queries one workspace, and `text` then narrows it to the search hits. Each
hit has `match` (`name` with the matched title characters in `matches`, or `content` with the passage in
`snippet`, terms in `**bold**`), `path` (ancestor titles), `workspace`, `url` and `updatedAt`.
`list_people` searches People (`query`), the workspace's members first.

```sh
claude mcp add --transport http keep https://keep.example.com/mcp --header "Authorization: Bearer keep_…"
```

### Inbox and watching

Keep tells a person (by People id) when they are mentioned (in a body, a title, a person property or a comment; only
newly, as `addedMentions` diffs the write), replied to (the author of the comment answered), shared a page or invited
to a workspace, and when a page they watch changes. Watching is explicit: the eye in a page's top bar, or MCP `watch`.
A watch covers the page's title, body, properties, comments, its trash and restore, and the pages right under it
added or removed (`child-added`, `child-removed`), not changes deeper in its subtree. Who watches a page shows beside
the eye.

Every write to pages and comments (`lib/pages/write.ts`, `lib/comments.ts`), and shares and invites, runs in
`transact` (`lib/notify/outbox.ts`): what it tells is written in its transaction. Nobody is told of their own write;
a watch skips only writes by its owner through its own client tag (`x-keep-client`), so an assistant's other threads
are told. A recipient who cannot read the page gets nothing. One write tells a person once per page (a reply over a
mention over a watch). A watch's changes within 60 s of the first are merged into one notification per watcher,
client tag and page, told against the page as it was before them (`data.since`, for `read_page`). Only a watch carries
`client` (its own tag); the write's tag is `data.via`.

Notifications are kept in Keep (the Inbox in the sidebar, with the unread count, grouped by page; opening one marks it
read and goes to the page or the comment, `#comment-<id>`) and handed to People (`POST {PEOPLE_URL}/api/notify`, Keep's
service key), which delivers them by email or webhook as the person's channels say and dedupes by id. Delivery is an
outbox (`lib/notify/deliver.ts`): started after the write, and by the server's timer; a 2xx is done, a 5xx, 408, 429 or no
answer is retried with backoff (about a day), any other answer fails it. Links point at `KEEP_URL`; notifications go to
`PEOPLE_NOTIFY_URL` when set (a local Keep on production People points it at local People).

Accepted gap: a trait rewriting its pages (`lib/traits.ts`) and bulk imports tell no one; webhooks still hear of the
trait's rewrite.

### Webhooks

Settings › Webhooks picks which events a hook is sent (`page.created`, `page.changed`, `page.deleted`,
`comment.created`, `comment.changed`, `comment.deleted`) and shows how its last delivery went. Each event is posted
from the outbox (retried as notifications are) as version 2:
`{version: 2, id, ts, type, urn, page, workspace, actor, client, changed, changes, comment?, schema?, traits?, properties?}`.
Every version 1 field means what it did (`urn` is the page for a page event; created and changed pages carry `schema`,
`traits` and `properties`); `id` is the event's (the same for every hook), `actor` a People URN, `client` the write's
tag, `changes` what changed in lines, `comment` `{id, body, author, replyTo}` for a comment event (whose `urn` is
`keep:comment/<id>`). Headers: `x-keep-event`, `x-keep-delivery`, `x-keep-signature: sha256=<hmac of the body>`. The
signing secret is kept sealed under `EXTENSION_SECRET` (the server's timer seals older ones; a build from before sealing signs
with the sealed string, so rolling back past it needs the secrets unsealed first). They are hints: a consumer may re-read the page over the API,
and must be correct with webhooks off.

### Embeds and elements

`/embed/page/<id>` is a page without the app around it. `https://keep.example.com/elements.js` defines
`<keep-pill urn="https://keep.example.com/p/…">` (title, icon, status) and `<keep-page id="…">` (the page, read-only); both use the
visitor's Keep cookie, and the API allows credentials from `*.example.com`.

## Frontend

SvelteKit SPA (Svelte 5, Tailwind 4). Routes: `/`, `/w/<workspace>`, `/w/<workspace>/p/<page>` (`?view=`),
`/embed/page/<id>`, `/sign-in`. Everything else is state on the page: the ⌘K palette, the ⌘N quick create, the row peek, settings.

- Editor: TipTap 3 (ProseMirror) driven directly from Svelte. Markdown shortcuts and Markdown paste, `/` for
  blocks, `@` to mention a page or a person, `+` and a name (or `/page`, `/subpage`) to make a page inside
  this one and mention it there, checklists, code, tables, images.
- Emoji: `:` and a letter or two opens the icon picker searched by what follows (the workspace's own first, then
  Unicode's by shortcode, name and tag, from `emojibase-data`), with the arrows and Enter picking from it while typing
  goes on; `:name:` typed in full becomes its emoji. `/emoji` (or `/icon`) opens the picker at the caret; the page icon,
  on the title's first line, uses the same one. It has tabs for emoji (with skin tone and recents), animated Noto emoji
  and Lucide icons in colours, and "Add custom emoji" uploads a picture under a name for the workspace.
- Completions: after a pause in typing the page goes to `POST /api/pages/:id/complete` as Markdown with the cursor
  marked (`model/completion.ts`), and what the model writes there is shown greyed at the caret (`editor/completion.ts`):
  Tab takes it, Escape or any other edit drops it, typing its own letters keeps it. The server (`lib/completion.ts`)
  adds where the page sits, its property values, the pages next to and under it, the pages it mentions and what the
  search finds for the paragraph being written, and asks Gemini 3.5 Flash Lite through Vercel's AI Gateway
  (`COMPLETION_MODEL` to change) with thinking off, streamed as events. The page's surroundings, the right to write it
  and each search are kept for 20 s, so a pause costs one model call (under a second) and the search runs once a word.
  Calls are tagged `keep` in the gateway, which is how pai's Settings › Spend counts them. Off per device in
  Settings › Keyboard; with no `AI_GATEWAY_API_KEY` the route answers 503 and the editor stays quiet.
- Pages are cached by id in memory (`lib/stores/pages.svelte.ts`): a page seen once opens instantly and is
  refreshed behind; sidebar rows prefetch on hover. Edits show at once and save after 600 ms.
- Views are worked out on the device from the synced records; edits to their pages show at once.

## Development

```sh
bun install
brew services start postgresql@17 && createdb keep_dev && bun run db:migrate
bun run dev            # Nitro on 3240, Vite on 5240
```

`.env` at the root (see `.env.example`): `DATABASE_URL`, the Clerk keys, `PEOPLE_URL`/`VITE_PEOPLE_URL`, `PEOPLE_API_KEY`, `KEEP_URL` (where notification links point; the
local frontend when unset), `AI_GATEWAY_API_KEY` for the editor's completions, and `BALANCE_MCP_KEY` (with `BALANCE_URL`, Balance's production when unset) for Balance block pills.

`bun run import:notion --page <notion page id> --parent <keep page id>` copies a Notion page tree (pages, blocks,
databases as a trait plus a page with a table of its rows) into Keep over the REST API, with `NOTION_TOKEN`, `KEEP_URL` and `KEEP_KEY` set. It needs an
internal integration token from https://www.notion.so/my-integrations with the source page shared to it.

## Migrations

`0006_traits_views` turned every database into a trait (its id the
database page's) and a plain page whose views keep to it, re-keyed values from property id to name, and dropped
`page.kind` and the database schema. `0016_nodes` made traits and views nodes (views that were tabs became blocks
at the end of their page's body), put every property a page has in its `schema`, shared select options by name,
worked out every page's traits, and numbered titles that repeated under a parent.

## Decisions

- Editor: TipTap, used without a Svelte wrapper — its core is framework-free and the bindings were not needed.
- Formulas: the buttons' JavaScript, read only, rather than a language of their own: one thing to learn and one editor.
- Buttons: checked JavaScript rather than a builder of steps, run on the server so the app, MCP and extensions' tokens meet in
  one place. QuickJS (`quickjs-emscripten`, the asyncify build with its WebAssembly inlined, so nothing is left to
  bundle) lets the script wait on the database as if it were synchronous; Node's `vm` is no boundary and a VM per press
  is too slow. Monaco for the editor, as it brings TypeScript's checker and completions (filtered to what a script may write).
- Tests: a local Postgres (Homebrew here, a service container in CI), one scratch database per run.
- `workspace_id` is a cached column, written by the server on insert; pages move only within their workspace.
