import { mergeAttributes, Node } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { mount, unmount } from "svelte";
import { pageUrn } from "$model/urn";
import EmbeddedView from "../views/EmbeddedView.svelte";

export const VIEW_BLOCK = "viewBlock";

/**
 * A view shown inline in the body: a view node of the tree, laid out as a table, board, list or timeline right where
 * it is placed. The block holds only the view's id; it can be turned back into a mention of the view (a link).
 */
export const ViewBlock = Node.create<{ pageId: string; editable: () => boolean }>({
  name: VIEW_BLOCK,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { pageId: "", editable: () => false };
  },

  addAttributes() {
    return { view: { default: null } };
  },

  parseHTML() {
    return [{ tag: "div[data-view-block]", getAttrs: (dom) => ({ view: (dom as HTMLElement).dataset.view ?? null }) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-view-block": "", "data-view": HTMLAttributes.view })];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.contentEditable = "false";
      dom.className = "my-2";
      dom.dataset.viewBlock = "";
      const viewId = node.attrs.view as string;
      const oncollapse = () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const mention = { type: "mention", attrs: { id: pageUrn(viewId), label: "" } };
        editor
          .chain()
          .insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: "paragraph", content: [mention] })
          .run();
      };
      const select = () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const { view } = editor;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        view.focus();
      };
      const dragstart = (event: DragEvent) => {
        const pos = getPos();
        if (typeof pos !== "number" || !event.dataTransfer) return;
        const { view } = editor;
        const selection = NodeSelection.create(view.state.doc, pos);
        view.dispatch(view.state.tr.setSelection(selection));
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", "");
        event.dataTransfer.setDragImage(dom, 0, 0);
        (view as { dragging: unknown }).dragging = { slice: selection.content(), move: true, node: selection };
      };
      const component = mount(EmbeddedView, {
        target: dom,
        props: {
          viewId,
          canEdit: this.options.editable(),
          oncollapse: this.options.editable() ? oncollapse : undefined,
          onselect: this.options.editable() ? select : undefined,
          ondragstart: this.options.editable() ? dragstart : undefined,
        },
      });
      return {
        dom,
        // Clicks and keys inside the view are the view's, not the editor's.
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy: () => void unmount(component),
      };
    };
  },
});
