import { StatusBar, VimMode } from "monaco-vim";

/**
 * Vim's ex commands for a script's editor: `:w` saves, `:wq` and `:x` save and close, `:q` closes when nothing is
 * left unsaved, `:q!` closes anyway. `:s` and `/` are Vim's own. The commands are Vim's, defined once for every
 * editor, so they act on the editor whose command line typed them (`current`).
 */

export interface ExHandlers {
  save(): void;
  /** Closes, unless there is something unsaved and `force` is not set; answers whether it closed. */
  quit(force: boolean): boolean;
}

interface ExParams {
  readonly argString?: string;
}

interface ExEditor {
  openNotification(text: string): void;
}

type DefineEx = (name: string, prefix: string, run: (cm: ExEditor, params: ExParams) => void) => void;

let current: ExHandlers | null = null;
let defined = false;

const forced = (params: ExParams) => params.argString?.trim().startsWith("!") ?? false;

function quit(cm: ExEditor, force: boolean) {
  if (!current?.quit(force)) cm.openNotification("E37: No write since last change (add ! to override)");
}

function define() {
  const { defineEx } = (VimMode as unknown as { Vim: { defineEx: DefineEx } }).Vim;
  defineEx("write", "w", () => current?.save());
  defineEx("wq", "wq", (cm) => {
    current?.save();
    quit(cm, true);
  });
  defineEx("xit", "x", (cm) => {
    current?.save();
    quit(cm, true);
  });
  defineEx("quit", "q", (cm, params) => quit(cm, forced(params)));
  defined = true;
}

/** Makes `handlers` the ones the ex commands act on, until `release`d. */
export function useExCommands(handlers: ExHandlers) {
  if (!defined) define();
  current = handlers;
  return () => {
    if (current === handlers) current = null;
  };
}

/**
 * Vim's command line (`:`, `/`), shown in the editor's corner. Its mode is not written there: the editor's own badge
 * shows it, as on the page.
 */
export class CommandLine extends StatusBar {
  override setMode() {}
}
