<script lang="ts">
  import { onMount } from "svelte";
  import type { Schema } from "$model/properties";
  import type { ScriptSelect } from "$model/script/types";
  import type { Problem } from "./problems";
  import { LoaderCircle } from "lucide-svelte";
  import { fade } from "svelte/transition";
  import { loadEditor } from "./load";
  import CodePicker from "./CodePicker.svelte";
  import type { MenuItem } from "../editor/menu.svelte";
  import { type PageItem, PageSearch } from "../editor/page-search.svelte";
  import { PROPERTY_ICONS, propertyTypeLabel } from "$lib/property-icons";
  import { searchNames } from "$model/search";
  import { OPERATORS, VimMode } from "@desk/editor";

  /** monaco-vim names an operator by its command; the page's names come from its key. */
  const OPERATOR_KEYS: Readonly<Record<string, string>> = { delete: "d", change: "c", yank: "y" };
  import { theme } from "$lib/stores/theme.svelte";
  import { vim } from "$lib/stores/vim.svelte";
  import { notices } from "$lib/stores/notices.svelte";

  /**
   * A code editor (Monaco, loaded when first shown) over `value`: a script, told what it is given by `declarations`, or
   * a formula; as tall as its code, between a few lines and `maxHeight`. `onsave` runs on ⌘S, `onsubmit` on ⌘Enter, `onproblems` gets
   * what the type checker finds wrong. `insert` puts text at the caret.
   */
  let {
    value = $bindable(""),
    declarations,
    schema = [],
    selects = [],
    language = "script",
    placeholder = "",
    maxHeight = 320,
    onsave,
    onsubmit,
    onquit,
    onproblems,
    class: className = "",
  }: {
    value?: string;
    declarations: string;
    /** The properties `self` has, offered in `self.prop(`. */
    schema?: Schema;
    /** What `select("…")` can name. */
    selects?: readonly ScriptSelect[];
    /** A button's script, or a formula: a script that only reads its page and returns its value. */
    language?: "script" | "formula";
    placeholder?: string;
    maxHeight?: number;
    onsave?: () => void;
    onsubmit?: () => void;
    /** Vim's `:q` (`force` for `:q!`): answers whether it closed. */
    onquit?: (force: boolean) => boolean;
    onproblems?: (problems: readonly Problem[]) => void;
    class?: string;
  } = $props();

  const MIN_HEIGHT = 84;
  const LINE_HEIGHT = 21;
  const PADDING = 10;
  /** Under Vim, a line more below the code, where its command line (`:`, `/`) shows without covering any. */
  const bottomPadding = () => PADDING + (vim.enabled ? LINE_HEIGHT : 0);
  let host = $state<HTMLDivElement>();
  let height = $state(MIN_HEIGHT);
  let loaded = $state<typeof import("./monaco")>();
  /** The editor is drawn: until then a spinner holds its place, and it fades in over it. */
  let ready = $state(false);
  /** Vim's mode while the editor has focus, shown in its corner as the page's is. */
  let vimModeName = $state<string | null>(null);
  let focused = $state(false);
  let editor: import("monaco-editor").editor.IStandaloneCodeEditor | undefined;
  /** The page being picked in `page(`, and where its search shows. */
  /** What is being picked at the caret: a page in `page(`, or a property of `schema` in `.prop(`, and where it shows. */
  let picking = $state<{
    query: string;
    range: import("monaco-editor").IRange;
    x: number;
    y: number;
    schema?: Schema;
  } | null>(null);
  /** Where Escape closed the search, so it stays closed until the caret leaves that `page(`. */
  let dismissed: string | null = null;

  /**
   * Whether Escape is the editor's own: a popup of it shows (its suggestions, hints, a hover, the page search), or
   * Vim is in insert or visual mode, which Escape leaves.
   */
  export function takesEscape() {
    const state = (vimMode as { state?: { vim?: { insertMode?: boolean; visualMode?: boolean } } } | undefined)?.state?.vim;
    return (
      !!picking ||
      // Vim's command line (`:`, `/`) takes its own Escape.
      !!commandLine?.contains(document.activeElement) ||
      !!state?.insertMode ||
      !!state?.visualMode ||
      !!host?.querySelector(".suggest-widget.visible, .parameter-hints-widget.visible, .monaco-hover:not(.hidden)")
    );
  }

  /** Escape or a click away: the search closes and the code keeps the focus, in the mode it was in. */
  function cancelPick() {
    if (!picking) return;
    dismissed = `${picking.range.startLineNumber}:${picking.range.startColumn}`;
    picking = null;
    editor?.focus();
  }

  /** A property as the picker lists it: its icon, name and type, the name's matched letters bold. */
  interface PropertyItem extends MenuItem {
    readonly name: string;
  }

  /** The properties of `schema` whose name matches what is typed, best first; all of them before anything is. */
  const propertySearch = (schema: Schema) => (query: () => string) => ({
    get items(): PropertyItem[] {
      const item = (p: Schema[number], matches?: readonly number[]) => ({
        name: p.name,
        label: p.name,
        icon: PROPERTY_ICONS[p.type],
        hint: propertyTypeLabel(p.type),
        matches,
      });
      const q = query();
      if (!q.trim()) return schema.map((p) => item(p));
      return searchNames(schema.map((p) => ({ ...p, title: p.name })), q, schema.length).map((hit) => item(hit.page, hit.matches));
    },
  });

  /** The pick written in place of what was typed: a page's id, or a property's name, quoted and closed. */
  function pick(text: string) {
    if (!editor || !picking) return;
    editor.executeEdits("pick", [{ range: picking.range, text: `${JSON.stringify(text)})`, forceMoveMarkers: true }]);
    picking = null;
    editor.focus();
  }

  /** Puts the caret at a line and column, in view. */
  export function goTo(line: number, column: number) {
    if (!editor) return;
    editor.setPosition({ lineNumber: line, column });
    editor.revealPositionInCenterIfOutsideViewport({ lineNumber: line, column });
    editor.focus();
  }

  export function insert(text: string) {
    if (!editor) return;
    const selection = editor.getSelection();
    if (selection) editor.executeEdits("insert", [{ range: selection, text, forceMoveMarkers: true }]);
    editor.focus();
  }

  onMount(() => {
    let disposed = false;
    let markers: { dispose(): void } | undefined;
    loadEditor()
      .then((module) => {
        if (disposed || !host) return;
        loaded = module;
        const { monaco } = module;
        module.declare(declarations, schema, selects);
        module.applyTheme(theme.dark, vim.enabled);
        const uri = monaco.Uri.parse(`file:///script-${crypto.randomUUID()}.js`);
        const model = monaco.editor.createModel(value, module.LANGUAGE, uri);
        editor = monaco.editor.create(host, {
          model,
          placeholder,
          automaticLayout: true,
          fixedOverflowWidgets: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          scrollbar: { alwaysConsumeMouseWheel: false, verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono"),
          // As a page's code block sets its code.
          fontSize: 13.5,
          lineHeight: LINE_HEIGHT,
          tabSize: 2,
          lineNumbers: "off",
          folding: false,
          glyphMargin: false,
          lineDecorationsWidth: 12,
          renderLineHighlight: "none",
          // As in a page: no washes behind the word under the cursor or the other copies of a selection.
          occurrencesHighlight: "off",
          selectionHighlight: false,
          overviewRulerLanes: 0,
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          padding: { top: PADDING, bottom: bottomPadding() },
          suggestFontSize: 13,
          suggestLineHeight: 30,
          suggest: { showStatusBar: false, preview: true, showInlineDetails: true },
        });
        module.drawReferences(editor);
        module.highlight(editor);
        module.forbid(model, language === "formula");
        const follow = () => {
          const position = editor?.getPosition();
          const page = position && module.pageArgument(model, position);
          const property = !page && position ? module.propertyArgument(model, position) : null;
          const found = page || property;
          const at = found && `${found.range.startLineNumber}:${found.range.startColumn}`;
          if (!found || !position || !editor || !host || at === dismissed) {
            if (at !== dismissed) dismissed = null;
            picking = null;
            return;
          }
          const caret = editor.getScrolledVisiblePosition(position);
          const box = host.getBoundingClientRect();
          if (!caret) return;
          editor.trigger("page", "hideSuggestWidget", null);
          picking = {
            query: found.query,
            range: found.range,
            x: box.left + caret.left,
            y: box.top + caret.top + caret.height + 4,
            ...(property && { schema: property.schema }),
          };
        };
        // Ctrl+J/K move through the completions while they show, as in the page's menus; Vim, after this, lets them be.
        editor.onKeyDown((event) => {
          const { browserEvent } = event;
          const step = browserEvent.ctrlKey && !browserEvent.metaKey ? { j: "selectNextSuggestion", k: "selectPrevSuggestion" }[browserEvent.key] : undefined;
          if (!step || !host?.querySelector(".suggest-widget.visible")) return;
          event.preventDefault();
          event.stopPropagation();
          editor?.trigger("keys", step, null);
        });
        // Opened by typing into `page(`, not by moving through one: it takes the focus.
        model.onDidChangeContent(() => queueMicrotask(follow));
        const fit = () => (height = Math.min(Math.max(editor?.getContentHeight() ?? MIN_HEIGHT, MIN_HEIGHT), maxHeight));
        editor.onDidContentSizeChange(fit);
        fit();
        model.onDidChangeContent(() => (value = model.getValue()));
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onsave?.());
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onsubmit?.());
        markers = monaco.editor.onDidChangeMarkers((changed) => {
          if (changed.some((u) => u.toString() === uri.toString()))
            onproblems?.(
              monaco.editor
                .getModelMarkers({ resource: uri })
                .toSorted((a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn)
                .map((m) => ({
                  message: m.message,
                  line: m.startLineNumber,
                  column: m.startColumn,
                  warning: m.severity < monaco.MarkerSeverity.Error,
                })),
            );
        });
        editor.focus();
        editor.onDidFocusEditorText(() => (focused = true));
        editor.onDidBlurEditorText(() => (focused = false));
        ready = true;
        created = editor;
      })
      .catch((error) => notices.error(error));
    return () => {
      disposed = true;
      markers?.dispose();
      editor?.getModel()?.dispose();
      editor?.dispose();
    };
  });

  $effect(() => loaded?.declare(declarations, schema, selects));
  $effect(() => loaded?.applyTheme(theme.dark, vim.enabled));

  // The page editor's Vim settings: line numbers, lines kept around the cursor, and its blink and glide.
  $effect(() => {
    created?.updateOptions({
      lineNumbers: !vim.enabled || vim.lineNumbers === "off" ? "off" : vim.lineNumbers === "relative" ? "relative" : "on",
      lineNumbersMinChars: 2,
      cursorSurroundingLines: vim.enabled ? vim.scrolloff : 0,
      padding: { top: PADDING, bottom: bottomPadding() },
      cursorBlinking: vim.enabled ? "smooth" : "blink",
      cursorSmoothCaretAnimation: vim.enabled ? "on" : "off",
    });
  });

  // Vim keys while Vim mode is on, loaded only then; switching it off takes them away.
  /** Where Vim's command line (`:`, `/`) is typed. */
  let commandLine = $state<HTMLDivElement>();
  let created = $state.raw<import("monaco-editor").editor.IStandaloneCodeEditor>();
  let vimMode: { dispose(): void } | undefined;
  $effect(() => {
    const target = created;
    if (!target || !vim.enabled) return;
    let gone = false;
    let keys: { dispose(): void } | undefined;
    let release: (() => void) | undefined;
    void Promise.all([import("monaco-vim"), import("./vim-ex")]).then(([{ initVimMode }, ex]) => {
      if (gone) return;
      const adapter = initVimMode(target, commandLine ?? null, ex.CommandLine);
      release = ex.useExCommands({
        save: () => onsave?.(),
        quit: (force) => onquit?.(force) ?? false,
      });
      vimMode = adapter;
      vimModeName = "normal";
      adapter.on("vim-mode-change", ({ mode, subMode }: { mode: string; subMode?: string }) => {
        vimModeName = mode === "visual" && subMode ? `visual-${subMode === "linewise" ? "line" : "block"}` : mode;
      });
      // An operator waiting for its motion (`d`, `c`, `y`) names the mode it puts the editor in, as on the page.
      keys = target.onKeyUp(() => {
        const state = (adapter as { state?: { vim?: { insertMode?: boolean; visualMode?: boolean; inputState?: { operator?: string } } } }).state?.vim;
        const operator = state?.inputState?.operator;
        const pending = operator && OPERATOR_KEYS[operator];
        if (pending) vimModeName = OPERATORS[pending] ?? vimModeName;
        else if (state && !state.insertMode && !state.visualMode && vimModeName && Object.values(OPERATORS).includes(vimModeName)) vimModeName = "normal";
      });
    });
    return () => {
      gone = true;
      release?.();
      keys?.dispose();
      vimMode?.dispose();
      vimMode = undefined;
      vimModeName = null;
    };
  });
