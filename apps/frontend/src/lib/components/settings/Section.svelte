<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, about, children }: { title: string; about: string; children: Snippet } = $props();
</script>

<section class="space-y-3">
  <div>
    <h3 class="border-b border-line pb-2 font-medium">{title}</h3>
    <p class="mt-2 text-[13px] text-ink-45">{about}</p>
  </div>
  {@render children()}
</section>
