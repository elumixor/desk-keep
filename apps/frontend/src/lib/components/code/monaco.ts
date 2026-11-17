import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { PROPERTY_ICON_NAMES } from "$lib/property-icons";
import { local } from "$lib/sync/local.svelte";
import { findProperty, type Schema } from "$model/properties";
import { CLIENT_CALLS } from "$model/script/names";
import type { ScriptSelect } from "$model/script/types";
import { UUID } from "$model/urn";
import { iconClass } from "./pill-icons";

/**
 * Monaco, loaded only when a script is edited: TypeScript with the declarations a script is given, a page picked by
 * name inside `page(…)` and drawn as a pill of its title (the id it is written as hidden), a property named in
 * `prop("…")` drawn as a pill too, calls and properties told apart, and colours from the palette.
 */

self.MonacoEnvironment = {
  getWorker: (_id, label) => (label === "typescript" || label === "javascript" ? new TsWorker() : new EditorWorker()),
};

/**
 * A script is JavaScript, checked strictly with the types it infers: TypeScript's own syntax (annotations, `type`,
 * `satisfies`, `as`) is refused by the checker, and what the runtime leaves out (`FORBIDDEN`) is marked here. Monaco's
 * completions are replaced by `complete`, which offers only what a script may write.
 */
const { javascriptDefaults, ScriptTarget, getJavaScriptWorker } = monaco.typescript;
/** TypeScript's `ModuleDetectionKind.Force`, which Monaco does not export. */
const MODULE_DETECTION_FORCE = 3;
/** TypeScript's "A 'return' statement can only be used within a function body". */
const RETURN_OUTSIDE_FUNCTION = 1108;
javascriptDefaults.setCompilerOptions({
  target: ScriptTarget.ESNext,
  lib: ["es2022"],
  allowJs: true,
  checkJs: true,
  strict: true,
  noEmit: true,
  // Every script a module of its own, so two open scripts' names never meet.
  moduleDetection: MODULE_DETECTION_FORCE,
});
// Monaco checks only a script's syntax by default; a script is checked as TypeScript checks it.
javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
  // A formula is a function's body: its `return` is where it ends.
  diagnosticCodesToIgnore: [RETURN_OUTSIDE_FUNCTION],
});
javascriptDefaults.setModeConfiguration({ ...javascriptDefaults.modeConfiguration, completionItems: false });

const LANGUAGE = "javascript";

/** The keywords a script writes; the rest of JavaScript's are not offered. */
const KEYWORDS = new Set(
  "const let if else for of in while do break continue return switch case default try catch finally throw new true false null undefined".split(
    " ",
  ),
);
/** Keywords a script may not use, marked as a problem where written. */
const FORBIDDEN = new Set(
  "class function var import export with yield async await typeof instanceof void delete debugger extends super this".split(
    " ",
  ),
);
/** The globals of JavaScript a script is offered, beside its own (`page`, `notify`, …) and what it declares. */
const BUILT_INS = new Set(
  "Math JSON Date Array Object String Number Boolean Map Set parseInt parseFloat isNaN isFinite NaN Infinity".split(
    " ",
  ),
);
/** What a script declares itself, or is declared with (the extensions' namespaces are constants). */
const LOCAL_KINDS = new Set(["const", "let", "local var", "parameter", "local function"]);
const OWN = new Set(["page", ...CLIENT_CALLS]);

/** The TypeScript worker's completion entry, as far as it is read here. */
interface Entry {
  readonly name: string;
  readonly kind: string;
  readonly sortText: string;
  readonly replacementSpan?: { readonly start: number; readonly length: number };
}

const offered = (entry: Entry, member: boolean) =>
  entry.kind === "keyword"
    ? KEYWORDS.has(entry.name)
    : member || LOCAL_KINDS.has(entry.kind) || OWN.has(entry.name) || BUILT_INS.has(entry.name);