</script>

<div class="relative {className}" style="height: {height}px">
  <div bind:this={host} class="size-full overflow-hidden rounded-[inherit] transition-opacity duration-200 {ready ? 'opacity-100' : 'opacity-0'}"></div>
  {#if vimModeName && focused}<VimMode mode={vimModeName} class="absolute right-2 bottom-2" />{/if}
  <!-- At the editor's bottom, in the line kept empty for it; monaco-vim shows it as a block. -->
  <div bind:this={commandLine} class="vim-command-line absolute inset-x-2 bottom-1.5 z-10 !flex h-7 items-center rounded-sm bg-surface px-2 font-mono text-[13px] text-ink shadow-panel"></div>
  {#if !ready}
    <div class="absolute inset-0 grid place-items-center text-ink-30" out:fade={{ duration: 150 }}><LoaderCircle size={18} class="animate-spin" /></div>
  {/if}
</div>
{#if picking?.schema}
  <CodePicker initial={picking.query} x={picking.x} y={picking.y} label="Search properties" search={propertySearch(picking.schema)}
    onpick={(item) => pick(item.name)} oncancel={cancelPick} />
{:else if picking}
  <CodePicker initial={picking.query} x={picking.x} y={picking.y} label="Search pages" search={(query) => new PageSearch(query)}
    onpick={(page) => pick((page as PageItem).id)} oncancel={cancelPick} />
{/if}
