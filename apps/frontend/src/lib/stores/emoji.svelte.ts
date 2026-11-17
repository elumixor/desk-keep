import { ICON_COLORS, type IconColor } from "$model/icons";
import { api } from "../api";
import { notices } from "./notices.svelte";
import { storedJson, storeJson } from "./stored";

export type CustomEmoji = ReturnType<typeof api.workspaces>["emoji"]["$get"]["$response"][number];

const CACHE = "keep.emoji.";
const RECENT = "keep.emoji.recent";
const TONE = "keep.emoji.tone";
const COLOR = "keep.emoji.color";
const RECENT_MAX = 24;

/**
 * The open workspace's own emoji, loaded once per workspace and kept on the device so pages draw them offline; and,
 * per device, the icons picked lately, the skin tone emoji are picked in and the colour Lucide icons are.
 */
class EmojiStore {
  list = $state<CustomEmoji[]>([]);
  recent = $state<string[]>(storedJson(RECENT, []));
  /** 0 is the yellow default, 1 to 5 the tones from lightest to darkest. */
  tone = $state<number>(storedJson(TONE, 0));
  /** `null` draws Lucide icons in the text's colour. */
  color = $state<IconColor | null>(ICON_COLORS.find((c) => c === storedJson(COLOR, null)) ?? null);
  readonly #byId = $derived(new Map(this.list.map((e) => [e.id, e])));
  #loadedFor: string | null = null;

  async load(workspaceId: string) {
    if (this.#loadedFor === workspaceId) return;
    this.#loadedFor = workspaceId;
    this.list = storedJson(CACHE + workspaceId, []);
    try {
      const list = await api.workspaces(workspaceId).emoji.$get();
      this.#set(workspaceId, list);
    } catch (error) {
      notices.error(error);
    }
  }

  get(id: string): CustomEmoji | undefined {
    return this.#byId.get(id);
  }

  byName(name: string): CustomEmoji | undefined {
    return this.list.find((e) => e.name === name);
  }

  async add(workspaceId: string, name: string, image: string): Promise<CustomEmoji | null> {
    try {
      const added = await api.workspaces(workspaceId).emoji.$post({ name, image });
      this.#set(
        workspaceId,
        [...this.list, added].sort((a, b) => a.name.localeCompare(b.name)),
      );
      return added;
    } catch (error) {
      notices.error(error);
      return null;
    }
  }

  async remove(workspaceId: string, id: string) {
    const before = this.list;
    this.#set(
      workspaceId,
      before.filter((e) => e.id !== id),
    );
    try {
      await api.workspaces(workspaceId).emoji(id).$delete();
    } catch (error) {
      this.#set(workspaceId, before);
      notices.error(error);
    }
  }

  /** An icon picked goes first among the recent ones. */
  use(icon: string) {
    this.recent = [icon, ...this.recent.filter((i) => i !== icon)].slice(0, RECENT_MAX);
    storeJson(RECENT, this.recent);
  }

  setTone(tone: number) {
    this.tone = tone;
    storeJson(TONE, tone);
  }

  setColor(color: IconColor | null) {
    this.color = color;
    storeJson(COLOR, color);
  }

  #set(workspaceId: string, list: CustomEmoji[]) {
    if (this.#loadedFor !== workspaceId) return;
    this.list = list;
    storeJson(CACHE + workspaceId, list);
  }
}

export const emoji = new EmojiStore();
