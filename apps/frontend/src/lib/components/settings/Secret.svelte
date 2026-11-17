<script lang="ts">
  let { label, value }: { label: string; value: string } = $props();
</script>

<div class="space-y-1.5 rounded-md bg-accent-soft p-3">
  <p class="text-[13px]">{label}</p>
  <code class="block font-mono text-[12px] break-all select-all" data-testid="secret">{value}</code>
</div>
