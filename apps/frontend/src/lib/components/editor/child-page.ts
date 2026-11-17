import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { FilePlus } from "lucide-svelte";
import { createPage } from "$lib/actions";
import { pageUrn } from "$model/urn";
import { justEdited } from "./edited";
import { type MenuItem, menuRenderer } from "./menu.svelte";
import { inBody } from "./title";

interface NewPage extends MenuItem {
  readonly title: string;
}

/**
 * `+` and a name makes a page inside this one and mentions it where it was typed. The name may have spaces; a `+`
 * followed by a space is plain text, and offers nothing.
 */
export const ChildPage = Extension.create<{ pageId: string }>({
  name: "childPage",
  // Ahead of Vim, like the other menus: Escape closes the menu before it leaves insert mode.
  priority: 101,
  addOptions() {
    return { pageId: "" };
  },
  addProseMirrorPlugins() {
    const pageId = this.options.pageId;
    return [
      Suggestion<NewPage>({
        editor: this.editor,
        pluginKey: new PluginKey("childPage"),
        char: "+",
        allowSpaces: true,
        allow: ({ state, range, isActive }) => {
          const $from = state.doc.resolve(range.from);
          const mention = state.schema.nodes.mention;
          return (
            inBody(state, range.from) &&
            (isActive || justEdited(state)) &&
            !!mention &&
            $from.parent.canReplaceWith($from.index(), $from.index(), mention)
          );
        },
        items: ({ query }) => {
          if (/^\s/.test(query)) return [];
          const title = query.trim();
          return [
            { title, label: title ? `New page “${title}”` : "New page", icon: FilePlus, hint: "Inside this page" },
          ];
        },
        command: ({ editor, range, props }) => {
          void createPage(pageId, { title: props.title, open: false }).then(({ id }) =>
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: "mention", attrs: { id: pageUrn(id), label: props.title, icon: null } },
                { type: "text", text: " " },
              ])
              .run(),
          );
        },
        render: () => menuRenderer<NewPage>({ hideEmpty: true }),
      }),
    ];
  },
});