const KINDS: Readonly<Record<string, monaco.languages.CompletionItemKind>> = {
  keyword: monaco.languages.CompletionItemKind.Keyword,
  const: monaco.languages.CompletionItemKind.Constant,
  let: monaco.languages.CompletionItemKind.Variable,
  "local var": monaco.languages.CompletionItemKind.Variable,
  var: monaco.languages.CompletionItemKind.Variable,
  parameter: monaco.languages.CompletionItemKind.Variable,
  function: monaco.languages.CompletionItemKind.Function,
  "local function": monaco.languages.CompletionItemKind.Function,
  method: monaco.languages.CompletionItemKind.Method,
  property: monaco.languages.CompletionItemKind.Property,
  getter: monaco.languages.CompletionItemKind.Property,
};

const text = (parts?: readonly { readonly text: string }[]) => parts?.map((part) => part.text).join("") ?? "";

/** Where a completion was asked, so its details can be fetched once picked. */
interface Item extends monaco.languages.CompletionItem {
  readonly uri: monaco.Uri;
  readonly offset: number;
}

monaco.languages.registerCompletionItemProvider(LANGUAGE, {
  triggerCharacters: ["."],
  async provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const wordRange = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    const offset = model.getOffsetAt(position);
    // Inside `page(` or `.prop(`, the app's own picker shows instead (`CodePicker`).
    const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
    if (PAGE_ARGUMENT.test(before) || PROPERTY_ARGUMENT.test(before)) return { suggestions: [] };
    const worker = await (await getJavaScriptWorker())(model.uri);
    const info: { isMemberCompletion: boolean; entries: Entry[] } | undefined = await worker.getCompletionsAtPosition(
      model.uri.toString(),
      offset,
    );
    if (!info || model.isDisposed()) return { suggestions: [] };
    const suggestions: Item[] = info.entries
      .filter((entry) => offered(entry, info.isMemberCompletion))
      .map((entry) => {
        const span = entry.replacementSpan;
        const range = span
          ? monaco.Range.fromPositions(model.getPositionAt(span.start), model.getPositionAt(span.start + span.length))
          : wordRange;
        return {
          uri: model.uri,
          offset,
          label: entry.name,
          insertText: entry.name,
          sortText: entry.sortText,
          kind: KINDS[entry.kind] ?? monaco.languages.CompletionItemKind.Property,
          range,
        };
      });
    return { suggestions };
  },
  async resolveCompletionItem(item) {
    const { uri, offset } = item as Item;
    const worker = await (await getJavaScriptWorker())(uri);
    const details = await worker.getCompletionEntryDetails(uri.toString(), offset, String(item.label));
    return details ? { ...item, detail: text(details.displayParts), documentation: text(details.documentation) } : item;
  },
});

