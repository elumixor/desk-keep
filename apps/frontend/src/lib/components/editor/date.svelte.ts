import { mergeAttributes, Node } from "@tiptap/core";
import { mount, unmount } from "svelte";
import { POPUP } from "$lib/popup";
import { dateRangeLabel } from "$lib/time";
import { DATE_NODE, dateNodeText } from "$model/dates";
import type { DateValue } from "$model/properties";
import DatePicker from "../properties/DatePicker.svelte";

/** Lucide's calendar, small, before the date. */
function icon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "date-mention-icon");
  svg.innerHTML =
    '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>';
  return svg;
}

const GAP = 4;
const MARGIN = 8;

/** A day in text (`@today`, `@12.3.2025`, `/date`): kept as `YYYY-MM-DD` (and `end`, for a range), shown as "Today", "Tomorrow" or the date. */
export const DateNode = Node.create({
  name: DATE_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      date: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-date") ?? "",
        renderHTML: (attributes) => ({ "data-date": attributes.date }),
      },
      end: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-end"),
        renderHTML: (attributes) => (attributes.end ? { "data-end": attributes.end } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-day]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-day": "", class: "date-mention" }),
      dateRangeLabel(node.attrs.date, node.attrs.end),
    ];
  },

  renderText({ node }) {
    return dateNodeText(node.attrs);
  },

  renderMarkdown(node) {
    return dateNodeText(node.attrs);
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("span");
      dom.className = "date-mention";
      dom.contentEditable = "false";
      if (editor.isEditable) dom.style.cursor = "pointer";
      const draw = () => {
        dom.title = dateNodeText(current.attrs);
        dom.replaceChildren(
          icon(),
          document.createTextNode(`\u2060${dateRangeLabel(String(current.attrs.date), current.attrs.end)}`),
        );
      };
      draw();

      let close: (() => void) | null = null;

      const open = () => {
        const host = document.createElement("div");
        host.className = `fixed z-50 w-64 text-left ${POPUP}`;
        document.body.append(host);
        const props = $state<{ value: DateValue | null }>({
          value: { start: current.attrs.date, ...(current.attrs.end && { end: current.attrs.end }) },
        });
        const set = (attrs: Record<string, unknown>) => {
          const pos = getPos();
          if (typeof pos === "number") editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, attrs));
        };
        const picker = mount(DatePicker, {
          target: host,
          props: {
            get value() {
              return props.value;
            },
            onpick: (next: DateValue | null) => {
              if (!next) {
                shut();
                const pos = getPos();
                if (typeof pos === "number")
                  editor
                    .chain()
                    .focus()
                    .deleteRange({ from: pos, to: pos + current.nodeSize })
                    .run();
                return;
              }
              props.value = next;
              set({ date: next.start.slice(0, 10), end: next.end?.slice(0, 10) ?? null });
            },
          },
        });
        const outside = (event: MouseEvent) => {
          if (!host.contains(event.target as globalThis.Node) && !dom.contains(event.target as globalThis.Node)) shut();
        };
        const onEscape = (event: KeyboardEvent) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          shut();
        };
        function shut() {
          removeEventListener("mousedown", outside, true);
          removeEventListener("keydown", onEscape, true);
          void unmount(picker);
          host.remove();
          close = null;
        }
        close = shut;
        addEventListener("mousedown", outside, true);
        addEventListener("keydown", onEscape, true);
        const place = () => {
          const rect = dom.getBoundingClientRect();
          const { offsetWidth: w, offsetHeight: h } = host;
          const left = Math.min(Math.max(MARGIN, rect.left), innerWidth - w - MARGIN);
          const below = rect.bottom + GAP;
          const top = below + h > innerHeight - MARGIN && rect.top - h - GAP > MARGIN ? rect.top - h - GAP : below;
          host.style.left = `${left}px`;
          host.style.top = `${top}px`;
        };
        place();
        requestAnimationFrame(place);
      };

      dom.addEventListener("click", (event) => {
        if (!editor.isEditable) return;
        event.preventDefault();
        if (close) close();
        else open();
      });

      return {
        dom,
        update: (next) => {
          if (next.type !== current.type) return false;
          current = next;
          draw();
          return true;
        },
        destroy: () => close?.(),
      };
    };
  },
});
