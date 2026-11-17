<script lang="ts">
  import { Editor, Extension, type JSONContent } from "@tiptap/core";
  import { Placeholder } from "@tiptap/extensions";
  import { PluginKey } from "@tiptap/pm/state";
  import StarterKit from "@tiptap/starter-kit";
  import { onMount, untrack } from "svelte";
  import type { DocNode } from "$model/document";
  import { fromInline, toInline } from "$model/markdown";
  import { mentionSuggestion } from "../editor/mention-suggestion";
  import { PageMention } from "../editor/page-mention";

  /**
   * The text of a comment, written in Keep's own editor so `@` mentions people and pages as it does on a page (the same
   * suggestions). It is a contenteditable, not an input, so `ui/TextField` does not apply. `value` is the comment's
   * text: lines, mentions as `[Label](urn)` (`$model/markdown`). Enter calls `onenter` (send), Shift+Enter breaks the
   * line, Escape calls `onescape`.
   */
  let {
    value = $bindable(""),
    pageId,
    label,
    placeholder = "",
    autofocus = false,
    onenter,
    onescape,
  }: {
    value?: string;
    pageId: string;
    label: string;
    placeholder?: string;
    autofocus?: boolean;
    onenter: () => void;
    onescape?: () => void;
  } = $props();

  let host = $state<HTMLDivElement>();
  let editor: Editor | null = null;
  /** The text the editor last wrote out: a `value` set from outside (cleared after sending) is put in. */
  let written = untrack(() => value);

  /** The `@` menu's state: while it is open, Enter and Escape are its own. */
  const mentionKey = new PluginKey("commentMention");
  const menuOpen = (editor: Editor) => !!mentionKey.getState(editor.state)?.active;

  const keys = Extension.create({
    name: "commentKeys",
    // Above the core keymap, which would split the paragraph on Enter.
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        Enter: ({ editor }) => {
          if (menuOpen(editor)) return false;
          onenter();
          return true;
        },
        "Shift-Enter": ({ editor }) => editor.commands.setHardBreak(),
        Escape: ({ editor }) => {
          if (!onescape || menuOpen(editor)) return false;
          onescape();
          return true;
        },
      };
    },
  });

  const doc = (text: string) => fromInline(text) as JSONContent;

  export function focus() {
    editor?.commands.focus("end");
  }

  onMount(() => {
    if (!host) return;
    editor = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          link: false,
          listItem: false,
          listKeymap: false,
          orderedList: false,
          strike: false,
          underline: false,
          trailingNode: false,
        }),
        Placeholder.configure({ placeholder: () => placeholder }),
        PageMention.configure({
          HTMLAttributes: { class: "mention item-inline" },
          suggestion: { ...mentionSuggestion(untrack(() => pageId)), pluginKey: mentionKey },
        }),
        keys,
      ],
      content: doc(untrack(() => value)),
      autofocus: untrack(() => autofocus) ? "end" : false,
      editorProps: {
        attributes: {
          class: "comment-field max-h-60 min-h-8 overflow-y-auto px-2 py-1 text-ink outline-none",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": untrack(() => label),
        },
      },
      onUpdate: ({ editor }) => {
        written = toInline(editor.getJSON() as DocNode);
        value = written;
      },
    });
    return () => {
      editor?.destroy();
      editor = null;
    };
  });

  $effect(() => {
    const next = value;
    if (!editor || next === written) return;
    written = next;
    editor.commands.setContent(doc(next));
  });
</script>

<div class="comment-host min-w-0 flex-1" bind:this={host}></div>