/** Inside `page(` before the caret: what is typed of the page (after an opening quote, if any), not yet picked. */
const PAGE_ARGUMENT = /\bpage\(\s*["']?([^"')]*)$/;
/**
 * Inside `.prop(` of a page before the caret: the page (its quoted id, or none for `self`), whether a quote is open,
 * and what is typed of the name.
 */
const PROPERTY_ARGUMENT = /\b(?:self|page\(\s*"([0-9a-f-]{36})"\s*\))\.prop\(\s*(["']?)([^"')]*)$/;
/** What may follow the caret in an argument and is replaced with the pick: a closing quote and bracket. */
const ARGUMENT_END = /^[^"')\]]*["']?[)\]]?/;
/** `page("<id>")`: the quoted id is drawn as the page's title. */
const PAGE_REF = /\bpage\(\s*("[0-9a-f-]{36}")\s*\)/gi;
/** Inside `select(` before the caret: what is typed of the select (after an opening quote, if any), not yet picked. */
const SELECT_ARGUMENT = /\bselect\(\s*["']?([^"')]*)$/;
/** `select("<id>/<property>")`: the quoted reference is drawn as its page and property. */
const SELECT_REF = /\bselect\(\s*("[0-9a-f-]{36}\/[^"\n]+")\s*\)/gi;
/** `prop("Name")`: the quoted name is drawn as a pill. */
const PROPERTY_REF = /\b(?:self|page\(\s*"([0-9a-f-]{36})"\s*\))\.prop\(\s*("[^"\n]+")\s*\)/gi;

/** The pressed page's properties: what `self.prop(` offers before a quote (TypeScript offers them after one). */
let pressed: Schema = [];
/** What `select(` offers. */
let selects: readonly ScriptSelect[] = [];

/** The range an argument's pick replaces: from after the opening parenthesis to its closing one. */
function argumentRange(model: monaco.editor.ITextModel, position: monaco.Position, typed: string) {
  const line = model.getLineContent(position.lineNumber);
  const start = position.column - typed.length + Math.max(typed.lastIndexOf("("), typed.lastIndexOf("[")) + 1;
  const end = position.column + (line.slice(position.column - 1).match(ARGUMENT_END)?.[0].length ?? 0);
  return new monaco.Range(position.lineNumber, start, position.lineNumber, end);
}

monaco.languages.registerCompletionItemProvider(LANGUAGE, {
  triggerCharacters: ["(", '"', "'"],
  provideCompletionItems(model, position) {
    const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
    const select = before.match(SELECT_ARGUMENT);
    if (select) {
      const [typed, query] = select;
      const range = argumentRange(model, position, typed);
      return {
        suggestions: selects
          .filter((s) => s.label.toLowerCase().includes(query.toLowerCase()))
          .map((s, index) => ({
            label: { label: s.label, description: s.options.join(", ") },
            kind: monaco.languages.CompletionItemKind.Enum,
            insertText: `"${s.ref}")`,
            filterText: model.getValueInRange(range),
            sortText: String(index).padStart(4, "0"),
            range,
          })),
      };
    }
    return { suggestions: [] };
  },
});

/**
 * The page being picked at the caret, inside `page(`: what is typed of it, and the range the pick (`"<id>")`)
 * replaces. The app's own page search shows for it (`PagePicker`), not Monaco's list.
 */
export function pageArgument(model: monaco.editor.ITextModel, position: monaco.Position) {
  const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const typed = before.match(PAGE_ARGUMENT);
  return typed ? { query: typed[1], range: argumentRange(model, position, typed[0]) } : null;
}

/**
 * The property being picked at the caret, inside `.prop(` of `self` or of `page("<id>")`: what is typed of it, the
 * range the pick (`"Name")`) replaces, and the properties of that page.
 */
export function propertyArgument(model: monaco.editor.ITextModel, position: monaco.Position) {
  const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const typed = before.match(PROPERTY_ARGUMENT);
  if (!typed) return null;
  const [whole, id, , query] = typed;
  return { query, range: argumentRange(model, position, whole), schema: id ? (local.page(id)?.schema ?? []) : pressed };
}

type Editor = monaco.editor.IStandaloneCodeEditor;

/** Where each match of `pattern`'s first group is in the model. */
function quoted(model: monaco.editor.ITextModel, pattern: RegExp) {
  const text = model.getValue();
  return [...text.matchAll(pattern)].map((match) => {
    const offset = (match.index ?? 0) + match[0].indexOf(match[1]);
    const from = model.getPositionAt(offset);
    const to = model.getPositionAt(offset + match[1].length);
    return { text: match[1].slice(1, -1), range: monaco.Range.fromPositions(from, to) };
  });
}

/** Each property named by `self.prop("…")` or `page("<id>").prop("…")`, with its page's schema. */
function propertyRefs(model: monaco.editor.ITextModel) {
  const text = model.getValue();
  return [...text.matchAll(PROPERTY_REF)].map((match) => {
    const [whole, pageId, quotedName] = match;
    const offset = (match.index ?? 0) + whole.lastIndexOf(quotedName);
    const range = monaco.Range.fromPositions(
      model.getPositionAt(offset),
      model.getPositionAt(offset + quotedName.length),
    );
    const schema = pageId ? (local.page(pageId)?.schema ?? []) : pressed;
    return { name: quotedName.slice(1, -1), schema, range };
  });
}

/**
 * Draws references as pills: a page's quoted id as its title, which the caret steps over and Backspace or Delete takes
 * whole; a property's quoted name without its quotes.
 */
export function drawReferences(editor: Editor) {
  const model = editor.getModel();
  if (!model) return;
  const decorations = editor.createDecorationsCollection();
  /** Every reference's range: each is one token, never edited inside (the caret steps over it, a selection takes it whole). */
  let atoms: monaco.Range[] = [];
  /** The reference a block caret (Vim's normal mode) stands on, drawn as the caret: the whole pill. */
  let under: monaco.Range | null = null;
  const block = () =>
    editor.getOption(monaco.editor.EditorOption.cursorStyle) === monaco.editor.TextEditorCursorStyle.Block;
  const on = (range: monaco.IRange) => (under && monaco.Range.equalsRange(under, range) ? " script-pill-cursor" : "");

  const draw = () => {
    const pageRefs = quoted(model, PAGE_REF).filter((ref) => UUID.test(ref.text));
    const selectRefs = quoted(model, SELECT_REF);
    const propRefs = propertyRefs(model);
    atoms = [...pageRefs, ...selectRefs, ...propRefs].map((ref) => monaco.Range.lift(ref.range));
    const hide = (range: monaco.IRange) => ({
      range,
      options: { inlineClassName: "script-hidden", inlineClassNameAffectsLetterSpacing: true },
    });
    decorations.set([
      ...pageRefs.map((ref) => ({
        ...hide(ref.range),
        options: {
          ...hide(ref.range).options,
          before: {
            content: local.page(ref.text)?.title || "Untitled",
            inlineClassName: `script-pill script-pill-page ${iconClass(local.page(ref.text)?.icon)}${on(ref.range)}`,
            cursorStops: monaco.editor.InjectedTextCursorStops.None,
          },
        },
      })),
      ...selectRefs.map((ref) => ({
        ...hide(ref.range),
        options: {
          ...hide(ref.range).options,
          before: {
            content: selects.find((s) => s.ref === ref.text)?.label ?? "Unknown select",
            inlineClassName: `script-pill${on(ref.range)}`,
            cursorStops: monaco.editor.InjectedTextCursorStops.None,
          },
        },
      })),
      ...propRefs.flatMap((ref) => {
        const { startLineNumber: line, startColumn: start, endColumn: end } = ref.range;
        const definition = findProperty(ref.schema, ref.name);
        const icon = definition ? (definition.icon ?? `lucide:${PROPERTY_ICON_NAMES[definition.type]}`) : undefined;
        return [
          hide(new monaco.Range(line, start, line, start + 1)),
          {
            range: new monaco.Range(line, start + 1, line, end - 1),
            options: {
              inlineClassName: `${icon ? "script-pill script-pill-named" : "script-pill"}${on(ref.range)}`,
              // The icon is text Monaco injects, so the caret's columns stay where the name's characters are.
              ...(icon && {
                before: {
                  content: "\u200b",
                  inlineClassName: `script-pill script-pill-icon ${iconClass(icon)}${on(ref.range)}`,
                  cursorStops: monaco.editor.InjectedTextCursorStops.None,
                },
              }),
            },
          },
          hide(new monaco.Range(line, end - 1, line, end)),
        ];
      }),
    ]);
  };

  const inside = (position: monaco.IPosition) =>
    atoms.find(
      (r) =>
        r.startLineNumber === position.lineNumber && position.column > r.startColumn && position.column < r.endColumn,
    );

  let last = editor.getPosition();
  editor.onDidChangeCursorSelection(({ selection }) => {
    if (selection.isEmpty()) {
      const position = selection.getPosition();
      const atom = inside(position);
      if (atom) {
        // From before it, past it; from after it, onto it (a block caret then stands on the whole pill).
        const forward = !last || last.lineNumber < position.lineNumber || last.column <= atom.startColumn;
        editor.setPosition(forward ? atom.getEndPosition() : atom.getStartPosition());
      }
    } else {
      // A selection reaching into a reference takes all of it.
      const touched = atoms.filter((r) => monaco.Range.areIntersecting(r, selection) && !selection.containsRange(r));
      if (touched.length) {
        const whole = touched.reduce((range: monaco.Range, r) => range.plusRange(r), monaco.Range.lift(selection));
        const reversed = selection.getDirection() === monaco.SelectionDirection.RTL;
        editor.setSelection(
          reversed
            ? monaco.Selection.fromPositions(whole.getEndPosition(), whole.getStartPosition())
            : monaco.Selection.fromPositions(whole.getStartPosition(), whole.getEndPosition()),
        );
      }
    }
    last = editor.getPosition();
    showUnder();
  });

  /** A block caret on a reference's first (hidden) character stands on the whole pill: drawn so, the caret hidden. */
  const showUnder = () => {
    const position = editor.getPosition();
    const next =
      position && block() ? (atoms.find((r) => monaco.Position.equals(position, r.getStartPosition())) ?? null) : null;
    if (next === under || (next && under && monaco.Range.equalsRange(next, under))) return;
    under = next;
    editor.getDomNode()?.classList.toggle("script-caret-on-pill", !!under);
    draw();
  };
  editor.onDidChangeConfiguration(showUnder);

  editor.onKeyDown((event) => {
    const position = editor.getPosition();
    const selection = editor.getSelection();
    if (!position || !selection?.isEmpty()) return;
    // Vim's `x` on a pill takes it whole.
    if (under && event.keyCode === monaco.KeyCode.KeyX && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      editor.executeEdits("pill", [{ range: under, text: "" }]);
      return;
    }
    const back = event.keyCode === monaco.KeyCode.Backspace;
    if (!back && event.keyCode !== monaco.KeyCode.Delete) return;
    const atom = atoms.find((r) => monaco.Position.equals(position, back ? r.getEndPosition() : r.getStartPosition()));
    if (!atom) return;
    event.preventDefault();
    editor.executeEdits("pill", [{ range: atom, text: "" }]);
  });

  model.onDidChangeContent(draw);
  draw();
}

/** What Monaco's own tokens leave plain: a called name, a property, and what is done in the presser's app. */
const CALL = "script-call";
const MEMBER = "script-member";
const CLIENT = "script-client";
const CLIENT_HOVER = { value: "Done in the app of whoever pressed, not to pages" };

/** The class a name gets from what is around it: called or a member, or one of the presser's app's calls. */
function nameClass(line: string, start: number, end: number, name: string) {
  const before = line.slice(0, start).trimEnd().at(-1);
  const after = line.slice(end).trimStart()[0];
  const member = before === ".";
  if (!member && CLIENT_CALLS.has(name)) return CLIENT;
  if (member && /\bconsole\s*\.$/.test(line.slice(0, start).trimEnd())) return CLIENT;
  if (after === "(") return CALL;
  return member ? MEMBER : null;
}

/**
 * Colours names as Monaco's tokens do not: a called function or method, a property, and the calls done in the
 * presser's app (`notify`, `console.log`, …), drawn apart from what changes pages.
 */
export function highlight(editor: Editor) {
  const model = editor.getModel();
  if (!model) return;
  const language = model.getLanguageId();
  const decorations = editor.createDecorationsCollection();
  const draw = () => {
    const lines = model.getLinesContent();
    decorations.set(
      monaco.editor.tokenize(model.getValue(), language).flatMap((tokens, index) => {
        const line = lines[index] ?? "";
        return tokens.flatMap((token, t) => {
          if (!token.type.startsWith("identifier")) return [];
          const end = tokens[t + 1]?.offset ?? line.length;
          const className = nameClass(line, token.offset, end, line.slice(token.offset, end));
          if (!className) return [];
          return [
            {
              range: new monaco.Range(index + 1, token.offset + 1, index + 1, end + 1),
              options: {
                inlineClassName: className,
                hoverMessage: className === CLIENT ? CLIENT_HOVER : undefined,
              },
            },
          ];
        });
      }),
    );
  };
  model.onDidChangeContent(draw);
  // Tokens are plain until the language's tokenizer has loaded, which `colorize` waits for.
  void monaco.editor.colorize("x", language, {}).then(() => !model.isDisposed() && draw());
}

const SYNTAX = "script-syntax";

/** Names that are values, not functions, with how they are used instead: a call to one is marked. */
const NOT_CALLED: Readonly<Record<string, string>> = {
  self: 'self is the pressed page, not called: write self.prop("Name").value',
  workspace: "workspace is a page, not called: write workspace.children",
};

/** What is wrong with a name or keyword as Monaco's tokens find it (never in a comment or a string), if anything. */
function misuse(token: monaco.Token, word: string, line: string, end: number) {
  const member = line.slice(0, token.offset).trimEnd().endsWith(".");
  const after = line.slice(end).trimStart();
  if (token.type.startsWith("keyword"))
    return FORBIDDEN.has(word) && !member && !after.startsWith(":")
      ? `\`${word}\` is not supported in a button's script`
      : null;
  if (!token.type.startsWith("identifier") || !after.startsWith("(") || member) return null;
  return NOT_CALLED[word] ?? null;
}

/** What a button's script may use and a formula may not: everything that reaches outside the page it reads. */
const FORMULA_UNAVAILABLE = new Set([
  ...CLIENT_CALLS,
  "page",
  "workspace",
  "findPages",
  "select",
  "Page",
  "Property",
  "ext",
]);

/** What else a formula may not write: a name that reaches outside it, used as anything but a member. */
function formulaMisuse(token: monaco.Token, word: string, line: string) {
  const member = line.slice(0, token.offset).trimEnd().endsWith(".");
  return token.type.startsWith("identifier") && !member && FORMULA_UNAVAILABLE.has(word)
    ? `A formula only reads its page: ${word} is not available`
    : null;
}

/** A formula with no `return` is empty: said as a warning over its first line. */
function missingReturn(model: monaco.editor.ITextModel, tokens: readonly monaco.Token[][]) {
  if (!model.getValue().trim()) return [];
  const lines = model.getLinesContent();
  const returns = tokens.some((line, index) =>
    line.some((t, i) => {
      const end = line[i + 1]?.offset ?? (lines[index] ?? "").length;
      return t.type.startsWith("keyword") && (lines[index] ?? "").slice(t.offset, end) === "return";
    }),
  );
  if (returns) return [];
  return [
    {
      severity: monaco.MarkerSeverity.Warning,
      message: "Nothing is returned, so the formula is empty: write return …",
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: model.getLineMaxColumn(1),
    },
  ];
}

/**
 * Marks what a script may not write: a forbidden keyword, a page or its values called as a function. A formula
 * (`formula`) is a script with more: it only reads, and returns its value.
 */
export function forbid(model: monaco.editor.ITextModel, formula = false) {
  const mark = () => {
    const lines = model.getLinesContent();
    const tokenized = monaco.editor.tokenize(model.getValue(), LANGUAGE);
    const markers = tokenized.flatMap((tokens, index) => {
      const line = lines[index] ?? "";
      return tokens.flatMap((token, t) => {
        const end = tokens[t + 1]?.offset ?? line.length;
        const word = line.slice(token.offset, end);
        const message = misuse(token, word, line, end) ?? (formula ? formulaMisuse(token, word, line) : null);
        if (!message) return [];
        return [
          {
            severity: monaco.MarkerSeverity.Error,
            message,
            startLineNumber: index + 1,
            startColumn: token.offset + 1,
            endLineNumber: index + 1,
            endColumn: end + 1,
          },
        ];
      });
    });
    monaco.editor.setModelMarkers(model, SYNTAX, [...markers, ...(formula ? missingReturn(model, tokenized) : [])]);
  };
  model.onDidChangeContent(mark);
  void monaco.editor.colorize("x", LANGUAGE, {}).then(() => !model.isDisposed() && mark());
}

/**
 * A CSS colour as Monaco takes it (`#rrggbb`), whatever notation the palette writes it in. It is resolved by the page
 * first (a canvas knows no `var()`), then read back through a canvas, which turns any colour into its pixel.
 */
function hex(color: string) {
  const probe = document.body.appendChild(document.createElement("span"));
  probe.style.color = color;
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "#000000";
  context.fillStyle = resolved;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

const THEME = "keep";

/** The palette's colours as Monaco's theme, applied to every editor; under Vim, the page's Vim cursor and selection. */
export function applyTheme(dark: boolean, vim: boolean) {
  const token = (name: string) => hex(`var(${name})`);
  const mix = (name: string, percent: number, base = "--text") =>
    hex(`color-mix(in srgb, var(${name}) ${percent}%, var(${base}))`);
  const color = (value: string) => value.slice(1);
  monaco.editor.defineTheme(THEME, {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      // The page's code blocks' colours (`--syntax-*`), so a script reads like code anywhere in the app.
      { token: "comment", foreground: color(token("--dim")), fontStyle: "italic" },
      { token: "keyword", foreground: color(token("--syntax-keyword")) },
      { token: "string", foreground: color(token("--syntax-string")) },
      { token: "number", foreground: color(token("--syntax-number")) },
      { token: "type", foreground: color(token("--syntax-title")) },
      { token: "type.identifier", foreground: color(token("--syntax-title")) },
      { token: "regexp", foreground: color(token("--syntax-string")) },
      { token: "string.escape", foreground: color(token("--syntax-number")) },
      { token: "comment.doc", foreground: color(token("--dim")), fontStyle: "italic" },
    ],
    colors: {
      "editor.background": token("--code-bg"),
      "editor.foreground": token("--text"),
      // As a page's line numbers (`.vim-lines`), faded the same way below by `.monaco-editor .line-numbers`.
      "editorLineNumber.foreground": token("--ink-20"),
      "editorLineNumber.activeForeground": token("--ink-45"),
      "editorCursor.foreground": vim ? mix("--accent", 40, "--code-bg") : token("--accent"),
      "editorCursor.background": token("--text"),
      "editor.selectionBackground": mix("--accent", 22, "--code-bg"),
      "editorWidget.background": token("--surface"),
      "editorWidget.border": token("--surface"),
      "editorSuggestWidget.background": token("--surface"),
      "editorSuggestWidget.border": token("--surface"),
      "editorSuggestWidget.foreground": token("--text"),
      "editorSuggestWidget.selectedBackground": mix("--text", 7, "--surface"),
      "editorSuggestWidget.selectedForeground": token("--text"),
      "editorSuggestWidget.highlightForeground": token("--accent"),
      "editorSuggestWidget.focusHighlightForeground": token("--accent"),
      "editorHoverWidget.background": token("--surface"),
      "editorHoverWidget.border": token("--surface"),
      "list.hoverBackground": mix("--text", 5, "--surface"),
    },
  });
  monaco.editor.setTheme(THEME);
}

/** What the script being edited sees (one editor is open at a time): its declarations, the pressed page's properties and the selects. */
export function declare(declarations: string, schema: Schema, named: readonly ScriptSelect[]) {
  javascriptDefaults.setExtraLibs([{ content: declarations, filePath: "file:///keep.d.ts" }]);
  pressed = schema;
  selects = named;
}

export { LANGUAGE, monaco };
