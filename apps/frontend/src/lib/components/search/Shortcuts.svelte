<script lang="ts">
  import { tick } from "svelte";
  import { afterNavigate, goto } from "$app/navigation";
  import { page } from "$app/state";
  import { closePage } from "$lib/actions";
  import { latinize } from "@desk/editor/latin-key";
  import { palette } from "$lib/stores/palette.svelte";
  import { quickCreate } from "$lib/stores/quick-create";
  import { sidebar } from "$lib/stores/sidebar.svelte";
  import { tree } from "$lib/stores/tree.svelte";
  import { visits } from "$lib/stores/visits.svelte";
  import { focusEditor } from "$lib/components/editor/focus";
  import { vim } from "$lib/stores/vim.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { synced } from "$lib/sync/client.svelte";

  /**
   * The shortcuts that come with Vim mode, as in Zed: ⌘F shows the open page in the tree and ⌘N opens quick create (Vim mode or not), and outside the editor
   * `space e` / `space o` / `/` find a page. In the tree, j/k move, l/h open and close, Enter opens the page (focus stays on the row) and
   * Escape goes back to the editor. In the editor, Vim's normal mode handles its own keys (`@desk/editor`, `leader.ts`).
   * Outside a field or the editor (which undo their own typing), ⌘Z undoes the last write and ⌘⇧Z / ⌘Y redoes it.
   */
  let leader = false;

  // Mounted once sign-in has loaded, after the first navigation: the page it opened on is recorded here.
  visits.record(page.url.pathname);

  afterNavigate(({ to }) => {
    if (!to) return;
    visits.record(to.url.pathname);
    void tree.show(to.params?.page);
  });

  const rows = () => [...document.querySelectorAll<HTMLAnchorElement>('[role="tree"] [data-tree-id] a')];
  const rowOf = (link: HTMLElement) => link.closest<HTMLElement>("[data-tree-id]");

  /** Opens the page and keeps the row focused, so the tree keys go on from it. */
  async function open(link: HTMLAnchorElement) {
    if (rowOf(link)?.dataset.treeId === page.params.page) return focusEditor();
    await goto(link.href, { keepFocus: true });
    await tick();
    link.focus();
  }

  // A code editor (Monaco) takes its keys through an element that is neither a field nor contenteditable.
  function typing(target: EventTarget | null) {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || !!target.closest(".monaco-editor"))
    );
  }

  function inTree(link: HTMLAnchorElement, key: string) {
    const row = rowOf(link);
    const id = row?.dataset.treeId;
    if (!row || !id) return false;
    const all = rows();
    const at = all.indexOf(link);
    if (key === "j" || key === "ArrowDown") all[at + 1]?.focus();
    else if (key === "k" || key === "ArrowUp") all[at - 1]?.focus();
    else if (key === "l" || key === "ArrowRight") {
      if (row.getAttribute("aria-expanded") === "false") tree.set(id, true);
      else all[at + 1]?.focus();
    } else if (key === "h" || key === "ArrowLeft") {
      if (row.getAttribute("aria-expanded") === "true") tree.set(id, false);
      else {
        const parent = workspace.rows.find((r) => r.id === id)?.parentId;
        document.querySelector<HTMLElement>(`[data-tree-id="${parent}"] a`)?.focus();
      }
    } else if (key === "Enter") void open(link);
    else if (key === "Escape") focusEditor();
    else return false;
    return true;
  }

  /** In the capture phase, so no editor or input can get to the key before the tree does. */
  function onfind(event: KeyboardEvent) {
    tree.shift = event.shiftKey;
    if (onhistory(event)) return;
    onnew(event);
    if (onclose(event)) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "f") return;
    event.preventDefault();
    event.stopPropagation();
    void tree.reveal(page.params.page);
  }

  /** The browser's back and forward (⌘[ ⌘] and the mouse's side buttons) step through the jumplist while it has a place to go; else the browser's own. */
  function onhistory(event: Event) {
    let step: 1 | -1 | 0 = 0;
    if (event instanceof KeyboardEvent) {
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) step = event.key === "[" ? -1 : event.key === "]" ? 1 : 0;
    } else if (event instanceof MouseEvent) step = event.button === 3 ? -1 : event.button === 4 ? 1 : 0;
    if (!step || !visits.can(step)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== "auxclick") void visits.go(step);
    return true;
  }

  /** ⌘W closes the open page: up to its parent, trashing it when blank. */
  function onclose(event: KeyboardEvent) {
    if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.code !== "KeyW" || !page.params.page) return false;
    event.preventDefault();
    event.stopPropagation();
    void closePage(page.params.page);
    return true;
  }

  /** ⌘N opens the popup that makes a page, view or trait, and closes it again. */
  function onnew(event: KeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.code !== "KeyN" || !workspace.id) return;
    event.preventDefault();
    event.stopPropagation();
    if (quickCreate.open) return quickCreate.hide();
    if (palette.open) palette.hide();
    quickCreate.show();
  }

  /** Undo and redo of synced writes: a property renamed or deleted, a page moved, renamed or trashed… */
  function onundo(event: KeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || typing(event.target)) return false;
    const key = event.key.toLowerCase();
    const redo = (key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey);
    if (!redo && !(key === "z" && !event.shiftKey)) return false;
    event.preventDefault();
    if (redo) synced.redo();
    else synced.undo();
    return true;
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || onundo(event) || !vim.enabled) return;
    if (event.ctrlKey && !event.metaKey && !event.altKey && !palette.open && !typing(event.target) && (event.key === "o" || event.key === "i")) {
      event.preventDefault();
      void visits.go(event.key === "o" ? -1 : 1);
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod || event.altKey || palette.open || typing(event.target)) {
      leader = false;
      return;
    }
    latinize(event);
    const link = event.target instanceof HTMLAnchorElement && event.target.closest('[role="tree"]') ? event.target : null;
    if (leader) {
      leader = false;
      if (event.key === "e" || event.key === "o") palette.find();
      else if (event.key === "w") sidebar.showSwitcher();
    } else if (event.key === " ") leader = true;
    else if (event.key === "/") palette.find();
    else if (!link || !inTree(link, event.key)) return;
    event.preventDefault();
  }
</script>

<svelte:window
  {onkeydown}
  onkeydowncapture={onfind}
  onmouseupcapture={onhistory}
  onauxclickcapture={onhistory}
  onkeyup={(event) => (tree.shift = event.shiftKey)}
  onblur={() => (tree.shift = false)}
/>
