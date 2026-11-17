import { GanttChart, Kanban, List, Table } from "lucide-svelte";
import type { ViewKind } from "$model/views";
import { local } from "./sync/local.svelte";

/** Each layout's icon: a view is drawn as the one it has, everywhere it shows. */
export const VIEW_ICONS = { table: Table, board: Kanban, list: List, timeline: GanttChart } as const satisfies Record<
  ViewKind,
  unknown
>;

/** A view's icon by its id, a table's while it is not known. */
export const viewIcon = (id?: string | null) => VIEW_ICONS[(id && local.view(id)?.kind) || "table"];
