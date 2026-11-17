import type { SchemaTarget } from "../schema";

/**
 * The property whose code is being edited (`PropertyCodeEditor`, one at a time over everything): a button's script or
 * a formula, by where it is and its name.
 */
class CodeEditing {
  editing = $state<{ readonly target: SchemaTarget; readonly name: string } | null>(null);

  edit(target: SchemaTarget, name: string) {
    this.editing = { target, name };
  }

  close() {
    this.editing = null;
  }
}

export const codeEditor = new CodeEditing();
