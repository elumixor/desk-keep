<script lang="ts">
  import { OPERATORS, scroller, VimBar, VimMode, vimPluginKey } from "@desk/editor";
  import { registerEditor, startOf } from "./focus";
  import { Editor, type JSONContent } from "@tiptap/core";
  import { type Snippet, untrack } from "svelte";
  import { goto } from "$app/navigation";
  import type { DocNode } from "$model/document";
  import { keepsLine, readTitle, savedTitle, type TitleLine, titleLine } from "$model/title";
  import { pageIdOf, personIdOf } from "$model/urn";
  import { pageHref } from "$lib/actions";
  import { peopleApi } from "$lib/stores/people-api.svelte";
  import { completion } from "$lib/stores/completion.svelte";
  import { fresh } from "$lib/stores/fresh";
  import { vim } from "$lib/stores/vim.svelte";
  import BlockHandle from "./BlockHandle.svelte";
  import { pickPageIcon } from "./emoji.svelte";
  import { fromTitleNode, toTitleNode } from "./title";
  import { extensions } from "./extensions";
  import { sameDoc } from "./same-doc";
  import { appear, FIRST_BLOCKS, stream } from "./stream";
  import { notices } from "$lib/stores/notices.svelte";

  /**
   * The page: its title on the first line, then its body, one document. The title's line is the page's `title`, and
   * itself in the body when the plain title cannot say it (see `$model/title`). What it emits comes back as `title`
   * and `content` (the write, drawn at once); anything else that arrives — an edit from
   * another device, an assistant's — replaces what the editor shows. `head` is drawn around the title: the properties
   * below it.
   */
  let {
    pageId,
    title,
    content,
    editable,
    ontitle,
    onicon,
    onchange,
    head,
    brief = false,
    focusTitle = false,
  }: {
    pageId: string;
    title: string;
    content: JSONContent | null;
    editable: boolean;
    ontitle: (title: string) => void;
    /** The page's icon, picked from the button marked `data-page-icon` in the head, or taken out. */
    onicon: (icon: string | null) => void;
    onchange: (doc: JSONContent) => void;
    head?: Snippet;
    /** The title alone (a trait's or view's): no body, no room kept below it. */
    brief?: boolean;
    /** Opens with the cursor at the start of the title, wherever focus was (a peek). */
    focusTitle?: boolean;
  } = $props();

  /** The last body and title the editor emitted or was set to: the server's echo of them is not news. */
  let shown: JSONContent | null = untrack(() => content);
  let shownTitle = untrack(() => title);

  /** The blocks of a long page not drawn yet: they follow a batch a frame (`stream`), and are saved with any edit. */
  const pending: JSONContent[] = [];

  /**
   * The document the editor holds: the title's line, then the body's blocks (an empty line for an empty body); past
   * `limit` blocks, the rest are left in `pending`.
   */
  function compose(title: string, body: JSONContent | null, limit = Infinity): JSONContent {
    const blocks = body?.content?.length ? body.content : [{ type: "paragraph" }];
    pending.splice(0, pending.length, ...blocks.slice(limit));
    const line = titleLine(title, body as DocNode | null) as JSONContent[];
    return { type: "doc", content: [toTitleNode(line), ...blocks.slice(0, limit)] };
  }

  /** A document from elsewhere, changing only what differs: the cursor stays, and undo does not take it back. */
  function applyRemote(instance: Editor, json: JSONContent) {
    const { state, view } = instance;
    const incoming = state.schema.nodeFromJSON(json);
    // The editor's own empty last line is not in what was saved: kept, or the change would reach to the document's end.
    const last = state.doc.lastChild;
    const keepsLine = last?.type.name === "paragraph" && !last.content.size && !incoming.lastChild?.eq(last);
    const doc = keepsLine ? incoming.copy(incoming.content.addToEnd(last)) : incoming;
    const start = state.doc.content.findDiffStart(doc.content);
    const end = state.doc.content.findDiffEnd(doc.content);
    if (start === null || !end) return;
    let { a, b } = end;
    const overlap = start - Math.min(a, b);
    if (overlap > 0) {
      a += overlap;
      b += overlap;
    }
    const tr = state.tr.replace(start, a, doc.slice(start, b));
    view.dispatch(tr.setMeta("addToHistory", false).setMeta("preventUpdate", true));
  }

  /** The body to save: its blocks, and the title's line when the plain title cannot say it. */
  function bodyOf(json: JSONContent): JSONContent {
    const line = fromTitleNode(json.content?.[0]) as TitleLine;
    const content = [...(json.content?.slice(1) ?? []), ...pending];
    return { type: "doc", ...(keepsLine(line) ? { attrs: { title: line } } : {}), content };
  }

  let host = $state<HTMLDivElement>();
  let area = $state<HTMLDivElement>();
  let around = $state<HTMLDivElement>();
  let editor = $state.raw<Editor | null>(null);
  /** Vim's mode while the editor has focus, shown in the corner. */
  let mode = $state<string | null>(null);
  let focused = $state(false);
  /** The bar `/`, `?` and `:` open. */
  let bar = $state<VimBar>();
  let barOpen = $state(false);

  /** Where the mode indicator goes when the line numbers are on the right: the page's left edge; else the right corner. */
  const indicatorLeft = $derived.by(() => {
    if (brief || vim.lineNumbers === "off" || vim.numbersSide !== "right" || !mode || !editor) return undefined;
    return `${scroller(editor.view).getBoundingClientRect().left + 16}px`;
  });

  /** Where a mention opens: a page here, a person in People. */
  const href = (urn: string) => {
    const id = pageIdOf(urn);
    if (id) return pageHref(id);
    const person = personIdOf(urn);
    return person ? peopleApi.url(person) : "#";
  };

  $effect(() => {
    if (!host) return;
    const onPrompt = (kind: "/" | "?" | ":", visual: [number, number] | null) => bar?.open(kind, visual);
    const scrolloff = () => vim.scrolloff;
    // Built once per mount (and again when Vim is switched): the content it starts from is read untracked, or every
    // keystroke would rebuild it.
    const instance = new Editor({
      element: host,
      extensions: extensions(
        href,
        untrack(() => pageId),
        () => editable,
        vim.enabled ? { onPrompt, scrolloff, lineNumbers: () => vim.lineNumbers, numbersSide: () => vim.numbersSide } : null,
        () => completion.enabled && !brief,
        () => untrack(() => around),
        untrack(() => brief),
      ),
      content: untrack(() => compose(title, content, FIRST_BLOCKS)),
      editable: untrack(() => editable),
      editorProps: { attributes: { class: untrack(() => brief) ? "desk-prose prose-keep prose-brief" : "desk-prose prose-keep min-h-[40vh] pb-32", "data-testid": "editor" } },
      onTransaction: ({ editor: e }) => {
        const state = vimPluginKey.getState(e.state);
        mode = state ? (OPERATORS[state.pendingOperator ?? ""] ?? state.mode) : null;
      },
      onFocus: () => (focused = true),
      onBlur: () => (focused = false),
      // The title and the body are saved apart, each only when it changed; the title's line kept in the body is the body's.
      onUpdate: ({ editor: e, transaction }) => {
        const before = transaction.before;
        const { doc } = e.state;
        const line = doc.child(0);
        const lineChanged = !before.firstChild?.eq(line);
        const blocksChanged = !before.content.cut(before.firstChild?.nodeSize ?? 0).eq(doc.content.cut(line.nodeSize));
        if (!lineChanged && !blocksChanged) return;
        const json = e.getJSON();
        if (lineChanged) {
          const next = readTitle(fromTitleNode(json.content?.[0]) as TitleLine);
          if (next !== shownTitle) {
            shownTitle = next;
            ontitle(next);
          }
        }
        const body = bodyOf(json);
        if (blocksChanged || !sameDoc(savedTitle(body as DocNode), savedTitle(shown as DocNode | null))) {
          shown = body;
          onchange(body);
        }
      },
    });
    editor = instance;
    registerEditor(instance);
    // The page comes in a block after another; a long one's tail is drawn over the next frames.
    appear(instance);
    const stop = stream(instance, pending);
    // A page opens with the cursor on the first line after the title, unless focus is already somewhere.
    const active = document.activeElement;
    if (untrack(() => pageId) === fresh.id) {
      // A page just made: the cursor at the end of the empty title, in Insert mode under Vim.
      fresh.id = null;
      if (untrack(() => editable)) {
        instance.commands.focus(instance.state.doc.child(0).nodeSize - 1);
        if (vim.enabled) instance.chain().setVimMode("insert").run();
      }
    } else if (untrack(() => editable && focusTitle)) instance.commands.focus(1);
    else if (untrack(() => editable) && (!active || active === document.body)) instance.commands.focus(startOf(instance));
    return () => {
      stop();
      instance.destroy();
      editor = null;
      registerEditor(null);
    };
  });

  // The line numbers are drawn over the page, so a change in the settings redraws them.
  $effect(() => {
    void [vim.lineNumbers, vim.numbersSide];
    untrack(() => editor?.view.dispatch(editor.state.tr));
  });

  $effect(() => {
    const parts = title;
    const next = content;
    const instance = untrack(() => editor);
    if (!instance) return;
    if (next !== shown && !sameDoc(next, shown)) {
      shown = next;
      shownTitle = parts;
      applyRemote(instance, compose(parts, next));
      return;
    }
    if (parts === shownTitle) return;
    shownTitle = parts;
    // Only the title's line is replaced, so the cursor in the body stays where it is.
    const { state } = instance;
    const line = state.doc.child(0);
    if (readTitle(fromTitleNode(line.toJSON()) as TitleLine) === parts) return;
    const node = toTitleNode(titleLine(parts, shown as DocNode | null) as JSONContent[]);
    const nodes = (node.content ?? []).map((node) => state.schema.nodeFromJSON(node));
    const tr = state.tr.replaceWith(1, line.nodeSize - 1, nodes);
    instance.view.dispatch(tr.setMeta("preventUpdate", true).setMeta("addToHistory", false));
  });

  $effect(() => {
    const instance = editor;
    const next = editable;
    // Untracked and silent: an update it emitted would write the page, which this effect must not depend on.
    untrack(() => instance?.setEditable(next, false));
  });

  function onclick(event: MouseEvent) {
    // The page's icon (or "Add icon") above the title opens the picker that changes it.
    const glyph = (event.target as HTMLElement).closest<HTMLElement>("[data-page-icon]");
    if (glyph && editor && editable) {
      event.preventDefault();
      pickPageIcon(editor, glyph, onicon);
      return;
    }
    // A link opens in a new tab, as a mention opens its page; ⌘U edits it.
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.link");
    if (link) {
      event.preventDefault();
      if (link.href && editor?.state.selection.empty) window.open(link.href, "_blank", "noopener");
      return;
    }
    const mention = (event.target as HTMLElement).closest<HTMLElement>(".mention");
    const urn = mention?.dataset.id;
    if (!urn) return;
    event.preventDefault();
    if (personIdOf(urn)) window.open(href(urn), "_blank", "noopener");
    else void goto(href(urn));
  }
</script>

<!-- The area reaches into the page's left margin, where the block handles sit. -->
<div class="relative -ml-14 pl-14" bind:this={area}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions — a mention is a link inside text the editor owns; Enter on it is the editor's. -->
  <div class="relative" bind:this={host} {onclick}></div>
  {#if editor && area && editable}<BlockHandle {editor} {area} />{/if}
</div>
<!-- Moved into the title's node view once the editor draws it. -->
<div hidden><div bind:this={around}>{@render head?.()}</div></div>
<VimBar bind:this={bar} bind:active={barOpen} {editor} onmessage={(message, kind) => notices.show(message, kind)} />
{#if mode && (focused || barOpen)}
  <!-- On the page's other side than the line numbers. -->
  <VimMode {mode} class="fixed bottom-4 z-30 {indicatorLeft ? '' : 'right-4'}" style={indicatorLeft ? `left: ${indicatorLeft}` : undefined} />
{/if}
