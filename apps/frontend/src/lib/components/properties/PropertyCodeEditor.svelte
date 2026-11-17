<script lang="ts">
  import { untrack } from "svelte";
  import type { Manifest } from "$model/extensions";
  import { FORMULA_TERMS } from "$model/formula/terms";
  import { formulaTypes } from "$model/formula/types";
  import { findProperty, type PropertyDefinition } from "$model/properties";
  import { scriptTerms } from "$model/script/terms";
  import { scriptSelects, scriptTypes } from "$model/script/types";
  import { pressButton } from "$lib/actions";
  import { schemaOf, updateProperty } from "$lib/schema";
  import { formulas } from "$lib/scripts/formula.svelte";
  import { codeEditor } from "$lib/stores/code-editor.svelte";
  import { extensions } from "$lib/stores/extensions.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { local } from "$lib/sync/local.svelte";
  import ScriptEditor from "../code/ScriptEditor.svelte";

  /**
   * The property whose code is being edited (`codeEditor`): a button's script or a formula, kept with Save and dropped
   * with Cancel. A button on a page runs here as it is in the editor, saved or not.
   */
  const editing = $derived(codeEditor.editing);
  const definition = $derived(editing ? findProperty(schemaOf(editing.target), editing.name) : undefined);
  const formula = $derived(definition?.type === "formula");
  const pageId = $derived(editing && "page" in editing.target ? editing.target.page : undefined);
  const scriptExtensions = $derived(extensions.list.map((e) => ({ id: e.id, name: e.name, manifest: e.manifest as Manifest })));
  const schema = $derived(editing ? schemaOf(editing.target) : []);
  /** What `select("…")` can name: the workspace's traits' selects, and the pressed page's own. */
  const selects = $derived.by(() => {
    const pressed = pageId ? local.page(pageId) : undefined;
    return scriptSelects([
      ...(pressed ? [{ id: pressed.id, name: pressed.title, schema: pressed.schema }] : []),
      ...local.traitsOf(workspace.id).map((t) => ({ id: t.id, name: t.name, schema: t.properties })),
    ]);
  });

  const saved = (definition: PropertyDefinition | undefined) =>
    (definition?.type === "formula" ? definition.formula : definition?.code) ?? "";

  let code = $state("");

  // Taken from the definition when it is opened, not again when a sync rewrites its page: edits stay here until saved.
  $effect.pre(() => {
    if (!editing) return;
    const { target, name } = editing;
    code = saved(untrack(() => findProperty(schemaOf(target), name)));
  });

  $effect(() => {
    if (editing && workspace.id) void extensions.load(workspace.id);
  });

  function save() {
    if (editing && definition && code !== saved(definition))
      updateProperty(editing.target, definition.name, formula ? { formula: code } : { code });
  }

  function done() {
    save();
    codeEditor.close();
  }

  const run = () => (pageId && definition ? pressButton(pageId, definition.name, code) : Promise.resolve(null));

  /** A formula's value on this page, computed here as it is typed. */
  async function evaluate() {
    if (!pageId) return null;
    const { value, error } = await formulas.run(pageId, code);
    return { logs: [], result: value, ...(error && { error }) };
  }
</script>

{#if editing && definition}
  {#if formula}
    <ScriptEditor title="Edit {definition.name}" bind:code language="formula" placeholder={'What it is, e.g. return self.prop("Price").value * self.prop("Qty").value'}
      declarations={formulaTypes(schema)} {schema} selects={[]} terms={FORMULA_TERMS}
      edited={code !== saved(definition)} onrun={pageId ? evaluate : undefined} onsave={save} ondone={done} oncancel={() => codeEditor.close()} />
  {:else}
    <ScriptEditor title="Edit {definition.name}" bind:code placeholder={'What pressing it does, e.g. self.prop("Status").value = "Done"'}
      declarations={scriptTypes(schema, scriptExtensions, selects)} {schema} {selects} terms={scriptTerms(scriptExtensions)}
      edited={code !== saved(definition)} onrun={pageId ? run : undefined} onsave={save} ondone={done} oncancel={() => codeEditor.close()} />
  {/if}
{/if}
