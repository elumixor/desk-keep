import { latinKey } from "@desk/editor/latin-key";

const VIM_ARROWS: Readonly<Record<string, string>> = {
  h: "ArrowLeft",
  j: "ArrowDown",
  k: "ArrowUp",
  l: "ArrowRight",
};

/** A menu's navigation key: Ctrl+H / J / K / L count as Left / Down / Up / Right. */
export function menuKey(event: KeyboardEvent): string {
  const arrow = event.ctrlKey && !event.metaKey && !event.altKey ? VIM_ARROWS[latinKey(event)] : undefined;
  return arrow ?? event.key;
}
