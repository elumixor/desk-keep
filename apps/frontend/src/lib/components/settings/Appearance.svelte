<script lang="ts">
  import { PALETTES, type Palette, type ThemeKind, type ThemeMode } from "@desk/core";
  import { Monitor, Moon, Sun } from "lucide-svelte";
  import { theme } from "$lib/stores/theme.svelte";
  import Section from "./Section.svelte";

  const MODES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "system", label: "System", icon: Monitor },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ];
  const KINDS: { kind: ThemeKind; label: string }[] = [
    { kind: "light", label: "Light theme" },
    { kind: "dark", label: "Dark theme" },
  ];
  const LINES = [46, 70, 58, 80, 40];

  const option = "flex h-8 items-center gap-2 rounded-sm px-3 transition-colors [&>svg]:text-ink-45";
</script>

{#snippet swatch(p: Palette, kind: ThemeKind)}
  {@const [bg, panel, line, ink, accent] = p.swatch}
  {@const on = theme.choice[kind] === p.id}
  <button
    role="radio"
    aria-checked={on}
    title={p.name}
    class="flex flex-col gap-1.5 rounded-md border-2 p-1 text-left text-[12px] transition-colors {on ? 'border-accent text-ink' : 'border-transparent text-ink-45 hover:border-line'}"
    onclick={() => theme.choose({ [kind]: p.id, mode: kind })}
  >
    <span class="flex h-14 overflow-hidden rounded-sm border" style="background:{bg};border-color:{line}">
      <span class="w-1/4" style="background:{panel}"></span>
      <span class="flex flex-1 flex-col justify-center gap-1 px-2">
        {#each LINES as width, i (i)}<span class="h-1 rounded-full" style="background:{i % 2 ? accent : ink};width:{width}%;opacity:{i % 2 ? 0.9 : 0.35}"></span>{/each}
      </span>
    </span>
    <span class="truncate px-0.5">{p.name}</span>
  </button>
{/snippet}

<Section title="Appearance" about="Keep follows the system until you pick a mode on this device. Picking a theme switches to its mode.">
  <div class="flex gap-2" role="radiogroup" aria-label="Mode">
    {#each MODES as m (m.value)}
      {@const on = theme.choice.mode === m.value}
      <button role="radio" aria-checked={on} class="{option} {on ? 'bg-ink-10 font-medium' : 'bg-ink-5 hover:bg-ink-10'}" onclick={() => theme.choose({ mode: m.value })}><m.icon size={16} /> {m.label}</button>
    {/each}
  </div>
  {#each KINDS as k (k.kind)}
    <div class="space-y-2 pt-2">
      <p class="text-[13px] font-medium">{k.label}</p>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2" role="radiogroup" aria-label={k.label}>
        {#each PALETTES.filter((p) => p.kind === k.kind) as p (p.id)}{@render swatch(p, k.kind)}{/each}
      </div>
    </div>
  {/each}
</Section>
