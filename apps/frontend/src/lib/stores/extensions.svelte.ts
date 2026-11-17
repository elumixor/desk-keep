import type { ExtensionPropertyType, Manifest } from "$model/extensions";
import type { PropertyDefinition } from "$model/properties";
import { api } from "../api";
import { notices } from "./notices.svelte";

export type InstalledExtension = ReturnType<typeof api.workspaces>["extensions"]["$get"]["$response"][number];

/** The open workspace's extensions with their manifests, loaded once per workspace. */
class Extensions {
  list = $state<InstalledExtension[]>([]);
  #loadedFor: string | null = null;

  async load(workspaceId: string, force = false) {
    if (this.#loadedFor === workspaceId && !force) return;
    this.#loadedFor = workspaceId;
    try {
      this.list = await api.workspaces(workspaceId).extensions.$get();
    } catch (error) {
      notices.error(error);
    }
  }

  get(id: string | undefined): InstalledExtension | undefined {
    return this.list.find((e) => e.id === id);
  }

  manifest(id: string | undefined): Manifest | undefined {
    return this.get(id)?.manifest as Manifest | undefined;
  }

  /** The manifest's description of an `extension` property, if its extension is still installed. */
  typeOf(definition: PropertyDefinition): ExtensionPropertyType | undefined {
    return this.manifest(definition.extension)?.propertyTypes.find((t) => t.id === definition.extType);
  }
}

export const extensions = new Extensions();
