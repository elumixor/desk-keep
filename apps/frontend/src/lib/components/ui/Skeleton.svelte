<script lang="ts">
  let { class: className = "h-4 w-full" }: { class?: string } = $props();
</script>

<div class="animate-pulse rounded-sm bg-ink-5 {className}"></div>
